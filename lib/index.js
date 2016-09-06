'use strict';

var fs = require('fs');
var path = require('path-posix');
var assign = require('object-assign');
var symlinkOrCopy = require('symlink-or-copy');
var Entry = require('./entry');
var logger = require('heimdalljs-logger')('fs-tree-diff:');
var util = require('./util');
var sortAndExpand = util.sortAndExpand;
var validateSortedUnique = util.validateSortedUnique;
var fs = require('fs');
var md5hex = require('md5hex');

var ARBITRARY_START_OF_TIME = 0;
var DEFAULT_DELEGATE = {
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

var STARTED = 'started';
var STOPPED = 'stopped';

module.exports = FSTree;

function FSTree(options) {
  options = options || {};

  var entries = options.entries || [];

  if (options.sortAndExpand) {
    sortAndExpand(entries);
  } else {
    validateSortedUnique(entries);
  }

  this.entries = entries;
  this.root = options.root;
  this.start();
}

FSTree.fromPaths = function(paths, options) {
  if (typeof options !== 'object') { options = {}; }

  var entries = paths.map(function(path) {
    return new Entry(path, 0, ARBITRARY_START_OF_TIME);
  });

  return new FSTree({
    entries: entries,
    sortAndExpand: options.sortAndExpand,
  });
};

FSTree.fromEntries = function(entries, options) {
  if (typeof options !== 'object') { options = {}; }

  return new FSTree({
    entries: entries,
    sortAndExpand: options.sortAndExpand,
  });
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
           this.entries[toIndex].relativePath < entries[fromIndex].relativePath) {
      toIndex++;
    }
    if (toIndex < this.entries.length &&
        this.entries[toIndex].relativePath === entries[fromIndex].relativePath) {
      this.entries.splice(toIndex, 1, entries[fromIndex++]);
    } else {
      this.entries.splice(toIndex++, 0, entries[fromIndex++]);
    }
  }
};

FSTree.prototype.addPaths = function(paths, options) {
  var entries = paths.map(function(path) {
    return new Entry(path, 0, ARBITRARY_START_OF_TIME);
  });

  this.addEntries(entries, options);
};

FSTree.prototype.start = function() {
  this._changes = [];
  this._relativePathToChange = Object.create(null);
  this._state = STARTED;
};

FSTree.prototype.stop = function() {
  this._state = STOPPED;
};

FSTree.prototype.findByRelativePath = function(relativePath) {
  // TODO: experiment with binary search since entries are sorted
  for (var i = 0; i < this.entries.length; i++){
    var entry = this.entries[i];

    if (entry.relativePath === relativePath) {
      return { entry: entry, index: i };
    }
  }

  return { entry: null, index: -1 };
};

FSTree.prototype.statSync = function(relativePath) {
  return this.findByRelativePath(relativePath).entry;
};

FSTree.prototype.changes = function() {
  // TODO: changes need to be in a specific order
  return this._changes;
};

FSTree.prototype.readFileSync = function(relativePath, encoding) {
  var entry = this.findByRelativePath(relativePath);

  // if instead of this.root we asked the entry, we could emulate symlinks on
  // readFileSync. (there will be other things to do as well, for example
  // rmdir/unlink etc..
  return fs.readFileSync(this.root + '/' + relativePath, encoding);
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

  fs.unlinkSync(this.root + '/' + relativePath);
  this._updateOrAppendChange('unlink', entry);
  this._insertAt(result, entry);
};

FSTree.prototype.rmdirSync = function(relativePath) {
  this._throwIfStopped('rmdir');

  var result = this.findByRelativePath(relativePath);
  var entry = result.entry;

  fs.rmdirSync(this.root + '/' + relativePath);
  this._updateOrAppendChange('rmdir', entry);
  this._insertAt(result, entry);
};

FSTree.prototype.mkdirSync = function(relativePath) {
  this._throwIfStopped('mkdir');

  var result = this.findByRelativePath(relativePath);
  var entry = result.entry;

  fs.mkdirSync(this.root + '/' + relativePath);
  this._updateOrAppendChange('mkdir', entry);
  this._insertAt(result, entry);
};

FSTree.prototype.writeFileSync = function(relativePath, content, options) {
  this._throwIfStopped('writeFile');

  var result = this.findByRelativePath(relativePath);
  var entry = result.entry;

  // TODO: cleanup idempotent stuff
  var checksum = md5hex('' + content);

  if (entry) {
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

  fs.writeFileSync(this.root + '/' + relativePath, content, options);
  var entry = new Entry(relativePath, content.length, Date.now(), checksum);
  var operation = result.entry ? 'change' : 'create';

  this._updateOrAppendChange(operation, entry);
  this._insertAt(result, entry);
};

FSTree.prototype._updateOrAppendChange = function(operation, entry) {
  var relativePath = entry.relativePath;
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
    for (var position = 0; position < this.entries.length; position++) {
      var current = this.entries[position];
      if (current.relativePath === entry.relativePath) {
        // replace
        this.entries[position] = entry;
        return position;
      } else if (current.relativePath < entry.relativePath) {
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

  var ours = this.entries;
  var theirs = otherFSTree.entries;
  var additions = [];

  var i = 0;
  var j = 0;

  var removals = [];

  var command;

  while (i < ours.length && j < theirs.length) {
    var x = ours[i];
    var y = theirs[j];

    if (x.relativePath < y.relativePath) {
      // ours
      i++;

      removals.push(removeCommand(x));

      // remove additions
    } else if (x.relativePath > y.relativePath) {
      // theirs
      j++;
      additions.push(addCommand(y));
    } else {
      if (!isEqual(x, y)) {
        command = updateCommand(y);

        if (x.isDirectory()) {
          removals.push(command);
        } else {
          additions.push(command);
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
  if (entryA.isDirectory() && entryB.isDirectory()) {
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
  return [entry.isDirectory() ? 'mkdir' : 'create', entry.relativePath, entry];
}

function removeCommand(entry) {
  return [entry.isDirectory() ? 'rmdir' : 'unlink', entry.relativePath, entry];
}

function updateCommand(entry) {
  return ['change', entry.relativePath, entry];
}
