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
  this.tree_ = null;
  this.treeCallback_ = this.treeCallback_.bind(this);
  this.queue_ = [[]];
  this.rootsLength_ = 0;
  this.emitter_ = new events.EventEmitter();
  this.once = this.emitter_.once.bind(this.emitter_);
  this.on = this.emitter_.on.bind(this.emitter_);
  this.removeListener = this.emitter_.removeListener.bind(this.emitter_);
  this.serverDirMap_ = {};
  dependencies.tree(this.queue_[0], this.treeCallback_);

  if (opts && opts.app) {
    this.basepath_ = opts.app.path();

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
      var onChange = function() {
        connection.send('change');
      };
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

  this.mapDirectory(
      __dirname + '/public', (opts && opts.app ? '/redoak/' : null));
};

exports.Middleware.prototype = {
  fileObjMap_: function(tree, f) {
    var serverPath = this.serverDirMap_[path.dirname(f.filename)];
    if (serverPath !== undefined) {
      return serverPath + path.basename(f.filename);
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
      this.emitter_.emit('tree');
    } else {
      this.emitter_.emit('tree');
    }
  },

  add_: function(fileObj) {
    if (this.handle_) {
      this.handle_();
      this.handle_ = null;
    }

    this.queue_.push(fileObj);
    if (this.queue_.length == 1) {
      this.tree_.addRoot(this.queue_[0], this.treeCallback_);
    }
  },

  addFile: function(filename) {
    var fileObj = {
      type: 'oak',
      index: this.rootsLength_++,
      filename: path.resolve(filename)
    };
    this.add_(fileObj);
  },

  addString: function(str) {
    var fileObj = { type: 'oak', data: str };
    this.add_(fileObj);
  },

  mapDirectory: function(dir, serverName) {
    this.serverDirMap_[dir] = serverName;
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
    var tree;
    if (filename) {
      tree = this.tree_.subtree({ filename: path.resolve(filename) });
    } else {
      tree = this.tree_;
    }

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
  },

  dispose: function() {
    if (this.handle_) {
      this.handle_();
      this.handle_ = null;
    }
    this.emitter_.removeAllListeners('tree');
    this.emitter_ = null;
    this.tree_ = null;
  }
};
