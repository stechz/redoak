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
      } else if (ast.type == 'if') {
        return fns.if ? fns.if(ast, state) : ast;
      } else if (ast.open) {
        return fns.open ? fns.open(ast, state) : ast;
      } else if (ast.close) {
        return fns.close ? fns.close(ast, state) : ast;
      } else if (ast.type == 'lit') {
        return fns.literal ? fns.literal(ast, state) : ast;
      } else {
        throw new Error('invalid ast: ' + JSON.stringify(ast));
      }
    } else {
      throw new Error('invalid ast: ' + JSON.stringify(ast));
    }
  })(state, ast);
}

function resolve(obj, paths) {
  for (var i = 0; i < paths.length; i++) {
    obj = obj[paths[i]];
    if (obj === undefined) {
      return undefined;
    }
  }
  return obj;
}

function forceStr(obj) {
  if (obj === undefined || obj === null) {
    return '';
  } else if (typeof obj == 'object') {
    return '';
  } else {
    return obj.toString();
  }
}

function stringifyOpenIf(ast) {
  var name = ast.clause.path.type == 'i' ? '.i' : ast.clause.path.join('.');
  var rvalue = ast.clause.value && ast.clause.value.type == 'last' ?
               '.last' : ast.clause.value;
  var result = '{if ';
  if (ast.clause.type == 'simple') {
    result += name;
  } else if (ast.clause.type == 'inverse') {
    result += 'not ' + name;
  } else if (ast.clause.type == 'eq') {
    result += name + ' is ' + rvalue;
  } else if (ast.clause.type == 'neq') {
    result += name + ' is not ' + rvalue;
  }
  return result + '}';
}

function stringifyOpenLoop(ast) {
  return '{loop ' + ast.path.join('.') + '}';
}

/** Binds all unbound variables using lookupFn. */
function bind(ast, obj, state, escapefn, unresolved) {
  state = state || [];
  escapefn = escapefn || escapeHtml;
  unresolved = unresolved || function() {};

  var lookup = function(state, path) {
    if (path.length > 0 &&  path[0].backout) {
      var sliceOff = path[0].backout;
      if (state.length > 1 && typeof state[state.length - 1] == 'number') {
        sliceOff += 1;
      }
      state = state.slice(0, state.length - sliceOff);
      path = path.slice(1);
    }
    return resolve(obj, state.concat(path));
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
      var bound = lookup(state, ast.path);
      if (bound === undefined) {
        return unresolved(ast, state);
      } else if (ast.escape) {
        return escapefn(forceStr(bound));
      } else {
        return forceStr(bound);
      }
    },

    loop: function(ast, state) {
      var bound = lookup(state, ast.path);
      if (bound === undefined) {
        return unresolved(ast, state);
      } else if (Array.isArray(bound)) {
        return simplify(bound.map(function(obj, i) {
          return operate(transforms, ast.contents,
                         state.concat(ast.path, [i]));
        }));
      } else {
        return '';
      }
    },

    'if': function(ast, state) {
      var loopStateI = (function() {
        for (var i = state.length - 1; i >= 0; i--) {
          if (typeof state[i] == 'number') {
            return i;
          }
        }
        return -1;
      });

      var bound = undefined;
      if (ast.clause.path.type == 'i') {
        bound = state[loopStateI()];
      } else {
        bound = lookup(state, ast.clause.path);
        if (bound === undefined) {
          var resolved = unresolved(ast, state);
          if (resolved !== undefined) {
            return resolved;
          }
        }
      }

      var value = ast.clause.value;
      if (value && value.type == 'last') {
        var i = loopStateI();
        value = i === 0 ? obj.length - 1 : state[i - 1].length - 1;
      }

      var clause = ast.clause;
      var isRealObject = typeof bound == 'object' && bound !== null;
      var execute = false;
      if (clause.type == 'eq') {
        execute = !isRealObject && forceStr(bound) == value;
      } else if (clause.type == 'neq') {
        execute = !isRealObject && forceStr(bound) != value;
      } else if (clause.type == 'simple') {
        execute = isRealObject || forceStr(bound);
      } else if (clause.type == 'inverse') {
        execute = !isRealObject && !forceStr(bound);
      }

      if (execute) {
        return operate(transforms, ast.contents, state);
      } else {
        return '';
      }
    },

    open: function(ast, state) {
      return unresolved(ast, state);
    },

    close: function(ast, state) {
      return unresolved(ast, state);
    },

    literal: function(ast, state) {
      return unresolved(ast, state);
    }
  };

  return operate(transforms, ast, state);
}

/**
 * Convenience function that parses string as an AST and then evaluates the
 * AST using obj as its namespace.
 */
function renderString(str, obj, escapefn, state) {
  state = state || [];
  var unresolved = function(ast) {
    if (ast.type == 'if') {
      return undefined;
    } else if (ast.open) {
      if (ast.obj.type == 'loop') {
        return stringifyOpenLoop(ast.obj);
      } else if (ast.obj.type == 'if') {
        return stringifyOpenIf(ast.obj);
      } else {
        return '';
      }
    } else if (ast.close) {
      return '{/}';
    } else if (ast.type == 'lit') {
      return ast.value;
    } else {
      return '';
    }
  };
  return bind(oakstacheParse(str), obj, state, escapefn, unresolved);
}

/** Like renderString, but leaves unbound variables in place. */
function renderStringUnbound(str, obj, escapefn) {
  var unresolved = function(ast, state) {
    if (ast.type == 'loop') {
      return (stringifyOpenLoop(ast) +
              bind(ast.contents, obj, state, escapefn, unresolved) + '{/}');
    } else if (ast.type == 'if') {
      return (stringifyOpenIf(ast) +
              bind(ast.contents, obj, state, escapefn, unresolved) + '{/}');
    } else if (ast.type == 'unbound') {
      var name = ast.path.join('.');
      if (ast.escape) {
        return '{' + name + '}';
      } else {
        return '{{' + name + '}}';
      }
    } else if (ast.open) {
      if (ast.obj.type == 'loop') {
        return stringifyOpenLoop(ast.obj);
      } else if (ast.obj.type == 'if') {
        return stringifyOpenIf(ast.obj);
      } else {
        return '';
      }
    } else if (ast.close) {
      return '{/}';
    } else if (ast.type == 'lit') {
      return '{"""' + ast.value + '"""}';
    }
  };
  return bind(oakstacheParse(str), obj, [], escapefn, unresolved);
}

if (typeof require == 'function' && require.main == module) {
  var assert = require('assert');

  // renderString tests
  (function test(str, json, result, state) {
    try {
      assert.equal(renderString(str, json, undefined, state), result);
    } catch(e) {
      console.log(JSON.stringify(oakstacheParse(str), 0, 2));
      throw e;
    }
    return test;
  })
    // Basic unbound
    ('{}', {}, '')
    ('test {123}', { 123: 'hi' }, 'test hi')
    ('test {abc.123}', { abc: { 123: 'hi' } }, 'test hi')
    ('test {abc.123}', {}, 'test ')

    // Escaped unbound
    ('<a href="{{href}}">', { href: '">hax!' }, '<a href="">hax!">')
    ('<a href="{href}">', { href: '">hax!' }, '<a href="&quot;&gt;hax!">')

    // Literal
    ('{"""{test}"""}', {}, '{test}')

    // If checks
    ('{if not r}no results{/}', { r: 5 }, '')
    ('{if not r}no results{/}', {}, 'no results')
    ('{if r}r: {{r}}{/}', { r: 5 }, 'r: 5')
    ('{if r is 4}r: {{r}}{/}', { r: 5 }, '')
    ('{if r is 5}r: {{r}}{/}', { r: 5 }, 'r: 5')
    ('{if r is r}r: {{r}}{/}', { r: 'r' }, 'r: r')
    ('{if r is r}r: {{r}}{/}', { r: 5 }, '')

    // Loops
    ('test {loop loop}{.}{/}', { loop: [1, 2, 3, 4, 5] }, 'test 12345')
    ('test {loop loop}Hello, {name}.{/}',
     { loop: [{ name: 'Ben' }, { name: 'world' }] },
     'test Hello, Ben.Hello, world.')
    ('{loop loop}Number {{i}} {/}',
     { loop: [{ i: 10 }, { i: 0 }] },
     'Number 10 Number 0 ')
    ('{loop loop}{../bar}{/}', { loop: [1, 2], bar: 3 }, '33')
    ('{loop loop}{bar}{/}', { loop: [1, 2], bar: 3 }, '')

    // Loops with ifs
    ('{loop .}{.}{if not .i is .last}, {/}{/}', [1, 2, 3], '1, 2, 3')
    ('{if loop}{loop loop}{.}{/}{/}', { loop: [1, 2, 3] }, '123')

    // Unresolved open or closed things.
    ('{loop x}', {}, '{loop x}')
    ('{/}', {}, '{/}')

    // Start with state
    ('{a}', { b: { a: 5 } }, '5', ['b'])
    ('{../value}', { b: { a: 5 }, value: 101 }, '101', ['b']);

  // renderStringUnbound tests
  (function test(str, json, result) {
    assert.equal(renderStringUnbound(str, json), result);
    return test;
  })
    ('test {123}', { 4: 'hi' }, 'test {123}')
    ('test {"""{}"""}', {}, 'test {"""{}"""}')
    ('test { }', {}, 'test { }')
    ('test {', {}, 'test {')
    ('test {456', {}, 'test {456')
    ('test {loop a}a{/}', {}, 'test {loop a}a{/}');
}

var exports = {};
exports.resolve = resolve;
exports.parse = oakstacheParse;
exports.operate = operate;
exports.bind = bind;
exports.renderString = renderString;
exports.renderStringUnbound = renderStringUnbound;
return exports;

})();

if (typeof module == 'object') {
  module.exports = oakstache;
}
