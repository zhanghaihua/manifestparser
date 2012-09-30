var ManifestReader = require('./manifestreader'), 
	PlistReader = require('../build/Release/bindings'), 
	fs = require('fs');
	util = require('util'), 
	XML2js = require('xml2js'),
	Buffer = require('buffer').Buffer,
	unzip = require('unzip'),
	ReadableStream = require('readable-stream'),
	_ = require('underscore');

// Export
module.exports = PlistManifestReader;

/**
 * Decompile a plist binary blob
 * 
 * @param {String} target
 * @param {Object} options
 */
function PlistManifestReader(target, options) {

	// Call manifest reader ctor
	ManifestReader.call(this, target, ['plist', 'zip', 'ipa'], options);

	return this;

};

// Inherit from ManifestReader
util.inherits(PlistManifestReader, ManifestReader);

// Determine if we are dealign with a zip archive
PlistManifestReader.prototype.isZipArchive = function(filename) {
	return filename.substr(-4) === '.zip' || filename.substr(-4) === '.ipa';
};

// Deferredeturn;
PlistManifestReader.prototype.parse = function() {
	var self = this,
		plistZip,
		printOutput = function(xml, results) {
			var json = self.options.outputFormat === 'json',
				isObject = _.isObject(xml);
			if(json) {
				var parser = new XML2js.Parser();
				parser.parseString(isObject ? xml.content : xml, function(err, result) {
					var output = JSON.stringify(result, null, 4);
					if(isObject) {
						xml.content = output;
						results.push(xml);
						self.emit('plist', output, xml.filename);
						return;
					}
					self.emit('plist', output);
				});
				return;
			}
			if(isObject) {
				results.push(xml);
				self.emit('plist', xml.content, xml.filename);
				return;
			}
			self.emit('plist', xml);
		};

	// initialize manifest reader
	self.init();
	
	// Check if target is buffer
	if(Buffer.isBuffer(self.target) || !self.isZipArchive(self.target)) {
		PlistReader.parse(self.target, function(err, plist) {
			if(err) {
				self.emit('error', err);
				return;
			}
			printOutput(plist);
		});
		return;
	} else if(self.isZipArchive(self.target)) {
		
		
		fs.exists(self.target, function(exists) {
			
			// Make sure file exists
			if(!exists) {
				throw new Error("File does not exist");
			}

			var // Plist files to parse
				plistFiles = [],
				// Number of plists found
				numFound = 0,
				// Number of plists waiting to be parsed
				numWaiting = 0,
				// Parsed plists
				plistResults = [],
				// Container for plist stream
				tmpContainer = {};
			
			// Read archive
			fs.createReadStream(self.target)
			// Pipe to unzipper
			.pipe(unzip.Parse())
			// Foreach zip entry
			.on('entry', function (entry) {
			  // Must be a valid plist file
			  if (entry.path.substr(-6) === '.plist' && entry.type === 'File') {			 
				
			    // Increment the number of files found
			    numFound++;
			    
			    // Create a new readable stream
				var rst = new ReadableStream();
				
				// Hook stream
				rst.wrap(entry);

				// Read plist data
				rst.on('data', function(chunk) {
					var buffer;
					if(_.isUndefined(tmpContainer[entry.path])) {
						buffer = tmpContainer[entry.path] = new Buffer(chunk);
					}  else {
						buffer.write(chunk);						
					}
				});

			  }
			})
			.on('end', function() {

				// No plist entries was found
				if(!numFound) {
					self.emit('error', new Error("Archive does not contain any plist files"));
					return;
				}
				
				// Number of remaining documents
				var numWaiting = numFound;
				
				// For each key/value
				_.each(tmpContainer, function(buffer, filename) {
					// Parse document
					PlistReader.parse(buffer, function(err, plist) {
						// Number of documents remaining
						numWaiting--;
						// Emit error when parsing fails
						if(err) {
							self.emit('error', err, filename);
							return;
						}
						// Save output into an array
						printOutput({
							filename: filename,
							content: plist
						}, plistResults);
						// Finished parsing
						if(numWaiting === 0) {
							self.emit('end', plistResults);
						}
					});
				});
				
			  });
			
		});
		
		
	}
};