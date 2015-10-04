'use strict';

function Entries(entries) {
  this.entries = entries;
}

Entries.prototype.update = function(updates) {
  var ul = updates.length;
  var el = this.entries.length;

  if (ul === el) {
    return this.diffUpdates(updates);
  }

  return [];
};

Entries.prototype.add = function(additions) {
  var al = additions.length;
  var el = this.entries.length;

  if (al > el) {
    return this.diffAdditions(additions);
  }

  return [];
};

Entries.prototype.sortByRelativePath = function(a, b) {
  var _a = a.relativePath.toLowerCase();
  var _b = b.relativePath.toLowerCase();

  if(_a < _b) {
    return -1;
  } else if (_a > _b) {
    return 1;
  }

  return 0;
};

Entries.prototype.datesEqual = function(dateOrNumA, dateOrNumB) {
  if(dateOrNumA instanceof Date) {
    dateOrNumA = dateOrNumA.getTime();
  }

  if(dateOrNumB instanceof Date) {
    dateOrNumB = dateOrNumB.getTime();
  }

  return dateOrNumA === dateOrNumB;
};

Entries.prototype.diffUpdates = function(updates) {
  var sortedUpdates = updates.slice().sort(this.sortByRelativePath.bind(this));
  var sortedEntries = this.entries.slice().sort(this.sortByRelativePath.bind(this));

  return sortedUpdates.filter(function(entry, i) {
    var _entry = sortedEntries[i];

    if (entry.relativePath !== _entry.relativePath) {
      throw new Error('Mismatch in files');
    }

    var mtimeChanged = !this.datesEqual(_entry.mtime, entry.mtime); // mtime may be an integer or a Date
    var sizeChanged = _entry.size !== entry.size;
    var modeChanged = _entry.mode !== entry.mode;

    return mtimeChanged || sizeChanged || modeChanged;

  }, this);
};

Entries.prototype.diffAdditions = function(newEntries) {
  var paths = this.entries.map(this.byRelativePath.bind(this));
  return newEntries.filter(function(entry) {
    return paths.indexOf(entry.relativePath) === -1;
  });
};

Entries.prototype.diffRemovals = function(newEntries) {
  var paths = newEntries.map(this.byRelativePath.bind(this));

  return this.entries.filter(function(entry) {
    return paths.indexOf(entry.relativePath) === -1;
  });
};

Entries.prototype.byRelativePath = function(entry) {
  return entry.relativePath;
};

Entries.prototype.remove = function(removals) {
  var rl = removals.length;
  var el = this.entries.length;

  if (rl < el) {
    return this.diffRemovals(removals);
  }

  return [];
};

Entries.prototype.identity = function() {
  return this.entries;
};

module.exports = Entries;
