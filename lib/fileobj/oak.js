var _ = require('underscore');
var html = require('../html');
var path = require('path');
var queryselector = require('../queryselector');

function processTemplate(template) {
  var document = template.ownerDocument;
  template.parentNode.removeChild(template);
  var name = template.getAttribute('name');
  if (!name) {
    throw new Error('template but no name');
  }

  // Find all template dependencies.
  var links = template.querySelectorAll(
      'link[rel=stylesheet][href], link[rel=js][href]');
  var dependencies = _.compact(_(links).map(function(link) {
    var useOak = !link.hasAttribute('oak-no');
    var data = '';
    var href = link.getAttribute('href');
    var el = null;
    link.parentNode.removeChild(link);

    if (href.charAt(0) == '#') {
      // Allow inline scripts.
      el = document.getElementById(href.substr(1));
      if (el) {
        el.parentNode.removeChild(el);
        href = '';
      } else {
        return;
      }
    }

    return {
      process: useOak,
      type: link.getAttribute('rel') == 'js' ? 'js' : 'css',
      filename: href,
      fromTemplate: true,
      element: el
    };
  }));

  var elements = [];
  var all = template.querySelectorAll('template *');

  // unbound will be an array of tuples.
  //   the first item contains unbound data for child nodes.
  //   the second item contains unbound data for attributes.
  var unboundFilter = function(x) { return x.match(/{/); };
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
    if (el.oakBlockDepth > 0) {
      return;
    }
    var name = el.getAttribute('oak-name');
    el.removeAttribute('oak-name');
    elements.push(el);
    return { name: name, eindex: elements.length - 1 };
  });
  elementNames = _.compact(elementNames);

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

  return {
    elementNames: elementNames,
    elements: qselements,
    events: events,
    name: name,
    data: template.innerHTML.replace(/^\s+|\s+$/, ''),
    dependencies: dependencies,
    unbound: unbound,
    hasUses: !!template.querySelectorAll('use').length,
    document: template.ownerDocument
  };
}

module.exports = function(fileObj, data) {
  var element = html.parseHTML(data);
  var document = element.ownerDocument;

  // Gather up templates.
  var templateEls = _(document.querySelectorAll('template'));
  var templates = templateEls.map(processTemplate);

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
      filename: path.resolve(__dirname, '../templates/rapid.mjs'),
      type: 'mjs'
    });
  }

  var out = {};
  out.templates = templates;
  out.isFragment = element != document.documentElement;
  out.document = document;
  out.fileObjs = [fileObjs, _(templates).pluck('dependencies')];
  return out;
};
