// Mustache-like templating language. This file has functions for parsing a
// template into an abstract syntax tree (AST) and for manipulating the tree.

var parser = require('./parser');

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
function findPathOrElse(obj, path, type) {
  var result = findPath(obj, path);
  if (type == 'inverse') {
    return !!result;
  } else {
    return result === undefined ? '' : result;
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
      var bound = lookup(state, ast.name, 'unbound');
      if (typeof bound == 'string' || typeof bound == 'boolean' ||
          typeof bound == 'number') {
        return bound.toString();
      } else {
        return ast;
      }
    },

    loop: function(ast, state) {
      var bound = lookup(state, ast.path, 'loop');
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
      var bound = lookup(state, ast.path, 'inverse');
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
function renderString(str, obj) {
  return bind(findPathOrElse.bind(null, obj), parser.mparse(str));
}

/** Like renderString, but leaves unbound variables in place. */
function renderStringUnbound(str, obj) {
  var find = function(path, type) {
    var result = findPath(obj, path);
    if (result === undefined) {
      var paths = path.replace(/\.\.$/, '').split('.');
      var name = paths[paths.length - 1];
      if (type == 'unbound') {
        return '{{' + name + '}}';
      } else if (type == 'loop') {
        return '{{#' + name + '}}';
      } else if (type == 'inverse') {
        return '{{^' + name + '}}';
      }
    }
    return result;
  };
  return bind(find, parser.mparse(str));
}

/** Renders ast as a string. */
function astToString(ast, obj) {
  return bind(findPathOrElse.bind(null, obj), ast);
}

exports.parse = parser.mparse;
exports.operate = operate;
exports.findPath = findPath;
exports.bind = bind;
exports.renderString = renderString;
exports.renderStringUnbound = renderStringUnbound;
exports.astToString = astToString;

if (require.main == module) {
  var assert = require('assert');

  assert.equal(findPath({ arr: [1, 2, 3] }, 'arr.1'), 2);
  assert.equal(findPath({ arr: [1, 2, 3] }, 'arr.1..'), 2);

  assert.equal(renderString('test {{123}}', { 123: 'hi' }),
               'test hi');

  assert.equal(renderString('{{^r}}no results{{/r}}', { r: 5 }), '');
  assert.equal(renderString('{{^r}}no results{{/r}}', {}), 'no results');
  assert.equal(renderString('{{#r}}r: {{r}}{{/r}}', { r: 5 }), 'r: 5');

  assert.equal(renderStringUnbound('test {{123}}', { 4: 'hi' }),
               'test {{123}}');

  var str = 'test {{#loop}}{{.}}{{/loop}}';
  var obj = { loop: [1, 2, 3, 4, 5] };
  assert.equal(renderString(str, obj), 'test 12345');

  var str = 'test {{#loop}}Hello, {{name}}.{{/loop}}';
  var obj = { loop: [{ name: 'Ben' }, { name: 'world' }] };
  assert.equal(renderString(str, obj), 'test Hello, Ben.Hello, world.');

  var str = '{{#loop}}Number {{i}} {{/loop}}';
  var obj = { loop: [{ i: 10 }, { i: 0 }] };
  assert.equal(renderString(str, obj), 'Number 10 Number 0 ');
}
