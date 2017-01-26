var FSTree = require('../');

var mapSeries = require('promise-map-series')
var expect = require('chai').expect;
var Plugin = require('broccoli-plugin');
var merge = require('lodash.merge');
var Builder = require('broccoli-builder').Builder;
var fixturify = require('fixturify');
var fs = require('fs-extra');
var path = require('path');
var walkSync = require('walk-sync');
var RSVP = require('rsvp');


function NewPlugin(inputs, _options) {
  var options = _options || {};

  Plugin.call(this, inputs, options);

  this._in = this._out = undefined;
  this._inWasPolyfilled = false;

  this.inputWalkOptions = {
    include: options.include,
    exclude: options.exclude
  };
}

NewPlugin.prototype = Object.create(Plugin.prototype);
NewPlugin.prototype.constructor = NewPlugin;

Object.defineProperty(NewPlugin.prototype, 'in', {
  get: function() {
    if (this._in && !this._inWasPolyfilled) { return this._in; }

    // TODO: multiple input paths?
    var inputNode = this._inputNodes[0];
    var tree;

    if (typeof inputNode === 'object' && inputNode !== null && inputNode.out) {
      tree = inputNode.out;
    } else {
      // warn polyfill
      this._inWasPolyfilled = true; // this exists
      var lastTree = this._lastInTree || FSTree.fromEntries([]);
      var inputPath = this.inputPaths[0];
      var entries = walkSync.entries(inputPath, this.inputWalkOptions);
      tree = this._lastInTree = FSTree.fromEntries(entries, { root: inputPath });
      tree.__changes = lastTree.calculatePatch(tree);
    }

    return this._in || (this._in = tree);
  }
});

Object.defineProperty(NewPlugin.prototype, 'out', {
  get: function() {
    if (this._out) { return this._out; }

    var tree = FSTree.fromEntries([], { root: this.outputPath });

    return this._out || (this._out = tree);
  }
});

function A(inputs, options) {
  NewPlugin.call(this, inputs, options);

  this._persistentOutput = true;
}

A.prototype = Object.create(NewPlugin.prototype);
A.prototype.constructor = A;
A.prototype.build = function() {
  var plugin = this;
  this.out.start(); // TODO: broccoli should call this;

  // this, or output patcher
  return mapSeries(this.in.changes(), function(change) {
    var operation = change[0];
    var relativePath = change[1];
    var entry = change[2];

    try {
      switch(operation) {
        case 'create':;
        case 'change': return plugin.out.writeFileSync(relativePath, plugin.in.readFileSync(relativePath));
        case 'unlink': return plugin.out.unlinkSync(relativePath);
        case 'rmdir' : return plugin.out.rmdirSync(relativePath);
        case 'mkdir' : return plugin.out.mkdir(relativePath);
      }
    } catch(e) {
    }
  }).finally(function() {
    plugin.out.stop(); // TODO: broccoli should call this;
  });
};

function Filter(nodes, options) {
  NewPlugin.call(this, nodes, options);
  this._persistentOutput = true;
}

Filter.prototype = Object.create(NewPlugin.prototype);
Filter.prototype.constructor = Filter;
Filter.prototype.build = function() {
  var plugin = this;
  this.out.start(); // TODO: broccoli should call this;
  return mapSeries(this.in.changes(), function(change) {
    var operation = change[0];
    var relativePath = change[1];
    var entry = change[2];

    switch(operation) {
      case 'create': return plugin.processFile(relativePath, entry);
      case 'change': return plugin.processFile(relativePath, entry);
      case 'unlink': return plugin.out.unlinkSync(relativePath);
      case 'rmdir' : return plugin.out.rmdirSync(relativePath);
      case 'mkdir' : return plugin.out.mkdir(relativePath);
    }
  }).finally(function() {
    plugin.out.stop(); // TODO: broccoli should call this;
  });
};

Filter.prototype.processFile = function(relativePath, entry) {
  var plugin = this;

  return new RSVP.Promise(function(resolve) {
    resolve(plugin._process(relativePath, entry));
  }).then(function(outputPath) {
    plugin.out.writeFileSync(relativePath, outputPath);
  });
};

// hook for caching
Filter.prototype._process = function(relativePath, entry) {
  var input  = this.in.readFileSync(relativePath, 'UTF8');
  var plugin = this;

  return new RSVP.Promise(function(resolve) {
    resolve(plugin.processString(input, relativePath));
  });
};

Filter.prototype.processString = function(string, relativePath) {
  return string + '!processed!' + relativePath;
};

function Concat(nodes, options) {
  NewPlugin.call(this, nodes, options);
  this._persistentOutput = true;
  this.outputFile = options.outputFile;
  this.relativePathToPosition = Object.create(null);
  this.output = [ ];
  this.deleted = [ ];
}

Concat.prototype = Object.create(NewPlugin.prototype);
Concat.prototype.constructor = Concat;

Concat.prototype.build = function() {
  var output = '';

  this.out.start(); // TODO: should be in base-class;

  this.in.changes().forEach(function(change) {
    var operation = change[0];
    var relativePath  = change[1];

    switch (operation) {
      case 'create': return this.create(relativePath);
      case 'change': return this.update(relativePath);
      case 'unlink': return this.remove(relativePath);
      case 'mkdir':  break;
      case 'unlinkdir': break;
    }
  }, this);

  this.out.writeFileSync(this.outputFile, this.output.join('\n'));

  this.out.stop(); // TODO: should be in base-class;
};

Concat.prototype.create = function(relativePath) {
  this.relativePathToPosition[relativePath] = this.output.push(this.in.readFileSync(relativePath)) - 1;
};

Concat.prototype.update = function(relativePath) {
  var position = this.relativePathToPosition[relativePath];

  if (position === undefined) { throw new Error('cannot updated: `' + relativePath + '`, as it has not yet been created'); }

  this.output[position] = this.in.readFileSync(relativePath);
};

Concat.prototype.remove = function(relativePath) {
  var position = this.relativePathToPosition[relativePath];
  if (position === undefined) { throw new Error('cannot remove: `' + relativePath + '`, as it has not yet been created'); }

  // update index
  Object.keys(this.relativePathToPosition).forEach(function(relativePath) {
    var i = this.relativePathToPosition[relativePathToPosition];

    if (i === position) {
      delete this.relativePathToPosition[relativePathToPosition];
    } else if (i < position) {
      this.relativePathToPosition[relativePathToPosition]--;
    } else {
      // nothing to do
    }

  }, this);
};

describe('BroccoliPlugins', function() {
  var INPUT_PATH = path.resolve(__dirname , '../tmp/testdir');
  beforeEach(function() {
    fs.mkdirpSync(INPUT_PATH)
  });

  afterEach(function() {
    fs.removeSync(INPUT_PATH)
  });

  it('works basic', function() {
    fixturify.writeSync(INPUT_PATH, { 'input.txt': 'hello, world!' });

    var a = new A([INPUT_PATH]);
    var b = new A([a]);

    var builder = new Builder(b);

    return builder.build().then(function(result) {
      expect(a._inWasPolyfilled).to.eql(true);
      expect(b._inWasPolyfilled).to.eql(false);

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

  it('works patches', function() {
    fixturify.writeSync(INPUT_PATH, { 'input.txt': 'hello, world!' });

    var a = new A([INPUT_PATH]);
    var b = new A([a]);
    var f = new Filter([b]);

    var builder = new Builder(f);

    return builder.build().then(function(result) {

      expect(a._inWasPolyfilled).to.eql(true);
      expect(b._inWasPolyfilled).to.eql(false);
      expect(f._inWasPolyfilled).to.eql(false);

      expect(fs.readFileSync(result.directory + '/input.txt', 'UTF8')).to.eql('hello, world!!processed!input.txt')
      var changes = a.out.changes();
      expect(changes).to.have.deep.property('0.0', 'create');
      expect(changes).to.have.deep.property('0.1', 'input.txt');
      return builder.build();
    }).then(function(result) {
      // output shoujld be the same
      expect(fs.readFileSync(result.directory + '/input.txt', 'UTF8')).to.eql('hello, world!!processed!input.txt')

      // no changes
      expect(a.out.changes()).to.eql([]);

      fixturify.writeSync(INPUT_PATH, { 'input.txt': 'goodnight, world!' });
      return builder.build();
    }).then(function(result) {
      expect(fs.readFileSync(result.directory + '/input.txt', 'UTF8')).to.eql('goodnight, world!!processed!input.txt')
      var changes = a.out.changes();
      expect(changes).to.have.deep.property('0.0', 'change');
      expect(changes).to.have.deep.property('0.1', 'input.txt');
    });
  });

  it('concat', function() {
    fixturify.writeSync(INPUT_PATH, {
      'a.txt': 'a: hello, world!',
      'b.txt': 'b: hello, world!'
    });

    var a = new A([INPUT_PATH]);
    var b = new A([a]);
    var f = new Filter([a]);
    var c = new Concat([f], {
      outputFile: 'out.txt'
    });

    var builder = new Builder(c);

    return builder.build().then(function(result) {


      expect(a._inWasPolyfilled).to.eql(true);
      expect(b._inWasPolyfilled).to.eql(false);
      expect(f._inWasPolyfilled).to.eql(false);
      expect(c._inWasPolyfilled).to.eql(false);

      expect(fs.readFileSync(result.directory + '/out.txt', 'UTF8')).to.eql('a: hello, world!!processed!a.txt\nb: hello, world!!processed!b.txt')
      var changes = a.out.changes();
      expect(changes).to.have.deep.property('0.0', 'create');
      expect(changes).to.have.deep.property('0.1', 'a.txt');
      expect(changes).to.have.deep.property('1.0', 'create');
      expect(changes).to.have.deep.property('1.1', 'b.txt');
      return builder.build();
    }).then(function(result) {
      // output shoujld be the same
      expect(fs.readFileSync(result.directory + '/out.txt', 'UTF8')).to.eql('a: hello, world!!processed!a.txt\nb: hello, world!!processed!b.txt')

      // no changes
      expect(a.out.changes()).to.eql([]);

      fixturify.writeSync(INPUT_PATH, { 'a.txt': 'a: goodnight, world!' });
      return builder.build();
    }).then(function(result) {
      expect(fs.readdirSync(result.directory)).to.eql(['out.txt']);
       expect(fs.readFileSync(result.directory + '/out.txt', 'UTF8')).to.eql('a: goodnight, world!!processed!a.txt\nb: hello, world!!processed!b.txt')
       var changes = a.out.changes();
       expect(changes).to.have.deep.property('0.0', 'change');
       expect(changes).to.have.deep.property('0.1', 'a.txt');

       fixturify.writeSync(INPUT_PATH, { 'a.txt': null });
       return builder.build();
    }).then(function(result) {
      // expect(fs.readdirSync(result.directory)).to.eql(['out.txt']);
      // expect(fs.readFileSync(result.directory + '/out.txt', 'UTF8')).to.eql('b: hello, world!!processed!b.txt')
      // var changes = a.out.changes();
      // expect(changes).to.have.deep.property('0.0', 'unlink');
      // expect(changes).to.have.deep.property('0.1', 'a.txt');

      // return builder.build();
    });
  });
});
