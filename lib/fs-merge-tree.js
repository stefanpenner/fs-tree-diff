'use strict';

const FSTree = require('./');

class FSMergeTree {
  constructor(options) {
    let roots = options.roots;

    for (let i=0; i<roots.length; ++i) {
      this[i] = new FSTree({
        root: roots[i]
      });
    }
  }
}

module.exports = FSMergeTree;
