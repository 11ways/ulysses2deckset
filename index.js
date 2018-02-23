#!/usr/bin/env node
"use strict";

// Welcome message
console.log('🦋 Welcome to the Ulysses Deckset Generator!');

var generateDeck,
    enable_debug,
    output_file,
    file_path,
    watcher,
    chokidar = require('chokidar'),
	 libpath  = require('path'),
	 BPlist   = require('bplist-parser'),
    Blast    = require('protoblast')(false),
    Plist    = require('plist'),
	 xattr    = require('fs-xattr'),
	 chalk    = require('chalk'),
    uname,
    dir,
    fs = require('fs'),
    Fn = Blast.Bound.Function;

// Set to true in order to enable debug
enable_debug = false;

// Get the source dir
dir = libpath.resolve(process.cwd(), process.argv[2] || '.');

// Name of the Ulysses PLIST
uname = '.Ulysses-Group.plist';

// Name of the output file
output_file = 'deck.md';

/**
 * Log function
 *
 * @author   Jelle De Loecker   <jelle@develry.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @return   {Boolean}
 */
function log(message) {
	console.log('[' + chalk.yellow(Blast.Bound.Date.format(new Date(), 'H:i')) + ']', ...arguments);
}

/**
 * Verbose log function
 *
 * @author   Jelle De Loecker   <jelle@develry.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @return   {Boolean}
 */
function verbose(message) {
	if (enable_debug) {
		console.info('[' + chalk.blue(Blast.Bound.Date.format(new Date(), 'H:i')) + ']', ...arguments);
	}
}

/**
 * Warning log function
 *
 * @author   Jelle De Loecker   <jelle@develry.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @return   {Boolean}
 */
function warn(message) {
	if (enable_debug) {
		console.warn('[' + chalk.orange(Blast.Bound.Date.format(new Date(), 'H:i')) + ']', ...arguments);
	}
}

/**
 * Actually generate the deckset md file
 *
 * @author   Jelle De Loecker   <jelle@develry.be>
 * @since    0.1.0
 * @version  0.1.0
 */
generateDeck = Blast.Bound.Function.throttle(function generateDeck() {

	readDir(dir, function gotSheets(err, results) {

		var slides_count;

		if (err) {
			throw err;
		}

		// Concatenate all the slides
		results = Blast.Bound.Array.flatten(results).join('\n\n---\n\n');

		// Count the slides
		slides_count = 1 + Blast.Bound.String.count(results, '\n---\n');

		fs.writeFile(output_file, results, function written(err) {

			if (err) {
				return console.error('Error writing file:', err);
			}

			log('Your Deckset (' + output_file + ') is up to date. It contains ' + slides_count + ' slides. Watching Ulysses for changes…');
		});
	});
}, 1000);

/**
 * Read in a directory
 *
 * @author   Jelle De Loecker   <jelle@develry.be>
 * @author   Roel Van Gils   <roel@11ways.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @param    {String}   dirpath
 * @param    {}
 */
function readDir(dirpath, callback) {

	var slides_count = 0;

	// Get all the files in the given path
	fs.readdir(dirpath, function gotFiles(err, files) {

		var tasks = [],
		    order;

		if (err) {
			// console.warn('Error reading dir "' + libpath.relative(dir, dirpath) + '"', err.code);
			return callback(null, []);
		}

		Fn.series(function getUlyssesFile(next) {

			var file_path = libpath.resolve(dirpath, uname);

			if (files.indexOf(uname) == -1) {
				return next();
			}

			fs.readFile(file_path, 'utf8', function gotFile(err, str) {

				if (err) {
					warn('Error reading plist file "' + libpath.relative(dir, file_path) + '":', err.code);
					return next();
				}

				order = Plist.parse(str);

				verbose('Ulysses order for:', dirpath, order);

				next();
			});
		}, function doFiles(next) {

			var tasks = [],
			    sheets;

			if (!order) {
				return next(null, []);
			}

			sheets = Blast.Bound.Array.flatten(order.sheetClusters);

			sheets.forEach(function eachFile(name) {

				var file_path;

				if (name == output_file) {
					return;
				}

				// Construct the absolute path to the md file
				file_path = libpath.resolve(dirpath, name);

				tasks.push(function readFile(next) {
					processSheet(dirpath, name, next);
				});
			});

			// Subfolders come after files
			if (order.childOrder) {
				order.childOrder.forEach(function eachFolder(name) {
					var sub_path = libpath.resolve(dirpath, name);

					tasks.push(function doFolder(next) {
						readDir(sub_path, function doneSubFolder(err, result) {

							if (err) {
								return next(err);
							}

							next(null, result);
						});
					});
				});
			}

			Fn.parallel(tasks, next);

		}, function done(err, results) {

			if (err) {
				return callback(err);
			}

			callback(null, results[1]);
		});

	});
}

/**
 * Process a sheet
 *
 * @author   Jelle De Loecker   <jelle@develry.be>
 * @author   Roel Van Gils   <roel@11ways.be>
 * @since    0.1.0
 * @version  0.1.0
 *
 * @param    {String}   dirpath
 * @param    {String}   filename
 * @param    {Function} callback
 */
function processSheet(dirpath, filename, callback) {

	var is_bundled,
	    asset_path,
	    full_path = libpath.resolve(dirpath, filename),
	    new_dir,
	    source,
	    stats;

	Fn.series(function getStats(next) {
		fs.stat(full_path, function gotStats(err, result) {

			if (err) {
				return next(err);
			}

			stats = result;
			next();
		});
	}, function checkHidden(next) {

		xattr.get(full_path, 'com.apple.metadata:_kMDItemUserTags', function gotTags(err, result) {

			if (err || !result) {
				return next();
			}

			// Parse the binary plist
			result = Blast.Bound.Array.flatten(BPlist.parseBuffer(result));

			if (result.indexOf('hide\n0') > -1 || result.indexOf('hide') > -1) {
				err = new Error('This is a hidden sheet');
				err.code = 'HIDDEN';

				return next(err);
			}

			return next();
		});

	}, function processDir(next) {

		// If the full path is not a directory, skip this function
		if (!stats.isDirectory()) {
			return next();
		}

		// Remember the link to this directory
		new_dir = libpath.resolve(dirpath, filename);

		// The actual md file is actually in this new_dir
		// So we'll prepend the filename with the directory
		// (this won't we a true "filename" only, strictly speaking, but it works)
		filename = libpath.join(filename, 'text.md');

		// Construct the full path to this text.md file
		full_path = libpath.resolve(dirpath, filename);

		// Remember that we're working on a bundled file,
		// so we can replace `assets/` folders
		is_bundled = true;

		// Get the stats of the new file
		fs.stat(full_path, function gotNewStats(err, result) {

			if (err) {
				return next(err);
			}

			stats = result;
			next();
		});
	}, function processSimple(next) {
		if (!stats.isFile()) {
			return next();
		}

		fs.readFile(full_path, 'utf8', function gotFile(err, result) {

			if (err) {
				return next(err);
			}

			source = result;

			if (is_bundled) {
				asset_path = libpath.resolve(new_dir, 'assets');

				// Make the path relative? To the start directory (dir)
				// or the current working directory? (process.cwd())
				asset_path = libpath.relative(process.cwd(), asset_path);

				// Path fix
				asset_path = asset_path.replace(/ /g, '\\ ');

				// Replace all assets links
				source = source.replace(/\]\(assets\//g, '](' + asset_path + '/');

			}

			// Ulysses fix for absolute URLS in Markdown ]()(
			source = source.replace(/\]\(\)\(/g, '](');

			return next(null);
		});
	}, function done(err) {

		if (err) {
			verbose('Error reading file "' + libpath.relative(dirpath, full_path) + '":', err.code);
			return callback(null, []);
		}

		// We have to return it as an array,
		// because in the end we just flatten all arrays and concatenate them
		source = Blast.Bound.Array.cast(source);

		callback(null, source);
	});
}

// Do initial check
generateDeck();

// Start watching changes
watcher = chokidar.watch(dir, {usePolling: true, interval: 900});

watcher.on('change', function onChange(path, stats) {

	var slide_changed = libpath.relative(process.cwd(), path);

	slide_changed = slide_changed.replace('.md', '');
	slide_changed = slide_changed.split(libpath.sep).join(' →  ');

	if (Blast.Bound.String.endsWith(path, output_file)) {
		return;
	}

	if (!Blast.Bound.String.endsWith(path, '.md') && !Blast.Bound.String.endsWith(path, '.Ulysses-Group.plist')) {
		return;
	}

	if (Blast.Bound.String.endsWith(path, '.Ulysses-Group.plist')) {
		log('Slides have been reordered or renamed.');
	} else {
		log('Contents of slide "' + slide_changed + '" has been changed.');
	}

	generateDeck();
});