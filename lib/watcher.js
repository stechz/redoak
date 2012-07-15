// More responsible file watching.
// By Benjamin Stover

var fs = require('fs');
var events = require('events');

exports.__fs = fs;

var OPTIONS = { persistent: true, interval: 100 };
var emitter = new events.EventEmitter();
emitter.setMaxListeners(100);

exports.listeners = function(file) {
  return emitter.listeners(file);
};

exports.watch = function(file, callback) {
  if (!emitter.listeners(file).length) {
    exports.__fs.watchFile(file, OPTIONS, function(stat1, stat2) {
      if (stat1.mtime.getTime() !== stat2.mtime.getTime()) {
        emitter.emit(file);
      }
    });
  }
  emitter.on(file, callback);
  return callback;
};

exports.unwatch = function(file, callback) {
  emitter.removeListener(file, callback);
  if (!emitter.listeners(file).length) {
    exports.__fs.unwatchFile(file);
  }
};
