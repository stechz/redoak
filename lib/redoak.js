// Express middleware and main library file.

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

/** Returns path for static files in redoak. */
exports.public = function() {
  return path.resolve(__dirname, 'public');
};

/**
 * Returns a function that outputs most recent HTML.  If opts is defined and
 * has 'path' and 'app', it also watches for websocket requests for 'path' and
 * sends messages when the files change.
 */
exports.html = function(filename, opts) {
  var emitter = new events.EventEmitter();
  dependencies.watch({ name: filename, type: 'oak' }, function(tree) {
    emitter.emit('tree', tree);
  });

  var str = '';
  var fileObjs = [];

  emitter.on('tree', function(tree) {
    var first = !str.length;
    str = render.html(tree, function(f) {
      if (f.filename.substr(0, __dirname.length) == __dirname) {
        return f.name;
      } else {
        return path.relative(path.dirname(tree[0].filename), f.filename);
      }
    });
    emitter.emit('fileobjs', fileObjs);
    if (first) {
      emitter.emit('ready');
    }

    // Useful for figuring out debugging the dependency tree.
    // var replace = function(n, v) {
    //   return (n == 'document' || n == 'data') ? undefined : v;
    // };
    // emitter.once('debug', console.log);
    // emitter.emit('debug', JSON.stringify(fileObjs, replace, 2));
  });

  if (opts && opts.app && opts.path) {
    var WebSocketServer = websocket.server;
    var websocketServer = new WebSocketServer(
        { httpServer: opts.app, autoAcceptConnections: false });
    websocketServer.on('request', function(req) {
      if (req.httpRequest.url != opts.path) {
        return;
      }

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
  }

  // fn is an emitter too.
  var fn = function() { return str; };
  fn.on = emitter.on.bind(emitter);
  fn.once = emitter.once.bind(emitter);
  fn.removeListener = emitter.removeListener.bind(emitter);
  return fn;
};

/**
 * Middleware for rapidly prototyping an oak HTML file.
 *
 * Any JS, CSS, or other oak files will be monitored for changes, and the page
 * will be refreshed when they change.
 *
 * @param app The express app.
 * @param begin Used for identifying websocket connections.
 * @param filename Path to HTML file.
 */
exports.middleware = function(app, begin, filename) {
  debug();
  var html = exports.html(filename, { app: app, path: begin });
  return function(req, res, next) {
    var str = html();
    if (str) {
      res.write(str);
      return res.end();
    }
    next();
  };
};
