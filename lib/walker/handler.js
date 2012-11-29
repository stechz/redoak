var parser = require('./parser');
var oakstache = require('../oakstache/handler');

/** If path is 'a.b.c' return `obj.a.b.c`. */
function resolve(obj, paths) {
  for (var i = 0; i < paths.length; i++) {
    obj = obj[paths[i]];
    if (obj === undefined) {
      return undefined;
    }
  }
  return obj;
}

/** TODO. */
function matches(obj, fullpath, selector) {
  var matches = [];
  selector.forEach(function(unit, i) {
    for (var j = 0; j <= fullpath.length; j++) {
      var path = fullpath.slice(0, j + 1);
      var newobj = resolve(obj, path);
      if (newobj.type != unit.id) {
        return;
      } else if (unit.type == 'hasattr' && newobj[unit.attr] === undefined) {
        return;
      } else if (unit.type === 'eqattr' &&
          newobj[unit.lhs].toString() !== unit.rhs) {
        return;
      }
      matches.push([i, j]);
    }
  });

  matches.reverse();
  if (!matches.length) {
    return false;
  } else if (matches[0][0] == selector.length - 1 &&
      matches[0][1] == fullpath.length) {
    var largestMatch = Number.MAX_VALUE;
    for (var i = selector.length - 2; i >= 0; i--) {
      var imatches = matches.filter(function(m) {
        return m[0] == i && m[1] < largestMatch;
      });
      if (!imatches.length) {
        return false;
      } else {
        largestMatch = imatches[imatches.length - 1][1];
      }
    }
    return true;
  } else {
    return false;
  }
}

/**
 * Like CSS, some selectors have priority over other selectors. This returns
 * -1 if a has priority, 1 is b has priority, and 0 if they are the same.
 */
function compareSelector(a, b) {
  if (!a && !b) {
    return 0;
  } else if (!a) {
    return 1;
  } else if (!b) {
    return -1;
  } else {
    return b.selector.length - a.selector.length;
  }
}

/** Robust way to operate on an AST. */
function walk(selectors, topjson) {
  return (function walk(state, json) {
    if (typeof json == 'string' || typeof json == 'number' ||
        typeof json == 'boolean') {
      return json.toString();
    } else if (Array.isArray(json)) {
      var arr = json.map(function(json, i) {
        return walk(state.concat([i]), json);
      });
      return arr.join('');
    } else if (typeof json == 'object') {
      var bestMatch = null;
      selectors.forEach(function(selector) {
        var better = compareSelector(bestMatch, selector) > 0;
        if (better && matches(topjson, state, selector.selector) > 0) {
          bestMatch = selector;
        }
      });

      if (bestMatch && bestMatch.declaration) {
        if (bestMatch.literal) {
          return bestMatch.declaration;
        } else {
          var newjson = {};
          Object.keys(json).forEach(function(prop) {
            newjson[prop] = walk(state.concat([prop]), json[prop]);
          });
          return oakstache.renderString(bestMatch.declaration, newjson);
        }
      } else {
        return '';
      }
    } else {
      return '';
    }
  })([], json);
}

if (require.main == module) {
  var assert = require('assert');

  // Test matching.

  var selector = parser.mparse('mytype\n  hello world')[0].selector;
  assert.ok(matches({ type: 'mytype' }, [], selector));

  var selector = parser.mparse('mytype[bar]\n  hello world')[0].selector;
  assert.ok(matches({ type: 'mytype', bar: 5 }, [], selector));

  var selector = parser.mparse('mytype[bar=4]\n  hello world')[0].selector;
  assert.ok(!matches({ type: 'mytype', bar: 5 }, [], selector));

  var selector = parser.mparse('mytype[bar=5]\n  hello world')[0].selector;
  assert.ok(matches({ type: 'mytype', bar: 5 }, [], selector));

  // Test rendering.

  var template = 'Hello, {{pagename}}. {{#loop}}test{{/loop}}';
  var json = oakstache.parse(template);
  var str = 'unbound[name=pagename]:literal\n' +
            '  <title>\n' +
            '    hello\n' +
            '  </title>\n\n' +
            'loop\n' +
            '  <loop>{{contents}}</loop>';
  var tree = parser.mparse(str);
  assert.equal(walk(tree, json),
              'Hello, <title>\n  hello\n</title>. <loop>test</loop>');
}
