// Calculate dependency trees and watch them.
//
// Dependency trees are hierarchical representations of HTML/JS/CSS files.
// Each node looks like: [fileObj, children].
// * see fileobj.js for more information about file objects.
//   These file objects don't contain the parsing data. That is kept in a
//   separate dictionary.
// * children are the potential HTML/JS/CSS dependencies of the fileObj.

var _ = require('underscore');
var assert = require('assert');
var fileobj = require('./fileobj');
var handlebars = require('./handlebars');
var mustache = require('./public/mustache');
var path = require('path');
var queryselector = require('./queryselector');
var watcher = require('./watcher');

// Every tree has these dependencies.
var widgetDependencies =
    ['create.mjs', 'widget.mjs', 'rapid.mjs', 'public/widget.js',
     'public/extra.js', 'public/mustache.js']
    .map(function(x) {
  return { type: path.extname(x).substr(1), filename: __dirname + '/' + x };
});

/** Robust way to operate on a mustache AST tree. */
function mustacheOperate(fns, ast, state) {
  return (function helper(state, ast) {
    if (Array.isArray(ast)) {
      var helperfn = helper.bind(null, state);
      return fns.stmts ? fns.stmts(ast, state, helper) : ast.map(helperfn);
    } else if (typeof ast == 'string') {
      return fns.content ? fns.content(ast, state) : ast;
    } else if (typeof ast == 'object') {
      if (ast.type == 'unbound') {
        return fns.unbound ? fns.unbound(ast, state) : ast;
      } else if (ast.type == 'loop') {
        return fns.loop ? fns.loop(ast, state, helper) : ast;
      } else if (ast.type == 'inversion') {
        return fns.inversion ? fns.inversion(ast, state, helper) : ast;
      } else {
        throw new Error('invalid ast: ' + JSON.stringify(ast));
      }
    } else {
      throw new Error('invalid ast: ' + JSON.stringify(ast));
    }
  })(state, ast);
}

/** If path is 'a.b.c' return `obj.a.b.c`. */
function findPath(obj, path) {
  var paths = path.split('.');
  for (var i = 0; i < paths.length; i++) {
    obj = obj[paths[i]];
    if (!obj) {
      return undefined;
    }
  }
  return obj;
}

/** Binds all unbound variables using lookupFn. */
function bindAst(lookupFn, ast) {
  var lookup = function(name, state) {
    while (state.length) {
      var result = lookupFn(state.join('.') + name);
      if (result) {
        return result;
      }
      state.pop();
    }
    return lookupFn(name);
  };

  var transforms = {
    stmts: function(ast, state) {
      var stmts = ast.map(function(ast) {
        return mustacheOperate(transforms, ast, state);
      });

      if (stmts.every(function(s) { return typeof s == 'string'; })) {
        return stmts.join('');
      } else {
        return stmts;
      }
    },

    unbound: function(ast, state) {
      var bound = lookup(ast.name, state);
      if (bound !== undefined) {
        return bound;
      } else {
        return ast;
      }
    },

    loop: function(ast, state) {
      var bound = lookup(ast.name, state);
      if (bound !== undefined) {
        if (Array.isArray(bound)) {
          return ast.map(function(obj) {
            return mustacheOperate(transforms, ast, state.concat(ast.name));
          });
        } else if (bound) {
          return mustacheOperate(transforms, ast, state.concat(ast.name));
        } else {
          return '';
        }
      } else {
        return ast;
      }
    },

    inverted: function(ast, state) {
      var bound = lookup(ast.name, state);
      return bound ? '' : mustacheOperate(transforms, ast, state);
    }
  };

  return mustacheOperate(transforms, ast, []);
}

/** Builds a tree structure given root file objects and file dictionary. */
function build(roots, files, callback) {
  (function recurse(fileObj, fileObjs, cycles, callback) {
    if (fileObj.filename) {
      if (cycles[fileObj.filename]) {
        return callback([fileObj, []]);
      } else {
        cycles = Object.create(cycles);
        cycles[fileObj.filename] = true;
      }
    }

    if (!fileObjs.length) {
      return callback([fileObj, []]);
    }

    var total = fileObjs.length;
    var childResults = new Array(total);
    fileObjs.forEach(function(childFileObj, i) {
      fileobj.fetch(files, childFileObj, function childCallback(err, data) {
        if (err && childFileObj.type == 'js' &&
            path.basename(childFileObj.filename) == 'widget.js') {
          // No widget.js file in local directory, so it must be referring
          // to redoak's basewidget. Start this particular child fetch over,
          // with the real path to widget.js.
          childFileObj = [];
          data = { fileObjs: widgetDependencies };
        } else if (err) {
          data = { error: err, fileObjs: [] };
        }

        if (childFileObj.filename) {
          files[childFileObj.filename] = data;
        } else if (childFileObj.data) {
          _.extend(childFileObj, data);
        }

        recurse(childFileObj, data.fileObjs, cycles, function(t) {
          childResults[i] = t;
          if (--total == 0) {
            callback([fileObj, childResults]);
          }
        });
      });
    });
  })([], roots, {}, callback);
}

/**
 * Expands a DOM subtree with its template dependencies.
 *
 * @param templates Reference of templates that can be applied.
 * @param node HTML template element or any element that needs to be expanded.
 * @param uses Use JSON structure from template.
 * @param view Transform unbound variables using render function.
 * @param render The function that will render the template with the given
 *               view and the view defined in uses.
 * @return Expanded uses structure. These qsis defines where the children
 *         widget elements are.
 */
function expandDOM(templates, node, uses, view, render) {
  var templateFor = function(use) {
    // Use the last mixin that matches a template.
    return use.mixins.reduce(function(x, y) {
      var index = _(templates).pluck('name').indexOf(y);
      return index >= 0 ? templates[index] : x;
    }, null);
  };

  var callbacks = uses.map(function(use, i) {
    // Map to a template. Use the last mixin to match a template.
    var template = templateFor(use);
    if (!template) {
      // TODO: post error system
      console.error('Cannot find template for use.', use.mixins);
      return null;
    }

    var obj;
    var jsonstr = mustache.to_html_unbound(use.obj, view);
    try {
      obj = JSON.parse(jsonstr);
    } catch(e) {
      console.error('Could not parse JSON for use.', jsonstr);
      return null;
    }
    var newView = _.extend(obj, view);

    var html;
    var data = template.uses.length ? template.expandedData: template.data;
    html = render(data, newView);

    var div = node.ownerDocument.createElement('div');
    div.innerHTML = html;

    var el = div.firstChild;
    while (el.nodeType != el.ELEMENT_NODE) {
      el = el.nextSibling;
    }

    // Insert into DOM.
    queryselector.inject(el, node, use);
    if (el.parentNode == div) {
      // TODO: post error system
      console.error('Queryselector inject did not work.', use);
      return null;
    }

    // Construct the QS must be done after everything is injected.
    return function() {
      var qsobj = queryselector.to(el, node);
      return _.extend({}, use, qsobj);
    };
  });

  return _(callbacks).compact().map(function(f) { return f(); });
}

/** Find all the templates in the tree. */
function allTemplates(tree) {
  var oakFilter = function(d) { return d.type == 'oak' && d.templates; };
  var fileObjs = tree.flatten();
  return (_.chain(fileObjs).filter(oakFilter).pluck('templates').flatten()
           .value());
}

/** TODO */
function tree(roots, callback) {
  var files = {};
  var firstTree = new Tree(
      files, [[], roots.map(function(x) { return [x, []]; })]);
  firstTree.recalculate(null, function(t) {
    callback(t);
  });
}

/** TODO */
function Tree(files, tree) {
  this.files_ = files;
  this.tree_ = tree;
}

Tree.prototype = {
  expand_: function() {
    var templates = _.flatten(allTemplates(this));
    templates.forEach(function(template) {
      var div = template.document.createElement('div');
      div.innerHTML = template.data;

      var expandedUses = expandDOM(
          templates, div.firstChild, template.uses, {},
          mustache.to_html_unbound);
      var ast = handlebars.mparse(template.data);
      template.ast = bindAst(findPath.bind(null, {}), ast);
      template.expandedUses = expandedUses;
      template.expandedData = div.innerHTML;
    });
  },

  addRoot: function(fileObj, callback) {
    var files = _.extend({}, this.files_);
    var roots = _.pluck(this.tree_[1], '0');
    roots.push(fileObj);
    build(roots, files, function(t) {
      var t = new Tree(files, t);
      t.expand_();
      callback(t);
    }.bind(this));
  },

  recalculate: function(fileObj, callback) {
    var files = _.extend({}, this.files_);
    if (fileObj && fileObj.filename) {
      if (files[fileObj.filename]) {
        delete files[fileObj.filename];
      }
    }

    var roots = _.pluck(this.tree_[1], '0');
    build(roots, files, function(t) {
      var t = new Tree(files, t);
      t.expand_();
      callback(t);
    }.bind(this));
  },

  /** Finds data object for given file. */
  data: function(fileObj) {
    var data = {};
    var subtree = this.subtree(fileObj);
    if (subtree && subtree.tree_[0].filename) {
      data = this.files_[subtree.tree_[0].filename];
    }
    return _.extend({}, fileObj, (subtree ? subtree.tree_[0] : {}), data);
  },

  /** Creates tree that only contains root node's oak dependencies. */
  oakDependencies: function() {
    var tree = this.subtree();
    var files = this.files_;
    var treeJson = (function build(node) {
      var data = files[node[0].filename];
      if (data && data.templates && node[0].type == 'oak') {
        var oakChildren = node[1].filter(function(x) {
          return (x[0].type == 'oak' || x[0].fromTemplate ||
                  x[0].length === 0 ||
                  node[0].filename == tree.tree_[0].filename);
        });
        return [node[0], oakChildren.map(build)];
      } else {
        return node.slice();
      }
    })(tree.tree_);
    return new Tree(files, treeJson);
  },

  /** Finds the subtree whose root filename matches given object's filename. */
  subtree: function(fileObj) {
    if (!fileObj) {
      if (this.tree_[0].filename || this.tree_[0].data) {
        return new Tree(this.files_, this.tree_);
      } else if (this.tree_[1].length == 1 && (
          this.tree_[1][0][0].filename || this.tree_[1][0][0].data)) {
        return new Tree(this.files_, this.tree_[1][0]);
      } else {
        throw new Error('No fileObj specified, and could not make a guess.');
      }
    }

    if (!fileObj.filename) {
      return null;
    }

    var nodes = [this.tree_];
    while (nodes.length) {
      var node = nodes.shift();
      if (node && node[0].filename == fileObj.filename) {
        return new Tree(this.files_, node);
      } else if (node) {
        nodes.push.apply(nodes, node[1]);
      }
    }
    return null;
  },

  children: function() {
    var children = this.tree_[1].map(function(n) { return [n[0], []]; });
    return fileobj.flatten([[], children]).map(function(f) {
      return _.extend({}, f, this.data(f));
    }.bind(this));
  },

  /** Flatten out to unique array of file objects with their data. */
  flatten: function() {
    return _.compact(fileobj.flatten(this.tree_)).map(function(f) {
      return _.extend({}, f, this.data(f));
    }.bind(this));
  }
};

/** Watches for changes for file objects and their dependencies. */
function watch(tree, callback) {
  var listeners = [];
  var unwatch = function() {
    listeners.forEach(function(l) { watcher.unwatch.apply(watcher, l); });
    listeners = null;
  };

  (function dep(tree, fileObj) {
    tree.recalculate(fileObj, function(newTree) {
      if (listeners === null) {
        // Called unwatch while we were generating the tree.
        return;
      }

      unwatch();
      listeners = _.compact(newTree.flatten().map(function(fileObj) {
        if (fileObj.filename) {
          var fn = dep.bind(this, newTree, fileObj);
          watcher.watch(fileObj.filename, fn);
          return [fileObj.filename, fn];
        }
      }));

      if (fileObj) {
        callback(newTree);
      }
    });
  })(tree);

  return unwatch;
}

/** Stops watching. */
function unwatch(handle) {
  handle();
}

module.exports.allTemplates = allTemplates;
module.exports.expandDOM = expandDOM;
module.exports.tree = tree;
module.exports.watch = watch;
module.exports.unwatch = unwatch;

if (require.main === module) {
  var testData = {
    'test.oak': '<template name="bar">' +
                '<link rel="js" href="widget.js">' +
                '<link rel="stylesheet" href="test.css">' +
                '<div>Some template</div></template>',
    'use.oak': '<link rel="oak" href="test.oak"><use name="bar"></use>',
    'test.css': 'body { background-color: white; }'
  };

  var files = {};
  for (var i in testData) {
    var filename = __dirname + '/' + i;
    var fileObj = { filename: filename, type: path.extname(i).substr(1) };
    files[filename] = fileobj.handleFile(fileObj, testData[i]);
  }

  var testOakData = files[__dirname + '/test.oak'];
  var cssFileObj = { filename: __dirname + '/test.css', type: 'css' };
  var testOakFileObj = { filename: __dirname + '/test.oak', type: 'oak' };
  var rootFileObj = { filename: __dirname + '/use.oak', type: 'oak' };
  build([rootFileObj], files, function(t) {
    (function test(n) {
      assert(n.length == 2);
      assert(!Array.isArray(n[0]) || n[0].length == 0);
      assert(Array.isArray(n[1]));
      n[1].forEach(test);
    })(t);

    var tree = new Tree(files, t);

    assert.ok(
        tree.data({ filename: __dirname + '/public/widget.js' }).data);
    assert.ok(tree.data({ filename: __dirname + '/widget.mjs' }).data);
    assert.ok(tree.data({ filename: __dirname + '/rapid.mjs' }).data);
    assert.ok(tree.data({ filename: __dirname + '/create.mjs' }).data);

    assert.strictEqual(tree.data(testOakFileObj).templates,
                       testOakData.templates);

    assert.strictEqual(tree.data(cssFileObj).data,
                       files[cssFileObj.filename].data);

    var fileObjs = tree.flatten();
    assert.equal(fileObjs.length, 10);
  });
}
