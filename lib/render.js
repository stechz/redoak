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
  return walker.walk(walker.parse(template.data), ast, JSON.stringify);
}

/** Returns code that renders a oakstache AST to var "result". */
function htmlJs(tree, ast) {
  var widgetName = __dirname + '/templates/htmljs.wjs';
  var template = tree.data({ filename: widgetName });
  if (!template.data) {
    return '';
  }

  var transform = function(obj) {
    if (obj.path) {
      obj.objname = 'obj';
      obj.ensurePath = [];
      for (var i = 1; i <= obj.path.length; i++) {
        obj.ensurePath.push(obj.path.slice(0, i));
      }
    }
  };

  ast = ast.map(function recurse(obj) {
    if (Array.isArray(obj)) {
      return obj.map(recurse);
    } else if (typeof obj == 'object') {
      obj = _.extend({}, obj);
      transform(obj);

      var keys = Object.keys(obj);
      for (var i = 0; i < keys.length; i++) {
        transform(obj[keys[i]]);
      }
      return obj;
    } else {
      return obj;
    }
  });

  console.log(JSON.stringify(ast, 0, 2));

  return walker.walk(walker.parse(template.data), ast, JSON.stringify);
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

    function keyForQS(qs) {
      // The same query string and query string index means the same element.
      return qs.qs + '%%%' + qs.qsi;
    }

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

    var usesToTree = function(uses) {
      var ast = [];

      var findBlock = function(ast, block) {
        for (var i = 0; i < ast.length; i++) {
          if (ast[i].type == block.openType && ast[i].path == block.openPath) {
            return ast[i];
          }
        }
        ast.push({ type: block.openType, path: block.openPath, contents: [] });
        return ast[ast.length - 1];
      };

      var ensureBlocks = function(blocks) {
        var currentAst = ast;
        for (var i = 0; i < blocks.length; i++) {
          currentAst = findBlock(currentAst, blocks[i]).contents;
        }
        return currentAst;
      };

      for (var i = 0; i < uses.length; i++) {
        var currentAst = ensureBlocks(uses[i].openBlocks);
        currentAst.push({ type: 'use', use: uses[i] });
      }

      return ast;
    };

    var ast = usesToTree(template.expandedUses);
    resource.use_code = useJs(tree, ast);

    if (template.unbound.children.length || template.unbound.attrs.length) {
      resource.fill = {
        children: template.unbound.children.map(function(x) {
          var div = template.document.createElement('div');
          div.innerHTML = x.value;
          dependencies.expandDOM(
              templates, div, {}, oakstache.renderStringUnbound);
          var ast = oakstache.parse(div.innerHTML);
          return {
            ename: iToName(x.eindex),
            code: htmlJs(tree, ast),
            childi: x.childi
          }
        }),

        attrs: template.unbound.attrs.map(function(x) {
          var ast = oakstache.parse(x.value);
          return {
            ename: iToName(x.eindex),
            aname: JSON.stringify(x.aname),
            code: htmlJs(tree, x.value)
          }
        })
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

  var testData = {
    'test.oak':
        '<template name="_"><link rel="js" href="widget.js">' +
        '<div></div></template>' +
        '<template name="bar"><div>{{options.value}}</div></template>'
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
    assert.equal(ast[2], '</div>');

    var name = __dirname + '/templates/htmljs.wjs';
    assert(tree.data({ filename: name }).data);

    var ast = jsp.parse(htmlJs(tree, ast));
    console.log(ast.print_to_string({ beautify: true }));
  });
}

exports.css = css;
exports.js = js;
exports.cssText = cssText;
exports.jsText = jsText;
exports.widgetCreateJS = widgetCreateJS;
exports.widgetJS = widgetJS;
exports.html = html;
