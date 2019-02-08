import fs = require('fs-extra');
import chai = require('chai');
import Entry from '../lib/entry';

const { expect } = chai;
const FIXTURE_DIR = 'fixture';

require('chai').config.truncateThreshold = 0;

describe('Entry', function() {
  describe('constructor', function() {
    const size = 1337;
    const mtime = Date.now();

    it('supports omitting mode for files', function() {
      const entry = new Entry('/foo.js', size, mtime);

      expect(entry.relativePath).to.equal('/foo.js');
      expect(entry.size).to.equal(size);
      expect(entry.mtime).to.equal(mtime);
      expect(entry.mode).to.equal(0);
      expect(entry.isDirectory()).to.not.be.ok;
    });

    it('supports omitting mode for directories', function() {
      const entry = new Entry('/foo/', size, mtime);

      expect(entry.relativePath).to.equal('/foo/');
      expect(entry.size).to.equal(size);
      expect(entry.mtime).to.equal(mtime);
      expect(entry.mode).to.equal(16877);
      expect(entry.isDirectory()).to.be.ok;
    });

    it('supports including manually defined mode', function() {
      const entry = new Entry('/foo.js', size, mtime, 1);

      expect(entry.relativePath).to.equal('/foo.js');
      expect(entry.size).to.equal(size);
      expect(entry.mtime).to.equal(mtime);
      expect(entry.mode).to.equal(1);
      expect(entry.isDirectory()).to.not.be.ok;
    });

    it('errors on a non-number mode', function() {
      expect(function() {
        // @ts-ignore
        return new Entry('/foo.js', size, mtime, '1');
      }).to.throw(`Expected 'mode' to be of type 'number' but was of type 'string' instead.`);
    });
  });

  describe('.fromStat', function() {
    afterEach(function() {
      fs.removeSync(FIXTURE_DIR);
    });

    it('creates a correct entry for a file', function() {
      const path = FIXTURE_DIR + '/index.js';

      fs.outputFileSync(path, '');

      try {

        const stat = fs.statSync(path);
        const entry = Entry.fromStat(path, stat);

        expect(entry.isDirectory()).to.not.be.ok;
        expect(entry.mode).to.equal(stat.mode);
        expect(entry.size).to.equal(stat.size);
        expect(entry.mtime).to.equal(stat.mtime);
        expect(entry.relativePath).to.equal(path);
      } finally {
        fs.unlinkSync(path);
      }
    });

    it('creates a correct entry for a directory', function() {
      const path = FIXTURE_DIR + '/foo/';

      fs.mkdirpSync(path);

      const stat = fs.statSync(path);
      const entry = Entry.fromStat(path, stat);

      expect(entry.isDirectory()).to.be.ok;
      expect(entry.mode).to.equal(stat.mode);
      expect(entry.size).to.equal(stat.size);
      expect(entry.mtime).to.equal(stat.mtime);
      expect(entry.relativePath).to.equal(path);
    });
  });
});
