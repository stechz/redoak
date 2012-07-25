// Express middleware and main lib file.
// By Benjamin Stover

var _ = require('underscore');
var dependencies = require('./dependencies');
var events = require('events');
var path = require('path');
var render = require('./render');
var websocket = require('websocket');

exports.dependencies = dependencies;
exports.render = render;

/** Call once to put in debug mode, where problems are outputted to console. */
var debug = _.memoize(function() {
  dependencies.on('error', function(fileObj) {
    console.error('Could not calculate dependencies for', fileObj.name);
    console.error(fileObj.error);
  });
});

/** TODO */
exports.emitter = function(filename) {
  var emitter = new events.EventEmitter();
  dependencies.watch({ name: filename, type: 'oak' }, function(tree) {
    emitter.emit('tree', tree);
  });
  return emitter;
};

/** Returns path for static files in redoak. */
exports.public = function() {
  return path.resolve(__dirname, 'public');
};

/** TODO */
exports.middleware = function(app, begin, emitterOrFilename) {
  debug();

  var str = '';
  var fileObjs = [];
  var emitter = typeof emitterOrFilename == 'string' ?
                exports.emitter(emitterOrFilename) : emitterOrFilename;

  emitter.on('tree', function(tree) {
    var nameCount = {};
    fileObjs = render.flatten(tree);
    fileObjs.forEach(function(fileObj) {
      var name = fileObj.name;
      if (nameCount[name]) {
        ++nameCount[name];
        fileObj.servername = nameCount[name] + '/' + name;
      } else {
        nameCount[name] = 1;
        fileObj.servername = fileObj.name;
      }
    });
    str = render.html(tree);
    emitter.emit('fileobjs', fileObjs);

    // Useful for figuring out debugging the dependency tree.
    // var replace = function(n, v) {
    //   return (n == 'document' || n == 'data') ? undefined : v;
    // };
    // emitter.once('debug', console.log);
    // emitter.emit('debug', JSON.stringify(fileObjs, replace, 2));
  });

  var WebSocketServer = websocket.server;
  var websocketServer = new WebSocketServer(
      { httpServer: app, autoAcceptConnections: false });
  websocketServer.on('request', function(req) {
    if (req.httpRequest.url != begin) {
      return;
    }

    var path = req.httpRequest.url.substr(begin.length);
    var connection = req.accept('', req.origin);
    function onChange() {
      connection.send('change');
    }
    emitter.on('fileobjs', onChange);
    connection.once('close', function() {
      emitter.removeListener('fileobjs', onChange);
      connection = null;
    });
  });

  return function(req, res, next) {
    if (str) {
      res.write(str);
      return res.end();
    }
    next();
  };
};
