# fs-tree-diff [![Build Status](https://travis-ci.org/stefanpenner/fs-tree-diff.svg)](https://travis-ci.org/stefanpenner/fs-tree-diff)

FSTree provides the means to calculate a patch (set of operations) between one file system tree and another.

The possible operations are:

* `unlink` – remove the specified file
* `rmdir` – remove the specified folder
* `mkdir` – create the specified folder
* `create` – create the specified file
* `update` – update the specified file

The operations choosen aim to minimize the amount of IO required to apply the patch.
For example, a naive `rm -rf` of a tree, is actually quite costly, as child directories
must be recursively traversed, entries stated, all to figure out what first must be deleted.
Since we patch from tree to tree, discovering new files is both wasteful and un-needed.

The operations will also be provided in the correct order. When deleting a large tree, unlink and rmdir operations will be provided depthFirst.

A simple example:

```js
var FSTree = require('fs-tree-diff');
var current = FSTree.fromPaths([
  'a.js'
]);

var next = FSTree.fromPaths({
  'b.js'
});

current.calculatePatch(next) === [
  ['unlink', 'a.js'],
  ['create', 'b.js']
];
```

A slightly more complicated example:

```js
var FSTree = require('fs-tree-diff');
var current = FSTree.fromPaths([
  'a.js',
  'b/f.js'
]);

var next = FSTree.fromPaths({
  'b.js',
  'b/c/d.js'
  'b/e.js'
});

current.calculatePatch(next) === [
  ['unlink', 'a.js'],
  ['unlink', 'b/e.js'],
  ['create', 'b.js'],
  ['mkdir', 'b/c'],
  ['create', 'b/c/d.js'],
  ['create', 'b/e.js']
];
```
