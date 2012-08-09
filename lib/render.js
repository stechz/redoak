// Rendering functions for a dependency tree.
//
// Use html() to render a dependency tree to an html string.

var _ = require('underscore');
var mustache = require('./public/mustache');
var path = require('path');
var queryselector = require('./queryselector');

/** Find subtree by its name. */
function subtree(tree, filename) {
  if (!tree.length) {
    return [];
  }
  if (tree[0].filename == filename) {
    return tree;
  } else {
    return tree[1].reduce(function(a, b) {
      return a.length ? a : subtree(b, filename);
    }, []);
  }
}

/** Make list of fileObjs unique. */
function uniq(fileObjs) {
  var map = function(fileObj) { return fileObj.filename; };
  return _.uniq(_.flatten(fileObjs), false, map);
}

/** Flattens tree to array of dependencies. */
function flatten(tree) {
  if (!tree.length) {
    return [];
  }

  // The node looks like [fileObj, children]. We swap the order here, so that
  // when the tree is flattened the leaf nodes come first.
  return uniq([tree[1].map(flatten), tree[0]]);
}

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
  var oakFilter = function(d) { return d.type == 'oak'; };
  var fileObjs = flatten(tree);
  return (_.chain(fileObjs).filter(oakFilter).pluck('templates').flatten()
           .value());
}

/**
 * Not every dependency is needed for the root file in a dependency tree. Only
 * the direct dependencies of the root file and all the dependencies for
 * templates are needed. This calculates that subset.
 */
function dependenciesFor(tree) {
  // Grab all template dependencies from oak files, as well as the direct
  // dependencies of the root oak file.
  var oakFilter = function(d) { return d.type == 'oak'; };
  var fileObjs = flatten(tree);
  var dependencies =
      _.chain(allTemplates(tree)).pluck('dependencies').flatten().value();
  dependencies = uniq([_(tree[1]).pluck('0'), dependencies]);

  // Take these dependencies and map them to their subtrees. Flatten out the
  // subtrees so that leaf nodes come first, then flatten out the list of
  // flattened trees.
  return uniq(dependencies.map(function(d) {
    if (d.type == 'oak') {
      // We went through the oak dependencies above. No need to do it again.
      return [];
    }
    var node = subtree(tree, d.filename);
    return flatten(node);
  }));
}

/** Returns array of CSS dependencies. */
function css(tree) {
  return dependenciesFor(tree).filter(function(d) { return d.type == 'css'; });
}

/** Returns array of JS dependencies. */
function js(tree) {
  var dependencies = dependenciesFor(tree);
  var view = { scripts: [], resources: [] };
  var scripts = [];
  for (var i = 0; i < dependencies.length; i++) {
    if (dependencies[i].type == 'js') {
      scripts.push(dependencies[i]);
    }
  }
  return scripts;
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
  var fileObjs = flatten(tree);
  var template = _.find(
      fileObjs, function(x) { return x.filename == widgetName });

  var resources = allTemplates(tree).map(function(template) {
    var resource;
    resource = {
      name: JSON.stringify(template.name),
      data: JSON.stringify(template.data),
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

    var uses = _.chain(makeUses(template.uses)).reverse().value();
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
function widgetCreateJS(tree) {
  var fileObjs = flatten(tree);
  var widgetName = __dirname + '/create.mjs';
  var template = _.find(
      fileObjs, function(x) { return x.filename == widgetName });

  var uses = makeUses(fileObjs[fileObjs.length - 1].uses);
  uses.reverse();

  var view = { has_uses: (uses.length ? [{ uses: uses }] : []) };
  return mustache.to_html(template.data, view);
}

/** Expand DOM use tags and template HTML use tags. */
function expandUses(fileObjs) {
  var root = fileObjs[fileObjs.length - 1];
  var templates = _.flatten(fileObjs.map(function(x) {
    return (x.type == 'oak') ? x.templates : [];
  }));

  var templateFor = function(use) {
    // Use the last mixin that matches a template.
    return use.mixins.reduce(function(x, y) {
      var index = _(templates).pluck('name').indexOf(y);
      return index >= 0 ? templates[index] : x;
    }, null);
  };

  function expandTemplate(node, uses, view) {
    var callbacks = uses.map(function(use, i) {
      // Map to a template. Use the last mixin to match a template.
      var template = templateFor(use);
      if (!template) {
        // TODO: post error system
        console.error('Cannot find template for use.', use.mixins);
        return null;
      }

      var obj;
      try {
        obj = JSON.parse(mustache.to_html(use.obj, view));
      } catch(e) {
        console.error('Could not parse JSON for use.', use.obj);
        return null;
      }
      var newView = _.extend(obj, view);

      // Create an element for the root document.
      var html = mustache.to_html(template.data, newView);
      var div = root.document.createElement('div');
      div.innerHTML = html;
      var el = div.firstChild;

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
    var div = root.document.createElement('div');
    div.innerHTML = template.data;
    template.uses = expandTemplate(div.firstChild, template.uses, {});
    template.data = div.innerHTML;
  });

  root.uses = expandTemplate(root.document, root.uses, {});
}

/**
 * Turn a tree into HTML.
 * @param map Map a fileObj to its server name.
 */
function html(tree, map) {
  var root = tree[0];
  if (!root || !root.document) {
    return '';
  }
  var document = root.document;
  var fileObjs = flatten(tree);
  expandUses(fileObjs);

  var cssFiles = css(tree);
  for (var i = 0; i < cssFiles.length; i++) {
    if (cssFiles[i].process) {
      var el = document.createElement('style');
      el.textContent = cssFiles[i].data;
    } else {
      var el = document.createElement('link');
      el.setAttribute('rel', 'stylesheet');
      el.setAttribute('href', map(cssFiles[i]));
    }
    document.querySelector('head').appendChild(el);
  }

  var jsWidgetText = widgetJS(tree);
  var script = document.createElement('script');
  var before = document.querySelector('body > script');
  var jsFiles = js(tree);
  for (var i = 0; i < jsFiles.length; i++) {
    var el = document.createElement('script');
    el.setAttribute('src', map(jsFiles[i]));
    document.body.insertBefore(el, before);

    if (jsWidgetText &&
        jsFiles[i].filename == __dirname + '/public/basewidget.js') {
      // Insert our widget code immediately after basewidget.js.
      var widgetScript = document.createElement('script');
      widgetScript.textContent = jsWidgetText;
      document.body.insertBefore(widgetScript, el.nextSibling);
    }
  }

  var jsText = widgetCreateJS(tree);
  if (jsText) {
    script = document.createElement('script');
    script.textContent = jsText;
  }
  document.body.appendChild(script);

  if (tree[0].isFragment) {
    return document.body.innerHTML;
  } else {
    // XXX for some reason, document.innerHTML puts the doctype node after the
    //     document element. HTML5 parsers expect this tag at the beginning.
    //     Should fix this properly somehow.
    return ('<!DOCTYPE html>\n' +
            document.innerHTML.replace(/<!doctype html>/i, ''));
  }
}

exports.flatten = flatten;
exports.css = css;
exports.js = js;
exports.widgetJS = widgetJS;
exports.html = html;
