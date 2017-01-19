'use strict';

const FSMergeTree = require('../lib/fs-merge-tree');
const FSTree = require('../');
const expect = require('chai').expect;
const path = require('path');

describe('FSMergeTree', function() {
  let ROOT = path.resolve('tmp/fs-test-root/');

  describe('constructor', function() {
    it('supports empty inputs', function() {
      let tree = new FSMergeTree({
        inputs: []
      });

      expect(tree.length).to.equal(0);
      expect(tree).to.not.have.property(0);
    });

    it('supports multiple inputs', function() {
      let tree = new FSMergeTree({
        inputs: [ROOT + 'foo', ROOT + 'bar']
      });

      expect(tree.length).to.equal(2);
      expect(tree).to.have.property(0);
      expect(tree).to.have.property(1);
      expect(tree).to.not.have.property(2);
    });

    it('supports tree inputs', function() {
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

    it('sets srcTree to true for string inputs', function() {
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

  describe('.map', function() {
    it('maps over no inputs', function() {
      let result = new FSMergeTree({
        inputs: []
      }).map((entry, index) => [entry, index])

      expect(result.length).to.equal(0);
    });

    it('maps over multiple inputs', function() {
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
});
