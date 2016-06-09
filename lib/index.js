'use strict';

var Entry = require('./entry');
var debug = require('debug')('fs-tree-diff:');

var ARBITRARY_START_OF_TIME = 0;

module.exports = FSTree;

function FSTree(options) {
  options = options || {};

  this.entries = options.entries || [];
  validateSortedUnique(this.entries);
}

function validateSortedUnique(entries) {
  for (var i = 1; i < entries.length; i++) {
    var previous = entries[i - 1].relativePath;
    var current = entries[i].relativePath;

    if (previous < current) {
      continue;
    } else {
      throw new Error('expected entries[' + (i -1) + ']: `' + previous +
                      '` to be < entries[' + i + ']: `' + current + '`, but was not. Ensure your input is sorted and has no duplicate paths');
    }
  }
}

FSTree.fromPaths = function(paths) {
  var entries = paths.map(function(path) {
    return new Entry(path, 0, ARBITRARY_START_OF_TIME);
  });

  return new FSTree({
    entries: entries,
  });
};


FSTree.fromEntries = function(entries) {
  return new FSTree({
    entries: entries
  });
};

Object.defineProperty(FSTree.prototype, 'size', {
  get: function() {
    return this.entries.length;
  }
});

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
    debug('invalidation reason: \nbefore %o\n entryB %o', entryA, entryB);
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
