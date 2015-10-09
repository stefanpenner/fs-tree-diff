'use strict';

var expect = require('chai').expect;
var FSTree = require('../lib/index');
var context = describe;
var fsTree;

describe('FSTree', function() {

  function entry(options) {
    return {
      relativePath: options.relativePath,
      mode: options.mode,
      size: options.size,
      mtime: options.mtime,
      isDirectory: function() {
        return (this.mode & 61440) === 16384;
      }
    };
  };

  it('can be instantiated', function() {
    expect(new FSTree()).to.be.an.instanceOf(FSTree);
  });

  describe('.fromPaths', function() {
    it('creates empty trees', function() {
      fsTree = FSTree.fromPaths([ ]);
      expect(fsTree.size).to.eq(0);
    });

    it('creates trees from paths', function() {
      var result;

      fsTree = FSTree.fromPaths([
        'a.js',
        'foo/a.js',
      ]);

      result = fsTree.calculatePatch(
        FSTree.fromPaths([
          'a.js',
          'foo/b.js',
        ])
      );

      expect(result).to.deep.equal([
        ['unlink', 'foo/a.js'],
        // This no-op is not fundamental: a future iteration could reasonably
        // optimize it away
        ['rmdir', 'foo'],
        ['mkdir', 'foo'],
        ['create', 'foo/b.js'],
      ]);
    });
  });

  describe('.fromEntries', function() {
    it('creates empty trees', function() {
      fsTree = FSTree.fromEntries([ ]);
      expect(fsTree.size).to.eq(0);
    });

    it('creates tree from entries', function() {
      var fsTree = FSTree.fromEntries([
        entry({ relativePath: 'a/b.js', mode: '0o666', size: 1, mtime: 1 }),
        entry({ relativePath: 'c/d.js', mode: '0o666', size: 1, mtime: 1 }),
        entry({ relativePath: 'a/c.js', mode: '0o666', size: 1, mtime: 1 })
      ]);

      expect(fsTree.size).to.eq(3);

      var result = fsTree.calculatePatch(FSTree.fromEntries([
        entry({ relativePath: 'a/b.js', mode: '0o666', size: 1, mtime: 2 }),
        entry({ relativePath: 'c/d.js', mode: '0o666', size: 1, mtime: 1 }),
        entry({ relativePath: 'a/c.js', mode: '0o666', size: 1, mtime: 1 })
        ])
      );

      expect(result).to.deep.equal([
        ['change', 'a/b.js']
      ]);
    });
  });

  describe('#calculatePatch', function() {
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
            'bar/baz.js',
            'foo.js',
          ]))).to.deep.equal([
            ['mkdir', 'bar'],
            ['create', 'foo.js'],
            ['create', 'bar/baz.js'],
          ]);
        });
      });
    });

    context('from a simple non-empty tree', function() {
      beforeEach( function() {
        fsTree = FSTree.fromPaths([
          'bar/baz.js',
          'foo.js',
        ]);
      });

      context('to an empty tree', function() {
        it('returns n rm operations', function() {
          expect(fsTree.calculatePatch(FSTree.fromPaths([]))).to.deep.equal([
            ['unlink', 'bar/baz.js'],
            ['rmdir', 'bar'],
            ['unlink', 'foo.js'],
          ]);
        });
      });
    });

    context('FSTree with entries', function() {
      beforeEach(function() {
        fsTree = new FSTree({
          entries: [
            entry({ relativePath: 'a/b.js', mode: '0o666', size: 1, mtime: 1 }),
            entry({ relativePath: 'c/d.js', mode: '0o666', size: 1, mtime: 1 }),
            entry({ relativePath: 'a/c.js', mode: '0o666', size: 1, mtime: 1 })
          ]
        });
      });

      it('should detect additions', function() {
        var result = fsTree.calculatePatch(new FSTree({
          entries: [
            entry({ relativePath: 'a/b.js', mode: '0o666', size: 1, mtime: 1 }),
            entry({ relativePath: 'c/d.js', mode: '0o666', size: 1, mtime: 1 }),
            entry({ relativePath: 'a/c.js', mode: '0o666', size: 1, mtime: 1 }),
            entry({ relativePath: 'a/j.js', mode: '0o666', size: 1, mtime: 1 })
          ]
        }));

        expect(result).to.deep.equal([
          ['create', 'a/j.js']
        ]);
      });

      it('should detect removals', function() {
        var result = fsTree.calculatePatch(new FSTree({
          entries: [
            entry({ relativePath: 'a/b.js', mode: '0o666', size: 1, mtime: 1 })
          ]
        }));

        expect(result).to.deep.equal([
          ['unlink', 'a/c.js'],
          ['unlink', 'c/d.js'],
          ['rmdir', 'c']
        ]);
      });

      it('should detect updates', function() {
        var result = fsTree.calculatePatch(new FSTree({
          entries: [
            entry({ relativePath: 'a/b.js', mode: '0o666', size: 1, mtime: 1 }),
            entry({ relativePath: 'c/d.js', mode: '0o666', size: 1, mtime: 2 }),
            entry({ relativePath: 'a/c.js', mode: '0o666', size: 10, mtime: 1 })
          ]
        }));

        expect(result).to.deep.equal([
          ['change', 'c/d.js'],
          ['change', 'a/c.js'],
        ]);
      });
    });

    context('FSTree with updates at several different depths', function () {
      beforeEach( function() {
        fsTree = new FSTree({
          entries: [
            entry({ relativePath: 'a.js', mode: '0o666', size: 1, mtime: 1 }),
            entry({ relativePath: 'b.js', mode: '0o666', size: 1, mtime: 1 }),
            entry({ relativePath: 'one/a.js', mode: '0o666', size: 1, mtime: 1 }),
            entry({ relativePath: 'one/b.js', mode: '0o666', size: 1, mtime: 1 }),
            entry({ relativePath: 'one/two/a.js', mode: '0o666', size: 1, mtime: 1 }),
            entry({ relativePath: 'one/two/b.js', mode: '0o666', size: 1, mtime: 1 }),
          ]
        });
      });

      it('catches each update', function() {
        var result = fsTree.calculatePatch(new FSTree({
          entries: [
            entry({ relativePath: 'a.js', mode: '0o666', size: 1, mtime: 2 }),
            entry({ relativePath: 'b.js', mode: '0o666', size: 1, mtime: 1 }),
            entry({ relativePath: 'one/a.js', mode: '0o666', size: 10, mtime: 1 }),
            entry({ relativePath: 'one/b.js', mode: '0o666', size: 1, mtime: 1 }),
            entry({ relativePath: 'one/two/a.js', mode: '0o667', size: 1, mtime: 1 }),
            entry({ relativePath: 'one/two/b.js', mode: '0o666', size: 1, mtime: 1 }),
          ]
        }));

        expect(result).to.deep.equal([
          ['change', 'a.js'],
          ['change', 'one/a.js'],
          ['change', 'one/two/a.js'],
        ]);
      });
    });

    context('with only unchanged paths', function() {
      beforeEach( function() {
        fsTree = FSTree.fromPaths([
          'bar/baz.js',
          'foo.js',
        ]);
      });

      it('returns an empty changeset', function() {
        expect(fsTree.calculatePatch(FSTree.fromPaths([
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
          'foo/one.js',
          'foo/two.js',
          'bar/one.js',
          'bar/two.js',
        ]);
      });

      context('with removals', function() {
        it('reduces the rm operations', function() {
          expect(fsTree.calculatePatch(FSTree.fromPaths([
            'bar/two.js'
          ]))).to.deep.equal([
            ['unlink', 'foo/one.js'],
            ['unlink', 'foo/two.js'],
            ['unlink', 'bar/one.js'],
            ['rmdir',  'foo'],
          ]);
        });
      });

      context('with removals and additions', function() {
        it('reduces the rm operations', function() {
          expect(fsTree.calculatePatch(FSTree.fromPaths([
            'bar/three.js'
          ]))).to.deep.equal([
            ['unlink', 'foo/one.js'],
            ['unlink', 'foo/two.js'],
            ['unlink', 'bar/one.js'],
            ['unlink', 'bar/two.js'],
            ['rmdir', 'foo'],

            // TODO: we could detect this NOOP [[rmdir bar] => [mkdir bar]] , but leaving it made File ->
            // Folder & Folder -> File transitions easiest. Maybe some future
            // work can explore, but the overhead today appears to be
            // neglibable

            ['rmdir', 'bar'],
            ['mkdir', 'bar'],

            ['create', 'bar/three.js'],
          ]);
        });
      });
    });

    context('from a deep non-empty tree', function() {
      beforeEach( function() {
        fsTree = FSTree.fromPaths([
          'bar/quz/baz.js',
          'foo.js',
        ]);
      });

      context('to an empty tree', function() {
        it('returns n rm operations', function() {
          expect(fsTree.calculatePatch(FSTree.fromPaths([]))).to.deep.equal([
            ['unlink', 'bar/quz/baz.js'],
            ['rmdir', 'bar/quz'],
            ['rmdir', 'bar'],
            ['unlink', 'foo.js'],
          ]);
        });
      });
    });

    context('from a deep non-empty tree \w intermediate entry', function() {
      beforeEach( function() {
        fsTree = FSTree.fromPaths([
          'bar/quz/baz.js',
          'bar/foo.js',
        ]);
      });

      context('to an empty tree', function() {
        it('returns one unlink operation', function() {
          expect(fsTree.calculatePatch(FSTree.fromPaths([
            'bar/quz/baz.js'
          ]))).to.deep.equal([
            ['unlink', 'bar/foo.js']
          ]);
        });
      });
    });

    context('another nested scenario', function() {
      beforeEach( function() {
        fsTree = FSTree.fromPaths([
          'subdir1/subsubdir1/foo.png',
          'subdir2/bar.css'
        ]);
      });

      context('to an empty tree', function() {
        it('returns one unlink operation', function() {
          expect(fsTree.calculatePatch(FSTree.fromPaths([
            'subdir1/subsubdir1/foo.png'
          ]))).to.deep.equal([
            ['unlink', 'subdir2/bar.css'],
            ['rmdir',  'subdir2']
          ]);
        });
      });
    });

    context('folder => file', function() {
      beforeEach( function() {
        fsTree = FSTree.fromPaths([
          'subdir1/foo'
        ]);
      });

      it('it unlinks the file, and rmdir the folder and then creates the file', function() {
        expect(fsTree.calculatePatch(FSTree.fromPaths([
          'subdir1'
        ]))).to.deep.equal([
          ['unlink', 'subdir1/foo'],
          ['rmdir', 'subdir1'],
          ['create', 'subdir1']
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
          'subdir1/foo'
        ]))).to.deep.equal([
          ['unlink', 'subdir1'],
          ['mkdir', 'subdir1'],
          ['create', 'subdir1/foo']
        ]);
      });
    });

    context('only folders', function() {
      beforeEach( function() {
        fsTree = FSTree.fromPaths([
          'dir/',
          'dir2/subdir1/',
          'dir3/subdir1/'
        ]);
      });

      it('it unlinks the file, and makes the folder and then creates the file', function() {
        var result = fsTree.calculatePatch(FSTree.fromPaths([
          'dir2/subdir1/',
          'dir3/',
          'dir4/',
        ]));

        expect(result).to.deep.equal([
          ['rmdir', 'dir3/subdir1'],
          ['rmdir', 'dir'],
          // This no-op (rmdir dir3; mkdir dir3) is not fundamental: a future
          // iteration could reasonably optimize it away
          ['rmdir', 'dir3'],
          ['mkdir', 'dir3'],
          ['mkdir', 'dir4']
        ]);
      });
    });
  });
});
