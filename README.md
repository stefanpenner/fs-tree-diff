# fs-tree-diff [![Build Status](https://travis-ci.org/stefanpenner/fs-tree-diff.svg)](https://travis-ci.org/stefanpenner/fs-tree-diff)

FSTree provides the means to calculate a patch (set of operations) between one file system tree and another.

The possible operations are:

* `unlink` – remove the specified file
* `rmdir` – remove the specified folder
* `mkdir` – create the specified folder
* `create` – create the specified file
* `change` – update the specified file to reflect changes

The operations chosen aim to minimize the amount of IO required to apply a given patch.
For example, a naive `rm -rf` of a directory tree is actually quite costly, as child directories
must be recursively traversed, entries stated.. etc, all to figure out what first must be deleted.
Since we patch from tree to tree, discovering new files is both wasteful and un-needed.

The operations will also be provided in a correct order, allowing us to safely
replay operations without having to first confirm the FS is as we expect.  For
example, `unlink`s for files will occur before a `rmdir` of those files' parent
dir.  Although the ordering will be safe, a specific order is not guaranteed.

A simple example:

```js
var FSTree = require('fs-tree-diff');
var current = FSTree.fromPaths([
  'a.js'
]);

var next = FSTree.fromPaths([
  'b.js'
]);

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
  'b/',
  'b/f.js'
]);

var next = FSTree.fromPaths([
  'b.js',
  'b/',
  'b/c/',
  'b/c/d.js',
  'b/e.js'
]);

current.calculatePatch(next) === [
  ['unlink', 'a.js', entryA],
  ['create', 'b.js', entryB],
  ['mkdir', 'b/c', entryBC],
  ['create', 'b/c/d.js', entryBCD],
  ['create', 'b/e.js', entryBE]
  ['unlink', 'b/f.js', entryBF],
]
```

Now, the above examples do not demonstrate `update` operations. This is because
when providing only paths, we do not have sufficient information to check if
one entry is merely different from another with the same relativePath.

For this, FSTree supports more complex input structure. To demonstrate, We will
use the [walk-sync](https://github.com/joliss/node-walk-sync) module. Which
provides higher fidelity input, allowing FSTree to also detect changes. More on
what an [entry from walkSync.entries
is](https://github.com/joliss/node-walk-sync#entries)

```js
var walkSync = require('walk-sync');

// path/to/root/foo.js
// path/to/root/bar.js
var current = new FSTree({
  entries: walkSync.entries('path/to/root')
});

writeFileSync('path/to/root/foo.js', 'new content');
writeFileSync('path/to/root/baz.js', 'new file');

var next = new FSTree({
  entries: walkSync.entries('path/to/root')
});

current.calculatePatch(next) === [
  ['update', 'foo.js', entryFoo], // mtime + size changed, so this input is stale and needs updating.
  ['create', 'baz.js', entryBaz]  // new file, so we should create it
  /* bar stays the same and is left inert*/
];
```

The entry objects provided depend on the operation.  For `rmdir` and `unlink`
operations, the current entry is provided.  For `mkdir`, `change` and `create`
operations the new entry is provided.

## API

The public API is:

- `FSTree.fromPaths` initialize a tree from an array of string paths.
- `FSTree.fromEntries` initialize a tree from an object containing an `entries`
  property.  Each entry must have the following properties (but may have more):

    - `relativePath`
    - `mode`
    - `size`
    - `mtime`

## Input 

`FSTree.fromPaths` and `FSTree.fromEntries` both validate their inputs.  Inputs
must be sorted and path-unique (ie two entries with the same `relativePath` but
different `size`s would still be illegal input).

## Change Calculation

When a prior entry has a `relativePath` that matches that of a current entry, a
change operation is included for files if any of the following properties differ between
the two entries:

  - `mode`
  - `size`
  - `mtime`
  - `meta`

For directories, only `meta` is checked for changes.

For the purposes of `meta` change calculation `null` and `undefined` are treated
as `{}`.

`meta` should be a flat object of simple properties (eg `{ rev: 1, link: true }`).

This means that if you wanted to, for example, link directories instead of
creating them, you would annotate your `entry` objects with `meta: { link: true
}` and check for this meta data when executing the patch returned by
`calculatePatch`.

