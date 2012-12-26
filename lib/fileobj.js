// Operations for fileobjs.
//
// fileobjs contain the file data, the filename, and other data after reading
// and sometimes parsing the file.

var _ = require('underscore');
var assert = require('assert');
var fs = require('fs');
var html5 = require('html5');
var jsdom = require('jsdom');
var jsp = require('uglify-js').parser;
var oakstache = require('./oakstache/handler');
var path = require('path');
var queryselector = require('./queryselector');
var sheet = require('Sheet');

// jsdom options for html parsing.
var defaultFeatures = {
  // Used for easier scraping.
  QuerySelector: true,

  // No need to fetch anything.
  FetchExternalResources: [],

  // domjs doesn't implement document.write correctly.
  ProcessExternalResources: []
};

html5.Parser.prototype.on('setup', function(parser) {
  var open = [];
  var openBlocks = [];
  var countBlocks = function(str) {
    var oldCount = openBlocks.length;
    var ast = oakstache.parse(str);
    ast.forEach(function(x) {
      if (x.openPath) {
        if (x.openType) {
          // This is an opening block.
          openBlocks.push(x);
        } else {
          // This is a closing block.
          while (openBlocks.length) {
            if (openBlocks.pop().openPath.join('.') == x.openPath.join('.')) {
              break;
            }
          }
        }
      }
    });
    return openBlocks.length - oldCount;
  };

  parser.tokenizer.on('token', function listen(t) {
    var openElements = parser.tree.open_elements;

    if (t.type == 'Characters') {
      var countDelta = countBlocks(t.data);

      if (countDelta != 0) {
        var lastInserted = openElements.last().lastChild;
        var isTextNode = lastInserted &&
                         lastInserted.nodeType == lastInserted.TEXT_NODE;
        var nodeValue = isTextNode ? lastInserted.nodeValue : '';
        nodeValue = nodeValue.replace(/^\s+|\s+$/g, '');
        var tokenData = t.data.replace(/^\s+|\s+$/g, '');
        if (isTextNode) {
          lastInserted.oakAddBlockDepth = countDelta;
        }
        if (!isTextNode || nodeValue != tokenData) {
          var table = parser.tree.getTableMisnestedNodePosition().insertBefore;
          var textNode = table.previousSibling;
          assert(textNode.nodeValue, t.data);

          var index = textNode.nodeValue.indexOf(t.data);
          if (index != 0) {
            var document = openElements.last().ownerDocument;
            var value = textNode.nodeValue;
            textNode.nodeValue = value.substring(0, index);
            textNode = document.createTextNode(value.substring(index));
          }
          openElements.last().appendChild(textNode);
        }
      }
    } else if (t.type == 'StartTag' && openBlocks.length > 0) {
      var count = openBlocks.length;
      var last = openElements.last();
      var element = last.lastChild ? last.lastChild : last;
      element.oakBlockDepth = count;
      element.oakOpenPath = _.pluck(openBlocks, 'openPath');
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

/** Flattens tree to array of dependencies. */
function flatten(tree) {
  // The node looks like [fileObj, children]. We swap the order here, so that
  // when the tree is flattened the leaf nodes come first.
  return uniq([tree[1].map(flatten), tree[0]]);
}

/** TODO */
function uniq(arrays) {
  var uniqCount = 0;
  var map = function(fileObj) {
    if (fileObj.filename) {
      return fileObj.filename;
    } else if (fileObj.element) {
      return fileObj.element;
    } else {
      return uniqCount++;
    }
  };
  return _.uniq(_.flatten(arrays), false, map);
}

// Handlers the different directives we may come across.
var fileHandlers = {
  'wjs': function(fileObj, data) {
    return { data: data };
  },

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

      // <div id='1'>
      //    blah {{#loop}}<div class='s'>{{i}}</div>{{/loop}} blah
      // </div>
      //
      // structure should look like
      //   el: #1, i: 0, value: blah {{#loop}}<...>{{/loop}} blah
      //   el: 

      // unbound will be an array of tuples.
      //   the first item contains unbound data for child nodes.
      //   the second item contains unbound data for attributes.
      var unboundFilter = function(x) { return x.match(/{{/); };
      var unbound = _(all).map(function(el, i) {
        if (el.tagName == 'USE' || el.oakBlockDepth > 0) {
          return undefined;
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
          return _.chain(things).map(map).compact().value();
        };

        var children;
        if (el.childNodes.some(function(x) { return x.oakAddBlockDepth; })) {
          children = [{ eindex: elements.length, value: el.innerHTML }];
        } else {
          children = transform(el.childNodes, childMap);
        }

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
        hasUses: !!template.querySelectorAll('use').length,
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
    out.fileObjs = uniq([fileObjs, _(templates).pluck('dependencies')]);
    return out;
  }
};

/**
 * Takes an unfilled fileObj and the file contents and returns a filled
 * fileobj.
 */
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

/** Helper function used for fetch. */
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
  if (!fileObj.filename) {
    handleFileWithCallback(fileObj, fileObj.data, callback);
  } else if (files[fileObj.filename]) {
    callback(null, files[fileObj.filename]);
  } else if (!fileHandlers[fileObj.type]) {
    callback(new Error('Cannot handle fileObj type'), null);
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

module.exports.flatten = flatten;
module.exports.uniq = uniq;
module.exports.parseHTML = parseHTML;
module.exports.handleFile = handleFile;
module.exports.fetch = fetch;

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

  var testOak = '<template name="bar">' +
                '<link rel="js" href="widget.js">' +
                '<link rel="stylesheet" href="test.css">' +
                '<div>Some template</div></template>';
  var fileObj = { filename: 'test.oak', type: 'oak' };
  fileObj = handleFile(fileObj, testOak);

  var template = fileObj.templates[0];
  assert.equal(template.name, 'bar');
  assert.equal(template.data, '<div>Some template</div>');
  assert.equal(fileObj.fileObjs.length, 2);
}
