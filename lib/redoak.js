// Express middleware and main library file.

var _ = require('underscore');
var dependencies = require('./dependencies');
var events = require('events');
var path = require('path');
var render = require('./render');
var websocket = require('websocket');

exports.dependencies = dependencies;
exports.render = render;

exports.Middleware = function(opts) {
  this.handle_ = null;
  this.treeCallback_ = this.treeCallback_.bind(this);
  this.queue_ = [[]];
  this.hasApp_ = opts && opts.app;
  this.rootsLength_ = 0;
  this.emitter_ = new events.EventEmitter();
  dependencies.tree(this.queue_[0], this.treeCallback_);

  if (this.hasApp_) {
    if (opts.app.settings.basepath) {
      this.basepath_ = opts.app.settings.basepath + '/redoak/';
    } else {
      this.basepath_ = '/redoak/';
    }

    var WebSocketServer = websocket.server;
    var websocketServer = new WebSocketServer(
        { httpServer: opts.app, autoAcceptConnections: false });
    websocketServer.on('request', function(req) {
      var url = req.httpRequest.url;
      var substr = url.substr(url.lastIndexOf('/') + 1);
      var index = parseInt(substr);
      if (isNaN(index) || index >= this.rootsLength_) {
        return;
      }

      var connection = req.accept('', req.origin);
      function onChange() {
        connection.send('change');
      }
      this.emitter_.on('tree', onChange);
      connection.once('close', function() {
        this.emitter_.removeListener('tree', onChange);
        connection = null;
      }.bind(this));
    }.bind(this));

    var dirname = __dirname + '/public/';
    opts.app.get('/redoak/mustache.js', this.get(dirname + 'mustache.js'));
    opts.app.get('/redoak/util.js', this.get(dirname + 'util.js'));
    opts.app.get('/redoak/basewidget.js', this.get(dirname + 'basewidget.js'));
    opts.app.get('/redoak/extra.js', this.get(dirname + 'extra.js'));
  }
};

exports.Middleware.prototype = {
  fileObjMap_: function(tree, f) {
    if (f.filename.substr(0, __dirname.length) == __dirname) {
      if (this.hasApp_) {
        return this.basepath_ + f.name;
      } else {
        return null;
      }
    } else {
      return path.relative(path.dirname(tree.data().filename), f.filename);
    }
  },

  treeCallback_: function(t) {
    this.tree_ = t;
    this.queue_.shift();
    if (this.queue_.length) {
      this.tree_.addRoot(this.queue_[0], this.treeCallback_);
    } else if (!this.handle_) {
      this.handle_ = dependencies.watch(t, this.treeCallback_);
    } else {
      this.emitter_.emit('tree');
    }
  },

  add: function(filename) {
    if (this.handle_) {
      this.handle_();
      this.handle_ = null;
    }

    var fileObj = { type: 'oak', name: filename, index: this.rootsLength_++ };
    this.queue_.push(fileObj);
    if (this.queue_.length == 1) {
      this.tree_.addRoot(this.queue_[0], this.treeCallback_);
    }
  },

  get: function(filename) {
    return function(req, res, next) {
      var str = this.html(filename);
      if (str) {
        res.write(str);
        return res.end();
      }
      next();
    }.bind(this);
  },

  html: function(filename) {
    var tree = this.tree_.subtree({ name: filename });
    if (tree) {
      var data = tree.data();
      if (data.type == 'oak') {
        var fileObjMap = this.fileObjMap_.bind(this, tree);
        return render.html(tree, fileObjMap, data.index);
      } else if (data.data) {
        return data.data;
      } else {
        return '';
      }
    } else {
      return '';
    }
  }
};
