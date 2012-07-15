var events = require('events');
var html5 = require('html5');
var fs = require('fs');
var jsdom = require('jsdom');
var jsp = require('uglify-js').parser;
var mustache = require('mustache');
var path = require('path');
var watcher = require('./watcher');

// Used for watching trees.
var emitter = new events.EventEmitter();

// jsdom options.
var defaultFeatures = {
  // Used for easier scraping.
  QuerySelector: true,

  // No need to fetch anything.
  FetchExternalResources: [],

  // domjs doesn't implement document.write correctly.
  ProcessExternalResources: []
};

function describeNode(el) {
  var str = el.tagName;
  if (el.className) {
    str += el.className.replace(/^|\s+/g, '.');
  }
  return str;
}

function constructQS(element, ancestor) {
  var el = element;
  var selectors = [];
  var lastParent = null;
  while (el != ancestor) {
    selectors.unshift(describeNode(el));
    lastParent = el;
    el = el.parentNode;
  }

  var str = selectors.join(' > ');
  var test = lastParent.querySelectorAll(str);
  if (test.length > 1) {
    throw 'Could not create unique CSS selector for node.';
  }
  if (test[0] != element) {
    throw ('Unexpected error: constructed selector does not work (' +
           str + ').');
  }
  return str;
}

// Every tree has these dependencies.
var basicDependencies =
    ['generated.mjs', 'rapid.js', 'basewidget.js', 'mustache.js']
    .map(function(x) {
  return {
    type: path.extname(x).substr(1),
    name: x,
    filename: __dirname + '/public/' + x
  };
});

// Handlers the different directives we may come across.
var fileHandlers = {
  'mjs': function(fileObj, data) {
    fileObj.data = data;
    return [];
  },

  'js': function(fileObj, data) {
    var ast = jsp.parse(data);

    // AST looks like ['toplevel', [ -- statements -- ]].
    // Only look through toplevel for directives.
    var fileObjs = [];
    var types = { require: 'js' };
    ast[1].forEach(function(stmt) {
      if (stmt[0]  == 'directive') {
        var match = stmt[1].match(/^(.*)? (.*)/);
        if (match && types[match[1]]) {
          var name = match[2];
          fileObjs.push({ type: types[match[1]], name: name });
        }
      }
    });

    fileObj.data = data;
    return fileObjs;
  },

  'resource': function(fileObj, data) {
    fileObj.data = data;
    return [];
  },

  'oak': function(fileObj, data) {
    // Some boilerplate to parse the DOM.
    var options = { features: defaultFeatures, parser: html5 };
    var window = jsdom.jsdom(null, null, options).createWindow();
    var document = window.document;
    var parser = new html5.Parser({ document: document });
    parser.parse(data);

    // Gather up scripts.
    var fileObjs = [].concat(basicDependencies);
    var includes = document.querySelectorAll(
        'script[src], template[src], link[rel=stylesheet][href]');
    for (var i = 0; i < includes.length; i++) {
      var attr = includes[i].tagName == 'LINK' ? 'href' : 'src';
      var src = includes[i].getAttribute(attr);
      var type = path.extname(src) == '.js' ? 'js' : 'resource';
      if (type == 'js') {
        includes[i].parentNode.removeChild(includes[i]);
      }
      fileObjs.push({ name: src , type: type });
    }

    // Gather up CSS.
    var css = [];
    var styles = document.querySelectorAll('template > style');
    for (var i = 0; i < styles.length; i++) {
      styles[i].parentNode.removeChild(styles[i]);
      var content = styles[i].textContent;
      css.push(content);
    }
    fileObj.css = css.join('\n');

    // Gather up templates.
    fileObj.templates = {};

    var templates = document.querySelectorAll('template');
    for (var i = 0; i < templates.length; i++) {
      // Find all events.
      var events = [];
      var all = templates[i].querySelectorAll('*');
      for (var j = 0; j < all.length; j++) {
        var attrs = Array.prototype.slice.call(all[j].attributes)
            .filter(function(x) { return x.name.substr(0, 6) === 'oak-on' });

        if (attrs.length) {
          var qs = constructQS(all[j], templates[i]);
          for (var k = 0; k < attrs.length; k++) {
            events.push([qs, attrs[k].name.substr(6), attrs[k].value]);
            all[j].removeAttribute(attrs[k].name);
          }
        }
      }

      templates[i].parentNode.removeChild(templates[i]);
      var name = templates[i].getAttribute('name');
      if (!name) {
        fileObj.error = 'template but no name';
        return [];
      }
      fileObj.templates[name] = {
        events: events,
        data: templates[i].innerHTML.replace(/^\s+|\s+$/, '')
      };
    }

    if (fileObj.root) {
      fileObj.document = document;
    }
    return fileObjs;
  }
};

/**
 * Constructs dependency tree for given file object.
 *
 * The tree consists of JS, resources, and errors. JS files are currently the
 * only type that can specify other dependencies. We read the JS files, parse
 * them, and then apply the same procedure to its dependencies.
 *
 * @param fileObj { name: 'some_filename', type: 'js|resource' }
 *                Modified in place.
 * @param cycles Tracks cycles as we discover the tree so that we don't end up
 *               in any infinite loops.
 * @param callback callback(tree)
 *                 Tree is an array where the first object is the file object.
 *                 If 'resource' type, node has 'data' with file contents.
 *                 If an error occurred, node has 'error' property.
 *                 Second element is an array with the dependencies.
 */
function dependencies(fileObj, cycles, callback) {
  if (!fileHandlers[fileObj.type]) {
    fileObj.error = 'Do not know how to handle this type.';
    return callback([fileObj, []]);
  }
  if (!fileObj.filename)  {
    fileObj.filename = path.resolve(fileObj.name);
  }
  if (!Object.keys(cycles).length) {
    fileObj.root = true;
  }
  if (cycles[fileObj.filename]) {
    fileObj.error = 'Cyclic dependency.';
    return callback([fileObj, []]);
  }
  cycles = Object.create(cycles);
  cycles[fileObj.name] = true;

  fs.readFile(fileObj.filename, 'utf-8', function(err, data) {
    if (err) {
      fileObj.error = 'Could not open file.';
      callback([fileObj, []]);
    }

    var fileObjs = [];
    try {
      fileObjs = fileHandlers[fileObj.type](fileObj, data);
    } catch(e) {
      fileObj.error = e.toString();
    }

    if (fileObjs.length) {
      var childResults = [];
      fileObjs.forEach(function(childFileObj) {
        if (!childFileObj.filename) {
          childFileObj.filename = path.resolve(
              path.dirname(fileObj.filename), childFileObj.name);
        }
        dependencies(childFileObj, cycles, function(t) {
          childResults.push(t);
          if (childResults.length == fileObjs.length) {
            callback([fileObj, childResults]);
          }
        });
      });
    } else {
      callback([fileObj, []]);
    }
  });
}

/** Flattens a dependencies tree into an array. */
function flatten(tree, keysInserted) {
  if (tree.length) {
    var name = tree[0].filename;
    if (keysInserted[name]) {
      return [];
    } else {
      var result = [];
      for (var i = 0; i < tree[1].length; i++) {
        result.push.apply(result, flatten(tree[1][i], keysInserted));
      }
      result.push(tree[0]);
      return result;
    }
  } else {
    return [];
  }
}

/** Renders CSS output given array with some template objects. */
function renderCSS(fileObjs, map) {
  var css = fileObjs.filter(function(x) { return x.type == 'template' });
  var template = '{{#templates}}{{{css}}}\n{{/templates}}';
  return mustache.to_html(template, { templates: css });
}

/**
 * Renders script output given array of deps.
 *
 * @param map Maps file objects to paths on server.
 */
function renderJS(fileObjs, map) {
  var view = {
    scripts: [],
    resources: []
  };

  var generatedTemplate = '';
  for (var i = 0; i < fileObjs.length; i++) {
    if (fileObjs[i].filename == __dirname + '/public/generated.mjs') {
      generatedTemplate = fileObjs[i].data;
    }
    else if (fileObjs[i].type == 'js') {
      view.scripts.push(JSON.stringify(map(fileObjs[i])));
    } else if (fileObjs[i].type == 'oak') {
      var keys = Object.keys(fileObjs[i].templates);
      for (var j = 0; j < keys.length; j++) {
        var template = fileObjs[i].templates[keys[j]];
        var resource;
        if (template.events.length) {
          resource = {
            has_fn: [{
              name: JSON.stringify(keys[j]),
              data: JSON.stringify(template.data),
              stmts: template.events.map(function(x) {
                return {
                  qs: JSON.stringify(x[0]),
                  ename: JSON.stringify(x[1]),
                  fname: JSON.stringify(x[2])
                };
              })
            }]
          };
        } else {
          resource = {
            hasnt_fn: [{
              name: JSON.stringify(keys[j]),
              data: JSON.stringify(template.data),
              has_fn: false
            }]
          };
        }
        view.resources.push(resource);
      }
    }
  }

  if (!generatedTemplate) {
    throw 'generated.js not found or is not a dependency.';
  }

  return mustache.to_html(generatedTemplate, view);
}


/** Call a function for each node in a tree. */
function forEachNode(tree, callback) {
  if (tree.length) {
    callback(tree);
    for (var i = 0; i < tree[1].length; i++) {
      forEachNode(tree[1][i], callback);
    }
  }
}

/** Used by watch and unwatch to stop internal callbacks from running. */
function unwatchTreeHelper(oldTree, callback) {
  forEachNode(oldTree, function(node) {
    var internalCallbacks = watcher.listeners(node[0].filename);
    for (var i = 0; i < internalCallbacks.length; i++) {
      if (internalCallbacks[i].external == callback) {
        watcher.unwatch(node[0].filename, internalCallbacks[i]);
        if (!emitter.listeners(oldTree[0].filename).length) {
          // No one is listening for this tree anymore. It can be deleted.
          delete treesForRoots[oldTree[0].filename];
        }
        return;
      }
    }
  });
}

/** Map from root tree filenames to their latest trees.  */
var treesForRoots = {};

/** Watches for changes for a fileObj and its dependencies. */
function watch(rootFileObj, callback) {
  var name = path.resolve(rootFileObj.name);
  emitter.on(name, callback);
  (function dep(oldTree, fileObj) {
    dependencies(rootFileObj, {}, function(tree) {
      unwatchTreeHelper(oldTree, callback);

      if (emitter.listeners(name).indexOf(callback) == -1) {
        // Tree was unwatched while we were calculating dependencies.
        return;
      }

      // It's OK to override other tree entries, though it's extra work. The
      // important thing is that treesForRoots contains the latest dependency
      // information so that we can unwatch all watched files.
      treesForRoots[name] = tree;

      forEachNode(tree, function(node) {
        var internalCallback = dep.bind(this, tree, node[0]);
        internalCallback.external = callback;
        watcher.watch(node[0].filename, internalCallback);
        if (node.error) {
          modules.exports.emit('error', tree, fileObj);
        }
      });
      emitter.emit(name, tree, fileObj);
    });
  })([], rootFileObj);
}

/** Stops watching fileObj. */
function unwatch(fileObj, callback) {
  var name = path.resolve(fileObj.name);
  emitter.removeListener(name, callback);
  if (treesForRoots[name]) {
    // If treeForRoots is defined, then watch dependencies callback has already
    // occurred. Otherwise, we trust watch to notice the listener is gone.
    unwatchTreeHelper(treesForRoots[name], callback);
  }
}

module.exports = new events.EventEmitter();
Object.defineProperty(module.exports, '__fs',
                      { set: function(x) { fs = x; } });
module.exports.dependencies = dependencies;
module.exports.flatten = flatten;
module.exports.renderCSS = renderCSS;
module.exports.renderJS = renderJS;
module.exports.watch = watch;
module.exports.unwatch = unwatch;
