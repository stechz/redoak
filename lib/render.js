// Rendering functions for a dependency tree.
//
// Use html() to render a dependency tree to an html string.

var _ = require('underscore');
var dependencies = require('./dependencies');
var jsp = require('uglify-js');
var oakstache = require('./oakstache/handler');
var path = require('path');
var queryselector = require('./queryselector');
var walker = require('./walker/handler');

/** Returns array of CSS dependencies. */
function css(tree) {
  var fileObjs = tree.oakDependencies().flatten();
  return fileObjs.filter(function(d) { return d.type == 'css'; });
}

/** Returns array of JS dependencies. */
function js(tree) {
  var fileObjs = tree.oakDependencies().flatten();
  return fileObjs.filter(function(d) { return d.type == 'js'; });
}

/** */
function useJs(tree, ast) {
  var widgetName = __dirname + '/templates/fill.wjs';
  var template = tree.data({ filename: widgetName });
  if (!template.data) {
    return '';
  }
  ast = decorateTemplateAst(ast);
  return walker.walk(walker.parse(template.data), ast, JSON.stringify);
}

function keyForQS(qs) {
  // The same query string and query string index means the same element.
  return qs.qs + '%%%' + qs.qsi;
}

function decorateTemplateAst(ast) {
  var transform = function(obj, fn) {
    if (Array.isArray(obj)) {
      return obj.map(function(obj) { return transform(obj, fn); });
    } else if (typeof obj == 'object') {
      obj = _.extend({}, obj);
      fn(obj);

      var keys = Object.keys(obj);
      for (var i = 0; i < keys.length; i++) {
        obj[keys[i]] = transform(obj[keys[i]], fn);
      }
      for (var i = 0; i < keys.length; i++) {
        if (obj[keys[i]] !== undefined && obj[keys[i]] !== null) {
          fn(obj[keys[i]]);
        }
      }
      return obj;
    } else {
      return obj;
    }
  };

  (function recurse(ast, count) {
    if (Array.isArray(ast)) {
      for (var i = 0; i < ast.length; i++) {
        recurse(ast[i], count);
      }
    } else if (ast.type == 'loop') {
      ast.loopRef = count;
      ast.loopId = count + 1;
      recurse(ast.contents, count + 1);
    } else if (ast.type == 'if') {
      ast.clause.loopRef = count;
      recurse(ast.contents, count);
    } else if (ast.type == 'unbound') {
      ast.loopRef = count;
    }
  })(ast, 0);

  var result = transform(ast, function(obj) {
    if (Array.isArray(obj.path)) {
      if (typeof obj.loopRef != 'number') {
        throw new Error('Bad loopRef.');
      }
      obj.ensurePath = [];
      obj.objref = obj.loopRef;

      var path = obj.path;
      if (path[0] && path[0].backout) {
        obj.objref = Math.max(0, obj.loopRef - path[0].backout);
        path = path.slice(1);
      }
      for (var i = 1; i <= path.length; i++) {
        obj.ensurePath.push(path.slice(0, i));
      }
    } else if (obj.path && obj.path.type == 'i') {
      obj.ensurePath = { type: 'i' };
    }
  });

  return result;
}

/** Returns code that renders a oakstache AST to var "result". */
function htmlJs(tree, ast) {
  var widgetName = __dirname + '/templates/htmljs.wjs';
  var template = tree.data({ filename: widgetName });
  if (!template.data) {
    return '';
  }

  ast = decorateTemplateAst(ast);
  return walker.walk(walker.parse(template.data), ast, JSON.stringify);
}

function usesToTree(uses) {
  var ast = [];

  var findBlock = function(ast, block) {
    for (var i = 0; i < ast.length; i++) {
      if (block.obj.type == 'if') {
        if (ast[i].type == 'if' &&
            ast[i].clause.path == block.obj.clause.path) {
          return ast[i];
        }
      } else if (ast[i].type == 'loop') {
        if (ast[i].type == 'loop' && ast[i].path == block.obj.path) {
          return ast[i];
        }
      }
    }
    if (block.obj.type == 'loop') {
      ast.push({ type: block.obj.type, path: block.obj.path, contents: [] });
    } else if (block.obj.type == 'if') {
      ast.push({
        type: block.obj.type,
        clause: block.obj.clause,
        contents: []
      });
    }
    return ast[ast.length - 1];
  };

  var ensureBlocks = function(blocks) {
    var currentAst = ast;
    for (var i = 0; i < blocks.length; i++) {
      currentAst = findBlock(currentAst, blocks[i]).contents;
    }
    return currentAst;
  };

  // The query selectors were built without knowing the template logic. If
  // any use inside the template has the same queryselector, the index will
  // need to be adjusted. qsdict tracks this.
  var qsdict = {};

  for (var i = 0; i < uses.length; i++) {
    var currentAst = ensureBlocks(uses[i].openBlocks);

    var qs = uses[i].qs;
    var qsi = uses[i].qsi;
    if (qsdict[qs]) {
      // Adjust index 
      qsi -= qsdict[qs];
      qsdict[qs]++;
    } else {
      qsdict[qs] = 1;
    }

    var use = { mixins: uses[i].mixins, obj: uses[i].obj, qs: qs, qsi: qsi };
    currentAst.push({ type: 'use', use: use });
  }

  return ast;
}

/**
 * Widget javascript for a dependency tree.
 *
 * This javascript handles the implementation of the widget.  It also listens
 * for JS events and allows script to render new widgets or change the contents
 * of existing widgets.
 *
 * Be sure this is included right after basewidget! Otherwise, other event
 * listeners may change the structure of the DOM and make our query selectors
 * invalid.
 */
function widgetJS(tree) {
  var widgetName = __dirname + '/templates/widget.mjs';
  var template = tree.data({ filename: widgetName });
  if (!template.data) {
    return '';
  }

  var templates = dependencies.allTemplates(tree);
  var resources = templates.map(function(template) {
    var resource = {
      name: JSON.stringify(template.name),
      code: htmlJs(tree, template.ast) + 'return result;',
      els: [],
      fill: [],
      rendered: []
    };

    var elementMap = _(template.elements).chain().map(function(qs, i) {
      // Extend elements with their original index.
      return { name: 'a' + i, qs: qs.qs, qsi: qs.qsi };
    }).groupBy(keyForQS).value();

    _(template.elementNames).forEach(function(nameObj) {
      var qs = template.elements[nameObj.eindex];
      elementMap[keyForQS(qs)][0].name = nameObj.name;
    });

    var elements = _(_(elementMap).values()).pluck('0');
    function iToName(i) {
      var key = keyForQS(template.elements[i]);
      for (var i = 0; i < elements.length; i++) {
        if (key == keyForQS(elements[i])) {
          if (elements[i].qs) {
            return JSON.stringify(elements[i].name);
          } else {
            return '';
          }
        }
      }
      return '';
    }

    if (elements.length) {
      resource.els = {
        stmts: _.compact(elements.map(function(x) {
          if (!x.qs) {
            return null;
          }
          return {
            name: JSON.stringify(x.name),
            qs: JSON.stringify(x.qs),
            qsi: x.qsi
          };
        }))
      };
    }

    if (template.events.length || template.expandedUses.length) {
      resource.rendered = {};

      if (template.events.length) {
        resource.rendered.events = {
          stmts: template.events.map(function(x) {
            return _.extend({}, {
              elname: iToName(x[0]),
              ename: JSON.stringify(x[1]),
              fname: JSON.stringify(x[2])
            });
          })
        };
      }

      if (template.expandedUses.length) {
        resource.rendered.child = { stmts: template.expandedUses };
      }
    }

    var ast = usesToTree(template.expandedUses);
    resource.use_code = useJs(tree, ast);

    if (template.unbound.children.length || template.unbound.attrs.length) {
/*      var fields = {};

      var enterInFields = function(value, obj) {
        var div = template.document.createElement('div');
        div.innerHTML = value;
        dependencies.expandDOM(
            templates, div, {}, oakstache.renderStringUnbound);
        var ast = oakstache.parse(div.innerHTML);
        for (var i = 0; i < ast.length; i++) {
          if (ast[i].type == 'unbound' || ast[i].type == 'if' ||
              ast[i].type == 'loop') {
            var path = ast[i].type == 'if' ? ast[i].clause.path : ast[i].path;
            var key = path.join('.');
            if (!fields[key]) {
              fields[key] = [];
            }
            fields[key].push(
                _.extend({}, obj, { code: htmlJs(tree, ast[i]) }));
          }
        }
      };

      template.unbound.children.forEach(function(x) {
        enterInFields(x.value, { ename: iToName(x.eindex), childi: x.childi });
      });

      template.unbound.attrs.forEach(function(x) {
        enterInFields(x.value, { ename: iToName(x.eindex), aname: x.aname });
      });

      var fieldArray = Object.keys(fields).map(function(key) {
        return { name: key, value: fields[key] };
      });

      console.log(JSON.stringify(fieldArray, 0, 2));
*/
      resource.fill = {
        children: _.compact(template.unbound.children.map(function(x) {
          var div = template.document.createElement('div');
          div.innerHTML = x.value;
          dependencies.expandDOM(
              templates, div, {}, oakstache.renderStringUnbound);
          var ast = oakstache.parse(div.innerHTML);
          if (ast.length == 1 && typeof ast[0] == 'string') {
            return;
          } else {
            return {
              ename: iToName(x.eindex),
              code: htmlJs(tree, ast),
              childi: x.childi
            };
          }
        })),

        attrs: _.compact(template.unbound.attrs.map(function(x) {
          var ast = oakstache.parse(x.value);
          if (ast.length == 1 && typeof ast[0] == 'string') {
            return;
          } else {
            return {
              ename: iToName(x.eindex),
              aname: JSON.stringify(x.aname),
              code: htmlJs(tree, ast)
            };
          }
        }))
      };
    }

    return resource;
  });

  var view = { resources: resources };
  var js = oakstache.renderString(template.data, view, JSON.stringify);

  var ast = jsp.parse(js);
  return ast.print_to_string({ beautify: true });
}

/**
 * Creates root widgets specified by use tags. Insert after all other scripts!
 */
function widgetCreateJS(tree, uses) {
  var template = tree.data({ filename: __dirname + '/templates/create.mjs' });
  if (!template.data || !uses.length) {
    return '';
  }

  var view = { uses: uses };
  var result = oakstache.renderString(template.data, view, JSON.stringify);
  return result;
}

/** Turn a tree into the dependency JS and all of its widgets. */
function jsText(tree, map, rapidId, path) {
  var text = '';
  var jsWidgetText = widgetJS(tree);
  var jsFiles = js(tree);
  var includedScripts = [];
  for (var i = 0; i < jsFiles.length; i++) {
    var servername = map(jsFiles[i]);
    if (jsFiles[i].data) {
      text += 'document.write("<script>");\n';
      text += 'document.write(' + JSON.stringify(jsFiles[i].data) + ');\n';
      text += 'document.write("<\\/script>");\n';
    } else if (jsFiles[i].element) {
      var index = includedScripts.indexOf(jsFiles[i].element);
      if (index == -1) {
        text += 'document.write("<script>");\n';
        text += 'document.write(' +
                JSON.stringify(jsFiles[i].element.textContent) +
                ');\n';
        text += 'document.write("<\\/script>");\n';
        includedScripts.push(jsFiles[i].element);
      }
    }

    if (jsWidgetText &&
        jsFiles[i].filename == __dirname + '/public/widget.js') {
      // Insert our widget code immediately after widget.js.
      text += 'document.write("<script>");\n';
      text += 'document.write(' + JSON.stringify(jsWidgetText) + ');\n';
      text += 'document.write("<\\/script>");\n';
    }
  }

  var rapidJsFileObj = { filename: __dirname + '/templates/rapid.mjs' };
  var rapidJs = tree.data(rapidJsFileObj).data;
  if (typeof rapidId == 'number' && rapidJs) {
    var model = { id: rapidId, host: JSON.stringify(path) };
    var renderedJs = oakstache.renderString(rapidJs, model);
    text += 'document.write("<script>");\n';
    text += 'document.write(' + JSON.stringify(renderedJs) + ');\n';
    text += 'document.write("</script>");\n';
  }

  return text;
}

/** Turn a tree into CSS. */
function cssText(tree, map) {
  var text = '';
  var cssFiles = css(tree);
  var includedCss = [];
  for (var i = 0; i < cssFiles.length; i++) {
    if (!cssFiles[i].process) {
      continue;
    }
    if (cssFiles[i].data) {
      text += cssFiles[i].data;
    } else if (cssFiles[i].element) {
      var index = includedCss.indexOf(cssFiles[i].element);
      if (index == -1) {
        text += cssFiles[i].element.textContent;
        includedCss.push(cssFiles[i].element);
      }
    }
  }
  return text;
}

/** Turn a tree into HTML. */
function html(tree, map, rapidId) {
  var root = tree.data();
  if (!root || !root.document) {
    return '';
  }

  var document = root.document;
  var html = document.firstChild.cloneNode(true);
  var head = html.querySelector('head');
  var body = html.querySelector('body');

  var templates = _.flatten(dependencies.allTemplates(tree));
  var expandedUses = dependencies.expandDOM(
      templates, html, {}, oakstache.renderString);

  var cssFiles = css(tree);
  var insertBefore = head.querySelector('style, link[rel=stylesheet]');
  var includedCss = [];
  for (var i = 0; i < cssFiles.length; i++) {
    if (!cssFiles[i].process) {
      continue;
    }
    if (cssFiles[i].data) {
      var el = document.createElement('style');
      el.textContent = cssFiles[i].data;
    } else if (cssFiles[i].element) {
      var el = document.createElement('style');
      var index = includedCss.indexOf(cssFiles[i].element);
      if (index == -1) {
        el.textContent = cssFiles[i].element.textContent;
        includedCss.push(cssFiles[i].element);
      }
    } else {
      var el = document.createElement('link');
      el.setAttribute('rel', 'stylesheet');
      el.setAttribute('href', map(cssFiles[i]));
    }
    head.insertBefore(el, insertBefore);
  }

  var jsWidgetText = widgetJS(tree);
  var before = html.querySelector('body > script');
  var jsFiles = js(tree);
  var includedScripts = [];
  for (var i = 0; i < jsFiles.length; i++) {
    var servername = map(jsFiles[i]);
    var el = document.createElement('script');
    if (jsFiles[i].data) {
      el.textContent = jsFiles[i].data;
    } else if (jsFiles[i].element) {
      var index = includedScripts.indexOf(jsFiles[i].element);
      if (index == -1) {
        el.textContent = jsFiles[i].element.textContent;
        includedScripts.push(jsFiles[i].element);
      }
    } else {
      el.setAttribute('src', servername);
    }
    if (el.textContent.length) {
      body.insertBefore(el, before);
    }

    if (jsWidgetText &&
        jsFiles[i].filename == __dirname + '/public/widget.js') {
      // Insert our widget code immediately after widget.js.
      var widgetScript = document.createElement('script');
      widgetScript.textContent = jsWidgetText;
      body.insertBefore(widgetScript, el.nextSibling);
    }
  }

  var rapidJsFileObj = { filename: __dirname + '/templates/rapid.mjs' };
  var rapidJs = tree.data(rapidJsFileObj).data;
  if (typeof rapidId == 'number' && rapidJs) {
    var renderedJs = oakstache.renderString(rapidJs, { id: rapidId });
    var script = document.createElement('script');
    script.textContent = renderedJs;
    body.insertBefore(script, before);
  }

  var jsText = widgetCreateJS(tree, expandedUses);
  if (jsText) {
    var script = document.createElement('script');
    script.textContent = jsText;
    body.appendChild(script);
  }

  if (root.isFragment) {
    return body.innerHTML;
  } else {
    return ('<!DOCTYPE html>\n' +
            html.outerHTML.replace(/<!doctype html>/i, ''));
  }
}

if (require.main === module) {
  var assert = require('assert');

   var uses = [{
     mixins: "[\"list.item\"]",
     obj: {},
     qs: "li",
     qsi: 0,
     openBlocks: [{
       obj: { type: "loop", path: ["children"] },
       open: true
     }]
   }];
   var tree = usesToTree(uses);
   assert.equal(tree.length, 1);
   assert.equal(tree[0].type, 'loop');
   assert.equal(tree[0].contents.length, 1);
   assert.equal(tree[0].contents[0].type, 'use');

   var uses = [
     {
       mixins: '[\"list.header\"]',
       obj: '{}',
       openBlocks: [{
         obj: {
          type: 'if',
          clause: { type: 'eq', path: [ 'type' ], value: 'header' }
         },
         open: true
       }],
       qs: 'li',
       qsi: 0
     },
     {
       mixins: '[\"list.item\"]',
       obj: '{}',
       openBlocks: [{
         obj: {
          type: 'if',
          clause: { type: 'eq', path: [ 'type' ], value: 'item' }
         },
         open: true
       }],
       qs: 'li',
       qsi: 1
     }
  ];
  var tree = usesToTree(uses);
  assert.equal(tree.length, 2);
  assert.ok(tree[0].clause);
  assert.equal(tree[0].type, 'if');
  assert.equal(tree[1].type, 'if');
  assert.strictEqual(tree[0].contents[0].use.qsi, 0);
  assert.strictEqual(tree[1].contents[0].use.qsi, 0);

   // TODO: some sort of tests for event listeners

  var testData = {
    'test.oak':
        '<template name="_"><link rel="js" href="widget.js">' +
        '<div></div></template>' +
        '<template name="bar"><div>' +
        '{{options.value}}' +
        '{if prop}We have a prop!{/}' +
        '{loop l}{.}{/}' +
        '{loop l1}{../l2}{/}' +
        '{loop lobj}{a}{/}' +
        '{loop lif}{if a}{a}{/}{/}' +
        '</div></template>'
  };

  var tree = dependencies.buildForTesting(testData, function(tree) {
    var data = tree.data();
    assert(data);

    var ast = data.templates[1].ast;
    assert(ast);
    assert.equal(ast[0], '<div>');
    assert.equal(ast[1].type, 'unbound');
    assert.equal(ast[1].path[0], 'options');
    assert.equal(ast[1].path[1], 'value');

    var name = __dirname + '/templates/htmljs.wjs';
    assert(tree.data({ filename: name }).data);

    var htmlAst = htmlJs(tree, ast);
    try {
      var jsAst = jsp.parse(htmlAst);
      var jsAstStr = jsAst.print_to_string({ beautify: true });
      jsAstStr += ' return result;';
    } catch(e) {
      console.log(JSON.stringify(ast, 0, 2));
      console.log(htmlAst);
      throw e;
    }

    var Widget = {
      escapeHtml: oakstache.escapeHtml,
      isEmptyObject: function(x) { return !x; }
    };
    var jsAstFn = new Function('Widget', 'obj', jsAstStr).bind(null, Widget);

    try {
      assert.equal(jsAstFn({ options: { value: '<p>' } }), '<div><p></div>');
      assert.equal(jsAstFn({}), '<div></div>');
      assert.equal(jsAstFn({ prop: true }), '<div>We have a prop!</div>');
      assert.equal(jsAstFn({ l: [1, 2, 3] }), '<div>123</div>');
      assert.equal(jsAstFn({ l: [] }), '<div></div>');
      assert.equal(jsAstFn({ l1: [1, 1, 1], l2: 2 }), '<div>222</div>');
      assert.equal(jsAstFn({ lobj: [{ a: 5 }] }), '<div>5</div>');
      assert.equal(
          jsAstFn({ lif: [{ a: 5 }, {}, { a: 6 }] }), '<div>56</div>');
    } catch(e) {
      console.log(jsAstStr);
      throw e;
    }
  });
}

exports.css = css;
exports.js = js;
exports.cssText = cssText;
exports.jsText = jsText;
exports.widgetCreateJS = widgetCreateJS;
exports.widgetJS = widgetJS;
exports.html = html;
