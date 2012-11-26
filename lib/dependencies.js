// Calculate dependency trees and watch them.
//
// Dependency trees are hierarchical representations of HTML/JS/CSS files.
// Each node looks like: [fileObj, children]. fileObj contains the type of the
// file, the filename, and other data after reading and sometimes parsing the
// file. children are the potential HTML/JS/CSS dependencies of the fileObj.
//
// watch lets you watch the filesystem for any changes to the tree.

var _ = require('underscore');
var assert = require('assert');
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
    ['create.mjs', 'widget.mjs', 'rapid.mjs', 'public/widget.js',
     'public/extra.js', 'public/mustache.js']
    .map(function(x) {
  return { type: path.extname(x).substr(1), filename: __dirname + '/' + x };
});

html5.Parser.prototype.on('setup', function(parser) {
  var opening = /{{[#^].*?}}/;
  var closing = /{{\/.*?}}/;
  var open = [];
  var countBlocks = function(numOpen, str) {
    var result = 0;
    while (true) {
      var openIndex = str.search(opening);
      var closeIndex = str.search(closing);
      var index = Math.min(openIndex, closeIndex);
      if (openIndex == -1 && closeIndex == -1) {
        return result;
      } else if (index == closeIndex && closeIndex >= 0 || openIndex == -1) {
        result = Math.max(result - 1, -numOpen);
        str = str.substring(closeIndex + 1);
      } else {
        result++;
        str = str.substring(openIndex + 1);
      }
    }
    return result;
  };

  var openElements = parser.tree.open_elements;
  parser.tokenizer.on('token', function listen(t) {
    if (t.type == 'Characters') {
      var numOpen = open.last() ? open.last().count : 0;
      var countDelta = countBlocks(numOpen, t.data);
      if (countDelta > 0) {
        if (open.last() == openElements.last()) {
          open.last().count += countDelta;
        } else {
          open.push({ count: countDelta, last: openElements.last() });
        }
      } else if (countDelta < 0) {
        assert.ok(open.last());
        var removeCount = 0;
        while (open.last() && removeCount < -countDelta) {
          var oldCount = open.last().count;
          open.last().count = Math.max(0, open.last().count + countDelta);
          removeCount += oldCount - open.last().count;
          if (open.last().count == 0) {
            open.pop();
          }
        }
      }

      if (countDelta != 0) {
        var lastInserted = openElements.last().lastChild;
        var isTextNode = lastInserted &&
                         lastInserted.nodeType == lastInserted.TEXT_NODE;
        var nodeValue = isTextNode ? lastInserted.value : '';
        nodeValue = nodeValue.replace(/^\s+|\s+$/g, '');
        var tokenData = t.data.replace(/^\s+|\s+$/g, '');
        if (isTextNode) {
          lastInserted.oakAddBlockDepth = countDelta;
        }
        if (!isTextNode || nodeValue != tokenData) {
          var table = parser.tree.getTableMisnestedNodePosition().insertBefore;
          var textNode = table.previousSibling;
          assert(textNode.nodeValue, t.data);

          var index = textNode.value.indexOf(t.data);
          if (index != 0) {
            var document = openElements.last().ownerDocument;
            var value = textNode.value;
            textNode.value = value.substring(0, index);
            textNode = document.createTextNode(value.substring(index));
          }
          openElements.last().appendChild(textNode);
        }
      }
    } else if (t.type == 'StartTag' && open.length > 0) {
      var count = open.reduce(function(a, b) { return a + b.count }, 0);
      assert.ok(count > 0);
      if (openElements.last().lastChild) {
        openElements.last().lastChild.oakBlockDepth = count;
      } else {
        openElements.last().oakBlockDepth = count;
      }
    } else if (t.type == 'EOF') {
      parser.tokenizer.removeListener('token', listen);
    }
  });
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
    var templates = [];
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
        var useOak = !link.hasAttribute('oak-no');
        var data = '';
        var href = link.getAttribute('href');
        var el = null;
        link.parentNode.removeChild(link);

        if (href.charAt(0) == '#') {
          // Allow inline scripts.
          el = document.getElementById(href.substr(1));
          el.parentNode.removeChild(el);
          href = '';
        }

        return {
          process: useOak,
          type: link.getAttribute('rel') == 'js' ? 'js' : 'css',
          filename: href,
          fromTemplate: true,
          element: el
        };
      });

      var elements = [];
      var all = template.querySelectorAll('template *');

      // Find all the unbound variables.

      // unbound will be an array of tuples.
      //   the first item contains unbound data for child nodes.
      //   the second item contains unbound data for attributes.
      //   the third item contains lookup data for all the elements.
      var unboundFilter = function(x) { return x.match(/{{/); };
      var unbound = _(all).map(function(el, i) {
        if (el.tagName == 'USE' || el.oakBlockDepth > 0) {
          return;
        }
        var childMap = function(x, i) {
          if (x.nodeType != x.TEXT_NODE || !unboundFilter(x.value) ||
              x.oakAddBlockDepth) {
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
        if (all[j].oakBlockDepth > 0) {
          continue;
        }

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

      var firstElement = (function nextElementSibling(el) {
        while (el && el.nodeType != el.ELEMENT_NODE) {
          el = el.nextSibling;
        }
        return el;
      })(template.firstChild);

      unbound.attrs.forEach(function(attr) {
        var attrel = elements[attr.eindex];
        attrel.removeAttribute(attr.aname);
      });
      var qselements = elements.map(function(el) {
        if (el == firstElement) {
          return { toplevel: true };
        } else {
          // XXX shouldn't this be firstElement?
          return queryselector.to(el, template);
        }
      });
      unbound.attrs.forEach(function(attr) {
        var attrel = elements[attr.eindex];
        attrel.setAttribute(attr.aname, attr.value);
      });

      templates.push({
        elementNames: elementNames,
        elements: qselements,
        events: events,
        name: name,
        data: template.innerHTML.replace(/^\s+|\s+$/, ''),
        dependencies: dependencies,
        unbound: unbound,
        uses: uses,
        document: template.ownerDocument
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

    if (document.querySelector('meta[oak-rapid~=]')) {
      fileObjs.push({
        filename: path.resolve(__dirname, 'rapid.mjs'),
        type: 'mjs'
      });
    }

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
    var attempts = 2;
    fs.readFile(fileObj.filename, 'utf-8', function read(err, data) {
      if (err) {
        if (--attempts == 0) {
          callback(new Error('Cannot open file.'), null);
        } else {
          setTimeout(function() {
            // Node workaround. On OSX, apparently readFile fails with ENOENT
            // if the file is locked, which happens for me when a watched file
            // changes (perhaps my vim holds on to the file a little longer
            // after writing?). So we give it a little time and attempt to read
            // the file again.
            fs.readFile(fileObj.filename, 'utf-8', read);
          }, 200);
        }
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
module.exports.allTemplates = allTemplates;
module.exports.expandDOM = expandDOM;
module.exports.tree = tree;
module.exports.watch = watch;
module.exports.unwatch = unwatch;

if (require.main === module) {
  // Fragments are given body element back.
  var el = parseHTML('<div></div>');
  assert.equal(el, el.ownerDocument.body);

  // Full documents are given html element back.
  el = parseHTML('<html><body><div></div></body></html>');
  assert.equal(el, el.ownerDocument.firstChild);

  // Text nodes with loops inside tables remain inside tables. By default,
  // HTML parsers put extraneous non-table stuff right before the table.
  el = parseHTML('<table>{{#rows}}<tr><td>test</td></tr>{{/rows}}</table>');
  assert.equal(el.firstChild.tagName, 'TABLE');
  var table = el.firstChild;
  var textNode = table.firstChild;
  assert.equal(textNode.nodeType, el.TEXT_NODE);
  assert.equal(table.rows[0].oakBlockDepth, 1);
  assert.equal(table.rows[0].cells[0].oakBlockDepth, 1);

  // Make sure inner loops work.
  el = parseHTML('{{#loop1}}{{#loop2}}<div></div>{{/loop2}} ' +
                 '<div>etc</div>{{/loop1}}');
  var divs = el.querySelectorAll('div');
  assert.equal(divs.length, 2);
  assert.equal(divs[0].oakBlockDepth, 2);
  assert.equal(divs[1].oakBlockDepth, 1);

  // Self-closing tags get oakBlockDepth.
  el = parseHTML('{{#loop}}<div><img src="blah.jpg"></div>{{/loop}}');
  var div = el.querySelector('div');
  var img = el.querySelector('img');
  assert.equal(div.oakBlockDepth, 1);
  assert.equal(img.oakBlockDepth, 1);

  // HTML parsers remove extra whitespace from nodeValue. Make sure no errors
  // occur.
  parseHTML('<div>  \n{{#loop1}}  <div>test</div>{{/loop1}}</div>');

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
    files[filename] = handleFile(fileObj, testData[i]);
  }

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
