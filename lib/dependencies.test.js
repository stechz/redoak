var assert = require('assert');
var dependencies = require('./dependencies');
var mockfs = require('./mocks/fs');
var vows = require('vows');
var watcher = require('./watcher');

var mockfs = require('./mocks/fs');
dependencies.__fs = mockfs;
watcher.__fs = mockfs;

// Note that since mockfs works asynchronously, results are available
// immediately after calls to dependencies or after changing a file on our
// mock filesystem.

vows.describe('dependencies').addBatch({
  'normal': {
    topic: function() {
      var tree = null;
      dependencies.dependencies(
          { name: 'path/to/js/main.js', type: 'js' }, {},
          function(t) { tree = t; });
      return tree;
    },

    'is an array': function(tree) {
      assert.instanceOf(tree, Array);
    },

    'root is main.js': function(tree) {
      assert.equal(tree[0].name, process.cwd() + '/path/to/js/main.js');
      assert.equal(tree[0].type, 'js');
    },

    'children of root are other.js and other2.js': function(tree) {
      var child1 = tree[1][0];
      var child2 = tree[1][1];
      assert.equal(child1[0].name, process.cwd() + '/path/to/js/other.js');
      assert.equal(child2[0].name, process.cwd() + '/path/to/js/other2.js');
    },

    'children of those are both other.html': function(tree) {
      var child11 = tree[1][0][1][0];
      var child21 = tree[1][1][1][0];
      assert.equal(child11[0].name, process.cwd() + '/path/to/js/other.html');
      assert.equal(child21[0].name, process.cwd() + '/path/to/js/other.html');
    },

    'flatten is correct': function(tree) {
      var flatten = dependencies.flatten(tree, {});
      assert.equal(flatten[0].name, process.cwd() + '/path/to/js/other.html');
      assert.equal(flatten[1].name, process.cwd() + '/path/to/js/other.js');
      assert.equal(flatten[3].name, process.cwd() + '/path/to/js/other2.js');
      assert.equal(flatten[4].name, process.cwd() + '/path/to/js/main.js');
    }
  },

  'watch': {
    topic: function() {
      this.clear = function() {
        this.tree = null;
        this.fileObj = null;
      };

      this.watchCallback = function(tree, fileObj) {
        this.tree = tree;
        this.fileObj = fileObj;
      }.bind(this);

      dependencies.watch(
          { name: 'path/to/js/main.js', type: 'js' }, this.watchCallback);
      return {};
    },

    'first callback happens': function() {
      assert.equal(this.fileObj.name, process.cwd() + '/path/to/js/main.js');
    },

    'poking main.js works': function() {
      this.clear();
      mockfs.$pokeFile(process.cwd() + '/path/to/js/main.js');
      assert.equal(this.fileObj.name,
                   process.cwd() + '/path/to/js/main.js');
    },

    'poking other.js works': function() {
      this.clear();
      mockfs.$pokeFile(process.cwd() + '/path/to/js/other.js');
      assert.equal(this.fileObj.name,
                   process.cwd() + '/path/to/js/other.js');
    },

    'callback is given root tree': function() {
      this.clear();
      mockfs.$pokeFile(process.cwd() + '/path/to/js/other.js');
      assert.equal(this.tree[0].name, process.cwd() + '/path/to/js/main.js');
    },

    'watch gets new data': function() {
      this.clear();

      // Keep old other.html string around.
      var old;
      mockfs.readFile(process.cwd() + '/path/to/js/other.html', null,
                      function(err, data) { old = data; });
      assert.isDefined(old);
      mockfs.$setupFile('path/to/js/other.html', null, 'this is new data');

      try {
        mockfs.$pokeFile(process.cwd() + '/path/to/js/other.html');
        assert.equal(this.tree[1][0][1][0][0].data, 'this is new data');
      } finally {
        mockfs.$setupFile('path/to/js/other.html', null, old);
      }
    },

    'cannot unwatch sub nodes': function() {
      dependencies.unwatch(this.tree[1][0][0], this.watchCallback);
      this.clear();
      mockfs.$pokeFile(process.cwd() + '/path/to/js/other.js');
      assert.isNotNull(this.fileObj);
    },

    'unwatch works': function() {
      dependencies.unwatch(this.tree[0], this.watchCallback);
      this.clear();
      assert.throws(function() {
        mockfs.$pokeFile(process.cwd() + '/path/to/js/main.js');
      }, Error);
    },

    'for multiple trees': {
      topic: function() {
        this.watchCallbackMain = function(tree, fileObj) {
          this.mainTree = tree;
          this.mainFileObj = fileObj;
        }.bind(this);
        this.watchCallbackOther = function(tree, fileObj) {
          this.otherTree = tree;
          this.otherFileObj = fileObj;
        }.bind(this);
        dependencies.watch(
            { name: 'path/to/js/main.js', type: 'js' }, this.watchCallbackMain);
        dependencies.watch(
            { name: 'path/to/js/other.js', type: 'js' },
            this.watchCallbackOther);
        return data;
      },

      'unwatching parent tree does not affect subtree': function() {
        dependencies.unwatch(this.mainTree[0], this.watchCallbackMain);
        assert.isFalse(
            mockfs.$isFileWatched(process.cwd() + '/path/to/js/main.js'));
        assert.isTrue(
            mockfs.$isFileWatched(process.cwd() + '/path/to/js/other.js'));
      }
    }
  }
}).export(module);
