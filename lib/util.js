'use strict';


module.exports.isDirectory = function(entry) {
  return (entry.mode & 61440) === 16384;
}

module.exports.isSymlink = function(entry) {
  return (entry.mode & 61440) === 40960;
}

module.exports.isFile = function(entry) {
  return !module.exports.isDirectory(entry);
}

module.exports.commonPrefix = function(a, b, term) {
  var max = Math.min(a.length, b.length);
  var end = -1;

  for(var i = 0; i < max; ++i) {
    if (a[i] !== b[i]) {
      break;
    } else if (a[i] === term) {
      end = i;
    }
  }

  return a.substr(0, end + 1);
};

module.exports.basename = function(entry) {
  var path = module.exports.entryRelativePath(entry);
  var end = path.length - 2;
  for(var i = end; i >= 0; --i) {
    if (path[i] === '/') {
      return path.substr(0, i + 1);
    }
  }

  return '';
};

module.exports.chompPathSep = function(path) {
  // strip trailing path.sep (but both seps on posix and win32);
  return path.replace(/(\/|\\)$/, '');
};

module.exports.lchompPathStart = function(path) {
  return path.replace(
    /^(?:\.$)|^(?:\.\/)/,
    ''
  );
};

module.exports.entryRelativePath = function(entry) {
  let path = entry.relativePath;
  if (module.exports.isDirectory(entry)) {
    return module.exports.chompPathSep(path);
  }

  return path;
}

// TODO: do we actually have to have Stat and entry2stat?
// it's here because we added support for walksync to accept us (an fs facade)
// as a custom fs API.
//
// This means walksync will be calling statSync on us, and walksync expects the
// stats it gets back to have `mtime`'s that are `Date`s, not `Number`s.
class Stat {
  constructor(relativePath, size, mtime, mode) {
    this.relativePath = relativePath;
    this.size = size;
    this.mtime = mtime;
    this.mode = mode;
  }

  isDirectory() {
    return module.exports.isDirectory(this);
  }
}

module.exports.entry2Stat = function(entry) {
  if (!entry) { return entry; }

  return new Stat(
    entry.relativePath,
    entry.size,
    new Date(entry.mtime),
    entry.mode
  );
}
