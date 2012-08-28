// More responsible file watching.

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
  var listeners = emitter.listeners(file);
  if (listeners.length) {
    callback.watcher = listeners[0].watcher;
  } else {
    try {
      var fn = function(event, filename) {
        if (event == 'rename') {
          emitter.emit(file);
        }
      };
      callback.watcher = exports.__fs.watch(file, OPTIONS, fn);
      emitter.on(file, callback);
    } catch(e) {
      return null;
    }
  }
  return callback;
};

exports.unwatch = function(file, callback) {
  var listener = emitter.listeners(file)[0];
  emitter.removeListener(file, callback);
  if (!emitter.listeners(file).length && listener) {
    listener.watcher.close();
  }
};
