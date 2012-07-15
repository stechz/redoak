var dependencies = require('./lib/dependencies');
var express = require('express');
var events = require('events');
var fs = require('fs');
var path = require('path');
var websocket = require('websocket');

// TODO: bug when basic dependency isn't found?
// TODO: use mustache from node_modules dir?

function html(fileObjs) {
  var root = fileObjs[fileObjs.length - 1];
  if (!root || !root.document) {
    return '';
  }
  var document = root.document;

  var cssText = dependencies.renderCSS(
      fileObjs, function(x) { return x.servername });
  if (cssText) {
    var css = document.createElement('style');
    document.querySelector('head').appendChild(css);
    css.textContent = cssText;
  }

  var script = document.createElement('script');
  var before = document.querySelector('body > script');
  document.body.insertBefore(script, before);
  script.textContent = dependencies.renderJS(
      fileObjs, function(x) { return x.servername; });

  // XXX for some reason, document.innerHTML puts the doctype node after the
  //     document element. HTML5 parsers expect this tag at the beginning.
  //     Should fix this properly somehow.
  return ('<!DOCTYPE html>' +
          document.innerHTML.replace(/<!doctype html>/i, ''));
}

function middleware(begin, filename) {
  var str = '';
  var fileObjs = [];
  var emitter = new events.EventEmitter();
  dependencies.watch({ name: filename, type: 'oak' }, function(tree) {
    var nameCount = {};
    fileObjs = dependencies.flatten(tree, {});
    (function() {
      console.log(JSON.stringify(fileObjs, function replace(name, value) {
        if (name == 'document' || name == 'data') {
          return undefined;
        }
        return value;
      }, 2));
    })();
    for (var i = 0; i < fileObjs.length; i++) {
      var name = fileObjs[i].name;
      if (nameCount[name]) {
        ++nameCount[name];
        fileObjs[i].servername = nameCount[name] + '/' + name;
      } else {
        nameCount[name] = 1;
        fileObjs[i].servername = fileObjs[i].name;
      }
    }
    str = html(fileObjs);
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
      // TODO: is this being called?
      console.log('close!');
      emitter.removeListener('change', onChange);
      connection = null;
    });
  });

  return function(req, res, next) {
    if (req.params[0]) {
      for (var i = 0; i < fileObjs.length; i++) {
        if (req.params[0] == fileObjs[i].servername) {
          res.write('' + fileObjs[i].data);
          res.end();
          return;
        }
      }
    } else {
      if (str) {
        res.write(str);
        res.end();
        return;
      }
    }
    return next();
  };
}

var app = express.createServer();
app.configure(function() {
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
  app.use(express.bodyParser());
  app.get('/*', middleware('/', 'public/example.html'));
});

app.listen(3000);
