var _ = require('underscore');
var dependencies = require('../dependencies');
var fs = require('fs');
var path = require('path');
var post = require('../post');

function pretty(document) {
  return '<!DOCTYPE html>' + (function walk(node, indent) {
    var str = '';
    var w = function(s) {
      str += s;
      return w;
    };
    w.nl = function() {
      str += '\n' + (new Array(indent + 1)).join(' ');
      return w;
    };

    var output = function() {
      var clone = node.cloneNode(false);
      var children = _(node.childNodes).reduce(
          function(a, b) { return a + walk(b, indent + 2); }, '');
      w.nl();
      w(clone.outerHTML.replace(/>[\S\s]*/, '>'));
      if (node.childNodes.length > 1 ||
          node.firstChild && node.firstChild.firstChild) {
        w(children.replace(/\s+$/, ' ')).nl();
      } else {
        w(children);
      }
      var end =
          clone.outerHTML.replace(/[\S\s]*<\//, '</').replace(/\s+$/, ' ');
      if (node.parentNode.childNodes.length == 1) {
        w(end);
      } else {
        w(end.replace(/ $/, ''));
      }
    };

    if (node.nodeType == node.TEXT_NODE) {
      if (node.parentNode.childNodes.length != 1) {
        w(node.value.replace(/\s+/g, ' ').replace(/^ $/, ''));
      } else {
        w(node.value.replace(/\s+/g, ' '));
      }
    } else if (node.tagName) {
      output();
    }
    return str;
  })(document.documentElement, 0);
}

var files = fs.readdirSync(__dirname).map(function(file) {
  if (!file.match(/\.oak\.html$/)) {
    return;
  }

  file = path.resolve(__dirname, file);
  dependencies.dependencies({ name: file, type: 'oak' }, {}, function(tree) {
    var fileObjs = post.flatten(tree, {});
    var document = dependencies.parseHTML(post.html(fileObjs));
    _(document.querySelectorAll('script')).forEach(
        function(s) { s.parentNode.removeChild(s); });

    var html = pretty(document);
    var data = fs.readFileSync(file.replace(/.oak.html$/, '.html'), 'utf-8');
    html = html.split('\n');
    data = data.slice(0, data.length - 1).split('\n');
    for (var i = 0; i < Math.min(html.length, data.length); i++) {
      if (html[i] != data[i]) {
        console.error('[act:' + i.toString() + ']', html[i], '\n' +
                      '[exp:' + i.toString() + ']', data[i]);
      }
    }
    if (html.length < data.length) {
      console.log('actual does not have enough lines');
    } else if (data.length < html.length) {
      console.log('data does not have enough lines');
    }
  });
});
