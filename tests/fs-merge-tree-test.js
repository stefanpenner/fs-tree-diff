'use strict';

const FSMergeTree = require('../lib/fs-merge-tree');
const FSTree = require('../');
const expect = require('chai').expect;
const path = require('path');
const fixturify = require('fixturify');
const rimraf = require('rimraf');
const fs = require('fs-extra');

function mapBy(array, property) {
  return array.map(function (item) {
    return item[property];
  });
}

describe('FSMergeTree', function () {
  let ROOT = path.resolve('tmp/fs-test-root/');

  describe('constructor', function () {
    it('supports empty inputs', function () {
      let tree = new FSMergeTree({
        inputs: []
      });

      expect(tree.length).to.equal(0);
      expect(tree).to.not.have.property(0);
    });

    it('supports multiple inputs', function () {
      let tree = new FSMergeTree({
        inputs: [ROOT + 'foo', ROOT + 'bar']
      });

      expect(tree.length).to.equal(2);
      expect(tree).to.have.property(0);
      expect(tree).to.have.property(1);
      expect(tree).to.not.have.property(2);
    });

    it('supports tree inputs', function () {
      let tree = new FSTree({
        root: ROOT
      });
      let fsMergeTree = new FSMergeTree({
        inputs: [tree]
      });

      expect(fsMergeTree.length).to.equal(1);
      expect(fsMergeTree).to.have.property(0);
      expect(fsMergeTree).to.not.have.property(1);
    });

    it('sets srcTree to true for string inputs', function () {
      let tree = new FSTree({
        root: `${ROOT}/guten-tag`,
      });
      let fsMergeTree = new FSMergeTree({
        inputs: [tree, `${ROOT}/hello`]
      });

      expect(fsMergeTree).to.have.deep.property('0.srcTree', false);
      expect(fsMergeTree).to.have.deep.property('1.srcTree', true);
    });
  });

  describe('.map', function () {
    it('maps over no inputs', function () {
      let result = new FSMergeTree({
        inputs: []
      }).map((entry, index) => [entry, index])

      expect(result.length).to.equal(0);
    });

    it('maps over multiple inputs', function () {
      let result = new FSMergeTree({
        inputs: [ROOT + '/foo', ROOT + '/bar']
      }).map((entry, index) => [entry, index])

      expect(result.length).to.equal(2);
      expect(result[0][0].root).to.eql(ROOT + '/foo/');
      expect(result[0][1]).to.eql(0);
      expect(result[1][0].root).to.eql(ROOT + '/bar/');
      expect(result[1][1]).to.eql(1);
    });
  });

  describe('_mergeRelativePaths', function () {
    var ROOT = __dirname + '/tmp/fixtures';

    beforeEach(function () {
      rimraf.sync(ROOT);
      fs.mkdirpSync(ROOT);
    });

    afterEach(function () {
      fs.removeSync(ROOT);
    });

    it('returns an array of file infos', function () {
      fixturify.writeSync(`${ROOT}/a`, {
        bar: {
          baz: 'hello',
        }, qux: 'guten tag'
      });

      fixturify.writeSync(`${ROOT}/b`, {
        c: {
          d: 'hello',
        }, e: 'guten tag'
      });

      let mergeTrees = new FSMergeTree({
        inputs: [`${ROOT}/a`, `${ROOT}/b`]
      });

      var fileInfos = mergeTrees._mergeRelativePath(null, '');
      var entries = mapBy(fileInfos, 'entry');

      expect(mapBy(entries, 'relativePath')).to.deep.equal(['bar/', 'c/', 'e', 'qux']);
    });

    it('merges files', function () {
      fixturify.writeSync(`${ROOT}/a`, {
        foo: '1', qux: 'guten tag'
      });

      fixturify.writeSync(`${ROOT}/a`, {
        bar: '1', baz: 'guten tag'
      });

      let mergeTrees = new FSMergeTree({
        inputs: [`${ROOT}/a`]
      });

      var fileInfos = mergeTrees._mergeRelativePath(null, '');
      var entries = mapBy(fileInfos, 'entry');

      expect(mapBy(entries, 'relativePath')).to.deep.equal(['bar', 'baz', 'foo', 'qux']);
    })

    it('merges empty directories', function () {
      fixturify.writeSync(`${ROOT}/a`, {
        foo: {}, qux: {}
      });

      fixturify.writeSync(`${ROOT}/b`, {
        bar: {}, baz: {}
      });

      let mergeTrees = new FSMergeTree({
        inputs: [`${ROOT}/a`, `${ROOT}/b`]
      });

      var fileInfos = mergeTrees._mergeRelativePath(null, '');
      var entries = mapBy(fileInfos, 'entry');

      expect(mapBy(entries, 'relativePath')).to.deep.equal(['bar/', 'baz/', 'foo/', 'qux/']);
    });

    it('refuses to overwrite files when overwrite is false or null and overwrites if its true', function () {
      fixturify.writeSync(`${ROOT}/a`, {
        bar: {
          baz: 'hello',
        }, qux: 'guten tag'
      });

      fixturify.writeSync(`${ROOT}/b`, {
        c: {
          d: 'hello',
        }, qux: 'guten tag'
      });

      let mergeTrees = new FSMergeTree({
        inputs: [`${ROOT}/a`, `${ROOT}/b`],
      });

      expect(() => mergeTrees._mergeRelativePath(null, '')).to.throw(
          /Merge error: file qux exists in .* and [^]* overwrite: true .*/);
      expect(() => mergeTrees._mergeRelativePath({overwrite: false}, '')).to.throw(
          /Merge error: file qux exists in .* and [^]* overwrite: true .*/);

      var fileInfos = mergeTrees._mergeRelativePath({overwrite: true}, '');
      var entries = mapBy(fileInfos, 'entry');
      expect(mapBy(entries, 'relativePath')).to.deep.equal(['bar/', 'c/', 'qux']);

    });

    it('refuses to honor conflicting capitalizations for a directory, with overwrite: false and true and null', function () {
      fixturify.writeSync(`${ROOT}/a`, {
        bar: {
          baz: 'hello',
        }
      });

      fixturify.writeSync(`${ROOT}/b`, {
        Bar: {
          d: 'hello',
        }
      });

      let mergeTrees = new FSMergeTree({
        inputs: [`${ROOT}/a`, `${ROOT}/b`],
      });
      expect(() => mergeTrees._mergeRelativePath(null, '')).to.throw(
          /Merge error: conflicting capitalizations:\nbar in .*\nBar in .*\nRemove/);
      expect(() => mergeTrees._mergeRelativePath({overwrite: false}, '')).to.throw(
          /Merge error: conflicting capitalizations:\nbar in .*\nBar in .*\nRemove/);
      expect(() => mergeTrees._mergeRelativePath({overwrite: true}, '')).to.throw(
          /Merge error: conflicting capitalizations:\nbar in .*\nBar in .*\nRemove/);
    });

    it('refuses to honor conflicting capitalizations for file, with overwrite: false and true and null', function () {
      fixturify.writeSync(`${ROOT}/a`, {
        bar: 'abcd'
      });

      fixturify.writeSync(`${ROOT}/b`, {
        Bar: 'hello'
      });

      let mergeTrees = new FSMergeTree({
        inputs: [`${ROOT}/a`, `${ROOT}/b`],
      });
      expect(() => mergeTrees._mergeRelativePath(null, '')).to.throw(
          /Merge error: conflicting capitalizations:\nbar in .*\nBar in .*\nRemove/);
      expect(() => mergeTrees._mergeRelativePath({overwrite: false}, '')).to.throw(
          /Merge error: conflicting capitalizations:\nbar in .*\nBar in .*\nRemove/);
      expect(() => mergeTrees._mergeRelativePath({overwrite: true}, '')).to.throw(
          /Merge error: conflicting capitalizations:\nbar in .*\nBar in .*\nRemove/);
    });

    it('rejects directories colliding with files, with overwrite: false and true and null', function () {
      fixturify.writeSync(`${ROOT}/a`, {
        bar: {
          baz: 'hello',
        }
      });

      fixturify.writeSync(`${ROOT}/b`, {
        bar: 'hello'
      });

      let mergeTrees = new FSMergeTree({
        inputs: [`${ROOT}/a`, `${ROOT}/b`],
      });

      expect(() => mergeTrees._mergeRelativePath({overwrite: true}, '')).to.throw(
          /Merge error: conflicting file types: bar is a directory in .* but a file in .*/);
      expect(() => mergeTrees._mergeRelativePath({overwrite: false}, '')).to.throw(
          /Merge error: conflicting file types: bar is a directory in .* but a file in .*/);
      expect(() => mergeTrees._mergeRelativePath(null, '')).to.throw(
          /Merge error: conflicting file types: bar is a directory in .* but a file in .*/);
    });

  });
});
