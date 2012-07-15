// Express middleware for rapid development.
// By Benjamin Stover

var dependencies = require('./lib/dependencies');
var express = require('express');
var fs = require('fs');
var mustache = require('mustache');
var websocket = require('websocket');

/**
 * Middleware for rapid development.
 *
 * Adds an HTTP endpoint for rapid development as well as listens for
 * websocket connections so that the page can be refreshed. The page must
 * define a RAPID_FN that responds to change events.
 *
 * @param app Express app.
 * @param begin Beginning of URL (i.e. '/rapid'). The rest of the URL will
 *              contain the JS file we are testing.
 * @param directories Array of directories with resources that we will load.
 */
function rapid(app, begin, directories) {
  // Set up static handlers for serving files.
  app.use(begin + '/_0', express.static(__dirname + '/public'));
  for (var i = 0; i < directories.length; i++) {
    app.use(begin + '/_' (i + 1), express.static(directories[i]));
  }


  fs.readFile(__dirname + 'templates/rapid.html', 'utf-8',
              function(err, rapidTemplate) {
    app.get(begin + '/*', function(req, res) {
      var filename = req.params[0];
      if (!filename) {
        return res.end();
      }
      fs.exists(filename, function(exists) {
        if (exists) {
          var fileObj = { name: filename, type: 'js' };
          dependencies.dependencies(fileObj, {}, function(tree) {
            if (err) {
              console.log(err);
            } else {
              var fileObjs = dependencies.flatten(tree, {});
              var css = dependencies.renderCSS(fileObjs);
              var deps = dependencies.renderJS(fileObjs, objToFilename);
              var view = { name: filename, depsjs: deps, css: css };
              res.send(mustache.to_html(rapidTemplate, view));
            }
            res.end();
          });
        } else {
          res.end();
        }
      });
    });
  });

  var WebSocketServer = websocket.server;
  var websocketServer = new WebSocketServer(
      { httpServer: app, autoAcceptConnections: false });
  websocketServer.on('request', function(req) {
    if (!req.url.substr(0, begin.length) != begin) {
      req.reject();
      return;
    }

    var path = req.substr(begin.length);
    var connection = req.accept('', req.origin);
    var first = true;
    var onChange = function(tree, fileObj) {
      if (!first) {
        connection.send(JSON.stringify(fileObj));
      }
      first = false;
    };

    dependencies.watch({ name: path, type: 'js' }, onChange);
    connection.once('close', function() {
      dependencies.unwatch({ name: path, type: 'js' }, onChange);
      connection = null;
    });
  });
};
