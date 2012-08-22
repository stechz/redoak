// Calculate dependency trees and watch them.
//
// Dependency trees are hierarchical representations of HTML/JS/CSS files.
// Each node looks like: [fileObj, children]. fileObj contains the type of the
// file, the filename, and other data after reading and sometimes parsing the
// file. children are the potential HTML/JS/CSS dependencies of the fileObj.
//
// watch lets you watch the filesystem for any changes to the tree.

var _ = require('underscore');
var fs = require('fs');
var html5 = require('html5');
var jsdom = require('jsdom');
var jsp = require('uglify-js').parser;
var mustache = require('./public/mustache');
var path = require('path');
var queryselector = require('./queryselector');
var sheet = require('Sheet');
var watcher = require('./watcher');

// jsdom options.
var defaultFeatures = {
  // Used for easier scraping.
  QuerySelector: true,

  // No need to fetch anything.
  FetchExternalResources: [],

  // domjs doesn't implement document.write correctly.
  ProcessExternalResources: []
};

// Every tree has these dependencies.
var widgetDependencies =
    ['create.mjs', 'widget.mjs', 'rapid.mjs', 'public/basewidget.js',
     'public/extra.js', 'public/mustache.js']
    .map(function(x) {
  return { type: path.extname(x).substr(1), filename: __dirname + '/' + x };
});

/**
 * Parse HTML into a document structure.
 * @returns Root document element if data is a complete document.
 *          Returns the body element if this data looks like a fragment.
 */
function parseHTML(data) {
  // Some boilerplate to parse the DOM.
  var options = { features: defaultFeatures, parser: html5 };
  var window = jsdom.jsdom(null, null, options).createWindow();
  var document = window.document;
  var parser = new html5.Parser({ document: document });

  var isFragment = true;
  parser.tokenizer = new html5.Tokenizer(data, document);
  parser.setup();

  parser.tokenizer.on('token', function listen(t) {
    if (t.type != 'SpaceCharacters') {
      isFragment = t.type == 'StartTag' && !t.name.match(/^html|head$/i);
    } else {
      parser.tokenizer.removeListener('token', listen);
    }
  });

  parser.tokenizer.tokenize();
  return isFragment ? document.body : document.documentElement;
}

/**
 * Returns array of objects that represent the use elements.  Removes the use
 * elements from the DOM at the same time.
 */
function eatUses(parent) {
  var uses = parent.querySelectorAll('use');
  var result = _.map(uses, function(use) {
    // Process mixins.
    var mixins = use.getAttribute('mixins') || use.getAttribute('mx');
    mixins = mixins.split(' ');

    // Figure out the object that will be passed to the template. The object
    // is determined by other attributes of the use tag and its inner text
    // content.
    var dict = {};
    _(use.attributes).forEach(function(attr) {
      if (attr.name != 'mixins' && attr.name != 'mx') {
        if (attr.value === '') {
          attr.value = true;
        }
        dict[attr.name] = attr.value;
      }
    });
    var obj = use.textContent || '{}';
    try {
      // Augment JSON content with the attributes of use tag.
      var jsonobj = _.extend({}, JSON.parse(obj), dict);
      obj = JSON.stringify(jsonobj);
    } catch(e) {
      // Not a JSON object, so add text content as a value parameter.
      dict.value = use.textContent;
      obj = JSON.stringify(dict);
    }

    var result = _.extend({ mixins: mixins, obj: obj },
                          queryselector.objectify(use, parent));
    use.parentNode.removeChild(use);
    return result;
  });
  result.reverse();
  return result;
}

// Handlers the different directives we may come across.
var fileHandlers = {
  'mjs': function(fileObj, data) {
    return { data: data };
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
          fileObjs.push({ type: types[match[1]], filename: name });
        }
      }
    });

    return { data: data, fileObjs: fileObjs };
  },

  'css': function(fileObj, data) {
    if (!fileObj.process) {
      return { data: data };
    }

    data = data.replace(/\n/g, '');

    var prefixRules = [
        'background-clip', 'background-origin', 'background-size',
        'border-radius', 'border-top-left-radius', 'border-top-right-radius',
        'border-bottom-left-radius', 'border-bottom-right-radius',
        'box-shadow', 'transform', 'transform-origin',
        'transition', 'transition-property', 'transition-duration',
        'transition-timing-function', 'transition-delay',
        'animation', 'animation-property', 'animation-duration',
        'animation-timing-function', 'animation-name', 'animation-delay',
        'animation-direction', 'animation-iteration-count',
        'user-select'];
    prefixRules = _(prefixRules).groupBy(function(s) { return s; });
    // TODO gradients work a little differently in old webkit browsers
    //      http://css-tricks.com/css3-gradients/
    var stylesheet = new sheet.Sheet(data);

    var selectorPrefix = '';

    function addPrefixer(str) {
      return function(prefix) {
        return prefix + str;
      };
    }

    function valueReplacer(cssTokens, value) {
      return function(prefix) {
        var result = value;
        for (var i = 0; i < cssTokens.length; i++) {
          result = result.replace(
              RegExp(cssTokens[i] + '(\\((rgba?(.*?)|.*?)*\\))?'),
              prefix + '$&');
        }
        return result;
      };
    }

    var prefixes = ['-moz-', '-webkit-', '-o-', '-ms-', ''];
    function doStyles(prefix, style) {
      return ['{', _(style).map(function(name) {
        var names = [name];
        var value = style[name];
        var values = [value];

        if (name == 'background-image' || name == 'background') {
          var atoms = ['linear-gradient', 'radial-gradient'];
          values = prefixes.map(valueReplacer(atoms, value));
        } else if (name == 'transition-property' || name == 'transition') {
          var atoms = ['transform'];
          names = prefixes.map(addPrefixer(name));
          values = prefixes.map(valueReplacer(atoms, value));
        }

        if (prefixRules[name]) {
          if (prefix === undefined) {
            names = prefixes.map(addPrefixer(name));
          } else {
            names = [prefix + name];
          }
        }

        if (values[0] == values[1]) {
          values = [values[0]];
        }
        var maxlength = Math.max(names.length, values.length);
        var result = [];
        for (var i = 0; i < maxlength; i++) {
          var namei = Math.min(i, names.length - 1);
          var valuei = Math.min(i, values.length - 1);
          result.push.call(result, names[namei], ':', values[valuei], ';');
        }
        return result;
      }), '}'];
    }

    function doAnimSubRule(prefix, rule) {
      if (rule.cssRules) {
        return [rule.name, '{',
                _(rule.cssRules).map(doAnimSubRule.bind(null, prefix)), '}'];
      } else if (rule.selectorText) {
        return [rule.selectorText, doStyles(prefix, rule.style)];j
      } else {
        return rule.cssText;
      }
    }

    var text = _(stylesheet.cssRules).map(function doRule(rule) {
      if (rule.kind == '@keyframes') {
        function insideText(prefix) {
          return ['{', _(rule.cssRules).map(
              doAnimSubRule.bind(null, prefix)), '}'];
        }
        return ['@-moz-keyframes', rule.name, insideText('-moz-'),
                '@-webkit-keyframes', rule.name, insideText('-webkit-'),
                '@-ms-keyframes', rule.name, insideText('-ms-'),
                '@-o-keyframes', rule.name, insideText('-o-'),
                '@keyframes', rule.name, insideText('')];
      } else if (rule.kind == '@media') {
        return ['@media', rule.name, '{', _(rule.cssRules).map(doRule), '}'];
      } else if (rule.selectorText) {
        var selectorText = selectorPrefix + rule.selectorText;
        return [selectorText, doStyles(undefined, rule.style)];
      } else {
        return rule.cssText;
      }
    });
    return { data: _.flatten(text).join(' ') };
  },

  'resource': function(fileObj, data) {
    return  { data: data };
  },

  'oak': function(fileObj, data) {
    var element = parseHTML(data);
    var document = element.ownerDocument;

    // Gather up templates.
    var templates = []
    _(document.querySelectorAll('template')).forEach(function(template) {
      template.parentNode.removeChild(template);
      var name = template.getAttribute('name');
      if (!name) {
        throw new Error('template but no name');
      }

      // Find all template dependencies.
      var links = template.querySelectorAll(
          'link[rel=stylesheet][href], link[rel=js][href]');
      var dependencies = _(links).map(function(link) {
        link.parentNode.removeChild(link);
        var useOak = !link.hasAttribute('oak-no');
        return {
          process: useOak,
          type: link.getAttribute('rel') == 'js' ? 'js' : 'css',
          filename: link.getAttribute('href'),
          fromTemplate: true
        };
      });

      var elements = [];
      var all = template.querySelectorAll('template *');

      // Find all the unbound variables.

      // unbound will be an array of tuples.
      //   the first item contains unbound data for child nodes.
      //   the second item contains unbound data for attributes.
      //   the third item contains lookup data for all the elements.
      var unboundFilter = function(x) { return x.match(/{{|{#|{\^/); };
      var unbound = _(all).map(function(el, i) {
        if (el.tagName == 'USE') {
          return;
        }
        var childMap = function(x, i) {
          if (x.nodeType != x.TEXT_NODE || !unboundFilter(x.value)) {
            return undefined;
          }
          return { eindex: elements.length, childi: i, value: x.value };
        };
        var attrMap = function(x) {
          if (!unboundFilter(x.value)) {
            return undefined;
          }
          return { eindex: elements.length, aname: x.name, value: x.value };
        };
        var transform = function(things, map) {
          return _.chain(things).map(map).compact().flatten().value();
        };

        var children = transform(el.childNodes, childMap);
        var attrs = transform(el.attributes, attrMap);
        if (attrs.length || children.length) {
          elements.push(el);
          return [children, attrs];
        } else {
          return undefined;
        }
      });
      unbound = _.compact(unbound);

      // Unzip unbound, which will be part of our template data.
      unbound = {
        children: _(_(unbound).pluck('0')).flatten(),
        attrs: _(_(unbound).pluck('1')).flatten()
      };

      // Find element names.
      var nameEls = template.querySelectorAll('*[oak-name]');
      var elementNames = _(nameEls).map(function(el) {
        var name = el.getAttribute('oak-name');
        el.removeAttribute('oak-name');
        elements.push(el);
        return { name: name, eindex: elements.length - 1 };
      });

      // Find all events.
      var events = [];
      for (var j = 0; j < all.length; j++) {
        var attrs = Array.prototype.slice.call(all[j].attributes)
            .filter(function(x) { return x.name.substr(0, 6) === 'oak-on' });

        if (attrs.length) {
          for (var k = 0; k < attrs.length; k++) {
            events.push([elements.length,
                         attrs[k].name.substr(6), attrs[k].value]);
            all[j].removeAttribute(attrs[k].name);
          }
          if (events.length) {
            elements.push(all[j]);
          }
        }
      }

      var uses = eatUses(template);

      unbound.attrs.forEach(function(attr) {
        var attrel = elements[attr.eindex];
        attrel.removeAttribute(attr.aname);
      });
      var qselements = elements.map(function(el) {
        return queryselector.to(el, template);
      });
      unbound.attrs.forEach(function(attr) {
        var attrel = elements[attr.eindex];
        attrel.setAttribute(attr.aname, attr.value);
      });

      var firstElement = (function nextElementSibling(el) {
        while (el && el.nodeType != el.ELEMENT_NODE) {
          el = el.nextSibling;
        }
        return el;
      })(template.firstChild);

      templates.push({
        elementNames: elementNames,
        elements: qselements,
        events: events,
        name: name,
        data: template.innerHTML.replace(/^\s+|\s+$/, ''),
        dependencies: dependencies,
        unbound: unbound,
        uses: uses
      });
    });

    // Gather up remaining scripts and CSS not in templates.
    var includes = document.querySelectorAll(
        'script[src], link[rel=stylesheet][href], link[rel=oak][href]');
    var fileObjs = _(includes).map(function(include) {
      var attr = include.tagName == 'LINK' ? 'href' : 'src';
      var src = include.getAttribute(attr);
      if (src.charAt(0) == '/') {
        // We don't handle absolute paths right now.
        return [];
      }
      var type;
      if (include.tagName == 'SCRIPT') {
        type = 'js';
      } else if (include.getAttribute('rel') == 'stylesheet') {
        type = 'css';
      } else {
        type = 'oak';
      }
      var useOak = !include.hasAttribute('oak-no');
      if (useOak) {
        include.parentNode.removeChild(include);
        return { filename: src , type: type, process: useOak };
      } else {
        return [];
      }
    });

    var out = {};
    out.templates = templates;
    out.isFragment = element != document.documentElement;
    out.document = document;
    out.uses = eatUses(document);
    out.fileObjs = uniq([fileObjs, _(templates).pluck('dependencies')]);
    return out;
  }
};

function uniq(arrays) {
  var map = function(fileObj) { return fileObj.filename; };
  return _.uniq(_.flatten(arrays), false, map);
}

/** Flattens tree to array of dependencies. */
function flatten(tree) {
  // The node looks like [fileObj, children]. We swap the order here, so that
  // when the tree is flattened the leaf nodes come first.
  return uniq([tree[1].map(flatten), tree[0]]);
}

function handleFile(fileObj, data) {
  var result = fileHandlers[fileObj.type](fileObj, data);
  result.fileObjs = _(result.fileObjs).map(function(childFileObj) {
    var extend = {};
    if (childFileObj.filename) {
      var filename = path.resolve(
          path.dirname(fileObj.filename), childFileObj.filename);
      extend = { filename: filename };
    }
    return _.extend({}, childFileObj, extend);
  });
  return result;
}

function handleFileWithCallback(fileObj, data, callback) {
  // Why does the code look so funny? If callback were in the try block and the
  // callback throws an error, the callback would be called twice.
  var result;
  try {
    result = handleFile(fileObj, data);
  } catch(e) {
    return callback(e, null);
  }
  callback(null, result);
}

/** Fetches fileObj if not already in files dictionary. */
function fetch(files, fileObj, callback) {
  if (files[fileObj.filename]) {
    callback(null, files[fileObj.filename]);
  } else if (!fileHandlers[fileObj.type]) {
    callback(new Error('Cannot handle fileObj type'), null);
  } else if (!fileObj.filename) {
    handleFileWithCallback(fileObj, fileObj.data, callback);
  } else {
    fs.readFile(fileObj.filename, 'utf-8', function(err, data) {
      if (err) {
        callback(new Error('Cannot open file.'), null);
      } else {
        handleFileWithCallback(fileObj, data, callback);
      }
    });
  }
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
      fetch(files, childFileObj, function childCallback(err, data) {
        if (err && childFileObj.type == 'js' &&
            path.basename(childFileObj.filename) == 'basewidget.js') {
          // No basewidget.js file in local directory, so it must be referring
          // to redoak's basewidget. Start this particular child fetch over,
          // with the real path to basewidget.js.
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
  addRoot: function(fileObj, callback) {
    var files = _.extend({}, this.files_);
    var roots = _.pluck(this.tree_[1], '0');
    roots.push(fileObj);
    build(roots, files, function(t) {
      callback(new Tree(files, t));
    });
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
      callback(new Tree(files, t));
    });
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
    return flatten([[], children]).map(function(f) {
      return _.extend({}, f, this.data(f));
    }.bind(this));
  },

  /** Flatten out to unique array of file objects with their data. */
  flatten: function() {
    return _.compact(flatten(this.tree_)).map(function(f) {
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

module.exports.parseHTML = parseHTML;
module.exports.tree = tree;
module.exports.watch = watch;
module.exports.unwatch = unwatch;

if (require.main === module) {
  var testData = {
    'test.oak': '<template name="bar">' +
                '<link rel="js" href="basewidget.js">' +
                '<link rel="stylesheet" href="test.css">' +
                '<div>Some template</div></template>',
    'use.oak': '<link rel="oak" href="test.oak"><use name="bar"></use>',
    'test.css': 'body { background-color: white; }'
  };

  var files = {};
  for (var i in testData) {
    var filename = __dirname + '/' + i;
    var fileObj = { filename: filename, type: path.extname(i).substr(1) };
    files[filename] = handleFile(fileObj, testData[i]);
  }

  var assert = require('assert');
  var testOakData = files[__dirname + '/test.oak'];
  var template = testOakData.templates[0];
  assert.equal(template.name, 'bar');
  assert.equal(template.data, '<div>Some template</div>');
  assert.equal(testOakData.fileObjs.length, 2);

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
        tree.data({ filename: __dirname + '/public/basewidget.js' }).data);
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
