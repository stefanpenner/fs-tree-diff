'use strict';

/* global Set:true */

var Set = require('fast-ordered-set');
var Entries = require('./entries');
var util = require('./util');
var Tree = require('./tree');
var EntryTree = require('./entry-tree');
var byRelativePath = util.byRelativePath;

var DIRECTORY_MODE = 16877;
var ARBITRARY_START_OF_TIME = 0;

module.exports = FSTree;

function toChangeOp(change) {
  return ['change', change.relativePath];
}

function FSTree(options) {
  options = options || {};

  this.entries = new Set(options.entries || [], 'relativePath');
}

FSTree.fromPaths = function (paths) {
  var entries = paths.map(function (path) {
    var isDirectory = path.charAt(path.length - 1) === '/';

    return {
      relativePath: path,
      mode: isDirectory ? DIRECTORY_MODE : '0',
      size: 0,
      mtime: ARBITRARY_START_OF_TIME,
    };
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

FSTree.prototype.calculatePatch = function (otherFSTree) {
  // TODO: algorithimic complexity here isn't ideal. Future work can reduce
  // that cost. Today, the FS IO operations outweigh the cost, even with a
  // naive implementation
  var tree = new Tree(this.entries);

  var otherEntries = otherFSTree.entries;

  var entriesToRemove = this.entries.subtract(otherEntries);
  var entriesToAdd = otherEntries.subtract(this.entries);

  // TODO: removeEntries should be combined with the postOrderDepthReducer and return removeOps
  tree.removeEntries(entriesToRemove);
  var removeOps = tree.postOrderDepthReducer(reduceRemovals, []);

  // TODO: addEntries should be combined with th  preOrderDepthReducer and return addOps
  tree.addEntries(entriesToAdd);
  var createOps = tree.preOrderDepthReducer(reduceAdditions, []);

  var changes = findChanges(this.entries, otherEntries).map(function(change) {
    return ['change', change];
  });

  return removeOps.concat(createOps).concat(changes);
};

function findChanges(previousEntries, nextEntries) {
  var a = previousEntries.intersection(nextEntries).values;
  var b = nextEntries.intersection(previousEntries).values;

  if (a.length !== b.length) {
    throw new Error('EWUT');
  }

  var changes = [];
  for (var i = 0; i < a.length; i++) {
    if (needsUpdate(a[i], b[i])) {
      changes.push(b);
    }
  }

  return changes;
}

function needsUpdate(before, after) {
  return false;
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
