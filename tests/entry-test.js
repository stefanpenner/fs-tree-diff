'use strict';

const fs = require('fs-extra');
const expect = require('chai').expect;
const Entry = require('../lib/entry');

const isDirectory = Entry.isDirectory;

const FIXTURE_DIR = 'fixture';

require('chai').config.truncateThreshold = 0;

describe('Entry', function() {
  describe('constructor', function() {
    var size = 1337;
    var mtime = Date.now();

    it('supports including manually defined mode', function() {
      var entry = new Entry('/foo.js', size, mtime, 1);
      expect(entry.relativePath).to.equal('/foo.js');
      expect(entry.size).to.equal(size);
      expect(entry.mtime).to.equal(mtime);
      expect(entry.mode).to.equal(1);
      expect(isDirectory(entry)).to.not.be.ok;
    });

    it('errors on a non-number mode', function() {
      expect(function() {
        return new Entry('/foo.js', size, mtime, '1');
      }).to.throw('Expected `mode` to be of type `number` but was of type `string` instead.')
    });

    it('strips trailing /', function() {
      expect(new Entry('/foo/', 0, 0, Entry.DIRECTORY_MODE).relativePath).to.eql('foo');
    });
  });

  describe('.fromPath', function () {
    it('infers directories from trailing /', function() {
      let entry = Entry.fromPath('/foo/');
      expect(entry.relativePath).to.equal('foo');
      expect(entry.size).to.equal(0);
      expect(entry.mtime).to.be.gt(0);
      expect(isDirectory(entry)).to.eql(true);
    });

    it('infers files from lack of trailing /', function() {
      let entry = Entry.fromPath('/foo');
      expect(entry.relativePath).to.equal('/foo');
      expect(entry.size).to.equal(0);
      expect(entry.mtime).to.be.gt(0);
      expect(isDirectory(entry)).to.eql(false);
    });
  });

  describe('.fromStat', function() {
    afterEach(function() {
      fs.removeSync(FIXTURE_DIR);
    });

    it('creates a correct entry for a file', function() {
      var path = FIXTURE_DIR + '/index.js';

      fs.outputFileSync(path, '');

      var stat = fs.statSync(path);
      var entry = Entry.fromStat(path, stat);

      expect(isDirectory(entry)).to.not.be.ok;
      expect(entry.mode).to.equal(stat.mode);
      expect(entry.size).to.equal(stat.size);
      expect(entry.mtime).to.equal(stat.mtime);
      expect(entry.relativePath).to.equal(path);

      fs.unlink(path);
    });

    it('creates a correct entry for a directory', function() {
      var path = FIXTURE_DIR + '/foo/';

      fs.mkdirpSync(path);

      var stat = fs.statSync(path);
      var entry = Entry.fromStat(path, stat);

      expect(isDirectory(entry)).to.be.ok;
      expect(entry.mode).to.equal(stat.mode);
      expect(entry.size).to.equal(stat.size);
      expect(entry.mtime).to.equal(stat.mtime);
      expect(entry.relativePath).to.equal(FIXTURE_DIR + '/foo');
    });
  });
});
