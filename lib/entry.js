'use strict';

const util = require('./util');

const chompLeadAndTrailingPathSep = util.chompLeadAndTrailingPathSep;
const isDirectory = util.isDirectory;
const isFile = util.isFile;
const isSymlink = util.isSymlink;

const ARBITRARY_START_OF_TIME = 0;
const DIRECTORY_MODE = 16877;
const SYMLINK_MODE = 40960;

module.exports = Entry;
function Entry(relativePath, size, mtime, mode, checksum) {
  let modeType = typeof mode;
  if (modeType !== 'number') {
    throw new TypeError('Expected `mode` to be of type `number` but was of type `' + modeType + '` instead.');
  }
  this.mode = mode;
  // ----------------------------------------------------------------------
  // required properties
  this.relativePath = isDirectory(this) ? chompLeadAndTrailingPathSep(relativePath) : relativePath;
  this.size = size;
  this.mtime = mtime;
  this.checksum = checksum;
}

Entry.isDirectory = isDirectory;
Entry.isFile = isFile;
Entry.isSymlink = isSymlink;


Entry.cloneEntry = function(originalEntry) {
  let newEntry;

  if (originalEntry instanceof Entry) {
    newEntry = new Entry(originalEntry.relativePath, originalEntry.size, originalEntry.mtime, originalEntry.mode, originalEntry.checksum);
  } else {
    newEntry = {};
  }

  Object.keys(originalEntry).forEach(key => {
    newEntry[key] = originalEntry[key];
  });

  return newEntry;
}


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
