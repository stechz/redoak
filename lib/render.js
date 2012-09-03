// Rendering functions for a dependency tree.
//
// Use html() to render a dependency tree to an html string.

var _ = require('underscore');
var mustache = require('./public/mustache');
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

/** Find all the templates in the tree. */
function allTemplates(tree) {
  var oakFilter = function(d) { return d.type == 'oak' && d.templates; };
  var fileObjs = tree.flatten();
  return (_.chain(fileObjs).filter(oakFilter).pluck('templates').flatten()
           .value());
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

  var resources = allTemplates(tree).map(function(template) {
    var resource;
    resource = {
      name: JSON.stringify(template.name),
      data: JSON.stringify(template.expandedData),
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
          return JSON.stringify(elements[i].name);
        }
      }
      return '';
    }

    if (elements.length) {
      resource.els = {
        stmts: elements.map(function(x) {
          return {
            name: JSON.stringify(x.name),
            qs: JSON.stringify(x.qs),
            qsi: x.qsi
          };
        })
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
            })
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
          return {
            ename: iToName(x.eindex),
            value: JSON.stringify(x.value),
            childi: x.childi
          }
        }),

        attrs: template.unbound.attrs.map(function(x) {
          return {
            ename: iToName(x.eindex),
            aname: JSON.stringify(x.aname),
            value: JSON.stringify(x.value)
          }
        })
      };
    }

    return resource;
  });

  var view = { resources: resources };
  return mustache.to_html(template.data, view);
}

/**
 * Creates root widgets specified by use tags. Insert after all other scripts!
 */
function widgetCreateJS(tree, expandedRoot) {
  var fileObjs = tree.flatten();
  var template = tree.data({ filename: __dirname + '/create.mjs' });
  if (!template.data) {
    return '';
  }

  var uses = makeUses(expandedRoot.expandedUses);
  uses.reverse();

  var view = { has_uses: (uses.length ? [{ uses: uses }] : []) };
  return mustache.to_html(template.data, view);
}

/** Expand DOM use tags and template HTML use tags. */
function expandUses(tree, htmlElement) {
  var root = tree.data();
  var templates = allTemplates(tree);
  templates = _.flatten(templates);

  var templateFor = function(use) {
    // Use the last mixin that matches a template.
    return use.mixins.reduce(function(x, y) {
      var index = _(templates).pluck('name').indexOf(y);
      return index >= 0 ? templates[index] : x;
    }, null);
  };

  function expandTemplate(node, uses, view, bound) {
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

      // Create an element for the root document.
      var html;
      if (bound) {
        html = mustache.to_html(
            (template.expandedData || template.data), newView);
      } else {
        html = mustache.to_html_unbound(
            (template.expandedData || template.data), newView);
      }
      var div = root.document.createElement('div');
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

      // Constructing the QS must be done after everything is injected.
      return function() {
        var qsobj = queryselector.to(el, node);
        return _.extend({}, use, qsobj);
      };
    });

    return _(callbacks).compact().map(function(f) { return f(); });
  }

  function toQS(result) {
    var qsobj = queryselector.to(el, node);
  }

  templates.forEach(function(template) {
    if (!template.expandedUses) {
      var div = root.document.createElement('div');
      div.innerHTML = template.data;
      template.expandedUses = expandTemplate(div.firstChild, template.uses, {});
      template.expandedData = div.innerHTML;
    }
  });

  root.expandedUses = expandTemplate(htmlElement, root.uses, {}, true);
  return root;
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
  var expandedRoot = expandUses(tree, html);

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
  for (var i = 0; i < jsFiles.length; i++) {
    var servername = map(jsFiles[i]);
    var el = document.createElement('script');
    if (servername) {
      el.setAttribute('src', servername);
    } else {
      el.textContent = jsFiles[i].data;
    }
    body.insertBefore(el, before);

    if (jsWidgetText &&
        jsFiles[i].filename == __dirname + '/public/basewidget.js') {
      // Insert our widget code immediately after basewidget.js.
      var widgetScript = document.createElement('script');
      widgetScript.textContent = jsWidgetText;
      body.insertBefore(widgetScript, el.nextSibling);
    }
  }

  var rapidJs = tree.data({ filename: __dirname + '/rapid.mjs' }).data;
  if (typeof rapidId == 'number' && rapidJs) {
    var renderedJs = mustache.to_html(rapidJs, { id: rapidId });
    var script = document.createElement('script');
    script.textContent = renderedJs;
    body.insertBefore(script, before);
  }

  var jsText = widgetCreateJS(tree, expandedRoot);
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
exports.widgetJS = widgetJS;
exports.html = html;
