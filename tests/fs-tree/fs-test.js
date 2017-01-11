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
        childTree = new FSTree({
          parent: tree
        });
      });

      it('shares entries', function() {
        expect(childTree.entries).to.equal(tree.entries);
      });

      it('shares changes', function() {
        expect(childTree._changes).to.equal(tree._changes);
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

        expect(result._parent).to.equal(tree);

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

        it('is respected by changes', function() {
          tree.mkdirSync('my-directory/subdir');

          let newTree = tree.chdir('my-directory/subdir');
          newTree.writeFileSync('ohai.txt', 'yes hello again');

          let treeChanges = tree.changes();
          let newTreeChanges = newTree.changes();

          expect(treeChanges).to.eql(newTreeChanges);

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
      it.skip('has tests', function() {
      });
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
