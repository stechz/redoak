var dependencies = require('./lib/dependencies');
var express = require('express');
var events = require('events');
var fs = require('fs');
var path = require('path');
var render = require('./lib/render');
var websocket = require('websocket');

// TODO: bug when basic dependency isn't found?
// TODO: use mustache from node_modules dir?
// TODO: bug: preserve is no longer working.

dependencies.on('error', function(err) {
  console.error(err);
});

function middleware(begin, filename) {
  var str = '';
  var fileObjs = [];
  var emitter = new events.EventEmitter();
  dependencies.watch({ name: filename, type: 'oak' }, function(tree) {
    // Useful for figuring out debugging the dependency tree.
    // var replace = function(n, v) {
    //   return (n == 'document' || n == 'data') ? undefined : v;
    // };
    // emitter.once('debug', console.log);
    // emitter.emit('debug', JSON.stringify(fileObjs, replace, 2));

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
    emitter.emit('change');
  });

  var WebSocketServer = websocket.server;
  var websocketServer = new WebSocketServer(
      { httpServer: app, autoAcceptConnections: false });
  websocketServer.on('request', function(req) {
    if (req.httpRequest.url.substr(0, begin.length) != begin) {
      req.reject();
      return;
    }

    var path = req.httpRequest.url.substr(begin.length);
    var connection = req.accept('', req.origin);
    function onChange() {
      connection.send('change');
    }
    emitter.on('change', onChange);
    connection.once('close', function() {
      emitter.removeListener('change', onChange);
      connection = null;
    });
  });

  return function(req, res, next) {
    if (req.params[0]) {
      for (var i = 0; i < fileObjs.length; i++) {
        if (req.params[0] == fileObjs[i].servername) {
          res.write('' + fileObjs[i].data);
          return res.end();
        }
      }
    } else {
      if (str) {
        res.write(str);
        return res.end();
      }
    }
    next();
  };
}

if (process.argv.length < 3) {
  console.error('Must specify an oak file.');
  process.exit(1);
}

var filename = process.argv[2];
console.log('Serving up ' + filename + ' on /.');
filename = path.resolve(filename);

var app = express.createServer();
app.configure(function() {
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
  app.use(express.bodyParser());
  app.use('/', express.static(path.dirname(filename)));
  app.get('/*', middleware('/', filename));
});

app.listen(3000);
