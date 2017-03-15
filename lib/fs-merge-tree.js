'use strict';

var fs = require('fs')
const canSymlink = require('can-symlink')();
const FSTree = require('./');
let defaultIsEqual = FSTree.defaultIsEqual;
const util = require('./util');


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
    this._currentTree = FSTree.fromPaths([]);
  }

  map(callback, context) {
    let result = new Array(this.length);
    for (let i = 0; i < this.length; i++) {
      result[i] = callback.call(context, this[i], i);
    }
    return result;
  }
}

function isLinkStateEqual(entryA, entryB) {
  // We don't symlink files, only directories
  if (!(entryA.isDirectory() && entryB.isDirectory())) {
    return true;
  }

  // We only symlink on systems that support it
  if (!canSymlink) {
    return true;
  }

  // This can change between rebuilds if a dir goes from existing in multiple
  // input sources to exactly one input source, or vice versa
  return entryA.linkDir === entryB.linkDir;
}

function isEqual(entryA, entryB) {
  return defaultIsEqual(entryA, entryB) && isLinkStateEqual(entryA, entryB);
}


FSMergeTree.prototype.changes = function(overwriteOptions) {
  let patches;
  let fileInfos = this._mergeRelativePath(overwriteOptions, '');
  let entries = fileInfos.map(function(fileInfo) {
    return fileInfo.entry;
  });

  let newTree = FSTree.fromEntries(entries);
  patches = this._currentTree.calculatePatch(newTree, isEqual);
  this._currentTree = newTree;
  return patches;
};


FSMergeTree.prototype._mergeRelativePath = function (overwriteOptions, baseDir, possibleIndices) {

  let overwrite = overwriteOptions ? overwriteOptions.overwrite : null ;
  let result = [];
  let isBaseCase = (possibleIndices === undefined);

  // baseDir has a trailing path.sep if non-empty
  let i, j, fileName, subEntries;

  let names = this.map((tree, index) => {
    if (possibleIndices == null || possibleIndices.indexOf(index) !== -1) {
     return tree.readdirSync(baseDir).sort()
    } else {
      return []
    }
  });

  // Guard against conflicting capitalizations
  let lowerCaseNames = {}
  for (i = 0; i < this.length; i++) {
    for (j = 0; j < names[i].length; j++) {

      fileName = names[i][j]
      let lowerCaseName = fileName.toLowerCase()
      // Note: We are using .toLowerCase to approximate the case
      // insensitivity behavior of HFS+ and NTFS. While .toLowerCase is at
      // least Unicode aware, there are probably better-suited functions.
      if (lowerCaseNames[lowerCaseName] === undefined) {
        lowerCaseNames[lowerCaseName] = {
          index: i,
          originalName: fileName
        }
      } else {
        let originalIndex = lowerCaseNames[lowerCaseName].index
        let originalName = lowerCaseNames[lowerCaseName].originalName
        if (originalName !== fileName) {

          throw new Error('Merge error: conflicting capitalizations:\n'
              + baseDir + originalName + ' in ' + this[originalIndex].root + '\n'
              + baseDir + fileName + ' in ' + this[i].root + '\n'
              + 'Remove one of the files and re-add it with matching capitalization.\n'
              + 'We are strict about this to avoid divergent behavior '
              + 'between case-insensitive Mac/Windows and case-sensitive Linux.'
          )
        }
      }
    }
  }
  // From here on out, no files and directories exist with conflicting
  // capitalizations, which means we can use `===` without .toLowerCase
  // normalization.

  // Accumulate fileInfo hashes of { isDirectory, indices }.
  // Also guard against conflicting file types and overwriting.

  let fileInfo = {}
  let tree;
  let infoHash;

  for (i = 0; i < this.length; i++) {
    tree = this[i];
    for (j = 0; j < names[i].length; j++) {
      fileName = names[i][j]

      let entry = tree.statSync(baseDir + fileName);
      entry.basePath = tree.root;
      let isDirectory = entry.isDirectory();

      if (fileInfo[fileName] == null) {
        fileInfo[fileName] = {
          entry: entry,
          isDirectory: isDirectory,
          indices: [i] // indices into inputPaths in which this file exists
        };
      } else {

        let existingEntryPath = fileInfo[fileName].entry.basePath + fileInfo[fileName].entry.relativePath;
        fileInfo[fileName].entry = entry;
        fileInfo[fileName].indices.push(i)

        // Guard against conflicting file types
        let originallyDirectory = fileInfo[fileName].isDirectory
        if (originallyDirectory !== isDirectory) {

          throw new Error('Merge error: conflicting file types: ' + baseDir + fileName
              + ' is a ' + (originallyDirectory ? 'directory' : 'file')
              + ' in ' + existingEntryPath
              + ' but a ' + (isDirectory ? 'directory' : 'file')
              + ' in ' + fileInfo[fileName].entry.basePath + fileInfo[fileName].entry.relativePath + '\n')

          throw new Error('Merge error: conflicting file types: ' + baseDir + fileName
              + ' is a ' + (originallyDirectory ? 'directory' : 'file')
              + ' in ' + fileInfo[fileName].entry.basePath + fileInfo[fileName].entry.relativePath
              + ' but a ' + (isDirectory ? 'directory' : 'file')
              + ' in ' + existingEntryPath  + '\n'
              + 'Remove or rename either of those.'
          )
        }

        // Guard against overwriting when disabled
        if (!isDirectory && !overwrite) {
          throw new Error('Merge error: '
              + 'file ' + baseDir + fileName + ' exists in '
              + fileInfo[fileName].entry.basePath + fileInfo[fileName].entry.relativePath + ' and ' + existingEntryPath +'\n'
              + 'Pass option { overwrite: true } to mergeTrees in order '
              + 'to have the latter file win.'
          )
        }

      }
    }
  }

  // Done guarding against all error conditions. Actually merge now.
  for (i = 0; i < this.length; i++) {
    for (j = 0; j < names[i].length; j++) {
      fileName = names[i][j]
      infoHash = fileInfo[fileName]

      if (infoHash.isDirectory) {
        if (infoHash.indices.length === 1 && canSymlink ) {
          // This directory appears in only one tree: we can symlink it without
          // reading the full tree
          infoHash.entry.linkDir = true;
          infoHash.entry._projection = this[i].chdir(infoHash.entry.relativePath);
          result.push(infoHash);

        } else {
          if (infoHash.indices[0] === i) { // avoid duplicate recursion
            subEntries = this._mergeRelativePath(overwriteOptions, baseDir + fileName + '/', infoHash.indices);

            // FSTreeDiff requires intermediate directory entries, so push
            // `infoHash` (this dir) as well as sub entries.
            result.push(infoHash);
            result.push.apply(result, subEntries);
          }
        }
      } else { // isFile
        if (infoHash.indices[infoHash.indices.length-1] === i) {
          result.push(infoHash);
        } else {
          // This file exists in a later inputPath. Do nothing here to have the
          // later file win out and thus "overwrite" the earlier file.
        }
      }
    }
  }

  if (isBaseCase) {
    // FSTreeDiff requires entries to be sorted by `relativePath`.
    return result.sort(function (a, b) {
      let pathA = a.entry.relativePath;
      let pathB = b.entry.relativePath;

      if (pathA === pathB) {
        return 0;
      } else if (pathA < pathB) {
        return -1;
      } else {
        return 1;
      }
    });
  } else {
    return result;
  }
};

module.exports = FSMergeTree;
