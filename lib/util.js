'use strict';

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
  var path = entry.relativePath;
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
