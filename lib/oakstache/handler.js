// Mustache-like templating language. This file has functions for parsing a
// template into an abstract syntax tree (AST) and for manipulating the tree.

if (typeof require == 'function') {
  var oakstacheParse = require('./parser').mparse;
}

var oakstache = (function() {

/** Escape HTML. */
function escapeHtml(html) {
  var table = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;',
                '\'': '&#039;' };
  return html.replace(/[\<\>\&'"]/g, function(match) { return table[match]; });
}

/** Robust way to operate on an AST. */
function operate(fns, ast, state) {
  return (function helper(state, ast) {
    if (Array.isArray(ast)) {
      var helperfn = helper.bind(null, state);
      return fns.stmts ? fns.stmts(ast, state) : ast.map(helperfn);
    } else if (typeof ast == 'string') {
      return fns.content ? fns.content(ast, state) : ast;
    } else if (ast && typeof ast == 'object') {
      if (ast.type == 'unbound') {
        return fns.unbound ? fns.unbound(ast, state) : ast;
      } else if (ast.type == 'loop') {
        return fns.loop ? fns.loop(ast, state) : ast;
      } else if (ast.type == 'inverse') {
        return fns.inverse ? fns.inverse(ast, state) : ast;
      } else {
        throw new Error('invalid ast: ' + JSON.stringify(ast));
      }
    } else {
      throw new Error('invalid ast: ' + JSON.stringify(ast));
    }
  })(state, ast);
}

/** If path is 'a.b.c' return `obj.a.b.c`. */
function findPath(obj, path) {
  if (path == '.') {
    return obj;
  }
  var paths = path.replace(/\.\.$/, '').split('.');
  for (var i = 0; i < paths.length - 1; i++) {
    var tmp = obj[paths[i]];
    if (typeof tmp == 'object') {
      obj = tmp;
    }
  }
  return obj[paths[paths.length - 1]];
}

/** Like findPath, but returns empty string if it can't find the path. */
function findPathOrElse(escapefn, obj, path, ast) {
  var result = findPath(obj, path);
  if (result === undefined) {
    return '';
  } else if (ast.type == 'unbound' && typeof result == 'object') {
    return '';
  } else if (ast.escape) {
    return escapefn(result.toString());
  } else {
    return result;
  }
}

/** Binds all unbound variables using lookupFn. */
function bind(lookupFn, ast) {
  var lookup = function(state, name, op) {
    return lookupFn(state.concat([name]).join('.'), op);
  };

  var simplify = function(stmts) {
    if (stmts.every(function(s) { return typeof s == 'string'; })) {
      return stmts.join('');
    } else {
      return stmts;
    }
  };

  var transforms = {
    stmts: function(ast, state) {
      return simplify(ast.map(function(ast, i) {
        return operate(transforms, ast, state);
      }));
    },

    unbound: function(ast, state) {
      var bound = lookup(state, ast.path.join('.'), ast);
      if (typeof bound == 'string' || typeof bound == 'boolean' ||
          typeof bound == 'number') {
        return bound.toString();
      } else {
        return ast;
      }
    },

    loop: function(ast, state) {
      var bound = lookup(state, ast.path.join('.'), ast);
      if (bound !== undefined) {
        if (Array.isArray(bound)) {
          return simplify(bound.map(function(obj, i) {
            return operate(transforms, ast.contents,
                           state.concat([ast.path, i]));
          }));
        } else if (bound) {
          return operate(transforms, ast.contents, state.concat([ast.path]));
        } else {
          return '';
        }
      } else {
        return ast;
      }
    },

    inverse: function(ast, state) {
      var bound = lookup(state, ast.path.join('.'), ast);
      if (bound === undefined) {
        return ast;
      } else if (bound) {
        return '';
      } else {
        return operate(transforms, ast.contents, state);
      }
    }
  };

  return operate(transforms, ast, []);
}

/**
 * Convenience function that parses string as an AST and then evaluates the
 * AST using obj as its namespace.
 */
function renderString(str, obj, escapefn) {
  var find = findPathOrElse.bind(null, escapefn || escapeHtml, obj);
  return bind(find, oakstacheParse(str));
}

/** Like renderString, but leaves unbound variables in place. */
function renderStringUnbound(str, obj) {
  var lookup = function(state, name, op) {
    return findPath(obj, state.concat([name]).join('.'), op);
  };

  var simplify = function(stmts) {
    if (stmts.every(function(s) { return typeof s == 'string'; })) {
      return stmts.join('');
    } else {
      return stmts;
    }
  };

  var transforms = {
    stmts: function(ast, state) {
      return simplify(ast.map(function(ast, i) {
        return operate(transforms, ast, state);
      }));
    },

    unbound: function(ast, state) {
      var name = ast.path.join('.');
      var bound = lookup(state, name, ast);
      if (typeof bound == 'string' || typeof bound == 'boolean' ||
          typeof bound == 'number') {
        return bound.toString();
      } else {
        if (ast.escape) {
          return '{{' + name + '}}';
        } else {
          return '{{{' + name + '}}}';
        }
      }
    },

    loop: function(ast, state) {
      var name = ast.path.join('.');
      var bound = lookup(state, name, ast);
      if (bound !== undefined) {
        if (Array.isArray(bound)) {
          return simplify(bound.map(function(obj, i) {
            return operate(transforms, ast.contents,
                           state.concat([ast.path, i]));
          }));
        } else if (bound) {
          return operate(transforms, ast.contents, state.concat([ast.path]));
        } else {
          return '';
        }
      } else {
        return '{{#' + name + '}}' +
               operate(transforms, ast.contents, state.concat([ast.path])) +
               '{{/' + name + '}}';
      }
    },

    inverse: function(ast, state) {
      var name = ast.path.join('.');
      var bound = lookup(state, name, ast);
      if (bound === undefined) {
        return '{{^' + name + '}}' +
               operate(transforms, ast.contents, state.concat([ast.path])) +
               '{{/' + name + '}}';
      } else if (bound) {
        return '';
      } else {
        return operate(transforms, ast.contents, state);
      }
    }
  };

  return operate(transforms, oakstacheParse(str), []);
}

/** Renders ast as a string. */
function astToString(ast, obj) {
  return bind(findPathOrElse.bind(null, escapeHtml, obj), ast);
}

if (typeof require == 'function' && require.main == module) {
  var assert = require('assert');

  assert.equal(findPath({ arr: [1, 2, 3] }, 'arr.1'), 2);
  assert.equal(findPath({ arr: [1, 2, 3] }, 'arr.1..'), 2);

  assert.equal(renderString('{{}}', {}), '');

  assert.equal(renderString('test {{123}}', { 123: 'hi' }),
               'test hi');

  assert.equal(renderString('{{^r}}no results{{/r}}', { r: 5 }), '');
  assert.equal(renderString('{{^r}}no results{{/r}}', {}), 'no results');
  assert.equal(renderString('{{#r}}r: {{r}}{{/r}}', { r: 5 }), 'r: 5');

  assert.equal(renderStringUnbound('test {{123}}', { 4: 'hi' }),
               'test {{123}}');
  assert.equal(renderStringUnbound('test {{#a}}a{{/a}}', {}),
               'test {{#a}}a{{/a}}');

  var str = 'test {{#loop}}{{.}}{{/loop}}';
  var obj = { loop: [1, 2, 3, 4, 5] };
  assert.equal(renderString(str, obj), 'test 12345');

  var str = 'test {{#loop}}Hello, {{name}}.{{/loop}}';
  var obj = { loop: [{ name: 'Ben' }, { name: 'world' }] };
  assert.equal(renderString(str, obj), 'test Hello, Ben.Hello, world.');

  var str = '{{#loop}}Number {{i}} {{/loop}}';
  var obj = { loop: [{ i: 10 }, { i: 0 }] };
  assert.equal(renderString(str, obj), 'Number 10 Number 0 ');

  assert.equal(renderString('<a href="{{{href}}}">', { href: '">hax!' }),
               '<a href="">hax!">');
  assert.equal(renderString('<a href="{{href}}">', { href: '">hax!' }),
               '<a href="&quot;&gt;hax!">');
}

var exports = {};
exports.parse = oakstacheParse;
exports.operate = operate;
exports.findPath = findPath;
exports.bind = bind;
exports.renderString = renderString;
exports.renderStringUnbound = renderStringUnbound;
exports.astToString = astToString;
return exports;

})();

if (typeof module == 'object') {
  module.exports = oakstache;
}
