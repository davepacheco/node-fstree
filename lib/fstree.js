/*
 * fstree.js: filesystem utilities
 */

var mod_child = require('child_process');
var mod_fs = require('fs');
var mod_path = require('path');
var mod_util = require('util');

var mod_vasync = require('vasync');
var mod_verror = require('verror');

/*
 * Public interface
 */
exports.copyTree = copyTree;
exports.rmTree = rmTree;
exports.mountLofs = mountLofs;
exports.cpMaxWorkers = 100; 	/* max cp suboperations at one time */

/*
 * Copy a recursive directory hierarchy, like "cp -R", except that only regular
 * files, symlinks, and directories are supported (not pipes or devices).  Like
 * "cp", this operation fails if the destination already exists.  If any part of
 * the operation fails, the partial copy will still be present.
 *
 * This implementation will only allow 100 outstanding filesystem operations at
 * a time.  If you need more, you can bump cpMaxWorkers, but beware of system
 * resource limits (e.g., file descriptors).
 */
function copyTree(src, dst, callback)
{
	var cpstate = {
	    'navail': 100,
	    'npending': 0,
	    'queue': [],
	    'errors': [],
	    'callback': callback
	};

	cpstate['queue'].push([ src, dst ]);
	copyRun(cpstate);
	return (cpstate);
}

function copyRun(cpstate)
{
	if (cpstate['errors'].length > 0 || cpstate['queue'].length === 0) {
		/*
		 * Either we've encountered errors or we've no more work to
		 * dispatch.  If there's still work outstanding, though, we
		 * cannot invoke the callback yet.
		 */
		if (cpstate['npending'] > 0)
			return;

		if (cpstate['errors'].length === 0) {
			cpstate['callback']();
			return;
		}

		var err = new mod_verror.MultiError(cpstate['errors']);
		cpstate['callback'](err);
		return;
	}

	var ent;

	while (cpstate['queue'].length > 0 &&
	    cpstate['npending'] < cpstate['navail']) {
		ent = cpstate['queue'].shift();
		cpstate['npending']++;
		copyOne(cpstate, ent);
	}
}

function copyOne(cpstate, ent)
{
	var callback = function (err) {
		if (err)
			cpstate['errors'].push(err);

		cpstate['npending']--;
		copyRun(cpstate);
	};

	mod_fs.lstat(ent[0], function (err, stat) {
		if (err) {
			callback(err);
			return;
		}

		if (stat.isFile())
			copyFile(cpstate, ent[0], ent[1], stat, callback);
		else if (stat.isDirectory())
			copyDirectory(cpstate, ent[0], ent[1], stat, callback);
		else if (stat.isSymbolicLink())
			copySymlink(cpstate, ent[0], ent[1], stat, callback);
		else
			callback(new Error('copyTree: ' +
			    'unsupported file type: ' + ent[0]));
	});

	return (cpstate);
}

function copyFile(_, src, dst, stat, callback)
{
	/*
	 * "open" with O_EXCL doesn't exist until Node 0.8.  Until then this
	 * check is subject to races.
	 */
	mod_fs.lstat(dst, function (err) {
		if (!err || err['code'] != 'ENOENT') {
			callback(new Error('copyTree: destination ' +
			    'exists: ' + dst));
			return;
		}

		var input = mod_fs.createReadStream(src);
		var output = mod_fs.createWriteStream(dst, {
		    'mode': stat.mode
		});

		mod_util.pump(input, output, function (suberr) {
			if (suberr)
				callback(new Error('copyTree: failed to ' +
				    'copy "' + src + '": ' + suberr.message));
			else
				callback();
		});
	});
}

function copyDirectory(cpstate, src, dst, stat, callback)
{
	mod_fs.mkdir(dst, stat.mode, function (err) {
		if (err) {
			callback(new Error('copyTree: mkdir "' +
			    dst + '": ' + err.message));
			return;
		}

		mod_fs.readdir(src, function (suberr, files) {
			if (suberr) {
				callback(new Error('copyTree: readdir "' +
				    src + '":' + suberr.message));
				return;
			}

			files.map(function (filename) {
				var srcfile = mod_path.join(src, filename);
				var dstfile = mod_path.join(dst, filename);
				cpstate['queue'].push([ srcfile, dstfile ]);
			});

			callback();
		});
	});
}

function copySymlink(_, src, dst, stat, callback)
{
	mod_fs.readlink(src, function (err, target) {
		if (err) {
			callback(err);
			return;
		}

		mod_fs.symlink(target, dst, callback);
	});
}

/*
 * Recursively remove an entire directory tree, like "rm -rf".
 */
function rmTree(dir, callback)
{
	if (mod_path.normalize(dir) == '/') {
		callback(new Error('refusing to remove "/"'));
		return;
	}

	mod_fs.lstat(dir, function (err, stat) {
		if (err) {
			if (err['code'] == 'ENOENT')
				callback();
			else
				callback(err);
			return;
		}

		if (!stat.isDirectory()) {
			mod_fs.unlink(dir, callback);
			return;
		}

		mod_fs.readdir(dir, function (suberr, files) {
			if (err) {
				callback(err);
				return;
			}

			mod_vasync.forEachParallel({
			    'inputs': files,
			    'func': function (filename, subcallback) {
				var newfile = mod_path.join(dir, filename);
				rmTree(newfile, subcallback);
			    }
			}, function (suberr2) {
				if (suberr2) {
					callback(suberr2);
					return;
				}

				mod_fs.rmdir(dir, callback);
			});
		});
	});
}

/*
 * Create a new read-only lofs mount of "source" at "dest".
 */
function mountLofs(source, dest, callback)
{
	mod_child.execFile('mount', [ '-F', 'lofs', '-oro', source, dest ],
	    function (err, stdout, stderr) {
		if (err) {
			callback(new mod_verror.VError(err,
			    '"mount" failed: %s', stderr));
			return;
		}

		callback();
	    });
}
