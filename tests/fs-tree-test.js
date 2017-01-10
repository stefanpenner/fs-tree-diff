'use strict';

const fs = require('fs-extra');
const path = require('path');
const expect = require('chai').expect;
const walkSync = require('walk-sync');
const FSTree = require('../lib/index');
const Entry = require('../lib/entry');
const context = describe;
const defaultIsEqual = FSTree.defaultIsEqual;
const md5hex = require('md5hex');
const fixturify = require('fixturify');
const rimraf = require('rimraf');

const isDirectory = Entry.isDirectory;

require('chai').config.truncateThreshold = 0;

let fsTree;

describe('FSTree', function() {
  let ROOT = path.resolve('tmp/fs-test-root/');

  function merge(x, y) {
    let result = {};

    Object.keys(x || {}).forEach(function(key) {
      result[key] = x[key];
    });

    Object.keys(y || {}).forEach(function(key) {
      result[key] = y[key];
    });

    return result;
  }

  function MockEntry(options) {
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
  }

  MockEntry.prototype = Entry.prototype;

  function metaIsEqual(a, b) {
    let aMeta = a.meta;
    let bMeta = b.meta;
    let metaKeys = aMeta ? Object.keys(aMeta) : [];
    let otherMetaKeys = bMeta ? Object.keys(bMeta) : [];

    if (metaKeys.length !== Object.keys(otherMetaKeys).length) {
      return false;
    } else {
      for (let i=0; i<metaKeys.length; ++i) {
        if (aMeta[metaKeys[i]] !== bMeta[metaKeys[i]]) {
          return false;
        }
      }
    }

    return true;
  }

  function userProvidedIsEqual(a, b) {
    return  defaultIsEqual(a, b) && metaIsEqual(a, b);
  }


  function file(relativePath, options) {
    return entry(merge({ relativePath: relativePath }, options));
  }

  function directory(relativePath, options) {
    return entry(merge({
      relativePath: relativePath,
      mode: 16877
    }, options));
  }

  function entry(options) {
    return new MockEntry({
      relativePath: options.relativePath,
      mode: options.mode || 0,
      size: options.size || 0,
      mtime: options.mtime || 0,
      meta: options.meta,
      checksum: options.checksum
    });
  }

  function by(property) {
    return function pluckProperty(item) {
      return item[property];
    };
  }

  const originalNow = Date.now;

  beforeEach(function() {
    Date.now = (() => 0);
  });

  afterEach(function() {
    Date.now = originalNow;
  });

  it('can be instantiated', function() {
    expect(new FSTree()).to.be.an.instanceOf(FSTree);
  });

  describe('.fromPaths', function() {
    it('creates empty trees', function() {
      fsTree = FSTree.fromPaths([ ]);
      expect(fsTree.size).to.eq(0);
    });

    describe('input validation', function() {
      it('throws on duplicate', function() {
        expect(function() {
          FSTree.fromPaths([
            'a',
            'a',
          ]);
        }).to.throw('expected entries[0]: `a` to be < entries[1]: `a`, but was not. Ensure your input is sorted and has no duplicate paths');
      });

      it('throws on unsorted', function() {
        expect(function() {
          FSTree.fromPaths([
            'b',
            'a',
          ]);
        }).to.throw('expected entries[0]: `b` to be < entries[1]: `a`, but was not. Ensure your input is sorted and has no duplicate paths');
      });
    });

    describe('options', function() {
      describe('sortAndExpand', function() {
        it('sorts input entries', function() {
          fsTree = FSTree.fromPaths([
            'foo/',
            'foo/a.js',
            'bar/',
            'bar/b.js',
          ], { sortAndExpand: true });

          expect(fsTree.entries.map(by('relativePath'))).to.deep.equal([
            'bar',
            'bar/b.js',
            'foo',
            'foo/a.js',
          ]);
        });

        it('expands intermediate directories implied by input entries', function() {
          fsTree = FSTree.fromPaths([
            'a/b/q/r/bar.js',
            'a/b/c/d/foo.js',
          ], { sortAndExpand: true });

          expect(fsTree.entries).to.deep.equal([
            directory('a/'),
            directory('a/b/'),
            directory('a/b/c/'),
            directory('a/b/c/d/'),
            file('a/b/c/d/foo.js'),
            directory('a/b/q/'),
            directory('a/b/q/r/'),
            file('a/b/q/r/bar.js'),
          ]);
        });

        it('does not mutate its input', function() {
          let paths = [
            'foo/',
            'foo/a.js',
            'bar/',
            'bar/b.js',
          ];
          fsTree = FSTree.fromPaths(paths, { sortAndExpand: true });

          expect(paths).to.deep.equal([
            'foo/',
            'foo/a.js',
            'bar/',
            'bar/b.js',
          ]);
        });
      });
    });

    it('creates trees from paths', function() {
      let result;

      fsTree = FSTree.fromPaths([
        'a.js',
        'foo/',
        'foo/a.js',
      ]);

      result = fsTree.calculatePatch(
        FSTree.fromPaths([
          'a.js',
          'foo/',
          'foo/b.js',
        ])
      );

      expect(result).to.deep.equal([
        ['unlink', 'foo/a.js', file('foo/a.js')],
        ['create', 'foo/b.js', file('foo/b.js')]
      ]);
    });
  });

  describe('.fromEntries', function() {

    describe('input validation', function() {
      it('throws on duplicate', function() {
        expect(function() {
          FSTree.fromEntries([
            file('a', { size: 1, mtime: 1 }),
            file('a', { size: 1, mtime: 2 }),
          ]);
        }).to.throw('expected entries[0]: `a` to be < entries[1]: `a`, but was not. Ensure your input is sorted and has no duplicate paths');
      });

      it('throws on unsorted', function() {
        expect(function() {
          FSTree.fromEntries([
            file('b'),
            file('a'),
          ]);
        }).to.throw('expected entries[0]: `b` to be < entries[1]: `a`, but was not. Ensure your input is sorted and has no duplicate paths');
      });
    });

    it('creates empty trees', function() {
      fsTree = FSTree.fromEntries([ ]);
      expect(fsTree.size).to.eq(0);
    });

    it('creates tree from entries', function() {
      let fsTree = FSTree.fromEntries([
        file('a/b.js', { size: 1, mtime: 1 }),
        file('a/c.js', { size: 1, mtime: 1 }),
        file('c/d.js', { size: 1, mtime: 1 }),
      ]);

      expect(fsTree.size).to.eq(3);

      let result = fsTree.calculatePatch(FSTree.fromEntries([
        file('a/b.js', { size: 1, mtime: 2 }),
        file('a/c.js', { size: 1, mtime: 1 }),
        file('c/d.js', { size: 1, mtime: 1 }),
      ]));

      expect(result).to.deep.equal([
        ['change', 'a/b.js', file('a/b.js', { mtime: 2, size: 1 })]
      ]);
    });
  });

  describe('adding new entries', function() {
    context(".addEntries", function() {
      context('input validation', function() {
        it('requires an array', function() {
          expect(function() {
              FSTree.fromPaths([]).addEntries(file('a.js'));
          }).to.throw(TypeError, 'entries must be an array');
        });

        it('throws on duplicate', function() {
          expect(function() {
            FSTree.fromEntries([]).addEntries([
              file('a', { size: 1, mtime: 1 }),
              file('a', { size: 1, mtime: 2 }),
            ]);
          }).to.throw('expected entries[0]: `a` to be < entries[1]: `a`, but was not. Ensure your input is sorted and has no duplicate paths');
        });

        it('throws on unsorted', function() {
          expect(function() {
            FSTree.fromEntries([]).addEntries([
              file('b'),
              file('a'),
            ]);
          }).to.throw('expected entries[0]: `b` to be < entries[1]: `a`, but was not. Ensure your input is sorted and has no duplicate paths');
        });
      });

      it('inserts one file into sorted location', function() {
        let result;

        fsTree = FSTree.fromPaths([
          'a.js',
          'foo/',
          'foo/a.js',
        ]);

        fsTree.addEntries([file('b.js', { size: 1, mtime: 1 })]);

        expect(fsTree.entries.map(by('relativePath'))).to.deep.equal([
          'a.js',
          'b.js',
          'foo',
          'foo/a.js',
        ]);
      });

      it('inserts several entries', function() {
        let result;

        fsTree = FSTree.fromPaths([
          'a.js',
          'foo/',
          'foo/a.js',
        ]);

        fsTree.addEntries([
          file('bar/b.js', { size: 10, mtime: 10 }),
          file('1.js'),
          file('foo/bip/img.jpg'),
        ], {sortAndExpand: true});

        expect(fsTree.entries.map(by('relativePath'))).to.deep.equal([
          '1.js',
          'a.js',
          'bar',
          'bar/b.js',
          'foo',
          'foo/a.js',
          'foo/bip',
          'foo/bip/img.jpg',
        ]);
      });

      it('replaces duplicates', function() {
        let result;

        fsTree = FSTree.fromPaths([
          'a.js',
          'foo/',
          'foo/a.js',
        ]);

        expect(fsTree.entries[2].mtime).to.equal(0);

        fsTree.addEntries([file('foo/a.js', { size: 10, mtime: 10 })], {sortAndExpand: true});

        expect(fsTree.entries.map(by('relativePath'))).to.deep.equal([
          'a.js',
          'foo',
          'foo/a.js',
        ]);
        expect(fsTree.entries[2].mtime).to.equal(10);
      });
    });

    context(".addPaths", function() {
      it("passes through to .addEntries", function() {
        let result;

        fsTree = FSTree.fromPaths([
          'a.js',
          'foo/',
          'foo/a.js',
        ]);

        fsTree.addPaths([
          'bar/b.js',
          '1.js',
          'foo/bip/img.jpg'
        ], {sortAndExpand: true});

        expect(fsTree.entries.map(by('relativePath'))).to.deep.equal([
          '1.js',
          'a.js',
          'bar',
          'bar/b.js',
          'foo',
          'foo/a.js',
          'foo/bip',
          'foo/bip/img.jpg',
        ]);
      });
    });
  });

  describe('#calculatePatch', function() {
    it('input validation', function() {
      expect(function() {
        FSTree.fromPaths([]).calculatePatch(FSTree.fromPaths([]), '');
      }).to.throw(TypeError, 'calculatePatch\'s second argument must be a function');
    });

    context('from an empty tree', function() {
      beforeEach( function() {
        fsTree = new FSTree();
      });

      context('to an empty tree', function() {
        it('returns 0 operations', function() {
          expect(fsTree.calculatePatch(FSTree.fromPaths([]))).to.deep.equal([]);
        });
      });

      context('to a non-empty tree', function() {
        it('returns n create operations', function() {
          expect(fsTree.calculatePatch(FSTree.fromPaths([
            'bar/',
            'bar/baz.js',
            'foo.js',
          ]))).to.deep.equal([
            ['mkdir',  'bar',        directory('bar/')],
            ['create', 'bar/baz.js', file('bar/baz.js')],
            ['create', 'foo.js',     file('foo.js')],
          ]);
        });
      });
    });

    context('from a simple non-empty tree', function() {
      beforeEach( function() {
        fsTree = FSTree.fromPaths([
          'bar/',
          'bar/baz.js',
          'foo.js',
        ]);
      });

      context('to an empty tree', function() {
        it('returns n rm operations', function() {
          expect(fsTree.calculatePatch(FSTree.fromPaths([]))).to.deep.equal([
            ['unlink', 'foo.js',     file('foo.js')],
            ['unlink', 'bar/baz.js', file('bar/baz.js')],
            ['rmdir',  'bar',        directory('bar/')],
          ]);
        });
      });
    });

    context('FSTree with entries', function() {
      context('of files', function() {
        beforeEach(function() {
          fsTree = new FSTree({
            entries: [
              directory('a/'),
              file('a/b.js', { mode: 0o666, size: 1, mtime: 1 }),
              file('a/c.js', { mode: 0o666, size: 1, mtime: 1 }),
              directory('c/'),
              file('c/d.js', { mode: 0o666, size: 1, mtime: 1, meta: { rev: 0 } })
            ]
          });
        });

        it('detects additions', function() {
          let result = fsTree.calculatePatch(new FSTree({
            entries: [
              directory('a/'),
              file('a/b.js', { mode: 0o666, size: 1, mtime: 1 }),
              file('a/c.js', { mode: 0o666, size: 1, mtime: 1 }),
              file('a/j.js', { mode: 0o666, size: 1, mtime: 1 }),
              directory('c/'),
              file('c/d.js', { mode: 0o666, size: 1, mtime: 1, meta: { rev: 0 } }),
            ]
          }));

          expect(result).to.deep.equal([
            ['create', 'a/j.js', file('a/j.js', { mode: 0o666, size: 1, mtime: 1 })]
          ]);
        });

        it('detects removals', function() {
          let result = fsTree.calculatePatch(new FSTree({
            entries: [
              directory('a/'),
              entry({ relativePath: 'a/b.js', mode: 0o666, size: 1, mtime: 1 })
            ]
          }));

          expect(result).to.deep.equal([
            ['unlink', 'c/d.js', file('c/d.js', { mode: 0o666, size: 1, mtime: 1, meta: { rev: 0 } })],
            ['rmdir',  'c',      directory('c/')],
            ['unlink', 'a/c.js', file('a/c.js', { mode: 0o666, size: 1, mtime: 1 })],
          ]);
        });

        it('detects file updates', function() {
          let entries = [
            directory('a/'),
            file('a/b.js', { mode: 0o666, size: 1, mtime: 2 }),
            file('a/c.js', { mode: 0o666, size: 10, mtime: 1 }),
            directory('c/'),
            file('c/d.js', { mode: 0o666, size: 1, mtime: 1, meta: { rev: 1 } }),
          ];

          let result = fsTree.calculatePatch(new FSTree({
            entries: entries
          }), userProvidedIsEqual);

          expect(result).to.deep.equal([
            ['change', 'a/b.js', entries[1]],
            ['change', 'a/c.js', entries[2]],
            ['change', 'c/d.js', entries[4]],
          ]);
        });

        it('detects directory updates from user-supplied meta', function () {
          let entries = [
            directory('a/', { meta: { link: true } }),
            file('a/b.js', { mode: 0o666, size: 1, mtime: 1 }),
            file('a/c.js', { mode: 0o666, size: 1, mtime: 1 }),
            directory('c/'),
            file('c/d.js', { mode: 0o666, size: 1, mtime: 1, meta: { rev: 0 } })
          ];

          let result = fsTree.calculatePatch(new FSTree({
            entries: entries
          }), userProvidedIsEqual);

          expect(result).to.deep.equal([
            ['change', 'a', entries[0]]
          ]);
        });

        it('passes the rhs user-supplied entry on updates', function () {
          let bEntry = file('a/b.js', {
            mode: 0o666, size: 1, mtime: 2, meta: { link: true }
          });
          let entries = [
            directory('a/'),
            bEntry,
            file('a/c.js', { mode: 0o666, size: 1, mtime: 1 }),
            directory('c/'),
            file('c/d.js', { mode: 0o666, size: 1, mtime: 1, meta: { rev: 0 } }),
          ];

          let result = fsTree.calculatePatch(new FSTree({
            entries: entries
          }));

          expect(result).to.deep.equal([
            ['change', 'a/b.js', bEntry],
          ]);
        });
      });
    });

    context('FSTree with updates at several different depths', function () {
      beforeEach( function() {
        fsTree = new FSTree({
          entries: [
            entry({ relativePath: 'a.js', mode: 0o666, size: 1, mtime: 1 }),
            entry({ relativePath: 'b.js', mode: 0o666, size: 1, mtime: 1 }),
            entry({ relativePath: 'one/a.js', mode: 0o666, size: 1, mtime: 1 }),
            entry({ relativePath: 'one/b.js', mode: 0o666, size: 1, mtime: 1 }),
            entry({ relativePath: 'one/two/a.js', mode: 0o666, size: 1, mtime: 1 }),
            entry({ relativePath: 'one/two/b.js', mode: 0o666, size: 1, mtime: 1 }),
          ]
        });
      });

      it('catches each update', function() {
        let result = fsTree.calculatePatch(new FSTree({
          entries: [
            entry({ relativePath: 'a.js', mode: 0o666, size: 1, mtime: 2 }),
            entry({ relativePath: 'b.js', mode: 0o666, size: 1, mtime: 1 }),
            entry({ relativePath: 'one/a.js', mode: 0o666, size: 10, mtime: 1 }),
            entry({ relativePath: 'one/b.js', mode: 0o666, size: 1, mtime: 1 }),
            entry({ relativePath: 'one/two/a.js', mode: 0o667, size: 1, mtime: 1 }),
            entry({ relativePath: 'one/two/b.js', mode: 0o666, size: 1, mtime: 1 }),
          ]
        }));

        expect(result).to.deep.equal([
          ['change', 'a.js', entry({ relativePath: 'a.js', size: 1, mtime: 2, mode: 0o666 })],
          ['change', 'one/a.js', entry({ relativePath: 'one/a.js', size: 10, mtime: 1, mode: 0o666})],
          ['change', 'one/two/a.js', entry({ relativePath: 'one/two/a.js', mode: 0o667, size: 1, mtime: 1})],
        ]);
      });
    });

    context('with unchanged paths', function() {
      beforeEach( function() {
        fsTree = FSTree.fromPaths([
          'bar/',
          'bar/baz.js',
          'foo.js',
        ]);
      });

      it('returns an empty changeset', function() {
        expect(fsTree.calculatePatch(FSTree.fromPaths([
          'bar/',
          'bar/baz.js',
          'foo.js'
        ]))).to.deep.equal([
          // when we work with entries, will potentially return updates
        ]);
      });
    });

    context('from a non-empty tree', function() {
      beforeEach( function() {
        fsTree = FSTree.fromPaths([
          'bar/',
          'bar/one.js',
          'bar/two.js',
          'foo/',
          'foo/one.js',
          'foo/two.js',
        ]);
      });

      context('with removals', function() {
        it('reduces the rm operations', function() {
          expect(fsTree.calculatePatch(FSTree.fromPaths([
            'bar/',
            'bar/two.js'
          ]))).to.deep.equal([
            ['unlink', 'foo/two.js', file('foo/two.js')],
            ['unlink', 'foo/one.js', file('foo/one.js')],
            ['rmdir',  'foo',        directory('foo/')],
            ['unlink', 'bar/one.js', file('bar/one.js')],
          ]);
        });
      });

      context('with removals and additions', function() {
        it('works', function() {
          expect(fsTree.calculatePatch(FSTree.fromPaths([
            'bar/',
            'bar/three.js'
          ]))).to.deep.equal([
            ['unlink', 'foo/two.js',    file('foo/two.js')],
            ['unlink', 'foo/one.js',    file('foo/one.js')],
            ['rmdir',  'foo',           directory('foo/')],
            ['unlink', 'bar/two.js',    file('bar/two.js')],
            ['unlink', 'bar/one.js',    file('bar/one.js')],
            ['create', 'bar/three.js',  file('bar/three.js')],
          ]);
        });
      });
    });

    context('from a deep non-empty tree', function() {
      beforeEach( function() {
        fsTree = FSTree.fromPaths([
          'bar/',
          'bar/quz/',
          'bar/quz/baz.js',
          'foo.js',
        ]);
      });

      context('to an empty tree', function() {
        it('returns n rm operations', function() {
          expect(fsTree.calculatePatch(FSTree.fromPaths([]))).to.deep.equal([
            ['unlink', 'foo.js',          file('foo.js')],
            ['unlink', 'bar/quz/baz.js',  file('bar/quz/baz.js')],
            ['rmdir',  'bar/quz',         directory('bar/quz/')],
            ['rmdir',  'bar',             directory('bar/')],
          ]);
        });
      });
    });

    context('from a deep non-empty tree \w intermediate entry', function() {
      beforeEach( function() {
        fsTree = FSTree.fromPaths([
          'bar/',
          'bar/foo.js',
          'bar/quz/',
          'bar/quz/baz.js',
        ]);
      });

      context('to an empty tree', function() {
        it('returns one unlink operation', function() {
          expect(fsTree.calculatePatch(FSTree.fromPaths([
            'bar/',
            'bar/quz/',
            'bar/quz/baz.js'
          ]))).to.deep.equal([
            ['unlink', 'bar/foo.js', file('bar/foo.js')]
          ]);
        });
      });
    });

    context('another nested scenario', function() {
      beforeEach( function() {
        fsTree = FSTree.fromPaths([
          'subdir1/',
          'subdir1/subsubdir1/',
          'subdir1/subsubdir1/foo.png',
          'subdir2/',
          'subdir2/bar.css'
        ]);
      });

      context('to an empty tree', function() {
        it('returns one unlink operation', function() {
          expect(fsTree.calculatePatch(FSTree.fromPaths([
            'subdir1/',
            'subdir1/subsubdir1/',
            'subdir1/subsubdir1/foo.png'
          ]))).to.deep.equal([
            ['unlink', 'subdir2/bar.css', file('subdir2/bar.css')],
            ['rmdir',  'subdir2',         directory('subdir2/')]
          ]);
        });
      });
    });

    context('folder => file', function() {
      beforeEach( function() {
        fsTree = FSTree.fromPaths([
          'subdir1/',
          'subdir1/foo'
        ]);
      });

      it('it unlinks the file, and rmdir the folder and then creates the file', function() {
        expect(fsTree.calculatePatch(FSTree.fromPaths([
          'subdir1'
        ]))).to.deep.equal([
          ['unlink', 'subdir1/foo', file('subdir1/foo')],
          ['rmdir',  'subdir1',     directory('subdir1')],
          ['create', 'subdir1',     file('subdir1')],
        ]);
      });
    });

    context('file => folder', function() {
      beforeEach( function() {
        fsTree = FSTree.fromPaths([
          'subdir1'
        ]);
      });

      it('it unlinks the file, and makes the folder and then creates the file', function() {
        expect(fsTree.calculatePatch(FSTree.fromPaths([
          'subdir1/',
          'subdir1/foo'
        ]))).to.deep.equal([
          ['unlink', 'subdir1',     file('subdir1')],
          ['mkdir',  'subdir1',     directory('subdir1')],
          ['create', 'subdir1/foo', file('subdir1/foo')]
        ]);
      });
    });

    context('folders', function() {
      beforeEach( function() {
        fsTree = FSTree.fromPaths([
          'dir/',
          'dir2/',
          'dir2/subdir1/',
          'dir3/',
          'dir3/subdir1/'
        ]);
      });

      it('it unlinks the file, and makes the folder and then creates the file', function() {
        let result = fsTree.calculatePatch(FSTree.fromPaths([
          'dir2/',
          'dir2/subdir1/',
          'dir3/',
          'dir4/',
        ]));

        expect(result).to.deep.equal([
          ['rmdir', 'dir3/subdir1',   directory('dir3/subdir1')],
          ['rmdir', 'dir',            directory('dir')],
          // This no-op (rmdir dir3; mkdir dir3) is not fundamental: a future
          // iteration could reasonably optimize it away
          ['mkdir', 'dir4',           directory('dir4')],
        ]);
      });
    });

    context('walk-sync like tree', function () {
      beforeEach( function() {
        fsTree = new FSTree({
          entries: [
            entry(directory('parent/')),
            entry(directory('parent/subdir/')),
            entry(file('parent/subdir/a.js'))
          ]
        });
      });

      it('moving a file out of a directory does not edit directory structure', function () {
        let newTree = new FSTree({
          entries: [
            entry(directory('parent/')),
            entry(file('parent/a.js')),
            entry(directory('parent/subdir/')),
          ]
        });
        let result = fsTree.calculatePatch(newTree);

        expect(result).to.deep.equal([
          ['unlink', 'parent/subdir/a.js',  file('parent/subdir/a.js')],
          ['create', 'parent/a.js',         file('parent/a.js')],
        ]);
      });

      it('moving a file out of a subdir and removing the subdir does not recreate parent', function () {
        let newTree = new FSTree({
          entries: [
            entry(directory('parent/')),
            entry(file('parent/a.js'))
          ]
        });
        let result = fsTree.calculatePatch(newTree);

        expect(result).to.deep.equal([
          ['unlink', 'parent/subdir/a.js',  file('parent/subdir/a.js')],
          ['rmdir', 'parent/subdir',        directory('parent/subdir')],
          ['create', 'parent/a.js',         file('parent/a.js')],
        ]);
      });

      it('moving a file into nest subdir does not recreate subdir and parent', function () {
        let newTree = new FSTree({
          entries: [
            entry(directory('parent/')),
            entry(directory('parent/subdir/')),
            entry(directory('parent/subdir/subdir/')),
            entry(file('parent/subdir/subdir/a.js'))
          ]
        });
        let result = fsTree.calculatePatch(newTree);

        expect(result).to.deep.equal([
          ['unlink', 'parent/subdir/a.js',        file('parent/subdir/a.js')],
          ['mkdir', 'parent/subdir/subdir',       directory('parent/subdir/subdir')],
          ['create', 'parent/subdir/subdir/a.js', file('parent/subdir/subdir/a.js')],
        ]);
      });

      it('always remove files first if dir also needs to be removed', function() {
        let newTree = new FSTree({
          entries: [
            entry(directory('parent/'))
          ]
        });

        let result = fsTree.calculatePatch(newTree);

        expect(result).to.deep.equal([
          ['unlink', 'parent/subdir/a.js',  file('parent/subdir/a.js')],
          ['rmdir', 'parent/subdir',        directory('parent/subdir')]
        ]);
      });

      it('renaming a subdir does not recreate parent', function () {
        let newTree = new FSTree({
          entries: [
            entry(directory('parent/')),
            entry(directory('parent/subdir2/')),
            entry(file('parent/subdir2/a.js'))
          ]
        });

        let result = fsTree.calculatePatch(newTree);

        expect(result).to.deep.equal([
          ['unlink', 'parent/subdir/a.js',  file('parent/subdir/a.js')],
          ['rmdir', 'parent/subdir',        directory('parent/subdir')],
          ['mkdir', 'parent/subdir2',       directory('parent/subdir2')],
          ['create', 'parent/subdir2/a.js', file('parent/subdir2/a.js')],
        ]);
      });
    });
  });

  describe('.applyPatch', function() {
    let inputDir = 'tmp/fixture/input';
    let outputDir = 'tmp/fixture/output';

    beforeEach(function() {
      fs.mkdirpSync(inputDir);
      fs.mkdirpSync(outputDir);
    });

    afterEach(function() {
      fs.removeSync('tmp');
    });

    it('applies all types of operations', function() {
      let firstTree = FSTree.fromEntries(walkSync.entries(inputDir));

      let fooIndex = path.join(inputDir, 'foo/index.js');
      let barIndex = path.join(inputDir, 'bar/index.js');
      let barOutput = path.join(outputDir, 'bar/index.js')

      fs.outputFileSync(fooIndex, 'foo'); // mkdir + create
      fs.outputFileSync(barIndex, 'bar'); // mkdir + create

      let secondTree = FSTree.fromEntries(walkSync.entries(inputDir));
      let patch = firstTree.calculatePatch(secondTree);

      FSTree.applyPatch(inputDir, outputDir, patch);
      expect(walkSync(outputDir)).to.deep.equal([
        'bar/',
        'bar/index.js',
        'foo/',
        'foo/index.js'
      ]);
      expect(fs.readFileSync(barOutput, 'utf-8')).to.equal('bar');

      fs.removeSync(path.dirname(fooIndex)); // unlink + rmdir
      fs.outputFileSync(barIndex, 'boo'); // change

      let thirdTree = FSTree.fromEntries(walkSync.entries(inputDir));
      patch = secondTree.calculatePatch(thirdTree);

      FSTree.applyPatch(inputDir, outputDir, patch);
      expect(walkSync(outputDir)).to.deep.equal([
        'bar/',
        'bar/index.js'
      ]);
      expect(fs.readFileSync(barOutput, 'utf-8')).to.equal('boo');
    });

    it('supports custom delegate methods', function() {
      let inputDir = 'tmp/fixture/input';
      let outputDir = 'tmp/fixture/output';

      let stats = {
        unlink: 0,
        rmdir: 0,
        mkdir: 0,
        change: 0,
        create: 0
      };
      let delegate = {
        unlink: function() {
          stats.unlink++;
        },
        rmdir: function() {
          stats.rmdir++;
        },
        mkdir: function() {
          stats.mkdir++;
        },
        change: function() {
          stats.change++;
        },
        create: function() {
          stats.create++;
        }
      };

      let patch = [
        [ 'mkdir', 'bar/' ],
        [ 'create', 'bar/index.js' ],
        [ 'mkdir', 'foo/' ],
        [ 'create', 'foo/index.js' ],
        [ 'unlink', 'foo/index.js' ],
        [ 'rmdir', 'foo/' ],
        [ 'change', 'bar/index.js' ]
      ];

      FSTree.applyPatch(inputDir, outputDir, patch, delegate);

      expect(stats).to.deep.equal({
        unlink: 1,
        rmdir: 1,
        mkdir: 2,
        change: 1,
        create: 2
      });
    });

    it('throws an error when a patch has an unknown operation type', function() {
      let patch = [ [ 'delete', '/foo.js' ] ];
      expect(function() {
        FSTree.applyPatch('/fixture/input', '/fixture/output', patch)
      }).to.throw('Unable to apply patch operation: delete. The value of delegate.delete is of type undefined, and not a function. Check the `delegate` argument to `FSTree.prototype.applyPatch`.');
    });
  });

  describe('.calculateAndApplyPatch', function() {
    let inputDir = 'tmp/fixture/input';
    let outputDir = 'tmp/fixture/output';

    beforeEach(function() {
      fs.mkdirpSync(inputDir);
      fs.mkdirpSync(outputDir);
    });

    afterEach(function() {
      fs.removeSync('tmp');
    });

    it('calculates and applies a patch properly', function() {
      let firstTree = FSTree.fromEntries(walkSync.entries(inputDir));

      let fooIndex = path.join(inputDir, 'foo/index.js');
      let barIndex = path.join(inputDir, 'bar/index.js');
      let barOutput = path.join(outputDir, 'bar/index.js')

      fs.outputFileSync(fooIndex, 'foo');
      fs.outputFileSync(barIndex, 'bar');

      let secondTree = FSTree.fromEntries(walkSync.entries(inputDir));
      firstTree.calculateAndApplyPatch(secondTree, inputDir, outputDir);

      expect(walkSync(outputDir)).to.deep.equal([
        'bar/',
        'bar/index.js',
        'foo/',
        'foo/index.js'
      ]);
    });

    it('calculates and applies a patch properly with custom delegates', function() {
      let stats = {
        mkdir: 0,
        create: 0
      };
      let delegate = {
        mkdir: function() {
          stats.mkdir++;
        },
        create: function() {
          stats.create++;
        }
      };

      let firstTree = FSTree.fromEntries(walkSync.entries(inputDir));

      let fooIndex = path.join(inputDir, 'foo/index.js');
      let barIndex = path.join(inputDir, 'bar/index.js');

      fs.outputFileSync(fooIndex, 'foo');
      fs.outputFileSync(barIndex, 'bar');

      let secondTree = FSTree.fromEntries(walkSync.entries(inputDir));
      firstTree.calculateAndApplyPatch(secondTree, inputDir, outputDir, delegate);

      expect(stats).to.deep.equal({
        mkdir: 2,
        create: 2
      });
    });
  });

  describe('fs', function() {
    let tree;

    beforeEach(function() {
      rimraf.sync(ROOT);
      fs.mkdirpSync(ROOT);

      fixturify.writeSync(ROOT, {
        'hello.txt': "Hello, World!\n",
        'my-directory': {},
      });

      tree = new FSTree({
        entries: walkSync.entries(ROOT),
        root: ROOT,
      });
    });

    afterEach(function() {
      fs.removeSync(ROOT);
    });

    describe('.findByRelativePath', function () {
      it('missing file', function () {
        expect(tree.findByRelativePath('missing/file')).to.eql({
          entry: null,
          index: -1
        });
      });

      it('file', function () {
        let result = tree.findByRelativePath('hello.txt');
        let entry = result.entry;
        let index = result.index;

        expect(index).to.gt(-1);
        expect(entry).to.have.property('relativePath', 'hello.txt');
        expect(entry).to.have.property('mode');
        expect(entry).to.have.property('size');
        expect(entry).to.have.property('mtime');
      });

      it('missing directory', function () {
        expect(tree.findByRelativePath('missing/directory')).to.eql({
          index: -1,
          entry: null
        });
      });

      it('directory with trailing slash', function () {
        let result = tree.findByRelativePath('my-directory/');
        let entry = result.entry;
        let index = result.index;

        expect(index).to.gt(-1);
        expect(entry).to.have.property('relativePath', 'my-directory/');
        expect(entry).to.have.property('mode');
        expect(entry).to.have.property('size');
        expect(entry).to.have.property('mtime');
      });

      it('directory without trailing slash', function () {
        let result = tree.findByRelativePath('my-directory');
        let entry = result.entry;
        let index = result.index;

        expect(index).to.gt(-1);
        // we can findByRelativePath without the trailing /, but we get back the
        // same entry we put in, from walk-sync this will have a trailing /
        expect(entry).to.have.property('relativePath', 'my-directory/');
        expect(entry).to.have.property('mode');
        expect(entry).to.have.property('size');
        expect(entry).to.have.property('mtime');
      });
    });

    it('ensures trailing slash for root', function() {
      expect(function() {
        new FSTree({ root: null })
      }).to.throw(`Root must be an absolute path, tree.root: 'null'`);

      expect(function() {
        new FSTree({ root: '' })
      }).to.throw(`Root must be an absolute path, tree.root: ''`);

      expect(function() {
        new FSTree({ root: 'foo' })
      }).to.throw(`Root must be an absolute path, tree.root: 'foo'`);

      expect(new FSTree({ root: '/foo' }).root).to.eql('/foo/');
      expect(new FSTree({ root: '/foo/' }).root).to.eql('/foo/');
      expect(new FSTree({ root: '/foo//' }).root).to.eql('/foo/');
    });

    /*
     * let a = new Plugin();
     *
     * a.in = parent; // frozen if not active
     * a.out = new FSTree();
     *
     * a.out.start();
     * a.build().finally(function() {
     *   a.out.stop();
     * });
     *
     * build() {
     *   let in = this.input; // frozen reference
     *   let out = this.output; // writable reference
     *
     *   in.changes().forEach(function(patch) {
     *     let relativePath = patch[0];
     *
     *     out.writeFileSync(relativePath, transform(in.readFileSync(relativePath));
     *   });
     * }
     */
    describe('.readFileSync', function() {
      describe('start/stop', function() {
        it('does not error when stopped', function() {
          tree.stop();
          expect(tree.readFileSync('hello.txt', 'UTF8')).to.eql('Hello, World!\n');
        });
      });

      it('reads existing file', function() {
        expect(tree.readFileSync('hello.txt', 'UTF8')).to.eql('Hello, World!\n');
      });

      it('throws for missing file', function() {
    // TODO: make sure as close as possible to real ENOENT error
        expect(function() {
          tree.readFileSync('missing.txt', 'UTF8');
        }, /ENOENT.*missing\.txt/);
      });
    });

    describe('.writeFileSync', function() {
      describe('start/stop', function() {
        afterEach(function() {
          tree.start();
        });

        it('does error when stopped', function() {
          tree.stop();
          expect(function() {
            tree.writeFileSync('hello.txt', 'OMG');
            expect(fs.readFileSync(tree.root + 'hello.txt', 'UTF8')).to.eql('Hello, World!\n');
    // did not write to file
          }).to.throw(/NOPE/);
        });
      });

      it('adds new file', function() {
        expect(tree.changes()).to.eql([]);

        expect(tree.writeFileSync('new-file.txt', 'new file'));

        let changes = tree.changes();

        expect(changes).to.have.deep.property('0.0', 'create');
        expect(changes).to.have.deep.property('0.1', 'new-file.txt');
        expect(changes).to.have.deep.property('0.2.relativePath', 'new-file.txt');
        expect(changes).to.have.deep.property('0.2.checksum', md5hex('new file'));
        expect(changes).to.have.deep.property('0.2.mode', 0);
        expect(changes).to.have.deep.property('0.2.mtime');
        expect(changes).to.have.property('length', 1);

        expect(tree.readFileSync('new-file.txt', 'UTF8')).to.eql('new file');

        expect(tree.entries.map(e => e.relativePath)).to.eql([
          'hello.txt',
          'my-directory/',
          'new-file.txt',
        ]);
      });

      describe('idempotent', function() {
        it('is idempotent files added this session', function() {
          let old = fs.statSync(tree.root + 'hello.txt');
          let oldContent = fs.readFileSync(tree.root + 'hello.txt');

          tree.writeFileSync('hello.txt', oldContent);

          let current = fs.statSync(tree.root + 'hello.txt');

          expect(old.mtime.getTime()).to.eql(current.mtime.getTime());
          expect(old).to.have.property('mode', current.mode);
          expect(old).to.have.property('size', current.size);
          expect(tree.changes()).to.eql([]);

          expect(tree.entries.map(e => e.relativePath)).to.eql([
            'hello.txt',
            'my-directory/',
          ]);
        });

        it('is idempotent across session', function() {
          tree.writeFileSync('new-file.txt', 'new file');
          let changes = tree.changes();

          expect(changes).to.have.deep.property('0.0', 'create');
          expect(changes).to.have.deep.property('0.1', 'new-file.txt');
          expect(changes).to.have.deep.property('0.2.relativePath', 'new-file.txt');
          expect(changes).to.have.deep.property('0.2.checksum', md5hex('new file'));
          expect(changes).to.have.deep.property('0.2.mode', 0);
          expect(changes).to.have.deep.property('0.2.mtime');


          expect(tree.entries.map(e => e.relativePath)).to.eql([
            'hello.txt',
            'my-directory/',
            'new-file.txt',
          ]);

          let oldmtime = changes[0][2].mtime;
          expect(changes).to.have.property('length', 1);

          let old = fs.statSync(tree.root + 'new-file.txt');

          tree.writeFileSync('new-file.txt', 'new file');

          let current = fs.statSync(tree.root + 'new-file.txt');

          expect(old.mtime.getTime()).to.eql(current.mtime.getTime());
          expect(old).to.have.property('mode', current.mode);
          expect(old).to.have.property('size', current.size);

          changes = tree.changes();
          expect(changes).to.have.deep.property('0.0', 'create');
          expect(changes).to.have.deep.property('0.1', 'new-file.txt');
          expect(changes).to.have.deep.property('0.2.relativePath', 'new-file.txt');
          expect(changes).to.have.deep.property('0.2.checksum', md5hex('new file'));
          expect(changes).to.have.deep.property('0.2.mode', 0);
          expect(changes).to.have.deep.property('0.2.mtime', oldmtime);
          expect(changes).to.have.property('length', 1);

          expect(tree.entries.map(e => e.relativePath)).to.eql([
            'hello.txt',
            'my-directory/',
            'new-file.txt',
          ]);

          tree.stop();
          tree.start();
          expect(tree.changes()).to.eql([]);
        });
      });

      describe('update', function() {
        it('tracks and correctly updates a file -> file', function() {
          tree.writeFileSync('new-file.txt', 'new file');
          let old = fs.statSync(tree.root + 'new-file.txt');
          tree.writeFileSync('new-file.txt', 'new different content');

          let current = fs.statSync(tree.root + 'new-file.txt');

          expect(old).to.have.property('mtime');
          expect(old).to.have.property('mode', current.mode);
          expect(old).to.have.property('size', 8);

          let changes = tree.changes();

          expect(changes).to.have.deep.property('0.0', 'change');
          expect(changes).to.have.deep.property('0.1', 'new-file.txt');
          expect(changes).to.have.deep.property('0.2.relativePath', 'new-file.txt');
          expect(changes).to.have.deep.property('0.2.checksum', md5hex('new different content'));
          expect(changes).to.have.deep.property('0.2.mode', 0);
          expect(changes).to.have.deep.property('0.2.mtime');
          expect(changes).to.have.property('length', 1);

          expect(tree.entries.map(e => e.relativePath)).to.eql([
            'hello.txt',
            'my-directory/',
            'new-file.txt',
          ]);
        });
      });
    });

    describe('.symlinkSync', function() {
      it('symlinks files', function() {
        expect(tree.changes()).to.eql([]);

        expect(tree.symlinkSync(`${tree.root}hello.txt`, 'my-link'));

        let changes = tree.changes();

        expect(changes).to.have.deep.property('0.0', 'create');
        expect(changes).to.have.deep.property('0.1', 'my-link');
        expect(changes).to.have.deep.property('0.2.relativePath', 'my-link');
        expect(changes).to.have.deep.property('0.2.mode', 0);
        expect(changes).to.have.deep.property('0.2.mtime');
        expect(changes).to.have.property('length', 1);

        expect(tree.readFileSync('my-link', 'UTF8')).to.eql('Hello, World!\n');

        expect(tree.entries.map(e => e.relativePath)).to.eql([
          'hello.txt',
          'my-directory/',
          'my-link',
        ]);
      });

      describe('idempotent', function() {
        it('is idempotent files added this session', function() {
          fs.symlinkSync(`${tree.root}hello.txt`, `${tree.root}hi`);
          let stat = fs.statSync(`${tree.root}hi`);
          let entry = new Entry('hi', stat.size, stat.mtime, stat.mode, `${tree.root}hello.txt`);
          tree.addEntries([entry]);

          let old = fs.statSync(tree.root + 'hi');
          tree.symlinkSync(`${tree.root}hello.txt`, 'hi');

          let current = fs.statSync(tree.root + 'hi');

          expect(old.mtime.getTime()).to.eql(current.mtime.getTime());
          expect(old).to.have.property('mode', current.mode);
          expect(old).to.have.property('size', current.size);
          expect(tree.changes()).to.eql([]);

          expect(tree.entries.map(e => e.relativePath)).to.eql([
            'hello.txt',
            'hi',
            'my-directory/',
          ]);
        });

        it('is idempotent across session', function() {
          tree.symlinkSync(`${tree.root}hello.txt`, 'hejsan');
          let changes = tree.changes();

          expect(changes).to.have.deep.property('0.0', 'create');
          expect(changes).to.have.deep.property('0.1', 'hejsan');
          expect(changes).to.have.deep.property('0.2.relativePath', 'hejsan');
          expect(changes).to.have.deep.property('0.2.mode', 0);
          expect(changes).to.have.deep.property('0.2.mtime');

          expect(tree.entries.map(e => e.relativePath)).to.eql([
            'hejsan',
            'hello.txt',
            'my-directory/',
          ]);

          let oldmtime = changes[0][2].mtime;
          expect(changes).to.have.property('length', 1);

          let old = fs.statSync(tree.root + 'hejsan');

          tree.symlinkSync(`${tree.root}hello.txt`, 'hejsan');

          let current = fs.statSync(tree.root + 'hejsan');

          expect(old.mtime.getTime()).to.eql(current.mtime.getTime());
          expect(old).to.have.property('mode', current.mode);
          expect(old).to.have.property('size', current.size);

          changes = tree.changes();
          expect(changes).to.have.deep.property('0.0', 'create');
          expect(changes).to.have.deep.property('0.1', 'hejsan');
          expect(changes).to.have.deep.property('0.2.relativePath', 'hejsan');
          expect(changes).to.have.deep.property('0.2.mode', 0);
          expect(changes).to.have.deep.property('0.2.mtime', oldmtime);
          expect(changes).to.have.property('length', 1);

          expect(tree.entries.map(e => e.relativePath)).to.eql([
            'hejsan',
            'hello.txt',
            'my-directory/',
          ]);

          tree.stop();
          tree.start();
          expect(tree.changes()).to.eql([]);
        });
      });

      describe('update', function() {
        it('tracks and correctly updates a file -> file', function() {
          tree.symlinkSync(`${tree.root}hello.txt`, 'hi');
          let old = fs.statSync(`${tree.root}hi`);
          tree.writeFileSync('hi', 'new different content');

          let current = fs.statSync(`${tree.root}hi`);

          expect(old).to.have.property('mtime');
          expect(old).to.have.property('mode', current.mode);
          expect(old).to.have.property('size', 14);

          let changes = tree.changes();

          expect(changes).to.have.deep.property('0.0', 'change');
          expect(changes).to.have.deep.property('0.1', 'hi');
          expect(changes).to.have.deep.property('0.2.relativePath', 'hi');
          expect(changes).to.have.deep.property('0.2.mode', 0);
          expect(changes).to.have.deep.property('0.2.mtime');
          expect(changes).to.have.property('length', 1);

          expect(tree.entries.map(e => e.relativePath)).to.eql([
            'hello.txt',
            'hi',
            'my-directory/',
          ]);
        });
      })
    });

    describe.only('.unlinkSync', function() {
      it('removes files', function() {
        tree.unlinkSync('hello.txt');

        let changes = tree.changes();

        expect(changes).to.have.deep.property('0.0', 'unlink');
        expect(changes).to.have.deep.property('0.1', 'hello.txt');
        expect(changes).to.have.deep.property('0.2.relativePath', 'hello.txt');
        expect(changes).to.have.deep.property('0.2.mode');
        expect(changes).to.have.deep.property('0.2.mtime');
        expect(changes).to.have.property('length', 1);

        expect(tree.entries.map(e => e.relativePath)).to.eql([
          'my-directory/',
        ]);
      });

      it('removes symlinked directories', function() {
        tree.symlinkSync(`${tree.root}my-directory`, 'linked-dir');

        // this test is uninterested in the symlink changes
        tree.stop();
        tree.start();

        tree.unlinkSync('linked-dir');

        let changes = tree.changes();

        expect(changes).to.have.deep.property('0.0', 'unlink');
        expect(changes).to.have.deep.property('0.1', 'linked-dir');
        expect(changes).to.have.deep.property('0.2.relativePath', 'linked-dir');
        expect(changes).to.have.deep.property('0.2.mode');
        expect(changes).to.have.deep.property('0.2.mtime');
        expect(changes).to.have.property('length', 1);

        expect(tree.entries.map(e => e.relativePath)).to.eql([
          'hello.txt',
          'my-directory/',
        ]);
      });

      describe('start/stop', function() {
        it('does error when stopped', function() {
          tree.stop();
          expect(function() {
            tree.unlinkSync('hello.txt');
          }).to.throw(/NOPE/);
          expect(function() {
            tree.unlinkSync('hello.txt');
          }).to.throw(/unlink/);
        });
      });
    });

    describe('.rmdirSync', function() {
      it('removes directories', function() {
        tree.rmdirSync('my-directory');

        let changes = tree.changes();

        expect(changes).to.have.deep.property('0.0', 'rmdir');
        expect(changes).to.have.deep.property('0.1', 'my-directory');
        expect(changes).to.have.deep.property('0.2.relativePath', 'my-directory');
        expect(changes).to.have.deep.property('0.2.mode');
        expect(changes).to.have.deep.property('0.2.mtime');
        expect(changes).to.have.property('length', 1);

        expect(tree.entries.map(e => e.relativePath)).to.eql([
          'hello.txt',
        ]);
      });

      describe('start/stop', function() {
        it('does error when stopped', function() {
          tree.stop();
          expect(function() {
            tree.rmdirSync('hello.txt');
          }).to.throw(/NOPE/);
          expect(function() {
            tree.rmdirSync('hello.txt');
          }).to.throw(/rmdir/);
        });
      });
    });

    describe('.mkdirSync', function() {
      it('-> directory (create)', function() {
        expect(tree.changes()).to.eql([]);

        expect(tree.mkdirSync('new-directory')).to.eql(undefined);

        let changes = tree.changes();
        let operation = changes[0][0];
        let relativePath = changes[0][1];
        let entry = changes[0][2];

        expect(operation).to.eql('mkdir');
        expect(relativePath).to.eql('new-directory');
        expect(entry).to.have.property('relativePath', 'new-directory');
        expect(entry).to.have.property('checksum', null);
        expect(entry).to.have.property('mode');
        expect(isDirectory(entry)).to.eql(true);
        expect(entry).to.have.property('mtime');
        expect(tree.changes()).to.have.property('length', 1);

        expect(tree.statSync('new-directory/')).to.eql(entry);
        expect(tree.statSync('new-directory')).to.eql(entry);

        expect(tree.entries.map(e => e.relativePath)).to.deep.equal([
          'hello.txt',
          'my-directory/',
          'new-directory',
        ]);
      });

      it('directory/ -> directory/ (idempotence)', function testDir2Dir() {
        let old = fs.statSync(`${tree.root}/my-directory`);

        tree.mkdirSync('my-directory/');

        let current = fs.statSync(`${tree.root}/my-directory`);

        expect(old.mtime.getTime()).to.eql(current.mtime.getTime());
        expect(old).to.have.property('mode', current.mode);
        expect(old).to.have.property('size', current.size);
        expect(tree.changes()).to.eql([]);

        expect(tree.entries.map(e => e.relativePath)).to.deep.equal([
          'hello.txt',
          'my-directory/',
        ]);
      });

      it('directory/ -> directory (idempotence, path normalization)', function () {
        let old = fs.statSync(`${tree.root}/my-directory`);

        tree.mkdirSync('my-directory');

        let current = fs.statSync(`${tree.root}/my-directory`);

        expect(old.mtime.getTime()).to.eql(current.mtime.getTime());
        expect(old).to.have.property('mode', current.mode);
        expect(old).to.have.property('size', current.size);
        expect(tree.changes()).to.eql([]);

        expect(tree.entries.map(e => e.relativePath)).to.deep.equal([
          'hello.txt',
          'my-directory/',
        ]);
      });

      // describe('file -> directory (error)');

      describe('start/stop', function() {
        it('does error when stopped', function() {
          tree.stop();
          expect(function() {
            tree.mkdirSync('hello.txt');
          }).to.throw(/NOPE/);
          expect(function() {
            tree.mkdirSync('hello.txt');
          }).to.throw(/mkdir/);
        });
      });
    });
  });

  describe('changes', function() {
    let tree;

    beforeEach(function() {

      fixturify.writeSync(ROOT, {
        'hello.txt': "Hello, World!\n",
        'my-directory': {},
      });

      tree = new FSTree({
        entries: walkSync.entries(ROOT),
        root: ROOT
      });

      tree.writeFileSync('omg.js', 'hi');
    })

    afterEach(function() {
      tree.unlinkSync('omg.js');
    })

    it('hides no changes if all match', function() {
      let changes = tree.changes({ include: ['**/*.js']});

      expect(changes).to.have.property('length', 1);
      expect(changes).to.have.deep.property('0.length', 3);
      expect(changes).to.have.deep.property('0.0', 'create');
      expect(changes).to.have.deep.property('0.1', 'omg.js');
    });


    it('hides changes if none match', function() {
      expect(tree.changes({ include: ['NO-MATCH'] })).to.have.property('length', 0);
    });


    describe('order', function() {
      // test changes are ordered:
      // 1. addtions/updates lexicographicaly
      // 2. removals reverse lexicographicaly
    });
  });

  describe('match', function() {
    let tree;

    beforeEach(function() {
      tree = new FSTree.fromEntries([
        directory('a/'),
        directory('a/b/'),
        directory('a/b/c/'),
        directory('a/b/c/d/'),
        file('a/b/c/d/foo.js'),
        directory('a/b/q/'),
        directory('a/b/q/r/'),
        file('a/b/q/r/bar.js'),
      ]);
    })

    it('ignores nothing, if all match', function() {
      let matched = tree.match({ include: ['**/*.js'] });

      expect(matched).to.have.property('length', 8);
      expect(matched.map(function(entry) { return entry.relativePath; })).to.eql([
        'a',
        'a/b',
        'a/b/c',
        'a/b/c/d',
        'a/b/c/d/foo.js',
        'a/b/q',
        'a/b/q/r',
        'a/b/q/r/bar.js',
      ]);
    });

    it('ignores those that do not match, if all match', function() {
      let matched = tree.match({ include: ['a/b/c/**/*'] });

      expect(matched).to.have.property('length', 5);
      expect(matched.map((entry) => entry.relativePath)).to.eql([
        'a',
        'a/b',
        'a/b/c',
        'a/b/c/d',
        'a/b/c/d/foo.js',
      ]);
    })
  });
});
