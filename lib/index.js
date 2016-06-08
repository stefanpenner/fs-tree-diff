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

FSTree.prototype.calculatePatch = function(otherFSTree) {
  var ours = this.entries;
  var theirs = otherFSTree.entries;
  var operations = [];

  var i = 0;
  var j = 0;

  var removals = [];

  while (i < ours.length && j < theirs.length) {
    var x = ours[i];
    var y = theirs[j];

    if (x.relativePath < y.relativePath) {
      // ours
      i++;

      var command = removeCommand(x);

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
      if (needsUpdate(x, y)) {
        operations.push(updateCommand(y));
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

function addCommand(entry) {
  return [entry.isDirectory() ? 'mkdir' : 'create', entry.relativePath, entry];
}

function removeCommand(entry) {
  return [entry.isDirectory() ? 'rmdir' : 'unlink', entry.relativePath, entry];
}

function updateCommand(entry) {
  return ['change', entry.relativePath, entry];
}

function needsUpdate(before, after) {
  if (before.isDirectory() && after.isDirectory()) {
    return false;
  }

  var invalidate = before.size !== after.size ||
         +before.mtime !== +after.mtime ||
         before.mode !== after.mode;

  if (invalidate) {
    debug('invalidation reason: \nbefore %o\n after %o', before, after);
  }

  return invalidate;
}
