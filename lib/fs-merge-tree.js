'use strict';

const walkSync = require('walk-sync');

const FSTree = require('./');

class FSMergeTree {
  constructor(options) {
    let roots = options.roots;

    for (let i=0; i<roots.length; ++i) {
      this[i] = new FSTree({
        entries: null,
        root: roots[i],
      });
    }

    this.length = roots.length;
  }

  map(callback, context) {
    let result = new Array(this.length);

    for (let i = 0; i < this.length; i++) {
      result[i] = callback.call(context, this[i], i);
    }

    return result;
  }
}

module.exports = FSMergeTree;
