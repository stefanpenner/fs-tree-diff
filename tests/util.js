'use strict';

var expect = require('chai').expect;
var util = require('../lib/util');
var Entry = require('../lib/entry');

var commonPrefix = util._commonPrefix;
var basename = util._basename;
var computeImpliedEntries = util._computeImpliedEntries;
var sortAndExpand = util.sortAndExpand;

require('chai').config.truncateThreshold = 0;


describe('commonPrefix', function() {
  it('computes no common prefix if non exists', function() {
    expect(commonPrefix('a', 'b')).to.equal('');
  });

  it('computes the common prefix between two strings', function() {
    expect(commonPrefix('a/b/c/', 'a/b/c/d/e/f/', '/')).to.equal('a/b/c/');
  });

  it('strips the suffix (of the common prefix) after the last occurrence of the terminal character', function() {
    expect(commonPrefix('a/b/c/ohai', 'a/b/c/obai', '/')).to.equal('a/b/c/');
  });
});

describe('basename', function() {
  it('computes the basename of files', function() {
    expect(basename(new Entry('a/b/c'))).to.equal('a/b/');
  });

  it('computes the basename of directories', function() {
    expect(basename(new Entry('a/b/c/'))).to.equal('a/b/');
  });
});

describe('computeImpliedEntries', function() {
  it('computes implied entries', function() {
    var entries = computeImpliedEntries('a/b/', 'c/d/e/');
    expect(entries).to.deep.equal([
      new Entry('a/b/c/', 0, 0),
      new Entry('a/b/c/d/', 0, 0),
      new Entry('a/b/c/d/e/', 0, 0),
    ]);
  });
});

describe('sortAndExpand', function() {
  it('sorts and expands entries in place', function() {
    var entries = [
      new Entry('a/b/q/r/bar.js'),
      new Entry('a/b/c/d/foo.js'),
    ];

    var sortedAndExpandedEntries = sortAndExpand(entries);

    expect(entries).to.equal(sortedAndExpandedEntries);
    expect(sortedAndExpandedEntries.map(function(e) { return e.relativePath;})).to.deep.equal([
      'a/',
      'a/b/',
      'a/b/c/',
      'a/b/c/d/',
      'a/b/c/d/foo.js',
      'a/b/q/',
      'a/b/q/r/',
      'a/b/q/r/bar.js',
    ]);
    expect(sortedAndExpandedEntries).to.deep.equal([
      new Entry('a/', 0, 0),
      new Entry('a/b/', 0, 0),
      new Entry('a/b/c/', 0, 0),
      new Entry('a/b/c/d/', 0, 0),
      new Entry('a/b/c/d/foo.js'),
      new Entry('a/b/q/', 0, 0),
      new Entry('a/b/q/r/', 0, 0),
      new Entry('a/b/q/r/bar.js'),
    ]);
  });
});
