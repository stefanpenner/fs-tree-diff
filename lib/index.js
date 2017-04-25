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
const symlink = util.symlink;

const chompPathSep = util.chompPathSep;
const chompLeadAndTrailingPathSep = util.chompLeadAndTrailingPathSep;
const lchompPathStart = util.lchompPathStart;
const entry2Stat = util.entry2Stat;
const sortAndExpand = treeOptionHelpers.sortAndExpand;
const entryRelativePath = util.entryRelativePath;
const sortPatches = util.sortPatches;
const validateSortedUnique = treeOptionHelpers.validateSortedUnique;
const isFile = Entry.isFile;
const isDirectory = Entry.isDirectory;

const ROOT = 'root';

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
    if (!this.srcTree) {
      this.start();
    } else {
      // srcTree is true, should not write to a tree.
      this.stop();
    }
  }
}

function validateRoot(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) {
    throw TypeError(`Root must be an absolute path, tree.root: '${root}'`);
  }
}

function ensureTrailingSlash(inputPath) {
  return inputPath === '' ? '' : `${chompPathSep(inputPath)}/`;
}

FSTree.prototype = {
  get _changes() {
      return this.parent ? this.parent._changes : this.__changes;
  },

  get _hasEntries() {
    return this.parent ? this.parent._hasEntries : this.__hasEntries;
  },

  get cwd() {
    return ensureTrailingSlash(this._cwd);
  },

  set cwd(value) {
    // strip leading and trailing slashes here for consistency
    this._cwd = value.replace(/^\/|\/$/g, '');
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

function getbasePath(tree, relativePath) {
  let root;
  if(tree.root) {
    root = tree.root;
  } else {
    let entry = tree.findByRelativePath(relativePath).entry;
    if(entry.basePath) {
      root = entry.basePath;
    } else {
      root = entry.absolutePath.replace(entry.relativePath, '');
    }
  }
  return root;
}


FSTree.fromParent = function(tree, options) {
  //TODO: write tests
  let path = options ? options.cwd : '';
  let root = getbasePath(tree, path);

  return new FSTree(Object.assign({}, options, {
    parent: tree,
    root: root,
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
  // There are times when the relativePath already includes this.cwd
  // relativePath = ember-data , cwd = modules/ember-data
  // cwd = modules relativePath = modules/ember-data
  const cwd = ensureTrailingSlash(this.cwd);
  var normalizedPath = ensureTrailingSlash(relativePath).indexOf(cwd) > -1  ? path.normalize(relativePath) : cwd.indexOf(relativePath) > -1 ? path.normalize(cwd) : path.normalize(`${cwd}${relativePath}`);
  return lchompPathStart(chompPathSep(normalizedPath));
};

FSTree.prototype.resolvePath = function(relativePath) {
  let normalizedPath = this._normalizePath(relativePath);
  let root = getbasePath(this, relativePath);

  let resolvedPath = path.resolve(`${root}/${normalizedPath}`);
  let rootSansPathSep = chompPathSep(root);

  if (!resolvedPath.startsWith(rootSansPathSep)) {
    let err;
    if (this.cwd) {
      err = `Invalid path: '${relativePath}' not within dir '${this.cwd}' of root '${root}'`;
    } else {
      err = `Invalid path: '${relativePath}' not within root '${root}'`;
    }
    throw new Error(err);
  }

  return resolvedPath;
};

FSTree.prototype.findByRelativePath = function(relativePath, options) {
  // walkSymlinks is used to determine whether to return the current tree or the symlinked tree.
  // if walkSymlinks is true, return the tree after walking through symlinks else return current tree
  const walkSymlinks = options && options.walkSymlinks !== undefined ? options.walkSymlinks : true;

  relativePath = this._normalizePath(relativePath);
  for (let i = 0; i < this.entries.length; i++) {
    let entry = this.entries[i];

    let projection = entry._projection;
    // The relativePath in entry and relativePath function parameter matches
    if (entryRelativePath(entry) === chompPathSep(relativePath)) {
      // if true walk through symlinks and get the symlinked tree, else return the current tree without walking through symlinks
      let walkThroughProjections = walkSymlinks && projection && projection.entry !== ROOT;
      if(walkThroughProjections) {
          return projection.tree.findByRelativePath(projection.entry.relativePath);
        }
      return { entry: entry, index: i, tree: this };
    } else if(projection && relativePath.startsWith(ensureTrailingSlash(entry.relativePath))) {
      // find the relativePath with respect to the projection's entry
      // eg. relativePath = 'a/b/c/foo.js' and projection's entry is 'd' (c is symlinked to d), with foo.js as its children
      //      search in the projection for d/foo.js
      let projectionEntryRelativePath = projection.entry === ROOT ? "." : projection.entry.relativePath;
      const sourceRelativePath = relativePath.replace(ensureTrailingSlash(entry.relativePath), ensureTrailingSlash(projectionEntryRelativePath));
      return projection.tree.findByRelativePath(sourceRelativePath);
    }
  }
  return { entry: null, index: -1 , tree: null};
};

FSTree.prototype.leastExistingAncestor = function(relativePath) {
  relativePath = this._normalizePath(relativePath);

  let result = { entry: null, tree: null };

  for (let i = 0; i < this.entries.length; i++) {
    const entry = this.entries[i];

    if (entryRelativePath(entry) === chompPathSep(relativePath)) {
      result = { entry: entry, tree: this };
      break;
    }

    if (relativePath.startsWith(ensureTrailingSlash(entry.relativePath))) {
      if (entry._projection) {
        const sourceRelativePath = relativePath.replace(entry.relativePath, chompPathSep(entry._projection.entry.relativePath));

        result = entry._projection.tree.leastExistingAncestor(sourceRelativePath);
        break;
      }

      result = { entry: entry, tree: this };
    }
  }

  while (result.entry && result.entry._projection) {
    result = result.entry._projection;
  }
  return result;
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
  let prefix;

  let result;
  let entries = this.entries;

  if (normalizedPath !== '') {
    result = this.findByRelativePath(relativePath);
      if (result.index === -1) {
        throw new Error(`ENOENT: no such file or directory, ${relativePath}`);
      } else if (isFile(result.entry)) {
        throw new Error(`ENOTDIR: not a directory, ${relativePath}`);
      }

    prefix = result.entry._projection && result.entry._projection.entry === ROOT ? '' : ensureTrailingSlash(result.tree._normalizePath(result.entry.relativePath));
    if (result.entry._projection && result.entry._projection.entry === ROOT){
      result.entry._projection.tree._ensureEntriesPopulated();
      entries = result.entry._projection.tree.entries;
    } else {
      entries = result.tree.entries;
    }
  } else {
    prefix = '';
  }

  return entries.filter(e => {
    let entryPath = entryRelativePath(e);

    //When the projection entry is pointing to root, it means that we symlinked root to destDir
    // eg. ROOT2/abc is symlinked to ROOT1
    // then when we try to find the children of abc it should return all the children of ROOT1 (not grandchildren),
    // in that case normalizedPath will not be part of entryPath
    if(result && result.entry && result.entry._projection && result.entry._projection.entry === ROOT) {
      return entryPath.indexOf('/', prefix.length) === -1;
    }

    return entryPath.length > normalizedPath.length && // make sure entry is a child of the dir we are reading
      entryPath.startsWith(prefix) && // don't return subdirs
      entryPath.indexOf('/', prefix.length) === -1;


  }).map(e => entryRelativePath(e).replace(prefix, ''));

}

FSTree.prototype.walkPaths = function() {
  // TODO: maybe the opposite of entryRelativePath
  // ie ensure there *is* a trailing /
  return this.walkEntries().map( e => {
    return this.cwd ? e.relativePath.replace(ensureTrailingSlash(this.cwd), '') : e.relativePath;
  });
};

FSTree.prototype.walkEntries = function() {
  this._ensureEntriesPopulated();

  let entries = [];
  this.filter(TRUE).forEach(entry => {
    entries.push(entry);
    if(entry._projection) {
      entries = entries.concat(entry._projection.walkEntries());
    }
  });

  return entries;
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

// filter this.entries with files, include and exclude
// including sort and expand of the matched entries
FSTree.prototype._filterEntries = function(options) {
  let filteredEntries = [];
  let dirStack = [];
  let dirDepth = 0;

  let inputsArr  = this.entries;
  let cwd = options.cwdPostfix ? `${this.cwd}${options.cwdPostfix}`:this.cwd;
  inputsArr.map(input => {
    // if input.length is undefined, then input is an entry from this.entry
    // else, input is an element from this._changes, which entry is its third
    // indice
    const entry = (input.length === undefined) ? input : input[2];
    const filterMatched = filterMatches(entry.relativePath, cwd, options.files, options.include, options.exclude);
    // being consistent here, by removing trailing slash at end of all relativePath
    if (filterMatched) {
      // if matched, push all dir entries from dirStack into filteredEntries
      for (let i = 0; i < dirStack.length; i++) {
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
      const topElem = filteredEntries[filteredEntries.length-1];
      if (topElem !== undefined){
        let topFilteredEntry = (topElem.length === undefined) ? topElem : topElem[2];
        while (filteredEntries.length !== 0 && isDirectory(topFilteredEntry) && isDirectory(entry) && getDirDepth(topFilteredEntry.relativePath) >= getDirDepth(entry.relativePath)) {
          filteredEntries.pop();
          topFilteredEntry = filteredEntries[filteredEntries.length-1];
        }
      }
      filteredEntries.push(input);
    } else if (isDirectory(entry) && chompPathSep(entry.relativePath).indexOf(cwd) > -1) {
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
      dirStack.push(input);
      dirDepth = curDirDepth;
    }
  });

  return filteredEntries;
}

FSTree.prototype.changes = function(options) {
  let filteredEntries = [];

  //If changes is called from projections, then these wont be reset.
  if(options === undefined) {
    options = {
      files: this.files, include: this.include, exclude: this.exclude
    }
  }
  // here we need a variable for this.cwd, which later on, we will need to prepend options.cwdPostfix to it.

  // if srcTree is true or if srcTree is false and changes is empty
  // and its called from projections( which might be a case while going through the projection)
  if (this.srcTree || (this._changes.length == 0 && options.fromProjection)) {
    if (this.files && this.include.length === 0 && this.exclude.length === 0) {
      this._entriesFromFiles();
    } else {
      this._ensureEntriesPopulated();
    }

    filteredEntries = this._filterEntries(options);
    let prevTree = new FSTree.fromEntries(this.prevEntries);

    const newTree = FSTree.fromEntries(filteredEntries);
    const patches = prevTree.calculatePatch(newTree);
    this.prevEntries = filteredEntries.slice();
    // if this.cwd is set, we should replace the relativePaths
    if (this.cwd) {
      return patches.map(patch => {
        const cwd = ensureTrailingSlash(this.cwd);
        let newEntry = Entry.cloneEntry(patch[2]);
        newEntry.relativePath = newEntry.relativePath.replace(this.cwd, '');
        return [patch[0], patch[1].replace(cwd, ''), newEntry];
      });
    }
    return patches;
  } else {
    let cwd = this.cwd;
    this._changes.forEach(change => {
      if(change[2]._projection) {
        // TODO: altCwd is a horrible name, totally need to find a better name
        const altCwd = options.cwdPostfix ? `${cwd}${options.cwdPostfix}` : cwd;
        if (shouldFollowSymlink(change[1], altCwd)) {
          // If projection is present call changes() recursively
          options.fromProjection = true;
          options.cwdPostfix = altCwd.replace(ensureTrailingSlash(change[1]), '');
          let projectedEntries = change[2]._projection.tree.changes(options);

          if (projectedEntries.length > 0) {
            let target = ensureTrailingSlash(change[2].relativePath);
            // Here, we need to prefix the relativePath of the current entry to
            // the return patches from changes
            projectedEntries.forEach(projectedChange => {
              // TODO: what condition should we NOT do mkdirp?
              if (projectedChange[0] === 'mkdir') {
                projectedChange[0] = 'mkdirp';
              }

              // Prevent duplicates. Is this the right way to do it??
              if (!ensureTrailingSlash(projectedChange[1]).startsWith(target)) {
                projectedChange[1] = `${target}${projectedChange[1]}`;
              }
              let newEntry = Entry.cloneEntry(projectedChange[2]);
              if (!ensureTrailingSlash(projectedChange[2].relativePath).startsWith(target)) {
                newEntry.relativePath = `${target}${projectedChange[2].relativePath}`;
              }
              projectedChange[2] = newEntry;
            });

            // since we have entries from the current dir, unshift change onto projectedEntries
            projectedEntries.unshift([change[0], change[1], Entry.cloneEntry(change[2])]);
            projectedEntries.forEach(projectedChange => {
              if (projectedChange[1].startsWith(cwd)) {
                projectedChange[1] = projectedChange[1].replace(cwd, '');
                projectedChange[2].relativePath = projectedChange[2].relativePath.replace(cwd, '');
                filteredEntries.push(projectedChange);
              }
            });
          }
        }
      } else { // change does not have projections
        let cwd = options.cwdPostfix ? `${this.cwd}${options.cwdPostfix}`:this.cwd;
        if (filterMatches(change[1], cwd, options.files, options.include, options.exclude)) {
          let newEntry = Entry.cloneEntry(change[2]);
          newEntry.relativePath = newEntry.relativePath.replace(cwd, '');
          filteredEntries.push([change[0], change[1].replace(cwd, ''), newEntry]);
        }
      }
    });
    return filteredEntries;
  }
};

function checkDirDepth(prevDirPath, currentDirPath){
  if(currentDirPath.includes(prevDirPath)) {
      if((currentDirPath.split(path.sep).length-1) >= (prevDirPath.split(path.sep).length-1)) {
        return true;
      }
  }
  return false;
}

FSTree.prototype.chdir = function(relativePath, options) {
  // when relativePath equals '/', we should return '' for cwd
  let cwd = (relativePath === '' || relativePath === '/' ) ? '' : ensureTrailingSlash(relativePath);

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

  let tree =  FSTree.fromParent(this, {
    cwd: cwd,
  });
  return tree;
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
  if(result.entry === null) {
    throw new Error(`ENOENT: no such file or directory, ${relativePath}`);
  }

  return fs.readFileSync(result.tree.root + '/' +  entry.relativePath, encoding);
};

FSTree.prototype._throwIfStopped = function(operation) {
  if (this._state === STOPPED) {
    throw new Error('NOPE, operation: ' + operation);
  }
};

FSTree.prototype.unlinkSync = function(relativePath) {
  this._throwIfStopped('unlink');

  this._ensureEntriesPopulated();

  let result = this.findByRelativePath(relativePath, { walkSymlinks: false });
  var entry = result.entry;

  // only unlinkSync when entry !== null
  // TODO: find WHY entry can be null
  if (entry !== null) {
    fs.unlinkSync(path.join(result.tree.root, entry.relativePath));
    result.tree._track('unlink', entry);
    result.tree._removeAt(result);
  }
};

FSTree.prototype.rmdirSync = function(relativePath) {
  this._throwIfStopped('rmdir');
  this._ensureEntriesPopulated();
  //var result = this.findByRelativePath(relativePath);
  let result = this.findByRelativePath(relativePath, { walkSymlinks: false });
  var entry = result.entry;

  // only rmdirSync when entry !== null
  // TODO: find WHY entry can be null
  if (entry !== null) {
    fs.rmdirSync(path.join(result.tree.root, entry.relativePath));
    result.tree._track('rmdir', entry);
    result.tree._removeAt(result);
  }
};

FSTree.prototype.mkdirSync = function(relativePath) {
  this._throwIfStopped('mkdir');
  this._ensureEntriesPopulated();

  let result = this.findByRelativePath(relativePath, { walkSymlinks: false });
  let entry = result.entry;

  if (entry) {
    logger.info('mkdirSync %s noop, directory exists', relativePath);
    return;
  }
  //TODO: add test, where  d is symlinked to a, and a has a/foo, a/foo/bar.css and try creating d/baz
  let normalizedPath = this._normalizePath(relativePath);

  fs.mkdirSync(`${this.root}${normalizedPath}`);
  entry = new Entry(normalizedPath, 0, Date.now(), Entry.DIRECTORY_MODE, null);

  this._track('mkdir', entry);
  this._insertAt(null, entry);
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

  if(relativePath[0] === '/'){
    relativePath =relativePath.substr(1);
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
  let result = this.findByRelativePath(relativePath, { walkSymlinks: false });

  var entry = result.entry;
  // ensureFile, so throw if the entry is a directory
  var mode;
  // TODO: cleanup idempotent stuff
  var checksum = md5hex('' + content);

  if (entry) {
    mode = entry.mode;

      if (!entry.checksum) {
      // lazily load checksum
      entry.checksum = md5hex(fs.readFileSync(path.join(this.root , relativePath), 'UTF8'));
    }

    if (entry.checksum === checksum) {
      // do nothin
      logger.info('writeFileSync %s noop, checksum did not change: %s === %s', relativePath, checksum, entry.checksum);
      return;
    };
  }

  let normalizedPath = this._normalizePath(relativePath);

  fs.writeFileSync(`${this.root}${normalizedPath}`, content, options);
  entry = new Entry(normalizedPath, content.length, Date.now(), mode || 0, checksum);
  var operation = result.entry ? 'change' : 'create';

  this._track(operation, entry);
  this._insertAt(null, entry);

};

FSTree.prototype.symlinkSync = function(target, relativePath /*, type */) {
  this._throwIfStopped('symlink');
  this._ensureEntriesPopulated();
  let result = this.findByRelativePath(relativePath);

  if (result.entry) {
    // Since we don't have symlinks in our abstraction, we don't care whether
    // the entry that currently exists came from a link or a write.  In either
    // case we will read the correct contents.
    return;
  }

  let normalizedPath = this._normalizePath(relativePath);
  //TODO: RESOLVEPATH(NORMALIZE PATH) TO REMOVE EXTRA SLASHES
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

  let mode = 0;

  let entry = new Entry(normalizedPath, 0, Date.now(), mode);
  let operation = result.entry ? 'change' : 'create';

  this._track(operation, entry);
  this._insertAt(result, entry);
};

FSTree.prototype.symlinkSyncFromEntry = function(srcFSTree,  srcRelativePath,  destRelativePath /*, type */) {
  this._throwIfStopped('symlinkSyncFromEntry');

  if (srcRelativePath === undefined) {
    throw new Error("srcRelativePath is undefined");
  } else if (destRelativePath === undefined) {
    throw new Error("destRelativePath is undefined");
  }

  this._ensureEntriesPopulated();

  let normalizedPath = this._normalizePath(destRelativePath);
  let tree = this;
  //TODO: RESOLVEPATH(NORMALIZE PATH) TO REMOVE EXTRA SLASHES
  let parent = path.dirname(destRelativePath);

  if (parent !== ".") {
    // move it to mkdirp
    let result = this.leastExistingAncestor(parent);
    if (result.entry) {
      tree = result.tree;
      normalizedPath = tree._normalizePath(path.join(result.entry.relativePath, path.basename(destRelativePath)));
    }
  }

  let destPath = `${tree.root}${normalizedPath}`;
  let sourceEntry;

  let srcAbsolutePath = srcFSTree.resolvePath(srcRelativePath);
  var destDir = path.dirname(normalizedPath);

  try {
    symlinkOrCopy.sync(srcAbsolutePath, destPath);
  } catch(e) {
    if (!existsSync(`${tree.root}${destDir}`)) {
      tree.mkdirpSync(destDir);
    }
    try {
      fs.unlinkSync(destPath);
    } catch(e) {}
    symlinkOrCopy.sync(srcAbsolutePath, destPath);
  }

  let entry = new Entry(normalizedPath, 0, Date.now(), Entry.DIRECTORY_MODE, null);

  if (srcRelativePath === "/") {
    sourceEntry = ROOT;
  } else {
     let projection = srcFSTree.findByRelativePath(srcRelativePath, { walkSymlinks: false });
     sourceEntry = projection.entry;
  }

  let sourceTree = srcFSTree.chdir(srcRelativePath);

  entry._projection = {tree: sourceTree, entry: sourceEntry};

  let operation = 'mkdir';

  tree._track(operation, entry);
  tree._insertAt(null, entry);
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

FSTree.prototype._entriesFromFiles = function() {
  if (this._hasEntries) {
    return;
  }
  let tempTree = FSTree.fromPaths(this.files, { sortAndExpand: true });
  this.entries = tempTree.entries;
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
  if (result && result.index > -1) {
    // already exists in a position
    this.entries[result.index] = entry;
  } else {
    // find appropriate position
    // TODO: experiment with binary search since entries are sorted, (may be a perf win)
    for (let position = 0; position < this.entries.length; position++) {
      let current = this.entries[position];
      let currentPath = entryRelativePath(current);
      //TODO: shd call the entryRelativePathWalksyncWithTrailingSlash instead of entryRelativePath
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

function shouldFollowSymlink(entryPath, cwd){
  // We should follow symlink if cwd equals entryPath or if entryPath starts with cwd
  // If the above is false, we can still descend if we have a partial match
  // when cwd starts with entryPath. In that case, we will return the portion
  // of the cwd that was not match. This indicates a partial match.

  // TODO: its too inconsistent when cwd and when relativePath has trailing slashes
  cwd = chompLeadAndTrailingPathSep(cwd);
  entryPath = chompLeadAndTrailingPathSep(entryPath);
  var val = cwd === entryPath || entryPath.startsWith(cwd) || cwd.startsWith(ensureTrailingSlash(entryPath));
  return val;
}

function filterMatches(entryPath, cwd, files, include, exclude){
  // exclude if outside of cwd
  if (!entryPath.startsWith(cwd) || cwd === ensureTrailingSlash(entryPath)) {
    return false;
  }

  if ((files !== null && files.length > 0) && (include.length > 0 || exclude.length > 0)) {
    throw new Error('Cannot pass files option (array or function) and a include/exlude filter. You can only have one or the other');
  }

  // previously, we always assumed cwd did not have a trailing slash, but that was not true
  if (cwd) {
    entryPath = entryPath.replace(cwd, '');
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
