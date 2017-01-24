'use strict';

const fs = require('fs-extra');
const path = require('path');
const expect = require('chai').expect;
const walkSync = require('walk-sync');
const FSTree = require('../../lib/index');
const Entry = require('../../lib/entry');
const md5hex = require('md5hex');
const fixturify = require('fixturify');
const rimraf = require('rimraf');
const oneLine = require('common-tags').oneLine;

const util = require('./util');
const file = util.file;
const directory = util.directory;

const isDirectory = Entry.isDirectory;

require('chai').config.truncateThreshold = 0;

let fsTree;

describe('FSTree fs abstraction', function() {
  let ROOT = path.resolve('tmp/fs-test-root/');

  const originalNow = Date.now;

  beforeEach(function() {
    Date.now = (() => 0);
  });

  afterEach(function() {
    Date.now = originalNow;
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

    describe('with parents', function() {
      let childTree;

      beforeEach(function() {
        childTree = FSTree.fromParent(tree);
      });

      it('shares entries', function() {
        expect(childTree.entries).to.equal(tree.entries);
      });

      it('shares changes', function() {
        expect(childTree._changes).to.equal(tree._changes);
      });

      it('shares _state', function() {
        expect(tree._state).to.eql('started');
        expect(childTree._state).to.eql('started');

        tree.stop();

        expect(tree._state).to.eql('stopped');
        expect(childTree._state).to.eql('stopped');

        childTree.start();

        expect(tree._state).to.eql('started');
        expect(childTree._state).to.eql('started');
      });

      it('shares _hasEntries and can populate from parent', function() {
        let lazyTree = new FSTree({
          entries: null,
          root: ROOT,
        });
        let childTree = new FSTree({
          parent: lazyTree,
        });

        expect(lazyTree._hasEntries).to.eql(false);
        expect(childTree._hasEntries).to.eql(false);

        lazyTree._ensureEntriesPopulated();

        expect(lazyTree._hasEntries).to.eql(true);
        expect(childTree._hasEntries).to.eql(true);
        expect(childTree.entries).to.equal(lazyTree.entries);
      });

      it('shares _hasEntries and can populate from child', function() {
        let lazyTree = new FSTree({
          entries: null,
          root: ROOT,
        });
        let childTree = FSTree.fromParent(lazyTree);

        expect(lazyTree._hasEntries).to.eql(false);
        expect(childTree._hasEntries).to.eql(false);

        childTree._ensureEntriesPopulated();

        expect(lazyTree._hasEntries).to.eql(true);
        expect(childTree._hasEntries).to.eql(true);
        expect(childTree.entries).to.equal(lazyTree.entries);
      });

      describe('with grandparents', function() {
        let grandchildTree;

        beforeEach(function() {
          grandchildTree = FSTree.fromParent(childTree);
        });

        it('shares cwd and can populate from grandparent', function() {
          let lazyTree = new FSTree({
            root: ROOT,
            cwd: '',
          });
          let childTree = new FSTree({
            parent: lazyTree,
          });
          let grandchildTree = new FSTree({
            parent: childTree,
          });

          expect(grandchildTree.cwd).to.eql(lazyTree.cwd);
          expect(childTree.cwd).to.eql(lazyTree.cwd);
        });

        it('shares files and can populate from grandparent', function() {
          let lazyTree = new FSTree({
            root: ROOT,
            files: ['hello.txt'],
          });
          let childTree = new FSTree({
            parent: lazyTree,
          });
          let grandchildTree = new FSTree({
            parent: childTree,
          });

          expect(grandchildTree.files).to.eql(lazyTree.files);
          expect(childTree.files).to.eql(lazyTree.files);
        });

        it('shares include and exclude and can populate from grandparent', function() {
          let lazyTree = new FSTree({
            root: ROOT,
            include: ['include.txt'],
            exclude: ['**.*.txt'],
          });
          let childTree = new FSTree({
            parent: lazyTree,
          });
          let grandchildTree = new FSTree({
            parent: childTree,
          });

          expect(grandchildTree.include).to.eql(lazyTree.include);
          expect(childTree.include).to.eql(lazyTree.include);
          expect(grandchildTree.exclude).to.eql(lazyTree.exclude);
          expect(childTree.exclude).to.eql(lazyTree.exclude);
        });
      });
    });

    describe('.srcTree', function() {
      it('defaults to false', function() {
        expect(new FSTree({
          root: ROOT
        })).to.have.property('srcTree', false);
      });

      it('can be specified as an option', function() {
        expect(new FSTree({
          srcTree: true,
          root: ROOT,
        })).to.have.property('srcTree', true);
      });

      it('is false for chdir projections', function() {
        let tree = new FSTree({
          root: ROOT,
          srcTree: true,
        });
        tree._ensureEntriesPopulated();
        expect(tree.srcTree).to.equal(true);
        expect(tree.chdir('my-directory').srcTree).to.equal(false);
        // projection does not affect parent
        expect(tree.srcTree).to.equal(true);
      });

      it('is false for filtered projections', function() {
        let tree = new FSTree({
          root: ROOT,
          srcTree: true,
        });
        expect(tree.srcTree).to.equal(true);
        expect(tree.filtered({ include: ['**/*'] }).srcTree).to.equal(false);
        // projection does not affect parent
        expect(tree.srcTree).to.equal(true);
      });
    });

    describe('.reread', function() {
      it('resets entries for source trees', function() {
        let tree = new FSTree({
          root: `${ROOT}/my-directory`,
          srcTree: true,
        });

        expect(tree.walkPaths()).to.eql([]);

        fixturify.writeSync(`${ROOT}/my-directory`, {
          a: {
            b: 'hello',
          },
          a2: 'guten tag'
        });

        tree.reread();

        expect(tree.walkPaths()).to.eql([
          'a/',
          'a/b',
          'a2'
        ]);
      });



      it('does not reset entries for non-source trees', function() {
        let tree = new FSTree({
          root: `${ROOT}/my-directory`,
          srcTree: false,
        });

        expect(tree.walkPaths()).to.eql([]);

        fixturify.writeSync(`${ROOT}/my-directory`, {
          a: {
            b: 'hello',
          },
          a2: 'guten tag'
        });

        tree.reread();

        expect(tree.walkPaths()).to.eql([]);
      });

      it('can change roots for source trees', function() {
        fixturify.writeSync(`${ROOT}/my-directory`, {
          a: {
            b: 'hello',
          },
          a2: 'guten tag'
        });

        let tree = new FSTree({
          root: `${ROOT}/my-directory`,
          srcTree: true,
        });

        expect(tree.walkPaths()).to.eql([
          'a/',
          'a/b',
          'a2'
        ]);

        tree.reread(`${ROOT}/my-directory/a`);

        expect(tree.walkPaths()).to.eql([
          'b',
        ]);

        expect(tree.root).to.eql(`${ROOT}/my-directory/a/`);
      });


      it.only('can change roots for source trees without providing absolute path', function() {
        fixturify.writeSync(`${ROOT}/my-directory/`, {
          a: {
            b: 'hello',
          },
          a2: 'guten tag'
        });

        let tree = new FSTree({
          root: `${ROOT}`,
          srcTree: true,
        });

        expect(tree.walkPaths()).to.eql([
          'hello.txt',
          'my-directory/',
          'my-directory/a/',
          'my-directory/a/b',
          'my-directory/a2'
        ]);
        //when the absolute path is not passed to reread, it should convert the path to absolute path
        tree.reread(`tmp/fs-test-root/my-directory/a`);
        expect(tree.walkPaths()).to.eql([
          'b',
        ]);
      });



      it('throws if called with a new root for a non-source tree', function() {
        fixturify.writeSync(`${ROOT}/my-directory`, {
          a: {
            b: 'hello',
          },
          a2: 'guten tag'
        });

        let tree = new FSTree({
          root: `${ROOT}/my-directory`,
          srcTree: false,
        });

        expect(tree.walkPaths()).to.eql([
          'a/',
          'a/b',
          'a2'
        ]);

        expect(function() {
          tree.reread(`${ROOT}/my-directory/a`);
        }).to.throw(oneLine`
          Cannot change root from '${ROOT}/my-directory/' to
          '${ROOT}/my-directory/a' of a non-source tree.
        `);
      });

      it('throws if given a relative path for a root', function() {
        fixturify.writeSync(`${ROOT}/my-directory`, {
          a: {
            b: 'hello',
          },
          a2: 'guten tag'
        });

        let tree = new FSTree({
          root: `${ROOT}/my-directory`,
          srcTree: true,
        });

        expect(function() {
          tree.reread('my-directory');
        }).to.throw(`Root must be an absolute path, tree.root: 'my-directory'`);
      });
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

      it('normalizes paths', function() {
        expect(tree.findByRelativePath('my-directory/').index).to.be.gt(-1);
        expect(tree.findByRelativePath('my-directory/.').index).to.be.gt(-1);
        expect(tree.findByRelativePath('my-directory/foo/..').index).to.be.gt(-1);
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
          tree.stop();
          tree.start();

          tree.writeFileSync('new-file.txt', 'new different content');

          let current = fs.statSync(tree.root + 'new-file.txt');

          expect(old).to.have.property('mtime');
          expect(old).to.have.property('mode', current.mode);
          expect(old).to.have.property('size', 8);

          let changes = tree.changes();

          expect(changes).to.have.deep.property('1.0', 'change');
          expect(changes).to.have.deep.property('1.1', 'new-file.txt');
          expect(changes).to.have.deep.property('1.2.relativePath', 'new-file.txt');
          expect(changes).to.have.deep.property('1.2.checksum', md5hex('new different content'));
          expect(changes).to.have.deep.property('1.2.mode', 0);
          expect(changes).to.have.deep.property('1.2.mtime');
          expect(changes).to.have.property('length', 2);

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

          tree.stop();
          tree.start();

          tree.writeFileSync('hi', 'new different content');

          let current = fs.statSync(`${tree.root}hi`);

          expect(old).to.have.property('mtime');
          expect(old).to.have.property('mode', current.mode);
          expect(old).to.have.property('size', 14);

          let changes = tree.changes();

          expect(changes).to.have.deep.property('1.0', 'change');
          expect(changes).to.have.deep.property('1.1', 'hi');
          expect(changes).to.have.deep.property('1.2.relativePath', 'hi');
          expect(changes).to.have.deep.property('1.2.mode', 0);
          expect(changes).to.have.deep.property('1.2.mtime');
          expect(changes).to.have.property('length', 2);

          expect(tree.entries.map(e => e.relativePath)).to.eql([
            'hello.txt',
            'hi',
            'my-directory/',
          ]);
        });
      })
    });

    describe('.unlinkSync', function() {
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
        expect(changes).to.have.deep.property('0.2.relativePath', 'my-directory/');
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

        expect(tree.statSync('new-directory/').relativePath).to.eql('new-directory');
        expect(tree.statSync('new-directory').relativePath).to.eql('new-directory');

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


    describe('.mkdirpSync', function() {
      it('-> directory (create)', function() {
        expect(tree.changes()).to.eql([]);
        expect(tree.mkdirpSync('new-directory/a/b/c/')).to.eql(undefined);

        let changes = tree.changes();

        expect(changes.map(e => e[0])).to.deep.equal(['mkdir','mkdir','mkdir','mkdir' ]);
        expect(changes.map(e => e[1])).to.deep.equal(['new-directory','new-directory/a','new-directory/a/b','new-directory/a/b/c' ]);
        expect(changes.map(e => e[2].relativePath)).to.deep.equal(['new-directory','new-directory/a','new-directory/a/b','new-directory/a/b/c' ]);

        let operation = changes[3][0];
        let relativePath = changes[3][1];
        let entry = changes[3][2];

        expect(operation).to.eql('mkdir');
        expect(relativePath).to.eql('new-directory/a/b/c');
        expect(entry).to.have.property('relativePath', 'new-directory/a/b/c');
        expect(entry).to.have.property('mode');
        expect(isDirectory(entry)).to.eql(true);
        expect(entry).to.have.property('mtime');
        expect(tree.changes()).to.have.property('length', 4);
        expect(tree.statSync('new-directory').relativePath).to.eql('new-directory');
        expect(tree.entries.map(e => e.relativePath)).to.deep.equal([
          'hello.txt',
          'my-directory/',
          'new-directory',
          'new-directory/a',
          'new-directory/a/b',
          'new-directory/a/b/c'
         ]);
      });

      it('directory/ -> directory/ (idempotence)', function testDir2Dir() {
        let old = fs.statSync(`${tree.root}/my-directory`);
        tree.mkdirpSync('my-directory/');

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

        tree.mkdirpSync('my-directory');

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


      describe('start/stop', function() {
        it('does error when stopped', function() {
          tree.stop();
          expect(function() {
            tree.mkdirpSync('hello.txt');
          }).to.throw(/NOPE/);
          expect(function() {
            tree.mkdirpSync('hello.txt');
          }).to.throw(/mkdirp/);
        });
      });
    });

    describe('.resolvePath', function() {
      it('resolves the empty string', function() {
        expect(tree.resolvePath('')).to.eql(ROOT);
      });

      it('resolves .', function() {
        expect(tree.resolvePath('')).to.eql(ROOT);
      });

      it('resolves paths that exist', function() {
        expect(tree.resolvePath('my-directory')).to.eql(`${ROOT}/my-directory`);
      });

      it('resolves paths that do not exist', function() {
        expect(tree.resolvePath('narnia')).to.eql(`${ROOT}/narnia`);
      });

      it('resolves paths with ..', function() {
        expect(tree.resolvePath('my-directory/uwot/../..')).to.eql(ROOT);
      });

      it('throws for paths that escape root', function() {
        expect(function() {
          tree.resolvePath('..')
        }).to.throw(`Invalid path: '..' not within root '${ROOT}/'`);
      });

      it('throws for paths within a chdir that escape root', function() {
        let myDir = tree.chdir('my-directory');

        expect(myDir.resolvePath('..')).to.eql(ROOT);

        expect(function() {
          myDir.resolvePath('../../');
        }).to.throw(`Invalid path: '../../' not within dir 'my-directory/' of root '${ROOT}/'`);
      });
    });

    describe.skip('.statSync', function() {
      it('returns a stat object for normalized paths that exists', function() {
        expect('this thing is tested').to.equal(true);
      });

      it('throws for nonexistent paths', function() {
        expect('this thing is tested').to.equal(true);
      });
    });

    describe('.existsSync', function() {
      it('returns true for paths that resolve to the root dir', function() {
        expect(tree.existsSync('')).to.eql(true);
        expect(tree.existsSync('.')).to.eql(true);
        expect(tree.existsSync('my-directory/..')).to.eql(true);
      });

      it('returns true if the normalized path exists', function() {
        expect(tree.existsSync('hello.txt')).to.eql(true);
        expect(tree.existsSync('my-directory')).to.eql(true);
        expect(tree.existsSync('./my-directory/foo/..////')).to.eql(true);
      });

      it('returns false if the path does not exist', function() {
        expect(tree.existsSync('pretty-sure-this-isnt-real')).to.eql(false);
        expect(tree.existsSync('my-directory/still-not-real')).to.eql(false);
      });

      // We care about this for now while we're still writing symlinks.  When we
      // actually take advantage of our change tracking, we may not need this,
      // except possibly for the initial state (eg where app is a symlink or
      // perhaps more realistically something within node_modules)
      it('follows symlinks', function() {
        fs.symlinkSync(`${ROOT}/this-dir-isnt-real`, `${ROOT}/broken-symlink`);
        fs.symlinkSync(`${ROOT}/hello.txt`, `${ROOT}/pretty-legit-symlink`);

        let treeWithLinks = new FSTree({
          entries: walkSync.entries(ROOT),
          root: ROOT,
        });

        expect(treeWithLinks.existsSync('broken-symlink')).to.eql(false);
        expect(treeWithLinks.existsSync('pretty-legit-symlink')).to.eql(true);
      });
    });

    describe('readdirSync', function() {
      beforeEach(function() {
        tree.mkdirSync('my-directory/subdir');
        tree.writeFileSync('my-directory/ohai.txt', 'hi');
        tree.writeFileSync('my-directory/again.txt', 'hello');
        tree.writeFileSync('my-directory/subdir/sup.txt', 'guten tag');
        tree.writeFileSync('my-directory.annoying-file', 'better test this');

        tree.stop();
        tree.start();
      });

      it('throws if path is a file', function() {
        expect(function() {
          tree.readdirSync('hello.txt');
        }).to.throw('ENOTDIR: not a directory, hello.txt');
      });

      it('throws if path does not exist', function() {
        expect(function() {
          tree.readdirSync('not-a-real-path');
        }).to.throw('ENOENT: no such file or directory, not-a-real-path');
      });

      it('returns the contents of a dir', function() {
        expect(tree.readdirSync('my-directory')).to.eql([
          'again.txt',
          'ohai.txt',
          'subdir',
        ]);
      });

      it('returns the contents of root', function() {
        expect(tree.readdirSync('./')).to.eql([
          'hello.txt',
          'my-directory',
          'my-directory.annoying-file'
        ]);
      });

      it('chomps trailing / in returned dirs', function() {
        // reset entries via walksync so that subdir has a trailing slash
        let newTree = new FSTree({
          root: ROOT,
          entries: walkSync.entries(ROOT),
        });

        expect(newTree.readdirSync('my-directory')).to.eql([
          'again.txt',
          'ohai.txt',
          'subdir',
        ]);
      });
    });

    describe('.walkPaths', function() {
      it('returns the paths for all entries', function() {
        expect(tree.walkPaths()).to.eql([
          'hello.txt',
          'my-directory/',
        ]);
      });

      it('respects cwd', function() {
        expect(tree.chdir('my-directory').walkPaths()).to.eql([]);
      });

      it('respects filters', function() {
        expect(tree.filtered({
          include: ['*.txt']
        }).walkPaths()).to.eql([
          'hello.txt',
        ]);
      });
    });

    describe('.walkEntries', function() {
      it('returns all entries', function() {
        expect(tree.walkEntries().map(e => e.relativePath)).to.eql([
          'hello.txt',
          'my-directory/',
        ]);
      });

      it('respects cwd', function() {
        expect(tree.chdir('my-directory').walkEntries()).to.eql([]);
      });

      it('respects filters', function() {
        expect(tree.filtered({
          include: ['*.txt']
        }).walkEntries().map(e => e.relativePath)).to.eql([
          'hello.txt',
        ]);
      });
    });

    describe('chdir', function() {
      it('throws if the path is to a file', function() {
        expect(function() {
          tree.chdir('hello.txt');
        }).to.throw('ENOTDIR: not a directory, hello.txt');

        tree.chdir('my-directory');
      });

      it('returns a new tree', function() {
        let result = tree.chdir('my-directory');
        expect(result).to.not.equal(tree);

        expect(result.parent).to.equal(tree);

        expect(result.root).to.equal(tree.root);
        expect(result.cwd).to.equal('my-directory/');
      });

      describe('when path does not exist', function() {
        it('throws without allowEmpty: true', function() {
          expect(function() {
            tree.chdir('pretty-sure-this-dir-doesnt-exist');
          }).to.throw('ENOENT: no such file or directory, pretty-sure-this-dir-doesnt-exist');

          tree.chdir('my-directory');
        });

        it('does not throw with allowEmpty true', function() {
          expect(function() {
            tree.chdir('pretty-sure-this-dir-doesnt-exist', { allowEmpty: true });
          }).to.not.throw();
        });
      });

      describe('other operations', function() {
        beforeEach(function() {
          tree.writeFileSync('my-directory/ohai.txt', 'yes hello');
          tree.stop();
          tree.start();
        });

        it('is respected by statSync', function() {
          expect(tree.statSync('ohai.txt')).to.equal(null);

          let newTree = tree.chdir('my-directory');

          let stat = newTree.statSync('ohai.txt');
          expect(stat).to.have.property('relativePath', 'my-directory/ohai.txt');
        });

        it('is respected by existsSync', function() {
          expect(tree.existsSync('ohai.txt')).to.equal(false);

          let newTree = tree.chdir('my-directory');

          expect(newTree.existsSync('ohai.txt')).to.equal(true);
        });

        it('is respected by readFileSync', function() {
          let newTree = tree.chdir('my-directory');
          expect(newTree.readFileSync('ohai.txt', 'UTF8')).to.eql('yes hello');
        });

        it('is respected by unlinkSync', function() {
          expect(
            tree.statSync('my-directory/ohai.txt')
          ).to.have.property('relativePath', 'my-directory/ohai.txt')

          let newTree = tree.chdir('my-directory');
          newTree.unlinkSync('ohai.txt');

          expect(tree.statSync('my-directory/ohai.txt')).to.equal(null);
          expect(newTree.statSync('ohai.txt')).to.equal(null);
        });

        it('is respected by rmdirSync', function() {
          tree.mkdirSync('my-directory/subdir');

          expect(
            tree.statSync('my-directory/subdir')
          ).to.have.property('relativePath', 'my-directory/subdir')

          tree.stop();
          tree.start();

          let newTree = tree.chdir('my-directory');
          newTree.rmdirSync('subdir');

          expect(tree.statSync('my-directory/subdir')).to.equal(null);
          expect(newTree.statSync('subdir')).to.equal(null);
        });

        it('is respected by mkdirSync', function() {
          expect(tree.statSync('my-directory/subdir')).to.equal(null);

          let newTree = tree.chdir('my-directory');
          newTree.mkdirSync('subdir');

          expect(
            tree.statSync('my-directory/subdir')
          ).to.have.property('relativePath', 'my-directory/subdir');
          expect(
            newTree.statSync('subdir')
          ).to.have.property('relativePath', 'my-directory/subdir');
        });

        it('is respected by mkdirpSync', function() {
          expect(tree.statSync('my-directory/subdir/a/b/c')).to.equal(null);
          let newTree = tree.chdir('my-directory');
          newTree.mkdirpSync('subdir/a/b/c');

          expect(
              tree.statSync('my-directory/subdir')
          ).to.have.property('relativePath', 'my-directory/subdir');
          expect(
              newTree.statSync('subdir')
          ).to.have.property('relativePath', 'my-directory/subdir');
          expect(
              tree.statSync('my-directory/subdir/a')
          ).to.have.property('relativePath', 'my-directory/subdir/a');

          expect(
              tree.statSync('my-directory/subdir/a/b')
          ).to.have.property('relativePath', 'my-directory/subdir/a/b');

        });


        it('is respected by writeFileSync', function() {
          expect(fs.existsSync(`${ROOT}/my-directory/hello-again.txt`)).to.equal(false);

          let newTree = tree.chdir('my-directory');
          newTree.writeFileSync('hello-again.txt', 'hello again');

          expect(fs.existsSync(`${ROOT}/my-directory/hello-again.txt`)).to.equal(true);
          expect(fs.readFileSync(`${ROOT}/my-directory/hello-again.txt`, 'UTF8')).to.eql('hello again');
        });

        it('is respected by symlinkSync', function() {
          expect(tree.statSync('my-directory/hello-again.txt')).to.equal(null);

          let newTree = tree.chdir('my-directory');
          newTree.symlinkSync(`${tree.root}/hello.txt`, 'hello-again.txt');

          expect(
            fs.readFileSync(`${tree.root}my-directory/hello-again.txt`, 'UTF8')
          ).to.equal('Hello, World!\n');
        });

        it('is respected by readdirSync', function() {
          tree.mkdirSync('my-directory/subdir');
          tree.writeFileSync('my-directory/ohai.txt', 'hi');
          tree.writeFileSync('my-directory/again.txt', 'hello');
          tree.writeFileSync('my-directory/subdir/sup.txt', 'guten tag');

          tree.stop();
          tree.start();

          expect(function() {
            tree.readdirSync('subdir');
          }).to.throw();

          let newTree = tree.chdir('my-directory');

          expect(newTree.readdirSync('subdir')).to.eql([
            'sup.txt',
          ]);
        });

        it('is respected by changes', function() {
          tree.mkdirSync('my-directory/subdir');

          let newTree = tree.chdir('my-directory/subdir');
          newTree.writeFileSync('ohai.txt', 'yes hello again');

          let treeChanges = tree.changes();
          let newTreeChanges = newTree.changes();
          expect(treeChanges).to.not.eql(newTreeChanges);

          expect(newTreeChanges).to.have.deep.property('0.0', 'create');
          expect(newTreeChanges).to.have.deep.property('0.1', 'ohai.txt');
          expect(newTreeChanges).to.have.deep.property('0.2.relativePath', 'my-directory/subdir/ohai.txt');
          expect(newTreeChanges).to.have.deep.property('0.2.mode');
          expect(newTreeChanges).to.have.deep.property('0.2.mtime');
          expect(newTreeChanges.length).to.eql(1);

          expect(treeChanges).to.have.deep.property('0.0', 'mkdir');
          expect(treeChanges).to.have.deep.property('0.1', 'my-directory/subdir');
          expect(treeChanges).to.have.deep.property('0.2.relativePath', 'my-directory/subdir');
          expect(treeChanges).to.have.deep.property('0.2.mode');
          expect(treeChanges).to.have.deep.property('0.2.mtime');
          expect(treeChanges).to.have.deep.property('1.0', 'create');
          expect(treeChanges).to.have.deep.property('1.1', 'my-directory/subdir/ohai.txt');
          expect(treeChanges).to.have.deep.property('1.2.relativePath', 'my-directory/subdir/ohai.txt');
          expect(treeChanges).to.have.deep.property('1.2.mode');
          expect(treeChanges).to.have.deep.property('1.2.mtime');
          expect(treeChanges.length).to.eql(2);
        });

        // TODO: remove this when match is removed.
        it('is respected by match', function() {
          expect(tree.match({ include: ['*'] }).map(e => e.relativePath)).to.eql([
            'hello.txt',
            'my-directory/'
          ]);

          let newTree = tree.chdir('my-directory');

          expect(newTree.match({ include: ['*'] }).map(e => e.relativePath)).to.eql([
          ]);
        });
      });
    });

    describe('.filtered', function() {
      it('returns a new tree with filters set', function() {
        expect(tree.include).to.eql([]);
        expect(tree.exclude).to.eql([]);
        expect(tree.files).to.eql([]);
        expect(tree.cwd).to.eql('');

        expect(tree.filtered({ include: ['*.js'] }).include).to.eql(['*.js']);
        expect(tree.filtered({ exclude: ['*.js'] }).exclude).to.eql(['*.js']);
        expect(tree.filtered({ files: ['foo.js'] }).files).to.eql(['foo.js']);
        expect(tree.filtered({ cwd: 'my-directory' }).cwd).to.eql('my-directory');

        let projection = tree.filtered({
          include: ['*.js'],
          exclude: ['*.css'],
          cwd: 'my-directory',
        });

        expect(projection.parent).to.equal(tree);

        expect(projection.include).to.eql(['*.js']);
        expect(projection.exclude).to.eql(['*.css']);
        expect(projection.cwd).to.eql('my-directory');
      });
    });

    describe('._hasEntries', function() {
      it('sets _hasEntries to true if entries are specified', function() {
        expect(new FSTree({
          entries: [],
          root: ROOT,
        })._hasEntries).to.eql(true);
      });

      it('sets _hasEntries to false if no entries are specified', function() {
        expect(new FSTree({
          entries: null,
          root: ROOT,
        })._hasEntries).to.eql(false);
      });

      describe('when entries are not initially read', function() {
        let lazyTree;

        beforeEach(function() {
          lazyTree = new FSTree({
            entries: null,
            root: ROOT,
          })
        });

        it('lazily populates entries for statSync', function() {
          expect(lazyTree.statSync('hello.txt').relativePath).to.eql('hello.txt');
          expect(lazyTree._hasEntries).to.eql(true);
        });

        it('does not lazily populate entries for existsSync', function() {
          expect(lazyTree.existsSync('genuinely-doesnt-exist')).to.eql(false);
          expect(lazyTree.existsSync('hello.txt')).to.eql(true);
          expect(lazyTree._hasEntries).to.eql(false);
        });

        it('lazily populates entries for readdirSync', function() {
          expect(lazyTree.readdirSync('.')).to.eql(['hello.txt', 'my-directory']);
          expect(lazyTree.readdirSync('my-directory')).to.eql([]);
          expect(lazyTree._hasEntries).to.eql(true);
        });

        // less sure about these ones

        it('lazily populates entries for readFileSync', function() {
          expect(lazyTree.readFileSync('hello.txt', 'UTF8')).to.eql('Hello, World!\n');
          expect(lazyTree._hasEntries).to.eql(true);
        });

        it('lazily populates entries for unlinkSync', function() {
          lazyTree.unlinkSync('hello.txt');
          expect(lazyTree.entries.map(e => e.relativePath)).to.eql(['my-directory/']);
          expect(lazyTree._hasEntries).to.eql(true);
        });

        it('lazily populates entries for rmdirSync', function() {
          lazyTree.rmdirSync('my-directory');
          expect(lazyTree.entries.map(e => e.relativePath)).to.eql(['hello.txt']);
          expect(lazyTree._hasEntries).to.eql(true);
        });

        it('lazily populates entries for mkdirSync', function() {
          lazyTree.mkdirSync('new-dir');
          expect(lazyTree.entries.map(e => e.relativePath)).to.eql([
            'hello.txt',
            'my-directory/',
            'new-dir',
          ]);
          expect(lazyTree._hasEntries).to.eql(true);
        });

        it('lazily populates entries for writeFileSync', function() {
          lazyTree.writeFileSync('new-file.txt', 'hai again');
          expect(lazyTree.entries.map(e => e.relativePath)).to.eql([
            'hello.txt',
            'my-directory/',
            'new-file.txt',
          ]);
          expect(lazyTree._hasEntries).to.eql(true);
        });

        it('lazily populates entries for symlinkSync', function() {
          lazyTree.symlinkSync(`${ROOT}/hello.txt`, 'hi.txt');
          expect(lazyTree.entries.map(e => e.relativePath)).to.eql([
            'hello.txt',
            'hi.txt',
            'my-directory/',
          ]);
          expect(lazyTree._hasEntries).to.eql(true);
        });

        it('is idempotent (does not populate entries twice)', function() {
          expect(lazyTree._hasEntries).to.eql(false);
          expect(lazyTree.entries.map(e => e.relativePath)).to.eql([]);

          lazyTree._ensureEntriesPopulated();

          expect(lazyTree._hasEntries).to.eql(true);
          expect(lazyTree.entries.map(e => e.relativePath)).to.eql(['hello.txt', 'my-directory/']);

          rimraf.sync(ROOT);

          lazyTree._ensureEntriesPopulated();

          expect(lazyTree._hasEntries).to.eql(true);
          expect(lazyTree.entries.map(e => e.relativePath)).to.eql(['hello.txt', 'my-directory/']);
        });
      });
    });
  });

  describe('projection', function() {
    let tree;

    beforeEach(function() {
      rimraf.sync(ROOT);
      fs.mkdirpSync(ROOT);

      fixturify.writeSync(ROOT, {
        'hello.txt': "Hello, World!\n",
        'goodbye.txt': 'Goodbye, World\n',
        'a': {
          'foo': {
            'one.js': '',
            'one.css': '',
            'two.js': '',
            'two.css': '',
          },
          'bar': {
            'two.js': '',
            'two.css': '',
            'three.js': '',
            'three.css': '',
          }
        },
        'b': {},
      });

      tree = new FSTree({
        entries: walkSync.entries(ROOT),
        root: ROOT,
      });
    });

    afterEach(function() {
      fs.removeSync(ROOT);
    });

    describe('files', function() {
      it('returns only matching files', function() {
        let filter = { files: ['hello.txt', 'a/foo/two.js', 'a/bar'] };

        // funnel will cp -r if files:[ 'path/to/dir/' ]
        // so this is semantically different, but i don't think it's actually
        // public API for files to contain a path to a dir
        expect(tree.filtered(filter).walkPaths()).to.eql([
          'a/bar/',
          'a/foo/two.js',
          'hello.txt',
        ]);
      });

      it('respects cwd', function() {
        let filter = { cwd: 'a/foo', files: ['one.js', 'two.css'] };

        expect(tree.filtered(filter).walkPaths()).to.eql([
          'one.js',
          'two.css',
        ]);
      });

      it('is incompatible with include', function() {
        let filter = { files: ['a/foo/one.js'], include: ['a/foo/one.css'] };

        expect(function(){
          tree.filtered(filter).walkPaths()
        }).to.throw('Cannot pass files option (array or function) and a include/exlude filter. You can only have one or the other');
      });

      it('is incompatible with exclude', function() {
        let filter = { files: ['a/foo/one.js'], exclude: ['a/foo/one.css'] };

        expect(function(){
          tree.filtered(filter).walkPaths()
        }).to.throw('Cannot pass files option (array or function) and a include/exlude filter. You can only have one or the other');
      });
    });

    describe('include', function() {
      it('matches by regexp', function() {
        let filter = { include: [new RegExp(/(hello|one)\.(txt|js)/)] };

        expect(tree.filtered(filter).walkPaths()).to.eql([
          'a/foo/one.js',
          'hello.txt',
        ]);
      });

      it('matches by function', function() {
        let filter = { include: [p => p === 'a/bar/three.css'] };

        expect(tree.filtered(filter).walkPaths()).to.eql([
          'a/bar/three.css',
        ]);
      });

      it('matches by string globs', function() {
        let filter = { include: ['**/*.{txt,js}'] };

        expect(tree.filtered(filter).walkPaths()).to.eql([
          'a/bar/three.js',
          'a/bar/two.js',
          'a/foo/one.js',
          'a/foo/two.js',
          'goodbye.txt',
          'hello.txt',
        ]);
      });

      it('matches by a mix of matchers', function() {
        let filter = { include: ['**/*.txt', new RegExp(/(hello|one)\.(txt|js)/), p => p === 'a/bar/three.js'] };

        expect(tree.filtered(filter).walkPaths()).to.eql([
          'a/bar/three.js',
          'a/foo/one.js',
          'goodbye.txt',
          'hello.txt',
        ]);
      });


      it('respects cwd', function() {
        let filter = { cwd: 'a/foo', include: ['*.css'] };

        expect(tree.filtered(filter).walkPaths()).to.eql([
          'one.css',
          'two.css',
        ]);
      });
    });

    describe('exclude', function() {
      it('matches by regexp', function() {
        let filter = { exclude: [new RegExp(/(hello|one|two)\.(txt|js)/)] };

        expect(tree.filtered(filter).walkPaths()).to.eql([
          'a/',
          'a/bar/',
          'a/bar/three.css',
          'a/bar/three.js',
          'a/bar/two.css',
          'a/foo/',
          'a/foo/one.css',
          'a/foo/two.css',
          'b/',
          'goodbye.txt',
        ]);
      });

      it('matches by function', function() {
        let filter = { cwd: 'a/bar', exclude: [p => p === 'three.css'] };

        expect(tree.filtered(filter).walkPaths()).to.eql([
          'three.js',
          'two.css',
          'two.js',
        ]);
      });

      it('matches by string globs', function() {
        let filter = { exclude: ['**/*.{txt,css}'] };

        expect(tree.filtered(filter).walkPaths()).to.eql([
          'a/',
          'a/bar/',
          'a/bar/three.js',
          'a/bar/two.js',
          'a/foo/',
          'a/foo/one.js',
          'a/foo/two.js',
          'b/',
        ]);
      });

      it('matches by a mix of matchers', function() {
        let filter = { exclude: ['**/*.css', new RegExp(/(hello|one)\.(txt|js)/), p => p === 'a/bar/three.js'] };

        expect(tree.filtered(filter).walkPaths()).to.eql([
          'a/',
          'a/bar/',
          'a/bar/two.js',
          'a/foo/',
          'a/foo/two.js',
          'b/',
          'goodbye.txt',
        ]);
      });

      it('respects cwd', function() {
        let filter = { cwd: 'a/foo', exclude: ['*.css'] };
        expect(tree.filtered(filter).walkPaths()).to.eql([
          'one.js',
          'two.js',
        ]);
      });

      it('takes precedence over include', function() {
        let filter = { cwd: 'a/foo', include: ['one.css', 'one.js'], exclude: ['*.css'] };

        expect(tree.filtered(filter).walkPaths()).to.eql([
          'one.js',
        ]);
      });
    });
  });



  describe('changes', function() {
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
        root: ROOT
      });

      tree.writeFileSync('omg.js', 'hi');
      tree.writeFileSync('hello.txt', "Hello Again, World!\n");
      tree.writeFileSync('my-directory/goodbye.txt', "Goodbye, World!\n");
    })

    afterEach(function() {
      fs.removeSync(ROOT);
    })

    it('hides no changes if all match', function() {
      let filter = { include: ['**/*'] };
      let changes = tree.filtered(filter).changes();

      expect(changes).to.have.property('length', 3);
      expect(changes).to.have.deep.property('0.length', 3);
      expect(changes).to.have.deep.property('0.0', 'create');
      expect(changes).to.have.deep.property('0.1', 'omg.js');
      expect(changes).to.have.deep.property('1.length', 3);
      expect(changes).to.have.deep.property('1.0', 'change');
      expect(changes).to.have.deep.property('1.1', 'hello.txt');
      expect(changes).to.have.deep.property('2.length', 3);
      expect(changes).to.have.deep.property('2.0', 'create');
      expect(changes).to.have.deep.property('2.1', 'my-directory/goodbye.txt');
    });

    it('hides changes if none match', function() {
      expect(tree.filtered({ include: ['NO_MATCH'] }).changes()).to.have.property('length', 0);
    });

    it('hides changes if they are outside of cwd', function() {
      let changes = tree.chdir('my-directory').changes();

      expect(changes).to.have.property('length', 1);
      expect(changes).to.have.deep.property('0.length', 3);
      expect(changes).to.have.deep.property('0.0', 'create');
      expect(changes).to.have.deep.property('0.1', 'goodbye.txt');
      expect(changes).to.have.deep.property('0.2.relativePath', 'my-directory/goodbye.txt');
      expect(changes).to.have.deep.property('0.2.mode', 0);
      expect(changes).to.have.deep.property('0.2.mtime');
    });

    it('hides changes if they do not match the file projection', function() {
      let filter = { files: ['file-not-here.txt'] };
      let changes = tree.filtered(filter).changes();

      expect(changes).to.have.property('length', 0);
    });

    it('hides changes if they do not match the include and exclude projection', function() {
      let filter = { include: ['**/include.css'], exclude: [e => e === 'excluded.js'] };
      let changes = tree.filtered(filter).changes();

      expect(changes).to.have.property('length', 0);
    });

    describe('order', function() {

      beforeEach(function() {
        rimraf.sync(ROOT);
        fs.mkdirpSync(ROOT);

        tree = new FSTree({
          entries: walkSync.entries(ROOT),
          root: ROOT,
        });

        tree.mkdirSync('a');
        tree.mkdirSync('a/b');
        tree.mkdirSync('a/b/c');
        tree.writeFileSync('a/b/c/d.txt', 'd is a great letter.');
      });

      afterEach(function() {
        fs.removeSync(ROOT);
      });

      it('additions/updates lexicographicaly', function() {
        let changes = tree.changes();

        expect(changes).to.have.property('length', 4);
        expect(changes).to.have.deep.property('0.length', 3);
        expect(changes).to.have.deep.property('0.0', 'mkdir');
        expect(changes).to.have.deep.property('0.1', 'a');
        expect(changes).to.have.deep.property('1.length', 3);
        expect(changes).to.have.deep.property('1.0', 'mkdir');
        expect(changes).to.have.deep.property('1.1', 'a/b');
        expect(changes).to.have.deep.property('2.length', 3);
        expect(changes).to.have.deep.property('2.0', 'mkdir');
        expect(changes).to.have.deep.property('2.1', 'a/b/c');
        expect(changes).to.have.deep.property('3.length', 3);
        expect(changes).to.have.deep.property('3.0', 'create');
        expect(changes).to.have.deep.property('3.1', 'a/b/c/d.txt');
      });

      it('removals reverse lexicographicaly', function() {
        tree.stop();
        tree.start();

        tree.unlinkSync('a/b/c/d.txt');
        tree.rmdirSync('a/b/c');
        tree.rmdirSync('a/b');
        tree.rmdirSync('a');

        let changes = tree.changes();

        expect(changes).to.have.property('length', 4);
        expect(changes).to.have.deep.property('0.length', 3);
        expect(changes).to.have.deep.property('0.0', 'unlink');
        expect(changes).to.have.deep.property('0.1', 'a/b/c/d.txt');
        expect(changes).to.have.deep.property('1.length', 3);
        expect(changes).to.have.deep.property('1.0', 'rmdir');
        expect(changes).to.have.deep.property('1.1', 'a/b/c');
        expect(changes).to.have.deep.property('2.length', 3);
        expect(changes).to.have.deep.property('2.0', 'rmdir');
        expect(changes).to.have.deep.property('2.1', 'a/b');
        expect(changes).to.have.deep.property('3.length', 3);
        expect(changes).to.have.deep.property('3.0', 'rmdir');
        expect(changes).to.have.deep.property('3.1', 'a');
      });
    });
  });

  describe('', function() {

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
      debugger;
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
