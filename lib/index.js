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

  let entries = options.entries || [];

  if (options.sortAndExpand) {
    sortAndExpand(entries);
  } else {
    validateSortedUnique(entries);
  }

  this._entries = entries;
  this._parent = options.parent || null;
  this.cwd = '';

  if ('root' in options) {
    let root = options.root;
    if (typeof root !== 'string' || !path.isAbsolute(root)) {
      throw TypeError(`Root must be an absolute path, tree.root: '${root}'`);
    }

    this.root = path.normalize(options.root + path.sep);
    this.cwd = options.cwd || ''; // relative to this.root
  }

  if (!this._parent) {
    this.__changes = [];
    this.start();
  }
}

FSTree.prototype = {
  get entries() {
    return this._parent ? this._parent.entries : this._entries;
  },

  get _changes() {
    return this._parent ? this._parent._changes : this.__changes;
  },

  get _state() {
    return this._parent ? this._parent.state : this.__state;
  },

  set _state(value) {
    if (this._parent) {
      this._parent._state = value;
    } else {
      this.__state = value;
    }
  },

  get _relativePathToChange() {
    return this._parent ? this._parent._relativePathToChange : this.__relativePathToChange;
  },

  set _relativePathToChange(value) {
    if (this._parent) {
      this._parent._relativePathToChange = value;
    } else {
      this.__relativePathToChange = value;
    }
  }
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
  return entry2Stat(this.findByRelativePath(relativePath).entry);
};

FSTree.prototype.existsSync = function(relativePath) {
  let resolvedPath = this.resolvePath(relativePath);
  let rootSansPathSep = chompPathSep(this.root);

  if (resolvedPath === rootSansPathSep) {
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
  let normalizedPath = this._normalizePath(relativePath);
  let normalizedPathTrailingSlash = `${normalizedPath}/`;

  if (normalizedPath !== '') {
    let result = this.findByRelativePath(relativePath);

    if (result.index === -1) {
      throw new Error(`ENOENT: no such file or directory, ${relativePath}`);
    } else if (isFile(result.entry)) {
      throw new Error(`ENOTDIR: not a directory, ${relativePath}`);
    }
  }

  return this.entries.filter(e => {
    let entryPath = entryRelativePath(e);
    return entryPath.length > normalizedPath.length &&
      entryPath.startsWith(normalizedPath) &&
      entryPath.indexOf('/', normalizedPathTrailingSlash.length) === -1;
  }).map(e => e.relativePath.replace(normalizedPathTrailingSlash, ''));
}

FSTree.prototype.match = function(globs) {
  var matcher = new MatcherCollection(globs.include);

  return this.filter(function(entry) {
    return matcher.mayContain(entryRelativePath(entry));
  });
};

FSTree.prototype.changes = function(globs) {
  var changes = this._changes;
  if (arguments.length > 0) {
    var included = new MatcherCollection(globs.include);
    var excluded;

    if (globs.exclude) {
      exclude = new MatcherCollection(exclude);
    }

    return changes.filter(function(change) {
      return included.mayContain(change[1]);
    });
  } else {
    return changes;
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

  return new FSTree({
    root: this.root,
    cwd: cwd,
    parent: this,
  });
};

FSTree.prototype.readFileSync = function(relativePath, encoding) {
  var result = this.findByRelativePath(relativePath);
  var entry = result.entry;

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

  var result = this.findByRelativePath(relativePath);
  var entry = result.entry;

  fs.unlinkSync(this.root + '/' + entry.relativePath);
  this._track('unlink', entry);
  this._removeAt(result);
};

FSTree.prototype.rmdirSync = function(relativePath) {
  this._throwIfStopped('rmdir');

  var result = this.findByRelativePath(relativePath);
  var entry = result.entry;

  fs.rmdirSync(this.root + '/' + entry.relativePath);
  this._track('rmdir', entry);
  this._removeAt(result);
};

FSTree.prototype.mkdirSync = function(relativePath) {
  this._throwIfStopped('mkdir');

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

FSTree.prototype.writeFileSync = function(relativePath, content, options) {
  this._throwIfStopped('writeFile');

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

FSTree.prototype._track = function(operation, entry) {
  var relativePath = entryRelativePath(entry);
  // ensure we dedupe changes (only take the last)
  var position = this._relativePathToChange[relativePath];
  if (position === undefined) {
    // new, so append
    this._relativePathToChange[relativePath] = this._changes.push([
      operation,
      relativePath,
      entry
    ]) - 1;
  } else {
    // existing, so replace
    this._changes[position][0] = operation;
    this._changes[position][2] = entry;
  }
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

FSTree.prototype.filter = function(fn, context) {
  return this.entries.filter(e => {
    return entryRelativePath(e).indexOf(this.cwd) === 0;
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
