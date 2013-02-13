// Methods for encapsulating where an element lives in the DOM.

var _ = require('underscore');

var classNameRegex = /^(-?[_a-zA-Z]+[_a-zA-Z0-9-]* ?)*$/;

/** Returns a CSS selector that describes the node. */
function describeNode(el) {
  var str = el.tagName.toLowerCase();
  if (!el.tagName) {
    throw new Error('Element does not have tag name.');
  } else if (el.tagName == 'USE') {
    return '*';
  }
  if (el.id) {
    str += '#' + el.id;
  } else if (el.className && el.className.match(classNameRegex)) {
    str += el.className.replace(/^\s+|\s+$/, '').replace(/^|\s+/g, '.');
  }
  return str;
}

var queryselector = {
  describeNode: describeNode,

  /** Returns an object that maps a path from ancestor to element as a QS. */
  to: function(element, ancestor) {
    var el = element;
    var selectors = [];
    while (el != ancestor) {
      selectors.unshift(describeNode(el));
      el = el.parentNode;
    }

    var str = selectors.join(' > ');
    var test = ancestor.querySelectorAll(str);
    return { qs: str, qsi: Array.prototype.indexOf.call(test, element) };
  },

  /** Maps the object back to an element. */
  from: function(ancestor, obj) {
    return ancestor.querySelectorAll(obj.qs)[obj.qsi];
  },

  /** Returns an object that can be used to reconstruct the element's place. */
  objectify: function(el, ancestor) {
    var obj = {};
    el.previousElementSibling = (function(el) {
      // jsdom doesn't implement previousElementSibling.
      el = el.previousSibling;
      while (el && el.nodeType != el.ELEMENT_NODE) {
        el = el.previousSibling;
      }
      return el;
    })(el);

    var qsfor =  el.previousElementSibling ?
                 'previousElementSibling' : 'parentNode';
    return _.extend({ qsfor: qsfor }, this.to(el[qsfor], ancestor));
  },

  /** Injects an element back into the DOM. */
  inject: function(el, ancestor, obj) {
    var reference = this.from(ancestor, obj);
    if (reference) {
      if (obj.qsfor == 'previousElementSibling') {
        reference.parentNode.insertBefore(el, reference.nextSibling);
      } else {
        reference.insertBefore(el, reference.firstChild);
      }
    }
  }
};

if (require.main === module) {
  var assert = require('assert');
  var html = require('./html');

  var document = html.parseHTML('').ownerDocument;

  var use = document.createElement('use');
  use.setAttribute('class', 'test123');
  assert.equal(queryselector.describeNode(use), '*');

  var div = document.createElement('div');
  div.innerHTML = '<div><p class="test abc"></p></div>';
  var to = queryselector.to(div.firstChild.firstChild, div);
  assert.equal(to.qs, 'div > p.test.abc');
  assert.strictEqual(to.qsi, 0);
}

module.exports = queryselector;
