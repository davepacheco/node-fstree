[![build status](https://secure.travis-ci.org/davepacheco/node-fstree.png)](http://travis-ci.org/davepacheco/node-fstree)
# fstree: recursive filesystem functions

There are plenty of modules for doing recursive filesystem operations.  These
have slightly different semantics than the ones I saw previously.

This module provides three main functions:


### copyTree(src, dst, callback): recursively copies "src" to "dst"

This behaves much like "cp -R", except that only regular files, symlinks, and
directories are supported (not pipes or devices).  Like "cp", this operation
fails if the destination already exists.  If any part of the operation fails,
the partial copy will still be present.

This implementation will only allow 100 outstanding filesystem operations at a
time.  If you need more, you can bump cpMaxWorkers, but beware of system
resource limits (e.g., file descriptors).


### rmTree(dir, callback): recursively remove an entire directory tree

This behaves much like "rm -r".  Unlike copyTree, this one does not attempt to
limit the number of outstanding filesystem operations, but it also doesn't use
a file descriptor per file in the tree.


### mountLofs(source, dest, callback): create a read-only lofs mount

On illumos systems, this creates a read-only lofs mount of "source" at "dest".
This just calls the underlying mount(1M) command.
