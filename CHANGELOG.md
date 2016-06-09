### master

* [BREAKING] entries must be lexigraphicaly sorted by relative path
* [BREAKING] entries must include intermediate directories
* [BREAKING] linkdir and unlinkdir no longer supported (BYO metadata)
* [BREAKING] `unlink` and `rmdir` operations are now passed the entry
* performance improvements
* directories in patches always end with a trailing slash
* fixes various issues related to directory state transitions
* directories can now receive `change` patches if user-supplied `meta` has
  property changes

# v0.4.x

* it works
