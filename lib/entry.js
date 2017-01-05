'use strict';

const { chompPathSep } = require('./util');

var ARBITRARY_START_OF_TIME = 0;
var DIRECTORY_MODE = 16877;

module.exports = Entry;
function Entry(relativePath, size, mtime, mode, checksum) {
  var modeType = typeof mode;
  if (modeType !== 'number') {
    throw new TypeError('Expected `mode` to be of type `number` but was of type `' + modeType + '` instead.');
  }
  this.mode = mode;
  // ----------------------------------------------------------------------
  // required properties

  this.relativePath = chompPathSep(relativePath);
  this.size = size;
  this.mtime = mtime;
  this.checksum = checksum;
}

function isDirectory(entry) {
  return (entry.mode & 61440) === 16384;
}

function isFile(entry) {
  return !isDirectory(entry);
}

Entry.isDirectory = isDirectory;
Entry.isFile = isFile;

// required methods

Entry.prototype.isDirectory = function() {
  return isDirectory(this);
};

Entry.prototype.isFile = function() {
  return isFile(this);
};

Entry.fromStat = function(relativePath, stat) {
  var entry = new this(relativePath, stat.size, stat.mtime, stat.mode);
  return entry;
};

Entry.fromPath = function (relativePath) {
  var mode = relativePath.charAt(relativePath.length - 1) === '/' ? DIRECTORY_MODE : 0;
  return new this(relativePath, 0, Date.now(), mode);
}

Entry.cast = function(entry) {
  if(entry.constructor === this) {
    return entry;
  }

  return new Entry(
    entry.relativePath,
    entry.size,
    entry.mtime,
    entry.mode
  );
}

Entry.DIRECTORY_MODE = DIRECTORY_MODE;
