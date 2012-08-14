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
    ['create.mjs', 'widget.mjs', 'rapid.mjs', 'public/basewidget.js',
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
          fileObjs.push({ type: types[match[1]], name: name });
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

    var out = {};
    out.templates = templates;
    out.isFragment = element != document.documentElement;
    out.document = document;
    out.uses = eatUses(document);
    var uniqMap = function(f) { return f.filename; };
    out.fileObjs = _.compact(_.uniq(_.flatten(
        [basicDependencies, fileObjs,
        _(templates).pluck('dependencies')]), uniqMap));
    return out;
  }
};

/** Flattens tree to array of dependencies. */
function flatten(tree) {
  if (!tree.length) {
    return [];
  }

  // The node looks like [fileObj, children]. We swap the order here, so that
  // when the tree is flattened the leaf nodes come first.
  var map = function(fileObj) { return fileObj.filename; };
  return _.uniq(_.flatten([tree[1].map(flatten), tree[0]]), false, map);
}

/** Make sure fileobj has filename if it has name. */
function normalizeFileObj(fileObj) {
  if (typeof fileObj == 'object' && fileObj.name) {
    return _.extend({}, { filename: path.resolve(fileObj.name) }, fileObj);
  } else {
    return [];
  }
}

/** Fetches fileObj if not already in files dictionary. */
function fetch(files, fileObj, callback) {
  fileObj = normalizeFileObj(fileObj);
  if (files[fileObj.filename]) {
    return callback(null, files[fileObj.filename]);
  }
  if (!fileHandlers[fileObj.type]) {
    return callback(new Error('Cannot handle fileObj type'), null);
  }

  fs.readFile(fileObj.filename, 'utf-8', function(err, data) {
    if (err) {
      return callback(new Error('Cannot open file.'), null);
    }

    var result;
    try {
      result = fileHandlers[fileObj.type](fileObj, data);
    } catch(e) {
      return callback(e, null);
    }

    result.fileObjs = _(result.fileObjs).map(function(childFileObj) {
      var filename = path.resolve(
          path.dirname(fileObj.filename), childFileObj.name);
      return _.extend({}, { filename: filename }, childFileObj);
    });

    callback(null, result);
  });
}

/** Builds a tree structure given root file objects and file dictionary. */
function build(roots, files, callback) {
  (function recurse(fileObj, fileObjs, cycles, callback) {
    fileObj = normalizeFileObj(fileObj);
    if (cycles[fileObj.filename]) {
      return callback([fileObj, []]);
    }

    cycles = Object.create(cycles);
    cycles[fileObj.filename] = true;

    if (!fileObjs.length) {
      return callback([fileObj, []]);
    }

    var total = fileObjs.length;
    var childResults = new Array(total);
    fileObjs.forEach(function(childFileObj, i) {
      childFileObj = normalizeFileObj(childFileObj);
      fetch(files, childFileObj, function(err, data) {
        if (err) {
          data = { error: err, fileObjs: [] };
        }
        files[childFileObj.filename] = data;
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
    if (fileObj) {
      fileObj = normalizeFileObj(fileObj);
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
    if (!fileObj) {
      if (this.tree_[0].filename) {
        fileObj = this.tree_[0];
      } else if (this.tree_[1].length == 1 && this.tree_[1][0][0].filename) {
        fileObj = this.tree_[1][0][0];
      } else {
        throw new Error('No fileObj specified, and could not make a guess.');
      }
    }
    fileObj = normalizeFileObj(fileObj);
    return _.extend({}, fileObj, this.files_[fileObj.filename]);
  },

  /** Finds the subtree whose root filename matches given object's filename. */
  subtree: function(fileObj) {
    fileObj = normalizeFileObj(fileObj);
    var nodes = [this.tree_];
    while (nodes.length) {
      var node = nodes.shift();
      if (node && node[0].filename == fileObj.filename) {
        return new Tree(this.files_, node);
      } else {
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
      listeners = newTree.flatten().map(function(fileObj) {
        var fn = dep.bind(this, newTree, fileObj);
        watcher.watch(fileObj.filename, fn);
        return [fileObj.filename, fn];
      });

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

module.exports = new events.EventEmitter();
module.exports.flatten = flatten;
module.exports.parseHTML = parseHTML;
module.exports.tree = tree;
module.exports.watch = watch;
module.exports.unwatch = unwatch;
