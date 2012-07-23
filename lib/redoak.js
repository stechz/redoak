// Express middleware and main lib file.
// By Benjamin Stover

var dependencies = require('./dependencies');
var express = require('express');
var events = require('events');
var fs = require('fs');
var path = require('path');
var render = require('./render');
var websocket = require('websocket');

exports.dependencies = dependencies;
exports.render = render;

exports.middleware = function(app, begin, filename) {
  var str = '';
  var fileObjs = [];
  var emitter = new events.EventEmitter();
  dependencies.watch({ name: filename, type: 'oak' }, function(tree) {
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
