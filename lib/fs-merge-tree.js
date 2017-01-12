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
  }
}

module.exports = FSMergeTree;
