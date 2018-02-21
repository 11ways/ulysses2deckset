#!/usr/bin/env node
"use strict";

// Welcome message
console.log('🦋 Welcome to the Ulysses Deckset Generator!');

var generateDeck,
    output_file,
    file_path,
    watcher,
    chokidar = require('chokidar'),
    libpath = require('path'),
    Blast = require('protoblast')(false),
    Plist = require('plist'),
    chalk = require('chalk'),
    uname,
    dir,
    fs = require('fs'),
    Fn = Blast.Bound.Function;

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
	console.log('[' + chalk.yellow(Blast.Bound.Date.format(new Date(), 'H:i')) + ']', message);
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
					console.warn('Error reading plist file "' + libpath.relative(dir, file_path) + '":', err.code);
					return next();
				}

				order = Plist.parse(str);

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
					fs.readFile(file_path, 'utf8', function gotFile(err, result) {

						if (err) {
							// console.warn('Error reading file "' + libpath.relative(dir, file_path) + '":', err.code);
							return next(null, []);
						}

						return next(null, result);
					});
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

// Do initial check
generateDeck();

// Start watching changes
watcher = chokidar.watch(dir);

watcher.on('change', function onChange(path, stats) {

	var slideChanged = path.replace(process.cwd()+"/","");

	slideChanged = slideChanged.replace(".md","");
	slideChanged = slideChanged.replace("/"," → ");

	if (Blast.Bound.String.endsWith(path, output_file)) {
		return;
	}

	if (!Blast.Bound.String.endsWith(path, '.md') && !Blast.Bound.String.endsWith(path, '.Ulysses-Group.plist')) {
		return;
	}

	if (Blast.Bound.String.endsWith(path, '.Ulysses-Group.plist')) {
		log("Slides have been reordered or renamed.");
	} else {
		log("Contents of slide '" + slideChanged + "' has been changed.");		
	}
	
	slidesCount = 0; // Reset slides count
	generateDeck();
});