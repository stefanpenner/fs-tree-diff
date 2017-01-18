'use strict';
const FSMergeTree = require('../lib/fs-merge-tree');
const expect = require('chai').expect;
const path = require('path');

describe('FSMergeTree', function() {
  let ROOT = path.resolve('tmp/fs-test-root/');

  describe('constructor', function() {
    it('supports empty roots', function() {
      let tree = new FSMergeTree({
        roots: []
      });

      expect(tree.length).to.equal(0);
      expect(tree).to.not.have.property(0);
    });

    it('supports multiple roots', function() {
      let tree = new FSMergeTree({
        roots: [ROOT + 'foo', ROOT + 'bar']
      });

      expect(tree.length).to.equal(2);
      expect(tree).to.have.property(0);
      expect(tree).to.have.property(1);
      expect(tree).to.not.have.property(2);
    });
  });

  describe('.map', function() {
    it('maps over no roots', function() {
      let result = new FSMergeTree({
        roots: []
      }).map((entry, index) => [entry, index])

      expect(result.length).to.equal(0);
    });

    it('maps over multipel roots', function() {
      let result = new FSMergeTree({
        roots: [ROOT + '/foo', ROOT + '/bar']
      }).map((entry, index) => [entry, index])

      expect(result.length).to.equal(2);
      expect(result[0][0].root).to.eql(ROOT + '/foo/');
      expect(result[0][1]).to.eql(0);
      expect(result[1][0].root).to.eql(ROOT + '/bar/');
      expect(result[1][1]).to.eql(1);
    });
  });
});
