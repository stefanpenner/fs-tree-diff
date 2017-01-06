'use strict';

const util = require('./util');

const chompPathSep = util.chompPathSep;
const isDirectory = util.isDirectory;
const isFile = util.isFile;
const isSymlink = util.isSymlink;

const ARBITRARY_START_OF_TIME = 0;
const DIRECTORY_MODE = 16877;
const SYMLINK_MODE = 40960;

module.exports = Entry;
function Entry(relativePath, size, mtime, mode, checksum, target) {
  let modeType = typeof mode;
  if (modeType !== 'number') {
    throw new TypeError('Expected `mode` to be of type `number` but was of type `' + modeType + '` instead.');
  }
  this.mode = mode;
  // ----------------------------------------------------------------------
  // required properties

  this.relativePath = isDirectory(this) ? chompPathSep(relativePath) : relativePath;
  this.size = size;
  this.mtime = mtime;
  this.checksum = checksum;
  this.target = target;
}

Entry.isDirectory = isDirectory;
Entry.isFile = isFile;
Entry.isSymlink = isSymlink;

Entry.fromStat = function(relativePath, stat) {
  let entry = new this(relativePath, stat.size, stat.mtime, stat.mode);
  return entry;
};

Entry.fromPath = function (relativePath) {
  let mode = relativePath.charAt(relativePath.length - 1) === '/' ? DIRECTORY_MODE : 0;
  return new this(relativePath, 0, Date.now(), mode);
}

Entry.DIRECTORY_MODE = DIRECTORY_MODE;
Entry.SYMLINK_MODE = SYMLINK_MODE;
