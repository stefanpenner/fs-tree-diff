'use strict';

/* global Set:true */

var Set = require('fast-ordered-set');
var util = require('./util');
var Tree = require('./tree');
var Entry = require('./entry');

var byRelativePath = util.byRelativePath;
var ARBITRARY_START_OF_TIME = 0;

module.exports = FSTree;

function toChangeOp(change) {
  return ['change', change.relativePath];
}

function FSTree(options) {
  options = options || {};

  if (options._entries) {
    this.entries = options._entries;
  } else {
    this.entries = new Set(options.entries || [], 'relativePath');
  }
}

FSTree.fromPaths = function (paths) {
  var entries = paths.map(function (path) {
    return new Entry(path, 0, ARBITRARY_START_OF_TIME);
  });

  return new FSTree({
    entries: entries,
  });
};

Object.defineProperty(FSTree.prototype, 'size', {
  get: function() {
    return this.entries.size;
  }
});

FSTree.prototype.forEach = function (fn, context) {
  this.entries.forEach(fn, context);
};

FSTree.prototype.difference = function(otherFSTree) {
  return new FSTree({
    _entries: this.entries.subtract(otherFSTree.entries),
  });
};

FSTree.prototype.intersection = function(otherFSTree) {
  return new FSTree({
    _entries: this.entries.intersection(otherFSTree.entries),
  });
};

FSTree.prototype.calculatePatch = function (otherFSTree) {
  // TODO: algorithimic complexity here isn't ideal. Future work can reduce
  // that cost. Today, the FS IO operations outweigh the cost, even with a
  // naive implementation
  var tree = new Tree(this.entries);

  var fsRemoveTree = this.difference(otherFSTree);
  var fsAddTree = otherFSTree.difference(this);

  // TODO: removeEntries should be combined with the postOrderDepthReducer and return removeOps
  tree.removeEntries(fsRemoveTree.entries);
  var removeOps = tree.postOrderDepthReducer(reduceRemovals, []);

  // TODO: addEntries should be combined with th  preOrderDepthReducer and return addOps
  tree.addEntries(fsAddTree.entries);
  var createOps = tree.preOrderDepthReducer(reduceAdditions, []);

  var changes = this._findChanges(otherFSTree).map(function(change) {
    return ['change', change];
  });

  return removeOps.concat(createOps).concat(changes);
};

FSTree.prototype._findChanges = function(nextTree) {
  var a = this.intersection(nextTree).entries.values;
  var b = nextTree.intersection(this).entries.values;

  if (a.length !== b.length) {
    throw new Error('EWUT');
  }

  var changes = [];
  for (var i = 0; i < a.length; i++) {
    if (needsUpdate(a[i], b[i])) {
      changes.push(b[i].relativePath);
    }
  }

  return changes;
}

function needsUpdate(before, after) {
  if (before.isDirectory() && after.isDirectory()) {
    return false;
  }

  return before.size !== after.size ||
         before.mtime !== after.mtime ||
         before.mode !== after.mode;
}

function reduceAdditions(tree, acc) {
  var childNames = Object.keys(tree.children);

  var createdChildren = childNames.reduce(function (ops, childName) {
    var child = tree.children[childName];
    if (child.isNew) {
      var operation = child.isFile ? 'create' : 'mkdir';
      child.isNew = false;
      ops.push([
        operation,
        tree.pathForChild(childName)
      ]);
    }

    return ops;
  }, []);

  return acc.concat(createdChildren);
}

function reduceRemovals(tree, acc) {
  var childNames = Object.keys(tree.children);

  var removeChildrenOps = childNames.reduce(function (ops, childName) {
    var child = tree.children[childName];

    if (child.operation === Tree.RMToken) {
      var operation = child.isFile ? 'unlink' : 'rmdir';
      ops.push([
        operation,
        tree.pathForChild(childName)
      ]);

      delete tree.children[childName];
    }

    return ops;
  }, []);

  var isRoot = tree.path === undefined;

  if (isRoot) {
    return acc.concat(removeChildrenOps);
  }  else if (removeChildrenOps.length === childNames.length) {
    tree.operation = Tree.RMToken;
    return acc.concat(removeChildrenOps);
  } else {
    return acc.concat(removeChildrenOps);
  }
}
