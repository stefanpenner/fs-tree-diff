'use strict';

var Entry = require('./entry');
var logger = require('heimdalljs-logger')('fs-tree-diff:');
var util = require('./util');
var sortAndExpand = util.sortAndExpand;
var validateSortedUnique = util.validateSortedUnique;

var ARBITRARY_START_OF_TIME = 0;

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
}

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
  var operations = [];

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

      command = removeCommand(x);

      if (x.isDirectory()) {
        removals.push(command);
      } else {
        // pre-cleanup file removals should occure in-order, this ensures file
        // -> directory transforms work correctly
        operations.push(command);
      }

      // remove operations
    } else if (x.relativePath > y.relativePath) {
      // theirs
      j++;
      operations.push(addCommand(y));
    } else {
      if (!isEqual(x, y)) {
        command = updateCommand(y);

        if (x.isDirectory()) {
          removals.push(command);
        } else {
          operations.push(command);
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
    operations.push(addCommand(theirs[j]));
  }

  return operations.concat(removals.reverse());
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

function addCommand(entry) {
  return [entry.isDirectory() ? 'mkdir' : 'create', entry.relativePath, entry];
}

function removeCommand(entry) {
  return [entry.isDirectory() ? 'rmdir' : 'unlink', entry.relativePath, entry];
}

function updateCommand(entry) {
  return ['change', entry.relativePath, entry];
}
