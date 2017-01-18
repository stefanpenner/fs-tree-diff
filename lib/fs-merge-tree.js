'use strict';

const walkSync = require('walk-sync');

const FSTree = require('./');

class FSMergeTree {
  constructor(options) {
    let inputs = options.inputs;
    for (let i=0; i<inputs.length; ++i) {
      let input = inputs[i];
      let tree;
      if (typeof input === 'string') {
        tree = new FSTree({
          entries: null,
          root: input,
          srcTree: true,
        });
      } else {
        tree = input;
      }

      this[i] = tree;
    }

    this.length = inputs.length;
  }

  map(callback, context) {
    let result = new Array(this.length);

    for (let i = 0; i < this.length; i++) {
      result[i] = callback.call(context, this[i], i);
    }

    return result;
  }

  reread() {
    for (let i=0; i<this.length; ++i) {
      this[i].reread();
    }
  }
}

module.exports = FSMergeTree;
