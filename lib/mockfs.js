var readFileData = {};
var watchFiles = {};

var mockfs = {
  $setupFile: function(file, err, data) {
    readFileData[process.cwd() + '/' + file] = [err, data];
  },

  $pokeFile: function(file) {
    var nowObj = { mtime: new Date() };
    var thenObj = { mtime: new Date(0) };
    watchFiles[file](thenObj, nowObj);
  },

  $isFileWatched: function(file) {
    return !!watchFiles[file];
  },

  readFile: function(file, _, callback) {
    var data = readFileData[file];
    if (data) {
      callback(data[0], data[1]);
    } else {
      callback('ERROR', null);
    }
  },

  watchFile: function(file, options, callback) {
    watchFiles[file] = callback;
  },

  unwatchFile: function(file) {
    delete watchFiles[file];
  }
};

mockfs.$setupFile('path/to/js/main.js', null,
                  '"require path/to/js/other.js";\n' +
                  '"require path/to/js/other2.js";\n');
mockfs.$setupFile('path/to/js/other.js', null,
                  '"resource path/to/js/other.html";\n');
mockfs.$setupFile('path/to/js/other2.js', null,
                  '"resource path/to/js/other.html";\n');
mockfs.$setupFile('path/to/js/other.html', null, '');

module.exports = mockfs;
