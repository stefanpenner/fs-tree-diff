'use strict';

const fs = require('fs');
const path = require('path-posix');
const assign = require('object-assign');
const symlinkOrCopy = require('symlink-or-copy');
const Entry = require('./entry');
const logger = require('heimdalljs-logger')('fs-tree-diff:');
const util = require('./util');
const treeOptionHelpers = require('./tree-option-helpers');
const md5hex = require('md5hex');
const MatcherCollection = require('matcher-collection');
const merge = require('lodash.merge');
const existsSync = require('exists-sync');
const walkSync = require('walk-sync');
const Minimatch = require('minimatch').Minimatch;


const chompPathSep = util.chompPathSep;
const lchompPathStart = util.lchompPathStart;
const entry2Stat = util.entry2Stat;
const sortAndExpand = treeOptionHelpers.sortAndExpand;
const entryRelativePath = util.entryRelativePath;
const validateSortedUnique = treeOptionHelpers.validateSortedUnique;
const isFile = Entry.isFile;
const isDirectory = Entry.isDirectory;

const DEFAULT_DELEGATE = {
  unlink: function(inputPath, outputPath, relativePath) {
    fs.unlinkSync(outputPath);
  },
  rmdir: function(inputPath, outputPath, relativePath) {
    fs.rmdirSync(outputPath);
  },
  mkdir: function(inputPath, outputPath, relativePath) {
    fs.mkdirSync(outputPath);
  },
  change: function(inputPath, outputPath, relativePath) {
    // We no-op if the platform can symlink, because we assume the output path
    // is already linked via a prior create operation.
    if (symlinkOrCopy.canSymlink) {
      return;
    }

    fs.unlinkSync(outputPath);
    symlinkOrCopy.sync(inputPath, outputPath);
  },
  create: function(inputPath, outputPath, relativePath) {
    symlinkOrCopy.sync(inputPath, outputPath);
  }
};

const STARTED = 'started';
const STOPPED = 'stopped';

function TRUE() { return true; }

module.exports = FSTree;

function FSTree(options) {
  options = options || {};

  if (options.parent) {
    this.parent = options.parent;
  } else {
    this.parent = null;
    this.entries = options.entries;
    let entries = this.entries;

    if (options.sortAndExpand) {
      sortAndExpand(entries);
    } else {
      validateSortedUnique(entries);
    }
  }

  this.parent = options.parent || null;
  this.cwd = options.cwd || '';
  this.files = options.files ||  null;
  this.exclude = options.exclude || [];
  this.include = options.include || [];

  /**
    Indicates whether this tree should act as a source tree.  A source tree is
    one that has to reread its root to discover changes, rather than tracking
    its changes from calls to `mkdirSync`, `writeFileSync` &c.

    There are two kinds of source trees:

      1.  Trees that are no plugin's output, ie the input trees for leaf nodes
          that refer to source directories.
      2.  Trees that are the output of a plugin that does not support the
          fsFacade feature and therefore still uses fs to write.
  */
  this.srcTree = !! options.srcTree;

  if ('root' in options) {
    let root = options.root;

    validateRoot(root);
    this.root = path.normalize(options.root + path.sep);
  }

  if (!this.parent) {
    this.__changes = [];
    this.start();
  }
}

function validateRoot(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) {
    throw TypeError(`Root must be an absolute path, tree.root: '${root}'`);
  }
}

FSTree.prototype = {
  get _changes() {
      return this.parent ? this.parent._changes : this.__changes;
  },

  get _hasEntries() {
    return this.parent ? this.parent._hasEntries : this.__hasEntries;
  },

  get cwd() {
    return this._cwd;
  },

  set cwd(value) {
    this._cwd = value;
  },

  get entries() {
    return this.parent ? this.parent.entries : this._entries;
  },

  set entries(value) {
    if (this.parent) {
      this.parent.entries = value;
    } else {
      this._entries = value || [];
      this.__hasEntries = Array.isArray(value);
    }
  },

  get exclude() {
    return this.parent ? this.parent.exclude : this._exclude;
  },

  set exclude(value) {
    if (this.parent) {
      this.parent.exclude = value;
    } else {
      this._exclude = value;
    }
  },

  get files() {
    return this.parent ? this.parent.files : this._files;
  },

  set files(value) {
    if (this.parent) {
      this.parent.files = value;
    } else {
      this._files = value;
    }
  },

  get include() {
    return this.parent ? this.parent.include : this._include;
  },

  set include(value) {
    if (this.parent) {
      this.parent.include = value;
    } else {
      this._include = value;
    }
  },

  get parent() {
    return this._parent;
  },

  set parent(value) {
    this._parent = value;
  },

  get _relativePathToChange() {
    return this.parent ? this.parent._relativePathToChange : this.__relativePathToChange;
  },

  set _relativePathToChange(value) {
    if (this.parent) {
      this.parent._relativePathToChange = value;
    } else {
      this.__relativePathToChange = value;
    }
  },

  get _state() {
    return this.parent ? this.parent._state : this.__state;
  },

  set _state(value) {
    if (this.parent) {
      this.parent._state = value;
    } else {
      this.__state = value;
    }
  },
};


FSTree.fromParent = function(tree, options) {
  return new FSTree(Object.assign({}, options, {
    parent: tree,
    root: tree.root,
    srcTree: false,
  }));
};

FSTree.fromPaths = function(paths, options) {
  if (typeof options !== 'object') { options = {}; }

  return new FSTree(merge(options, {
    entries:  paths.map(e => Entry.fromPath(e)),
  }));
};

FSTree.fromEntries = function(entries, options) {
  if (typeof options !== 'object') { options = {}; }

  return new FSTree(merge(options, {
    entries: entries
  }));
};

Object.defineProperty(FSTree.prototype, 'size', {
  get: function() {
    return this.entries.length;
  }
});

FSTree.prototype.addEntries = function(entries, options) {
  if (!Array.isArray(entries)) {
    throw new TypeError('entries must be an array');
  }
  if (options && options.sortAndExpand) {
    sortAndExpand(entries);
  } else {
    validateSortedUnique(entries);
  }
  var fromIndex = 0;
  var toIndex = 0;
  while (fromIndex < entries.length) {
    while (toIndex < this.entries.length &&
           entryRelativePath(this.entries[toIndex]) < entryRelativePath(entries[fromIndex])) {
      toIndex++;
    }
    if (toIndex < this.entries.length &&
        entryRelativePath(this.entries[toIndex]) === entryRelativePath(entries[fromIndex])) {
      this.entries.splice(toIndex, 1, entries[fromIndex++]);
    } else {
      this.entries.splice(toIndex++, 0, entries[fromIndex++]);
    }
  }
};

FSTree.prototype.addPaths = function(paths, options) {
  this.addEntries(paths.map(e => Entry.fromPath(e)), options);
};

// TODO: maybe don't allow calls to `start, stop` on child trees?  but instead
// only read state from parent
FSTree.prototype.start = function() {
  this._changes.splice(0, this._changes.length);
  this._relativePathToChange = Object.create(null);
  this._state = STARTED;
};

FSTree.prototype.stop = function() {
  this._state = STOPPED;
};

FSTree.prototype._normalizePath = function(relativePath) {
  return lchompPathStart(chompPathSep(path.normalize(`${this.cwd}${relativePath}`)));
};

FSTree.prototype.resolvePath = function(relativePath) {
  let normalizedPath = this._normalizePath(relativePath);
  let resolvedPath = path.resolve(`${this.root}${normalizedPath}`);
  let rootSansPathSep = chompPathSep(this.root);

  if (!resolvedPath.startsWith(rootSansPathSep)) {
    let err;
    if (this.cwd) {
      err = `Invalid path: '${relativePath}' not within dir '${this.cwd}' of root '${this.root}'`;
    } else {
      err = `Invalid path: '${relativePath}' not within root '${this.root}'`;
    }
    throw new Error(err);
  }
  return resolvedPath;
};

FSTree.prototype.findByRelativePath = function(relativePath) {
  relativePath = this._normalizePath(relativePath);

  // TODO: experiment with binary search since entries are sorted
  for (var i = 0; i < this.entries.length; i++){
    var entry = this.entries[i];

    if (entryRelativePath(entry) === relativePath) {
      return { entry: entry, index: i };
    }

  }

  return { entry: null, index: -1 };
};

FSTree.prototype.statSync = function(relativePath) {
  this._ensureEntriesPopulated();
  return entry2Stat(this.findByRelativePath(relativePath).entry);
};

FSTree.prototype.existsSync = function(relativePath) {
  let resolvedPath = this.resolvePath(relativePath);
  let rootSansPathSep = chompPathSep(this.root);

  if (resolvedPath === rootSansPathSep || !this._hasEntries) {
    return fs.existsSync(resolvedPath);
  }

  let result = this.findByRelativePath(relativePath);

  // result.entry.mode === undefined is essentialy isSymlink(result.entry)
  // we can't *actually* check the mode of result.entry b/c it's not the stat
  // info for the symlink b/c walkSync follows symlinks
  if (result.index > -1 && result.entry.mode === undefined) {
    return existsSync(resolvedPath);
  }

  return result.index > -1;
};

// We do this for walk-sync, but once we have globs in projections we'll
// implement walkSync ourselves
FSTree.prototype.readdirSync = function(relativePath) {
  this._ensureEntriesPopulated();

  let normalizedPath = this._normalizePath(relativePath);
  let normalizedPathTrailingSlash = `${normalizedPath}/`;
  let prefix;

  if (normalizedPath !== '') {
    let result = this.findByRelativePath(relativePath);

    if (result.index === -1) {
      throw new Error(`ENOENT: no such file or directory, ${relativePath}`);
    } else if (isFile(result.entry)) {
      throw new Error(`ENOTDIR: not a directory, ${relativePath}`);
    }

    prefix = normalizedPathTrailingSlash;
  } else {
    prefix = '';
  }

  return this.entries.filter(e => {
    let entryPath = entryRelativePath(e);

      // make sure entry is not the actual dir we are reading
    return entryPath.length > normalizedPath.length &&
      // make sure entry is a child of the dir we are reading
      entryPath.startsWith(prefix) &&
      // don't return subdirs
      entryPath.indexOf('/', normalizedPathTrailingSlash.length) === -1;
  }).map(e => entryRelativePath(e).replace(normalizedPathTrailingSlash, ''));
}

FSTree.prototype.walkPaths = function() {
  // TODO: maybe the opposite of entryRelativePath
  // ie ensure there *is* a trailing /
  return this.walkEntries().map( e => {
    return this.cwd ? e.relativePath.replace(`${this.cwd}/`, '') : e.relativePath;
  });
};

FSTree.prototype.walkEntries = function() {
  this._ensureEntriesPopulated();

  return this.filter(TRUE);
};

// TODO: remove? (see #54)
FSTree.prototype.match = function(globs) {
  var matcher = new MatcherCollection(globs.include);

  return this.filter(function(entry) {
    return matcher.mayContain(entryRelativePath(entry));
  });
};

function getDirDepth(dirPath){
  return dirPath.split(path.sep).length-1;
}

FSTree.prototype.changes = function() {
  let patches;
  this._ensureEntriesPopulated();

  if (this.srcTree) {
    let filteredEntries = [];
    let dirStack = [];
    let dirDepth = 0;
    // filter this.entries with files, include and exclude
    // including sort and expand of the matched entries
    this.entries.map(entry => {
      const filterMatched = filterMatches(entry.relativePath, this.cwd, this.files, this.include, this.exclude);
      if (filterMatched) {
        // if we find a match, push all the dir entries in dirStack
        // into filteredEntries
        let i;
        for (i = 0; i < dirStack.length; i++) {
          filteredEntries.push(dirStack[i]);
        }
        dirStack = [];
        dirDepth = 0;

        // Removing entries that are directories since exclude
        // only excludes files when matched, if a file is not match,
        // its directories should not be part of entries here, we are
        // are assuming if we see two directories being added
        // we should check the directory Depth and remove all directories
        // with greater directory Depth
        // eg. subdir1/
        //     subdir1/subsubdir1/
        //     subdir2 /
        //
        //    when the above happens, we should remove subdir1 & subsubdir1
        let topFilteredEntry = filteredEntries[filteredEntries.length-1];
        if (topFilteredEntry !== undefined && isDirectory(topFilteredEntry) && isDirectory(entry)) {
          while (filteredEntries.length !== 0 && getDirDepth(topFilteredEntry.relativePath) >= getDirDepth(entry.relativePath)) {
            filteredEntries.pop();
            topFilteredEntry = filteredEntries[filteredEntries.length-1];
          }
        }
        filteredEntries.push(entry);
      } else if (isDirectory(entry)) {
        // if filters didn't match, but entry is directory, keep the entry in
        // a stack. We may need it if there is an entry that matched that
        // requires us to mkdir the parent directories of the file
        // eg. subdir1/subsubdir1/foo.png
        //
        // if the above matched, we must have mkdir for subdir1 and subsubdir1
        const curDirDepth = getDirDepth(entry.relativePath);
        while (dirStack.length !== 0 && dirDepth >= curDirDepth) {
          dirStack.pop();
          dirDepth--;
        }
        dirStack.push(entry);
        dirDepth = curDirDepth;
      }
    });

    const prevTree = new FSTree.fromEntries(this.prevEntries);
    const newTree = FSTree.fromEntries(filteredEntries);
    patches = prevTree.calculatePatch(newTree);
    this.prevEntries = filteredEntries.slice();
    return patches;
  } else {
    return this._changes.filter(change => {
      return filterMatches(change[1], this.cwd, this.files, this.include, this.exclude);
    }).map(change => {
      return [change[0], change[1].replace(`${this.cwd}`, ''), change[2]];
    });
  }
};

FSTree.prototype.chdir = function(relativePath, options) {
  let cwd = relativePath === '' ? '' : `${chompPathSep(relativePath)}/`;

  if (cwd === this.cwd) { return this; }

  let allowEmpty = options && options.allowEmpty;

  let result = this.findByRelativePath(relativePath);

  if (result.index === -1) {
    if (!allowEmpty) {
      throw new Error(`ENOENT: no such file or directory, ${relativePath}`);
    }
  } else if (isFile(result.entry)) {
    throw new Error(`ENOTDIR: not a directory, ${relativePath}`);
  }

  return FSTree.fromParent(this, {
    cwd: cwd,
  });
};

FSTree.prototype.filtered = function(options) {
  return FSTree.fromParent(this, {
    cwd: options.cwd,
    include: options.include,
    exclude: options.exclude,
    files: options.files,
  });
};

FSTree.prototype.readFileSync = function(relativePath, encoding) {
  this._ensureEntriesPopulated();
  let result = this.findByRelativePath(relativePath);
  let entry = result.entry;

  // if instead of this.root we asked the entry, we could emulate symlinks on
  // readFileSync. (there will be other things to do as well, for example
  // rmdir/unlink etc..
  return fs.readFileSync(this.root + '/' + entry.relativePath, encoding);
};

FSTree.prototype._throwIfStopped = function(operation) {
  if (this._state === STOPPED) {
    throw new Error('NOPE, operation: ' + operation);
  }
};

FSTree.prototype.unlinkSync = function(relativePath) {
  this._throwIfStopped('unlink');

  this._ensureEntriesPopulated();
  var result = this.findByRelativePath(relativePath);
  var entry = result.entry;

  fs.unlinkSync(this.root + '/' + entry.relativePath);
  this._track('unlink', entry);
  this._removeAt(result);
};

FSTree.prototype.rmdirSync = function(relativePath) {
  this._throwIfStopped('rmdir');

  this._ensureEntriesPopulated();

  var result = this.findByRelativePath(relativePath);
  var entry = result.entry;

  fs.rmdirSync(this.root + '/' + entry.relativePath);
  this._track('rmdir', entry);
  this._removeAt(result);
};

FSTree.prototype.mkdirSync = function(relativePath) {
  this._throwIfStopped('mkdir');

  this._ensureEntriesPopulated();

  let result = this.findByRelativePath(relativePath);
  let entry = result.entry;

  if (entry) {
    logger.info('mkdirSync %s noop, directory exists', relativePath);
    return;
  }

  let normalizedPath = this._normalizePath(relativePath);

  fs.mkdirSync(`${this.root}${normalizedPath}`);
  entry = new Entry(normalizedPath, 0, Date.now(), Entry.DIRECTORY_MODE, null);

  this._track('mkdir', entry);
  this._insertAt(result, entry);
};


FSTree.prototype.mkdirpSync = function(relativePath) {
  this._throwIfStopped('mkdirp');
  this._ensureEntriesPopulated();

  let result = this.findByRelativePath(relativePath);
  let entry = result.entry;
  if (entry) {
    logger.info('mkdirpSync %s noop, directory exists', relativePath);
    return;
  }

  let paths = relativePath.split("/");
  let subsetPaths = [];

  // TODO: Its O(N2) should change it to O(N)
  for(let i = 0; i < paths.length; i ++ ) {
    if(i != 0) {
      subsetPaths[i] = subsetPaths[i-1] + "/" + paths[i];
    } else {
      subsetPaths[i] = paths[i];
    }

    let result = this.findByRelativePath(subsetPaths[i]);
    if(!result.entry) {
      this.mkdirSync(subsetPaths[i]);
    }

  }
};


FSTree.prototype.writeFileSync = function(relativePath, content, options) {
  this._throwIfStopped('writeFile');

  this._ensureEntriesPopulated();
  var result = this.findByRelativePath(relativePath);
  var entry = result.entry;
  // ensureFile, so throw if the entry is a directory
  var mode;
  // TODO: cleanup idempotent stuff
  var checksum = md5hex('' + content);

  if (entry) {
    mode = entry.mode;

    if (!entry.checksum) {
      // lazily load checksum
      entry.checksum = md5hex(fs.readFileSync(this.root + '/' + relativePath, 'UTF8'));
    }

    if (entry.checksum === checksum) {
      // do nothin
      logger.info('writeFileSync %s noop, checksum did not change: %s === %s', relativePath, checksum, entry.checksum);
      return;
    };
  }

  let normalizedRelativePath = this._normalizePath(relativePath);

  fs.writeFileSync(this.root + normalizedRelativePath, content, options);
  var entry = new Entry(normalizedRelativePath, content.length, Date.now(), mode || 0, checksum);
  var operation = result.entry ? 'change' : 'create';

  this._track(operation, entry);
  this._insertAt(result, entry);
};

FSTree.prototype.symlinkSync = function(target, relativePath /*, type */) {
  // TODO: throw if stopped
  this._ensureEntriesPopulated();

  let result = this.findByRelativePath(relativePath);

  if (result.entry) {
    // Since we don't have symlinks in our abstraction, we don't care whether
    // the entry that currently exists came from a link or a write.  In either
    // case we will read the correct contents.
    return;
  }

  let normalizedPath = this._normalizePath(relativePath);
  symlinkOrCopy.sync(target, `${this.root}${normalizedPath}`);

  // TODO: do we need this pattern?  used in funnel
  //
  // try {
  //   this.out.symlinkSync(sourcePath, destPath);
  // } catch(e) {
  //   if (!existsSync(destDir)) {
  //     mkdirp.sync(destDir);
  //   }
  //   try {
  //     fs.unlinkSync(destPath);
  //   } catch(e) {

  //   }
  //   symlinkOrCopy.sync(sourcePath, destPath);
  // }

  // TODO: should we read the file here so our entry has size, mode & checksum?
  // this turns 1 io -> 2 io (symlink -> symlink + stat)
  let entry = new Entry(normalizedPath, 0, Date.now(), 0);
  let operation = result.entry ? 'change' : 'create';
  this._track(operation, entry);
  this._insertAt(result, entry);
};

/**
  reread this tree's root directory., if necessary.  The root directory may also
  have changed.  Note that just as with initial reading, rereading is done lazily.

  This is used when we are not able to track our changes, because our root is
  written to directly, rather than via this facade.  This can happen because either:

    a) our root is a source directory or
    b) our root is the outputPath of a plugin that does not yet utilize this fs facade for writing

  Root changes are discouraged but are supported because broccoli-plugin
  supports plugins with unstable output paths.  Such plugins' out trees will
  necessarily be treated as source trees as those plugins will not be fs facade
  aware, which is why it is an error to change the root of a non-source tree.
*/
FSTree.prototype.reread = function(newRoot) {

  if (!this.srcTree) {
    if (newRoot && path.normalize(newRoot + path.sep) != this.root) {
      throw new Error(
        `Cannot change root from '${this.root}' to '${newRoot}' of a non-source tree.`
      );
    }
    // reread is a no-op if our entries is populated by an upstream plugin
    return;
  }

  if (newRoot) {
    this.root = path.normalize(path.resolve(newRoot) + path.sep);
  }

  // TODO: stash current entries so we can calculate a diff
  // don't eagerly read, but invalidate our current entries
  this.__hasEntries = false;
};

FSTree.prototype._ensureEntriesPopulated = function() {
  if (this._hasEntries) {
    return;
  }
  this.entries = walkSync.entries(this.root);

};

FSTree.prototype._track = function(operation, entry) {
  var relativePath = entryRelativePath(entry);
  this._relativePathToChange[relativePath] = this._changes.push([
    operation,
    relativePath,
    entry
  ]) - 1;
};

FSTree.prototype._insertAt = function(result, entry) {
  if (result.index > -1) {
    // already exists in a position
    this.entries[result.index] = entry;
  } else {
    // find appropriate position
    // TODO: experiment with binary search since entries are sorted, (may be a perf win)
    for (let position = 0; position < this.entries.length; position++) {
      let current = this.entries[position];
      let currentPath = entryRelativePath(current);
      let entryPath = entryRelativePath(entry);

      if (currentPath === entryPath) {
        // replace
        this.entries[position] = entry;
        return position;
      } else if (currentPath > entryPath) {
        // insert before
        this.entries.splice(position, 0, entry);
        return position;
      } else {
        // do nothing, still waiting to find the right place

      }
    }

    // we are at the end, and have not yet found an appropriate place, this
    // means the end is the appropriate place
    return this.entries.push(entry);
  }
};

FSTree.prototype._removeAt = function(result) {
  if (result.index === -1) {
    return;
  }

  for (let position=0; position < this.entries.length; ++position) {
    let current = this.entries[position];
    if (entryRelativePath(current) === entryRelativePath(result.entry)) {
      this.entries.splice(position, 1);
      return;
    }
  }
};

function match(path, matcher) {
  if (matcher instanceof RegExp) {
    return matcher.test(path);
  } else if (typeof matcher === 'string') {
    // TODO: preprocess filters (eg cache minimatch instances the way funnel does)
    return new Minimatch(matcher).match(path);
  } else if (typeof matcher === 'function') {
    return matcher(path);
  }

  throw new Error('wat is happening');
}

function filterMatches(entryPath, cwd, files, include, exclude){
  // exclude if outside of cwd
  if (entryPath.indexOf(cwd) === -1) {
    return false;
  }

  if ((files !== null && files.length > 0) && (include.length > 0 || exclude.length > 0)) {
    throw new Error('Cannot pass files option (array or function) and a include/exlude filter. You can only have one or the other');
  }

  if (cwd) {
    entryPath = entryPath.replace(`${cwd}/`, '');
  }

  if (files !== null) {
    // include only if it matches an entry in files
    return files.indexOf(entryPath) > -1;
  }

  if (exclude.length > 0) {
    // exclude if matched by anything in exclude or if entryPath equals cwd
    if ((cwd && entryPath === cwd) || exclude.some(matcher => match(entryPath, matcher))) {
      return false;
    }
  }

  if (include.length > 0) {
    // exclude unless matched by something in includes
    if (include.every(matcher => !match(entryPath, matcher))) {
      return false;
    }
  }

  return true;
}

FSTree.prototype.filter = function(fn, context) {
  return this.entries.filter(e => {
    return filterMatches(entryRelativePath(e), this.cwd, this.files, this.include, this.exclude);
  }).filter(fn, context);
};

FSTree.prototype.forEach = function(fn, context) {
  this.entries.forEach(fn, context);
};

FSTree.prototype.calculatePatch = function(otherFSTree, isEqual) {
  if (arguments.length > 1 && typeof isEqual !== 'function') {
    throw new TypeError('calculatePatch\'s second argument must be a function');
  }

  if (typeof isEqual !== 'function') {
    isEqual = FSTree.defaultIsEqual;
  }

  let ours = this.entries;
  let theirs = otherFSTree.entries;
  let additions = [];

  let i = 0;
  let j = 0;

  let removals = [];

  let command;

  while (i < ours.length && j < theirs.length) {
    let x = ours[i];
    let y = theirs[j];
    let xpath = entryRelativePath(x);
    let ypath = entryRelativePath(y);

    if (xpath < ypath) {
      // ours
      i++;

      removals.push(removeCommand(x));

      // remove additions
    } else if (xpath > ypath) {
      // theirs
      j++;
      additions.push(addCommand(y));
    } else {
      if (!isEqual(x, y)) {
        let xFile = isFile(x);
        let yFile = isFile(y);

        if(xFile === yFile) {
          // file -> file update or directory -> directory update
          additions.push(updateCommand(y));
        } else {
          // file -> directory or directory -> file
          removals.push(removeCommand(x));
          additions.push(addCommand(y));
        }
      }
      // both are the same
      i++; j++;
    }
  }

  // cleanup ours
  for (; i < ours.length; i++) {
    removals.push(removeCommand(ours[i]));
  }

  // cleanup theirs
  for (; j < theirs.length; j++) {
    additions.push(addCommand(theirs[j]));
  }

  // operations = removals (in reverse) then additions
  return removals.reverse().concat(additions);
};

FSTree.prototype.calculateAndApplyPatch = function(otherFSTree, input, output, delegate) {
  var patch = this.calculatePatch(otherFSTree);
  FSTree.applyPatch(input, output, patch, delegate);
};

FSTree.defaultIsEqual = function defaultIsEqual(entryA, entryB) {
  if (isDirectory(entryA) && isDirectory(entryB)) {
    // ignore directory changes by default
    return true;
  }

  var equal = entryA.size === entryB.size &&
       +entryA.mtime === +entryB.mtime &&
       entryA.mode === entryB.mode;


  if (!equal) {
    logger.info('invalidation reason: \nbefore %o\n entryB %o', entryA, entryB);
  }

  return equal;
};

FSTree.applyPatch = function(input, output, patch, _delegate) {
  var delegate = assign({}, DEFAULT_DELEGATE, _delegate);
  for (var i = 0; i < patch.length; i++) {
    applyOperation(input, output, patch[i], delegate);
  }
};

function applyOperation(input, output, operation, delegate) {
  var method = operation[0];
  var relativePath = operation[1];
  var inputPath = path.join(input, relativePath);
  var outputPath = path.join(output, relativePath);

  var delegateType = typeof delegate[method];
  if (delegateType === 'function') {
    delegate[method](inputPath, outputPath, relativePath);
  } else {
    throw new Error('Unable to apply patch operation: ' + method + '. The value of delegate.' + method + ' is of type ' + delegateType + ', and not a function. Check the `delegate` argument to `FSTree.prototype.applyPatch`.');
  }
}

function addCommand(entry) {
  return [isDirectory(entry) ? 'mkdir' : 'create', entryRelativePath(entry), entry];
}

function removeCommand(entry) {
  return [isDirectory(entry) ? 'rmdir' : 'unlink', entryRelativePath(entry), entry];
}

function updateCommand(entry) {
  return ['change', entryRelativePath(entry), entry];
}
