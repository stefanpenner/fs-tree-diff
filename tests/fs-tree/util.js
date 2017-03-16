'use strict';

const merge = require('lodash.merge');

const Entry = require('../../lib/entry');

module.exports.MockEntry = function(options) {
  let relativePath = options.relativePath;
  let mode = options.mode;
  let size = options.size;
  let mtime = options.mtime;
  let checksum = options.checksum;
  let meta = options.meta;

  Entry.call(this, relativePath, size, mtime, mode, checksum);

  if (meta) {
    this.meta = meta;
  }
};

module.exports.MockEntry.prototype = Entry.prototype;



module.exports.file = function(relativePath, options) {
  return module.exports.entry(merge({ relativePath: relativePath }, options));
};

module.exports.directory = function(relativePath, options) {
  return module.exports.entry(merge({
    relativePath: relativePath,
    mode: 16877
  }, options));
};

module.exports.entry = function(options) {
  return new module.exports.MockEntry({
    relativePath: options.relativePath,
    mode: options.mode || 0,
    size: options.size || 0,
    mtime: options.mtime || 0,
    meta: options.meta,
    checksum: options.checksum
  });
}
