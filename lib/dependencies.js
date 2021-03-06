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
var fileobj = require('./fileobj/fileobj');
var oakstache = require('./oakstache/handler');
var path = require('path');
var queryselector = require('./queryselector');
var watcher = require('./watcher');

// Every tree has these dependencies.
var widgetDependencies =
    ['templates/create.mjs', 'templates/widget.mjs', 'templates/rapid.mjs',
    'templates/htmljs.wjs', 'public/widget.js', 'public/extra.js',
    'templates/fill.wjs']
    .map(function(x) {
  return { type: path.extname(x).substr(1), filename: __dirname + '/' + x };
});

function buildSync(roots, files) {
  return (function recurse(fileObj, fileObjs, cycles) {
    if (fileObj.filename) {
      if (cycles[fileObj.filename]) {
        return callback([fileObj, []]);
      } else {
        cycles = Object.create(cycles);
        cycles[fileObj.filename] = true;
      }
    }

    if (!fileObjs.length) {
      return [fileObj, []];
    }

    return [fileObj, fileObjs.map(function(childFileObj, i) {
      var data = fileobj.fetchSync(files, childFileObj);
      var widgetJsFilename = path.resolve(__dirname, 'public', 'widget.js');
      if (!data && childFileObj.type == 'js' &&
            path.basename(childFileObj.filename) == 'widget.js' &&
            childFileObj.filename != widgetJsFilename) {
        // No widget.js file in local directory, so it must be referring to
        // redoak's widget. Start this particular child fetch over, with the
        // real path to widget.js.
        childFileObj = [];
        data = { fileObjs: widgetDependencies };
      } else if (!data) {
        data = { error: new Error(), fileObjs: [] };
      }

      if (childFileObj.filename) {
        files[childFileObj.filename] = data;
      } else if (childFileObj.data) {
        _.extend(childFileObj, data);
      }

      return recurse(childFileObj, data.fileObjs, cycles);
    })];
  })([], roots, {});
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
        var widgetJsFilename = path.resolve(__dirname, 'public', 'widget.js');
        if (err && childFileObj.type == 'js' &&
            path.basename(childFileObj.filename) == 'widget.js' &&
            childFileObj.filename != widgetJsFilename) {
          // No widget.js file in local directory, so it must be referring to
          // redoak's widget. Start this particular child fetch over, with the
          // real path to widget.js.
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

function buildForTesting(filenameToData) {
  var files = {};
  for (var i in filenameToData) {
    var filename = __dirname + '/' + i;
    files[filename] = fileobj.handleFile(filename, filenameToData[i]);
  }

  var rootFilename = __dirname + '/' + Object.keys(filenameToData)[0];
  var rootFileObj = { type: 'oak', filename: rootFilename };
  var t = buildSync([rootFileObj], files);
  (function test(n) {
    assert(n.length == 2);
    assert(!Array.isArray(n[0]) || n[0].length == 0);
    assert(Array.isArray(n[1]));
    n[1].forEach(test);
  })(t);

  var tree = new Tree(files, t);
  tree.expand_();
  return tree;
}

function useElementToJson(use) {
  // Process mixins.
  var mixinsStr = use.getAttribute('mixins') || use.getAttribute('mx');
  var mixinsArr = mixinsStr.split(' ');

  // Figure out the object that will be passed to the template. The object
  // can be specified with attributes in the use tag and recursive 'obj'
  // elements inside the tag.
  var dict = (function recurse(el) {
    var dict = {};

    // Array of elements in the 'children' property.

    var children = [];
    while (el.querySelector('> obj')) {
      var objEl = el.querySelector('> obj');
      el.removeChild(objEl);
      children.push(recurse(objEl));
    }

    if (children.length) {
      dict.children = children;
    }

    if (el.innerHTML) {
      dict.value = el.innerHTML;
    }

    // Generic attributes of obj.

    _(el.attributes).forEach(function(attr) {
      if (attr.name != 'mixins' && attr.name != 'mx') {
        if (attr.value === '') {
          attr.value = true;
        }
        dict[attr.name] = attr.value;
      }
    });

    return dict;
  })(use);

  var result = {
    mixins: mixinsArr,
    mixinsAst: oakstache.parse(mixinsStr),
    obj: JSON.stringify(dict),
    openBlocks: _(use.oakOpenBlocks).toArray()
  };
  return result;
}

/**
 * Expands a DOM subtree with its template dependencies.
 *
 * @param templates Reference of templates that can be applied.
 * @param node HTML template element or any element that needs to be expanded.
 * @param view Transform unbound variables using render function.
 * @param render The function that will render the template AST with the given
 *               view and the view defined in uses.
 * @return Array of expanded elements with use information.
 */
function expandDOMForElement(templates, node, view, render) {
  var templateFor = function(use, view) {
    // Use the last mixin that matches a template.
    return use.mixins.reduce(function(x, y) {
      var index = _(templates).pluck('name').indexOf(y);
      return index >= 0 ? templates[index] : x;
    }, null);
  };

  var beforeExpandUses = node.querySelectorAll('use');
  var result =  _.flatten(_(beforeExpandUses).map(function(useEl) {
    if (useEl == node) {
      return;
    }

    var use = useElementToJson(useEl);

    var obj;
    var jsonstr = oakstache.renderStringUnbound(use.obj, view);
    try {
      obj = JSON.parse(jsonstr);
    } catch(e) {
      console.error('Could not parse JSON for use.', jsonstr);
      return null;
    }
    var newView = _.extend(obj, view);

    // Map to a template. Use the last mixin to match a template.
    var template = templateFor(use, newView);
    if (!template && use.mixinsAst.length === 1 &&
        typeof use.mixinsAst[0] == 'string') {
      // TODO: post error system
      console.error('Cannot find template for use.', use.mixins);
      return null;
    }

    var results = [];
    if (template) {
      var data = template.hasUses ? template.expandedData : template.data;
      var html = render(data, newView);
      var div = node.ownerDocument.createElement('div');
      div.innerHTML = html;

      var el = div.firstChild;
      while (el.nodeType != el.ELEMENT_NODE) {
        el = el.nextSibling;
      }

      var newUses = el.querySelectorAll('use');
      useEl.parentNode.replaceChild(el, useEl);

      if (newUses.length > 0) {
        results = expandDOMForElement(templates, el, newView, render);
      }
    } else {
      el = useEl;
    }

    // Constructing the QS must be done after everything is injected.
    return results.concat([{ element: el, use: use }]);
  }));
  return result;
}

function expandDOM(templates, node, view, render) {
  var finalResolve = render('{test}', {}) === '';
  var data = expandDOMForElement(templates, node, view, render);

  // Constructing the QS must be done after everything is injected.
  return data.map(function(useAndElement) {
    var use = useAndElement.use;
    var element = useAndElement.element;
    var qsobj = queryselector.to(element, node);
    var result = _.extend({}, use, qsobj, { mixins: use.mixins });
    if (element.tagName == 'USE' && finalResolve) {
      // On the final resolve, the use tags should disappear.
      element.parentNode.removeChild(element);
    }
    return result;
  });
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
          templates, div.firstChild, {}, oakstache.renderStringUnbound);
      template.expandedUses = expandedUses;
      template.expandedData = div.innerHTML;
      template.ast = oakstache.parse(template.expandedData, {});
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
module.exports.buildForTesting = buildForTesting;
module.exports.expandDOM = expandDOM;
module.exports.tree = tree;
module.exports.watch = watch;
module.exports.unwatch = unwatch;

if (require.main === module) {
  var testData = {
    'use.oak': '<link rel="oak" href="test.oak"><use name="bar"></use>',
    'test.oak': '<template name="bar">' +
                '<link rel="js" href="widget.js">' +
                '<link rel="stylesheet" href="test.css">' +
                '<div>Some template</div></template>',
    'test.css': 'body { background-color: white; }'
  };

  var tree = buildForTesting(testData);
  var cssFileObj = { filename: __dirname + '/test.css', type: 'css' };
  var testOakFileObj = { filename: __dirname + '/test.oak', type: 'oak' };

  // Ensure file dependencies have been put into the tree.
  (function fn(name) {
    try {
      assert.ok(tree.data({ filename: __dirname + '/' + name }).data);
    } catch(e) {
      console.error('Could not find ' + __dirname + '/' + name);
      console.error(JSON.stringify(tree.tree_, 0, 2));
      console.error(tree.files_[__dirname + '/' + name]);
      throw e;
    }
    return fn;
  })
  ('public/widget.js')
  ('templates/widget.mjs')
  ('templates/rapid.mjs')
  ('templates/create.mjs')
  ('templates/htmljs.wjs');

  assert.equal(tree.data(testOakFileObj).templates.length, 1);
  assert.strictEqual(tree.data(cssFileObj).data, testData['test.css']);

  var fileObjs = tree.flatten();
  assert.equal(fileObjs.length, 11);
}
