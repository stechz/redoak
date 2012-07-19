// Post tree operations.
// By Benjamin Stover.

var _ = require('underscore');
var mustache = require('mustache');
var queryselector = require('./queryselector');

/** Flattens a dependencies tree into an array. */
function flatten(tree, keysInserted) {
  if (tree.length) {
    var name = tree[0].filename;
    if (keysInserted[name]) {
      return [];
    } else {
      var result = [];
      for (var i = 0; i < tree[1].length; i++) {
        result.push.apply(result, flatten(tree[1][i], keysInserted));
      }
      result.push(tree[0]);
      return result;
    }
  } else {
    return [];
  }
}

/** Renders CSS output given array with some template objects. */
function renderCSS(fileObjs, map) {
  var css = fileObjs.filter(function(x) { return x.type == 'template' });
  var template = '{{#templates}}{{{css}}}\n{{/templates}}';
  return mustache.to_html(template, { templates: css });
}

/**
 * Renders script output given array of deps.
 *
 * @param map Maps file objects to paths on server.
 */
function renderJS(fileObjs, map) {
  var view = {
    scripts: [],
    resources: []
  };

  var generatedTemplate = '';
  for (var i = 0; i < fileObjs.length; i++) {
    if (fileObjs[i].filename == __dirname + '/generated.mjs') {
      generatedTemplate = fileObjs[i].data;
    }
    else if (fileObjs[i].type == 'js') {
      view.scripts.push(JSON.stringify(map(fileObjs[i])));
    } else if (fileObjs[i].type == 'oak') {
      var keys = Object.keys(fileObjs[i].templates);
      for (var j = 0; j < keys.length; j++) {
        var template = fileObjs[i].templates[keys[j]];
        var resource;
        if (template.events.length) {
          resource = {
            has_fn: [{
              name: JSON.stringify(keys[j]),
              data: JSON.stringify(template.data),
              uses: template.uses,
              stmts: template.events.map(function(x) {
                return {
                  qs: JSON.stringify(x[0]),
                  ename: JSON.stringify(x[1]),
                  fname: JSON.stringify(x[2])
                };
              })
            }]
          };
        } else {
          resource = {
            hasnt_fn: [{
              name: JSON.stringify(keys[j]),
              data: JSON.stringify(template.data).replace(/\//g, '\\/'),
              has_fn: false
            }]
          };
        }
        view.resources.push(resource);
      }
    }
  }

  if (!generatedTemplate) {
    return '';
  }
  return mustache.to_html(generatedTemplate, view);
}

/** TODO */
function renderWidgetJS(fileObjs) {
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

  var child = fileObjs.filter(function(f) { return f.type == 'oak'; })
                      .map(function(f) {
    return Object.keys(f.templates).map(function(name) {
      return {
        name: JSON.stringify(name),
        stmts: makeUses(f.templates[name].uses)
      };
    });
  });
  child = _.flatten(child, true);
  child = child.filter(function(c) { return c.stmts.length });

  var view = { has_uses: (uses ? [{ uses: uses }] : []), child: child };
  return mustache.to_html(template.data, view);
}

/** TODO */
function expandUses(root) {
  var templateFor = function(use) {
    // Use the last mixin that matches a template.
    return use.mixins.reduce(
        function(x, y) { return root.templates[y] || x; }, null);
  };

  function recurse(node, uses, view) {
    return uses.map(function(use, i) {
      // Map to a template. Use the last mixin to match a template.
      var template = templateFor(use);
      if (!template) {
        // TODO: post error system
        console.error('Cannot find template for use.', use);
        return [];
      }

      var obj;
      try {
        obj = JSON.parse(mustache.to_html(use.obj, view));
      } catch(e) {
        console.error('Could not parse JSON for use.', use.obj);
        return [];
      }
      var newView = _.extend(obj, view);

      // Create an element for the root document.
      var html = mustache.to_html(template.data, newView);
      var div = root.document.createElement('div');
      div.innerHTML = html;
      var el = div.firstChild;

      console.log(node.outerHTML);

      // Insert into DOM.
      queryselector.inject(el, node, use);
      if (el.parentNode == div) {
        // TODO: post error system
        console.error('Queryselector inject did not work.', use);
        return [];
      }

      var qsobj = queryselector.to(el, node);
      console.log(el.textContent);
      console.log(JSON.stringify(qsobj, 0, 2));
      console.log(node.outerHTML + '\n\n\n---------\n\n\n');
      return _.extend({}, use, qsobj);
    });
  }

  var keys = Object.keys(root.templates);
  keys.forEach(function(name) {
    var template = root.templates[name];
    var div = root.document.createElement('div');
    div.innerHTML = template.data;
    template.uses = recurse(div.firstChild, template.uses, {});
    template.data = div.innerHTML;
  });

  root.uses = recurse(root.document, root.uses, {});
}

/** TODO */
function html(fileObjs) {
  var root = fileObjs[fileObjs.length - 1];
  if (!root || !root.document) {
    return '';
  }
  var document = root.document;
  expandUses(root);

  var cssText = renderCSS(
      fileObjs, function(x) { return x.servername });
  if (cssText) {
    var css = document.createElement('style');
    document.querySelector('head').appendChild(css);
    css.textContent = cssText;
  }

  var script = document.createElement('script');
  var before = document.querySelector('body > script');
  document.body.insertBefore(script, before);
  script.textContent = renderJS(
      fileObjs, function(x) { return x.servername; });

  script = document.createElement('script');
  script.textContent = renderWidgetJS(fileObjs);
  document.body.appendChild(script);

  // XXX for some reason, document.innerHTML puts the doctype node after the
  //     document element. HTML5 parsers expect this tag at the beginning.
  //     Should fix this properly somehow.
  return ('<!DOCTYPE html>' +
          document.innerHTML.replace(/<!doctype html>/i, ''));
}

exports.flatten = flatten;
exports.expandUses = expandUses;
exports.renderCSS = renderCSS;
exports.renderJS = renderJS;
exports.renderWidgetJS = renderWidgetJS;
exports.html = html;
