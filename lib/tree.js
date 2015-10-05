'use strict';

var Set = require('fast-ordered-set');
var Entry = require('./entry');
var chomp = require('./util').chomp;

var ARBITRARY_START_OF_TIME = 0;

function Tree(entries, path, isNew) {
  this.children = { };
  this.operation = null;
  this.isFile = false;
  this.isNew = isNew === true;
  this.path = path;

  if (entries.size > 0) {
    this.addEntries(entries, this.isNew);
  }
}

Tree.RMToken = function RMToken() { };
Tree.CreateToken = function CreateToken() { };

Tree.prototype.pathForChild = function (childName) {
  if (this.path) {
    return this.path + '/' + childName;
  } else {
    return childName;
  }
};

Tree.prototype.preOrderDepthReducer = function(fn, acc) {
  var names = Object.keys(this.children);
  if (names.length === 0) { return acc; }

  var result = fn(this, acc);
  var tree = this;

  return names.reduce(function(acc, name) {
    var child = tree.children[name];
    if (child instanceof Tree) {
      return child.preOrderDepthReducer(fn, acc);
    } else {
      return acc;
    }
  }, result);
};

Tree.prototype.postOrderDepthReducer = function(fn, acc) {
  var names = Object.keys(this.children);
  if (names.length === 0) { return acc; }

  names.forEach(function(name) {
    var child = this.children[name];
    if (child instanceof Tree) {
      acc = child.postOrderDepthReducer(fn, acc);
    }
  }, this);

  return fn(this, acc);
};

Tree.prototype.addEntries = function (entries, _isNew) {
  var isNew = arguments.length > 1 ? arguments[1] : true;

  entries.forEach(function(entry) {
    this.addEntry(entry, isNew);
  }, this);
};

function File(entry, isNew) {
  this.isFile = true;
  this.isNew = isNew;
  this.entry = entry;
  this.operation = undefined;
  // TODO: error if entry is a directory
}

Tree.prototype.addEntry = function (entry, _isNew) {
  var fileParts = entry.relativePath.split('/');
  var current = fileParts.shift();
  var child = this.children[current];
  var isNew = arguments.length > 1 ? arguments[1] : true;

  if (current === '') {
    return;
  }

  if (fileParts.length === 0) {
    if (child && child.isFile) {
      throw new Error('Cannot add duplicate file');
    } else if (child instanceof Tree) {
      throw new Error('Cannot overwrite directory with file');
    }

    // add a file
    this.children[current] = new File(entry, isNew);
  } else {
    if (child && child.isFile) {
      throw new Error('Cannot add files to files');
    }

    var tree = this.children[current];
    if (!tree) {
      this.children[current] = new Tree(new Set([
        new Entry( fileParts.join('/'), 0, ARBITRARY_START_OF_TIME)
      ], 'relativePath'), this.pathForChild(current), isNew);
    } else {
      tree.addEntry(new Entry(fileParts.join('/'), entry.size, entry.mtime), isNew);
    }
  }
};

Tree.prototype.removeEntries = function (entries) {
  entries.forEach(this.removeEntry, this);
};

Tree.prototype.removeEntry = function (entry) {
  var fileParts = chomp(entry.relativePath, '/').split('/');
  var current = fileParts.shift();
  var child = this.children[current];

  if (fileParts.length === 0) {
    if (!child) {
      throw new Error('Cannot remove nonexistant file');
    }

    this.children[current].operation = Tree.RMToken;
  } else {
    if (!child) {
      throw new Error('Cannot remove from nonexistant directory');
    } else if (child.isFile) {
      throw new Error('Cannot remove directory from file');
    }

    child.removeEntry(new Entry(fileParts.join('/'), null, null));
  }
};


module.exports = Tree;
