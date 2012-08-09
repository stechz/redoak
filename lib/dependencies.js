// Calculate dependency trees and watch them.
//
// Dependency trees are hierarchical representations of HTML/JS/CSS files.
// Each node looks like: [fileObj, children]. fileObj contains the type of the
// file, the filename, and other data after reading and sometimes parsing the
// file. children are the potential HTML/JS/CSS dependencies of the fileObj.
//
// watch lets you watch the filesystem for any changes to the tree.

var _ = require('underscore');
var events = require('events');
var fs = require('fs');
var html5 = require('html5');
var jsdom = require('jsdom');
var jsp = require('uglify-js').parser;
var mustache = require('./public/mustache');
var path = require('path');
var queryselector = require('./queryselector');
var sheet = require('Sheet');
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
  parser.tokenizer.once('token', function listen(t) {
    if (t.type != 'SpaceCharacters') {
      isFragment = t.type == 'StartTag' && !t.name.match(/^html|head$/i);
      parser.tokenizer.removeListener('token', listen);
    }
  });
  parser.tokenizer.tokenize();
  return isFragment ? document.body : document.documentElement;
}

// Every tree has these dependencies.
var basicDependencies =
    ['create.mjs', 'widget.mjs', 'public/rapid.js', 'public/basewidget.js',
     'public/extra.js', 'public/mustache.js']
    .map(function(x) {
  return {
    type: path.extname(x).substr(1),
    name: path.basename(x),
    filename: __dirname + '/' + x
  };
});

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

  'css': function(fileObj, data) {
    if (!fileObj.process) {
      fileObj.data = data;
      return [];
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
    fileObj.data = _.flatten(text).join(' ');
    return [];
  },

  'resource': function(fileObj, data) {
    fileObj.data = data;
    return [];
  },

  'oak': function(fileObj, data) {
    var element = parseHTML(data);
    var document = element.ownerDocument;

    // Gather up templates.
    fileObj.templates = [];

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
          name: link.getAttribute('href'),
          type: link.getAttribute('rel') == 'js' ? 'js' : 'css',
          filename: path.resolve(path.dirname(fileObj.filename),
                                 link.getAttribute('href'))
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

      dependencies = dependencies.map(function(d) {
        if (d.type == 'css') {
          d.prefix = queryselector.describeNode(firstElement);
        }
        return d;
      });

      fileObj.templates.push({
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
        return;
      }
      var type;
      if (include.tagName == 'SCRIPT') {
        type = 'js';
      } else if (include.getAttribute('rel') == 'stylesheet') {
        type = 'css';
      } else {
        type = 'oak';
      }
      include.parentNode.removeChild(include);
      var useOak = !include.hasAttribute('oak-no');
      return { name: src , type: type,
               process: useOak,
               filename: path.resolve(path.dirname(fileObj.filename), src) };
    });

    fileObj.isFragment = element != document.documentElement;
    fileObj.document = document;
    fileObj.uses = eatUses(document);
    var uniqMap = function(f) { return f.filename; };
    return _.compact(_.uniq(_.flatten(
        [basicDependencies, fileObjs,
        _(fileObj.templates).pluck('dependencies')]), uniqMap));
  }
};

/**
 * Constructs dependency tree for given file object.
 *
 * The tree consists of JS, resources, and errors. JS files are currently the
 * only type that can specify other dependencies. We read the JS files, parse
 * them, and then apply the same procedure to its dependencies.
 *
 * @param fileObj { name: 'some_filename', type: 'js|oak|resource' }
 *                Can specify 'filename' for where it lives on filesystem.
 * @param callback callback(tree)
 *                 Tree is an array where the first object is the file object.
 *                 If 'resource' type, node has 'data' with file contents.
 *                 If an error occurred, node has 'error' property.
 *                 Second element is an array with the dependencies.
 */
function dependencies(fileObj, callback) {
  (function recurse(fileObj, cycles, callback) {
    fileObj = _.extend({}, fileObj);
    if (!fileHandlers[fileObj.type]) {
      fileObj.error = 'Do not know how to handle this type.';
      return callback([fileObj, []]);
    }
    if (!fileObj.filename)  {
      fileObj.filename = path.resolve(fileObj.name);
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
        return;
      }

      var fileObjs = [];
//      try {
        fileObjs = fileHandlers[fileObj.type](fileObj, data);
//      } catch(e) {
//        fileObj.error = e;
//      }

      if (fileObjs.length) {
        var total = fileObjs.length;
        var childResults = new Array(fileObjs.length);
        fileObjs.forEach(function(childFileObj, i) {
          if (!childFileObj.filename) {
            childFileObj.filename = path.resolve(
                path.dirname(fileObj.filename), childFileObj.name);
          }
          recurse(childFileObj, cycles, function(t) {
            childResults[i] = t;
            if (--total == 0) {
              callback([fileObj, childResults]);
            }
          });
        });
      } else {
        callback([fileObj, []]);
      }
    });
  })(fileObj, {}, callback);
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
    dependencies(rootFileObj, function(tree) {
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
module.exports.parseHTML = parseHTML;
Object.defineProperty(module.exports, '__fs',
                      { set: function(x) { fs = x; } });
module.exports.dependencies = dependencies;
module.exports.forEachNode = forEachNode;
module.exports.watch = watch;
module.exports.unwatch = unwatch;
