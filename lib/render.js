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
  return _.uniq(_.flatten(fileObjs), map);
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
  return dependenciesFor(tree).filter(function(d) {
    return d.type == 'resource' && path.extname(d.filename) == '.css';
  });
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
 * This javascript handles creating widgets and attaching them to the DOM.
 * It also listens for JS events and allows script to render new widgets or
 * change the contents of existing widgets.
 */
function widgetJS(tree) {
  var fileObjs = flatten(tree);
  var widgetName = __dirname + '/widget.mjs';
  var template = _.find(
      fileObjs, function(x) { return x.filename == widgetName });

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

  var uses = makeUses(fileObjs[fileObjs.length - 1].uses);
  uses.reverse();

  var child = fileObjs.filter(function(f) { return f.type == 'oak'; })
                      .map(function(f) {
    return Object.keys(f.templates).map(function(name) {
      return {
        name: JSON.stringify(name),
        stmts: _.chain(makeUses(f.templates[name].uses)).reverse().value()
      };
    });
  });
  child = _.flatten(child, true);
  child = child.filter(function(c) { return c.stmts.length });

  var resources = allTemplates(tree).map(function(template) {
    var resource;
    resource = {
      name: JSON.stringify(template.name),
      data: JSON.stringify(template.data),
      fill: [],
      events: []
    };

    if (template.events.length) {
      resource.events = {
        stmts: template.events.map(function(x) {
          return _.extend({}, {
            qs: JSON.stringify(x[0].qs),
            qsi: x[0].qsi,
            ename: JSON.stringify(x[1]),
            fname: JSON.stringify(x[2])
          })
        })
      };
    }

    if (template.unbound.elements.length) {
      resource.fill = {
        elements: template.unbound.elements.map(function(x) {
          return {
            qs: JSON.stringify(x.qs),
            qsi: x.qsi,
            name: x.name
          };
        }),
        children: template.unbound.children.map(function(x) {
          return {
            qs: JSON.stringify(x.qs),
            qsi: x.qsi,
            ename: x.ename,
            value: JSON.stringify(x.value),
            childi: x.childi
          }
        }),
        attrs: template.unbound.attrs.map(function(x) {
          return {
            qs: JSON.stringify(x.qs),
            qsi: x.qsi,
            ename: x.ename,
            aname: JSON.stringify(x.aname),
            value: JSON.stringify(x.value)
          }
        })
      };
    }

    return resource;
  });
  var view = {
    has_uses: (uses.length ? [{ uses: uses }] : []),
    child: child,
    resources: resources
  };
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

      // Add unbound stuff.
      var eldict = _(template.unbound.elements).groupBy('name');
      template.unbound.attrs.forEach(function(attr) {
        var attrel = queryselector.from(el, eldict[attr.ename][0]);
        attrel.setAttribute(attr.aname, mustache.to_html(attr.value, newView));
      });
      template.unbound.children.forEach(function(child) {
        var childel = queryselector.from(el, eldict[child.ename][0]);
        childel.nodeValue = mustache.to_html(child.value, newView);
      });

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
    var el = document.createElement('link');
    el.setAttribute('rel', 'stylesheet');
    el.setAttribute('href', map(cssFiles[i]));
    document.querySelector('head').appendChild(el);
  }

  var script = document.createElement('script');
  var before = document.querySelector('body > script');
  var jsFiles = js(tree);
  for (var i = 0; i < jsFiles.length; i++) {
    var el = document.createElement('script');
    el.setAttribute('src', map(jsFiles[i]));
    document.body.insertBefore(el, before);
  }

  var jsText = widgetJS(tree);
  if (jsText) {
    script = document.createElement('script');
    script.textContent = jsText;
  }
  document.body.appendChild(script);

  // XXX for some reason, document.innerHTML puts the doctype node after the
  //     document element. HTML5 parsers expect this tag at the beginning.
  //     Should fix this properly somehow.
  return ('<!DOCTYPE html>\n' +
          document.innerHTML.replace(/<!doctype html>/i, ''));
}

exports.flatten = flatten;
exports.css = css;
exports.js = js;
exports.widgetJS = widgetJS;
exports.html = html;
