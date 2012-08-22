var _ = require('underscore');
var dependencies = require('../dependencies');
var fs = require('fs');
var path = require('path');
var render = require('../render');

/** Tidy by damned, we'll do it our own way. */
function pretty(element) {
  return (function walk(node, indent) {
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
      if (!clone.outerHTML.match(/<.*?\/>/)) {
        var end =
            clone.outerHTML.replace(/[\S\s]*<\//, '</').replace(/\s+$/, ' ');
        if (node.parentNode.childNodes.length == 1) {
          w(end);
        } else {
          w(end.replace(/ $/, ''));
        }
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
  })(element, 0).replace('\n', '');
}

var onlyFile = process.argv[2];

var files = fs.readdirSync(__dirname);
var errors = [];
files.forEach(function(file) {
  if (!file.match(/\.oak\.html$/)) {
    return;
  }
  if (onlyFile && path.resolve(__dirname, file) != path.resolve(onlyFile)) {
    return;
  }

  file = path.resolve(__dirname, file);
  var oakfile = file.replace(/.oak.html$/, '.html');
  var relativeFile = path.relative(process.cwd(), file);

  var fileObj = { filename: file, type: 'oak' };
  dependencies.tree([fileObj], function(tree) {
    var element = dependencies.parseHTML(
        render.html(tree, function(f) { return path.basename(f.filename); }));
    var document = element.ownerDocument;

    var error = function(msg) {
      if (!error.called) {
        console.error('For', relativeFile);
      }
      error.called = true;
      console.error.apply(msg, _.toArray(arguments));
    }

    var html;
    if (tree.data().isFragment) {
      html = pretty(element.firstChild);
    } else {
      html = '<!DOCTYPE html>\n' + pretty(element);
    }

    var data = fs.readFileSync(oakfile, 'utf-8');
    html = html.split('\n');
    data = data.slice(0, data.length - 1).split('\n');
    for (var i = 0; i < Math.max(html.length, data.length); i++) {
      if (html[i] != data[i]) {
        for (var j = i ; j < html.length; j++) {
          error('[act:' + j.toString() + ']', html[j]);
        }
        for (var j = i ; j < data.length; j++) {
          error('[exp:' + j.toString() + ']', data[j]);
        }
        break;
      }
    }
    if (html.length < data.length) {
      error('actual does not have enough lines');
    } else if (data.length < html.length) {
      error('expected does not have enough lines');
    }

    errors.push(error.called);
  });
});

process.on('exit', function() {
  var error = errors.reduce(function(a, b) { return a || b; }, false);
  process.exit(error ? 1 : 0);
});
