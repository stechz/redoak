var assert = require('assert');
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
  var resolvefn = typeof obj == 'function' ? obj : resolve.bind(null, obj);
  var matches = [];
  selector.forEach(function(part, i) {
    for (var j = 0; j <= fullpath.length; j++) {
      var path = fullpath.slice(0, j);
      var newobj = resolvefn(path.concat(part.path));
      var unit = part.unit;
      if ((unit.type == 'object' || unit.type == 'any_object') &&
          (typeof newobj != 'object' || Array.isArray(newobj))) {
        continue;
      } else if (unit.type == 'any_string' && typeof newobj != 'string') {
        continue;
      } else if (unit.type == 'any_number' && typeof newobj != 'number') {
        continue;
      } else if (unit.type == 'any_array' && !Array.isArray(newobj)) {
        continue;
      } else if (unit.type == 'object') {
        var every = unit.filters.every(function(f) {
          if (f.type == 'has' && newobj[f.id] === undefined) {
            return false;
          } else if (f.type == 'eq' && f.lhs in newobj &&
                     newobj[f.lhs].toString() != f.rhs.toString()) {
            return false;
          } else {
            return true;
          }
        });
        if (!every) {
          continue;
        }
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
 * -1 if a has priority, >0 is b has priority, and <0 if they are the same.
 */
function compareSelector(a, b) {
  if (!a && !b) {
    return 0;
  } else if (!a) {
    return 1;
  } else if (!b) {
    return -1;
  } else {
    var getFilterScore = function(filter) {
      if (filter.type == 'eq') {
        return 1;
      } else if (filter.type == 'has') {
        return 0;
      } else {
        return -1;
      }
    };

    var getPartScore = function(part) {
      var unit = part.unit;
      if (unit.type == 'object') {
        return [2].concat(unit.filters.map(getFilterScore));
      } else if (unit.type == 'any_object' || unit.type == 'any_number' ||
                 unit.type == 'any_string' || unit.type == 'any_array') {
        return [1];
      } else if (unit.type == 'any') {
        return [0];
      } else {
        return [-1];
      }
    };

    var getSelectorScore = function(selector) {
      return [selector.length].concat(selector.map(getPartScore));
    };

    var ascore = getSelectorScore(a.selector);
    var bscore = getSelectorScore(b.selector);
    var result = (function compare(ascore, bscore) {
      for (var i = 0; i < Math.min(ascore.length, bscore.length); i++) {
        var aisarray = Array.isArray(ascore[i]);
        var bisarray = Array.isArray(bscore[i]);
        assert.equal(aisarray, bisarray);
        if (aisarray) {
          var score = compare(ascore[i], bscore[i]);
          if (score !== 0) {
            return score;
          }
        } else if (ascore[i] !== bscore[i]) {
          return bscore[i] - ascore[i];
        }
      }

      return bscore.length - ascore.length;
    })(ascore, bscore);
    return result;
  }
}

/** Robust way to operate on an AST. */
function walk(selectors, topjson) {
  var resolvefn = function(state) {
    return resolve(topjson, state);
  };

  var findBestSelector = function(state) {
    var bestMatch = null;
    selectors.forEach(function(selector) {
      var better = compareSelector(bestMatch, selector) > 0;
      if (better && matches(resolvefn, state, selector.selector) > 0) {
        bestMatch = selector;
      }
    });
    return bestMatch;
  };

  return (function walk(state, json) {
    var bestMatch = findBestSelector(state);
    var obj;
    if (typeof json == 'string' || typeof json == 'number' ||
        typeof json == 'boolean') {
      obj = json.toString();
    } else if (Array.isArray(json)) {
      var arr = json.map(function(json, i) {
        return walk(state.concat([i]), json);
      });
      obj = arr.join('');
    } else if (typeof json == 'object') {
      obj = {};
      Object.keys(json).forEach(function(prop) {
        obj[prop] = walk(state.concat([prop]), json[prop]);
      });
    } else {
      obj = '';
    }

    if (bestMatch) {
      if (bestMatch.declaration) {
        if (bestMatch.literal) {
          return bestMatch.declaration;
        } else {
          return oakstache.renderString(bestMatch.declaration, obj);
        }
      } else {
        return '';
      }
    } else {
      if (typeof obj == 'object') {
        return '';
      } else {
        return obj;
      }
    }
  })([], json);
}

exports.parse = parser.mparse;
exports.walk = walk;

if (require.main == module) {
  // Test matching.

  var selector = parser.mparse('{}')[0].selector;
  assert.ok(matches({}, [], selector));

  var selector = parser.mparse('{}')[0].selector;
  assert.ok(!matches([], [], selector));

  var selector = parser.mparse('{t=mytype}')[0].selector;
  assert.ok(matches({ t: 'mytype' }, [], selector));

  var selector = parser.mparse('{bar=4}')[0].selector;
  assert.ok(!matches({ bar: 5 }, [], selector));

  var selector = parser.mparse('{t}')[0].selector;
  assert.ok(matches({ t: 'mytype', bar: 5 }, [], selector));

  var selector = parser.mparse('{t}')[0].selector;
  assert.ok(!matches({ bar: 5 }, [], selector));

  var selector = parser.mparse('{b}')[0].selector;
  assert.ok(matches({ t: { b: 5 } }, ['t'], selector));

  var selector = parser.mparse('{t} {b}')[0].selector;
  assert.ok(matches({ t: { b: 5 } }, ['t'], selector));

  // Test comparing.

  var selectors = parser.mparse('{a}\n{b}');
  assert.equal(compareSelector(selectors[0], selectors[1]), 0);

  var selectors = parser.mparse('{a}\n{}');
  assert.ok(compareSelector(selectors[0], selectors[1]) < 0);

  var selectors = parser.mparse('{}\n{a}');
  assert.ok(compareSelector(selectors[0], selectors[1]) > 0);

  var selectors = parser.mparse('{a}\n{a} {b}');
  assert.ok(compareSelector(selectors[0], selectors[1]) > 0);

  // Test rendering.

  var template = 'Hello, {{pagename}}. {{#loop}}test{{/loop}}';
  var json = oakstache.parse(template);
  var str = '{type=unbound name=pagename} literal\n' +
            '  <title>\n' +
            '    hello\n' +
            '  </title>\n\n' +
            '{type=loop}\n' +
            '  <loop>{{contents}}</loop>';
  var tree = parser.mparse(str);
  assert.equal(walk(tree, json),
              'Hello, <title>\n  hello\n</title>. <loop>test</loop>');

  var json = { a: { b: { c: 5 } } };
  var tree = parser.mparse('*\n  {{a}}{{b}}{{c}}\n{c}\n  hello');
  assert.equal(walk(tree, json), 'hello');
}
