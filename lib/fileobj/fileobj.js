// Operations for fileobjs.
//
// fileobjs contain the file data, the filename, and other data after reading
// and sometimes parsing the file.

var _ = require('underscore');
var fs = require('fs');
var path = require('path');

// Handlers the different directives we may come across.
var fileHandlers = {
  css: require('./css'),
  js: require('./js'),
  oak: require('./oak')
};

/** Flattens tree to array of dependencies. */
function flatten(tree) {
  // The node looks like [fileObj, children]. We swap the order here, so that
  // when the tree is flattened the leaf nodes come first.
  return uniq([tree[1].map(flatten), tree[0]]);
}

/** TODO */
function uniq(arrays) {
  var uniqCount = 0;
  var map = function(fileObj) {
    if (fileObj.filename) {
      return fileObj.filename;
    } else if (fileObj.element) {
      return fileObj.element;
    } else {
      return uniqCount++;
    }
  };
  return _.uniq(_.flatten(arrays), false, map);
}

/**
 * Takes an unfilled fileObj and the file contents and returns a filled
 * fileobj.
 */
function handleFile(fileObj, data) {
  var handler = fileHandlers[fileObj.type];
  var result = handler ?  handler(fileObj, data) : { data: data };
  result.fileObjs = _(uniq(result.fileObjs)).map(function(childFileObj) {
    var extend = {};
    if (childFileObj.filename) {
      var filename = path.resolve(
          path.dirname(fileObj.filename), childFileObj.filename);
      extend = { filename: filename };
    }
    return _.extend({}, childFileObj, extend);
  });
  return result;
}

/** Helper function used for fetch. */
function handleFileWithCallback(fileObj, data, callback) {
  // Why does the code look so funny? If callback were in the try block and the
  // callback throws an error, the callback would be called twice.
  var result;
  try {
    result = handleFile(fileObj, data);
  } catch(e) {
    console.error(e.stack);
    return callback(e, null);
  }
  callback(null, result);
}

/** Fetches fileObj if not already in files dictionary. */
function fetch(files, fileObj, callback) {
  if (!fileObj.filename) {
    handleFileWithCallback(fileObj, fileObj.data, callback);
  } else if (files[fileObj.filename]) {
    callback(null, files[fileObj.filename]);
  } else {
    var attempts = 2;
    fs.readFile(fileObj.filename, 'utf-8', function read(err, data) {
      if (err) {
        if (--attempts == 0) {
          callback(new Error('Cannot open file.'), null);
        } else {
          setTimeout(function() {
            // Node workaround. On OSX, apparently readFile fails with ENOENT
            // if the file is locked, which happens for me when a watched file
            // changes (perhaps my vim holds on to the file a little longer
            // after writing?). So we give it a little time and attempt to read
            // the file again.
            fs.readFile(fileObj.filename, 'utf-8', read);
          }, 200);
        }
      } else {
        handleFileWithCallback(fileObj, data, callback);
      }
    });
  }
}

if (require.main === module) {
  var assert = require('assert');
  var testOak = '<template name="bar">' +
                '<link rel="js" href="widget.js">' +
                '<link rel="stylesheet" href="test.css">' +
                '<div>Some template</div></template>';
  var fileObj = { filename: 'test.oak', type: 'oak' };
  fileObj = handleFile(fileObj, testOak);

  var template = fileObj.templates[0];
  assert.equal(template.name, 'bar');
  assert.equal(template.data, '<div>Some template</div>');
  assert.equal(fileObj.fileObjs.length, 2);
}

module.exports.flatten = flatten;
module.exports.uniq = uniq;
module.exports.handleFile = handleFile;
module.exports.fetch = fetch;
