'use strict';

const expect = require('chai').expect;
const Entry = require('../lib/entry');
const util = require('../lib/util');
const treeOptionHelpers = require('../lib/tree-option-helpers');

const entryRelativePath = util.entryRelativePath;
const lchompPathStart = util.lchompPathStart;
const commonPrefix = util.commonPrefix;
const basename = util.basename;
const computeImpliedEntries = treeOptionHelpers.computeImpliedEntries;
const sortAndExpand = treeOptionHelpers.sortAndExpand;
const isDirectory = Entry.isDirectory;
const isFile = Entry.isFile;

require('chai').config.truncateThreshold = 0;


describe('util', function() {
  const originalNow = Date.now;

  beforeEach(function() {
    Date.now = (() => 0);
  });

  afterEach(function() {
    Date.now = originalNow;
  });

  describe('.commonPrefix', function() {
    it('computes no common prefix if none exists', function() {
      expect(commonPrefix('a', 'b')).to.equal('');
    });

    it('computes the common prefix between two strings', function() {
      expect(commonPrefix('a/b/c/', 'a/b/c/d/e/f/', '/')).to.equal('a/b/c/');
    });

    it('strips the suffix (of the common prefix) after the last occurrence of the terminal character', function() {
      expect(commonPrefix('a/b/c/ohai', 'a/b/c/obai', '/')).to.equal('a/b/c/');
    });
  });

  describe('.lchompPathStart', function() {
    it('lchomps ./', function() {
      expect(lchompPathStart('./')).to.eql('');
    });

    it('lchomps .', function() {
      expect(lchompPathStart('.')).to.eql('');
    });

    it('does not lchomp ..', function() {
      expect(lchompPathStart('..')).to.eql('..');
    });

    it('does not lchomp ../', function() {
      expect(lchompPathStart('../')).to.eql('../');
    });
  });

  describe('.basename', function() {
    it('computes the basename of files', function() {
      expect(basename(Entry.fromPath('a/b/c'))).to.equal('a/b/');
    });

    it('computes the basename of directories', function() {
      expect(basename(Entry.fromPath('a/b/c/'))).to.equal('a/b/');
    });
  });

  describe('.computeImpliedEntries', function() {
    it('computes implied entries', function() {
      let entries = computeImpliedEntries('a/b/', 'c/d/e/');

      expect(entries).to.deep.equal([
        new Entry('a/b/c/', 0, 0, Entry.DIRECTORY_MODE),
        new Entry('a/b/c/d/', 0, 0, Entry.DIRECTORY_MODE),
        new Entry('a/b/c/d/e/', 0, 0, Entry.DIRECTORY_MODE),
      ]);
    });

    it('does not compute existing entries', function() {
      let entries = computeImpliedEntries('a/', 'b/c/');

      expect(entries.map(e => e.relativePath)).to.deep.equal([
        'a/b', 'a/b/c'
      ]);
    });
  });

  describe('.sortAndExpand', function() {
    it('sorts and expands entries in place', function() {
      let entries = [
        'a/b/q/r/bar.js',
        'a/b/c/d/foo.js',
      ].map(e => Entry.fromPath(e));

      var sortedAndExpandedEntries = sortAndExpand(entries);

      expect(entries).to.equal(sortedAndExpandedEntries);
      expect(sortedAndExpandedEntries.map(function(e) { return e.relativePath;})).to.deep.equal([
        'a',
        'a/b',
        'a/b/c',
        'a/b/c/d',
        'a/b/c/d/foo.js',
        'a/b/q',
        'a/b/q/r',
        'a/b/q/r/bar.js',
      ]);
      expect(sortedAndExpandedEntries).to.deep.equal([
        new Entry('a', 0, 0, Entry.DIRECTORY_MODE),
        new Entry('a/b', 0, 0, Entry.DIRECTORY_MODE),
        new Entry('a/b/c', 0, 0, Entry.DIRECTORY_MODE),
        new Entry('a/b/c/d', 0, 0, Entry.DIRECTORY_MODE),
        new Entry('a/b/c/d/foo.js', 0, 0, 0),
        new Entry('a/b/q', 0, 0, Entry.DIRECTORY_MODE),
        new Entry('a/b/q/r', 0, 0, Entry.DIRECTORY_MODE),
        new Entry('a/b/q/r/bar.js', 0, 0, 0),
      ]);
    });
  });

  describe('.entryRelativePath', function() {
    it('strips nothing for file entries', function() {
      expect(entryRelativePath(new Entry('my-path', 0, 0, 0))).to.eql('my-path');
      expect(entryRelativePath(new Entry('my-path/', 0, 0, 0))).to.eql('my-path/');
      expect(entryRelativePath(new Entry('my-path\\', 0, 0, 0))).to.eql('my-path\\');
    });

    it('strips trailing / or \\ for directory entries', function() {
      expect(
        entryRelativePath(new Entry('my-path', 0, 0, Entry.DIRECTORY_MODE))
      ).to.eql('my-path');
      expect(
        entryRelativePath(new Entry('my-path/', 0, 0, Entry.DIRECTORY_MODE))
      ).to.eql('my-path');
      expect(
        entryRelativePath(new Entry('my-path\\', 0, 0, Entry.DIRECTORY_MODE))
      ).to.eql('my-path');
    });
  });
});
