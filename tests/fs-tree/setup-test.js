'use strict';

const expect = require('chai').expect;
const FSTree = require('../../lib/index');
const context = describe;

const util = require('./util');
const file = util.file;
const directory = util.directory;

require('chai').config.truncateThreshold = 0;

let fsTree;

describe('FSTree setup', function() {
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

          expect(fsTree.entries.map(e => e.relativePath)).to.deep.equal([
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

        expect(fsTree.entries.map(e => e.relativePath)).to.deep.equal([
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

        expect(fsTree.entries.map(e => e.relativePath)).to.deep.equal([
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

        expect(fsTree.entries.map(e => e.relativePath)).to.deep.equal([
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

        expect(fsTree.entries.map(e => e.relativePath)).to.deep.equal([
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
});

