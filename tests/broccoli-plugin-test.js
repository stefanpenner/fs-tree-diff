var FSTree = require('../');

var expect = require('chai').expect;
var Plugin = require('broccoli-plugin');
var merge = require('lodash.merge');
var Builder = require('broccoli-builder').Builder;
var fixturify = require('fixturify');
var fs = require('fs-extra');
var path = require('path');
var walkSync = require('walk-sync');

function A(inputs, _options) {
  var options = _options || {};

  Plugin.call(this, inputs, options);

  this._persistentOutput = true;
  this._in = this._out = undefined;

  this.inputWalkOptions = {
    include: options.include,
    exclude: options.exclude
  };
}

A.prototype = Object.create(Plugin.prototype);

// TODO: should be part of broccoli-plugin or something
Object.defineProperty(A.prototype, 'in', {
  get: function() {
    if (this._in) { return this._in; }

    // TODO: multiple input paths?
    var inputNode = this._inputNodes[0];
    var tree;

    if (typeof inputNode === 'object' && inputNode !== null && inputNode.out) {
      tree = inputNode.out;
    } else {
      var inputPath = this.inputPaths[0];
      var entries = walkSync.entries(inputPath, this.inputWalkOptions);
      var tree = FSTree.fromEntries(entries, { root: inputPath });
    }

    return this._in || (this._in = tree);
  }
});

Object.defineProperty(A.prototype, 'out', {
  get: function() {
    if (this._out) { return this._out; }

    var tree = FSTree.fromEntries([], { root: this.outputPath });

    return this._out || (this._out = tree);
  }
});
// end TODO: should be part of broccoli-plugin or something

A.prototype.constructor = A;
A.prototype.build = function() {
  this.out.start(); // TODO: broccoli should call this;
  this.out.writeFileSync('input.txt', this.in.readFileSync('input.txt'));
  this.out.stop(); // TODO: broccoli should call this;
};

describe('BroccoliPlugins', function() {

  var INPUT_PATH = path.resolve(__dirname , '/../tmp/testdir');
  beforeEach(function() {
    fs.mkdirp(INPUT_PATH)
  });
  beforeEach(function() {
    fs.remove(INPUT_PATH)
  });

  it('works', function() {
    fixturify.writeSync(INPUT_PATH, { 'input.txt': 'hello, world!' });

    var a = new A([INPUT_PATH]);
    var b = new A([a]);

    var builder = new Builder(b);

    return builder.build().then(function(result) {
      expect(fs.readFileSync(result.directory + '/input.txt', 'UTF8')).to.eql('hello, world!')
      var changes = a.out.changes();
      expect(changes).to.have.deep.property('0.0', 'create');
      expect(changes).to.have.deep.property('0.1', 'input.txt');
      return builder.build();
    }).then(function(result) {
      // output shoujld be the same
      expect(fs.readFileSync(result.directory + '/input.txt', 'UTF8')).to.eql('hello, world!')

      // no changes
      expect(a.out.changes()).to.eql([]);

      fixturify.writeSync(INPUT_PATH, { 'input.txt': 'goodnight, world!' });
      return builder.build();
    }).then(function(result) {
      expect(fs.readFileSync(result.directory + '/input.txt', 'UTF8')).to.eql('goodnight, world!')
      var changes = a.out.changes();
      expect(changes).to.have.deep.property('0.0', 'change');
      expect(changes).to.have.deep.property('0.1', 'input.txt');
    });
  });
});
