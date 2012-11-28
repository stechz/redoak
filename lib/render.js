// Rendering functions for a dependency tree.
//
// Use html() to render a dependency tree to an html string.

var _ = require('underscore');
var dependencies = require('./dependencies');
var oakstache = require('./oakstache/handler');
var path = require('path');
var queryselector = require('./queryselector');

/** Change template uses to something that can be used in generated JS. */
function makeUses(uses) {
  return _.compact(uses.map(function(use) {
    try {
      JSON.parse(JSON.stringify(use.obj));
    } catch(e) {
      // TODO: need to have a post op error phase.
      console.error('Cannot parse JSON for use:', use.obj);
      return null;
    }

    return {
      mixins: JSON.stringify(use.mixins),
      obj: use.obj,
      qs: JSON.stringify(use.qs),
      qsi: use.qsi
    };
  }));
}

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

/** Returns code that renders a oakstache AST to var "result". */
function htmlJs(ast) {
  var accessFor = function(path) {
    return path.map(function(p) {
      return '[' + JSON.stringify(p) + ']';
    }).join('');
  };

  var transforms = {
    stmts: function(ast, state) {
      return ast.map(function(ast) {
        return oakstache.operate(transforms, ast, state);
      }).join('');
    },

    loop: function(ast, state) {
      var path = state.concat([ast.path]);
      return 'var arr = obj' + accessFor(path) +
             'for (var i = 0; i < arr.length; i++) {' +
             '  result += (function() {' +
             oakstache.operate(transforms, ast.contents, path) + '})(); }';
    },

    inverse: function(ast, state) {
      var path = state.concat([ast.path]);
      return 'var cond = !!obj' + accessFor(path) + ';' +
             'if (!cond) { result += (function() {' +
             oakstache.operate(transforms, ast.contents, path) + '})(); }';
    },

    unbound: function(ast, state) {
      var path = state.concat([ast.name]);
      if (ast.escape) {
        return 'result += Widget.escapeHtml(obj' + accessFor(path) + ');';
      } else {
        return 'result += obj' + accessFor(path) + ';';
      }
    },

    content: function(ast, state) {
      return 'result += ' + JSON.stringify(ast) + ';';
    }
  };

  return 'var result = "";' +
         oakstache.operate(transforms, ast, []);
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
  var widgetName = __dirname + '/widget.mjs';
  var fileObjs = tree.flatten();
  var template = tree.data({ filename: widgetName });
  if (!template.data) {
    return '';
  }

  var resources = dependencies.allTemplates(tree).map(function(template) {
    var resource = {
      name: JSON.stringify(template.name),
      code: htmlJs(template.ast) + 'return result;',
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

    var uses = _.chain(makeUses(template.expandedUses)).reverse().value();
    if (template.events.length || uses.length) {
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

      if (uses.length) {
        resource.rendered.child = { stmts: uses };
      }
    }

    if (template.unbound.children.length || template.unbound.attrs.length) {
      resource.fill = {
        children: template.unbound.children.map(function(x) {
          // TODO: sometimes a rendered template will not have a text node
          //       because an element ends up empty
          //       (like "<div>{{blah}}</div>"). We should ensure a text node
          //       is created!
          var ast = oakstache.parse(x.value);
          return {
            ename: iToName(x.eindex),
            code: htmlJs(ast),
            childi: x.childi
          }
        }),

        attrs: template.unbound.attrs.map(function(x) {
          var ast = oakstache.parse(x.value);
          return {
            ename: iToName(x.eindex),
            aname: JSON.stringify(x.aname),
            code: htmlJs(x.value)
          }
        })
      };
    }

    return resource;
  });

  var view = { resources: resources };
  return oakstache.renderString(template.data, view);
}

/**
 * Creates root widgets specified by use tags. Insert after all other scripts!
 */
function widgetCreateJS(tree, expandedUses) {
  var fileObjs = tree.flatten();
  var template = tree.data({ filename: __dirname + '/create.mjs' });
  if (!template.data) {
    return '';
  }

  var uses = makeUses(expandedUses);
  uses.reverse();

  var view = { has_uses: (uses.length ? [{ uses: uses }] : []) };
  return oakstache.renderString(template.data, view);
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
      templates, html, root.uses, {}, oakstache.renderString);

  var cssFiles = css(tree);
  var insertBefore = head.querySelector('style, link[rel=stylesheet]');
  for (var i = 0; i < cssFiles.length; i++) {
    if (cssFiles[i].process && cssFiles[i].data) {
      var el = document.createElement('style');
      el.textContent = cssFiles[i].data;
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

  var rapidJs = tree.data({ filename: __dirname + '/rapid.mjs' }).data;
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

exports.css = css;
exports.js = js;
exports.widgetCreateJS = widgetCreateJS;
exports.widgetJS = widgetJS;
exports.html = html;
