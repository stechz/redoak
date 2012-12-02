if (typeof require == 'function') {
  var assert = require('assert');
  var oakstache = require('../oakstache/handler');
  var walkerParse = require('./parser').mparse;
}

var walker = (function() {

var DEBUG = false;

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
  if (selector.length > fullpath.length + 1) {
    return false;
  }

  var resolvefn = typeof obj == 'function' ? obj : resolve.bind(null, obj);
  var matches = [];
  selector.forEach(function(part, i) {
    for (var j = 0; j <= fullpath.length; j++) {
      var path = fullpath.slice(0, j);
      var newobj = resolvefn(path);
      var unit = part.unit;
      if ((unit.type == 'object' || unit.type == 'any_object') &&
          (typeof newobj != 'object' || Array.isArray(newobj))) {
        continue;
      } else if ((unit.type == 'any_string' || unit.type == 'string') &&
                 typeof newobj != 'string') {
        continue;
      } else if (unit.type == 'any_number' && typeof newobj != 'number') {
        continue;
      } else if (unit.type == 'any_array' && !Array.isArray(newobj)) {
        continue;
      } else if (unit.type == 'string' && part.content != newobj) {
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

      if (j + part.path.length <= fullpath.length) {
        (function() {
          for (var k = 0; k < part.path.length; k++) {
            if (part.path[k] != fullpath[j + k]) {
              return;
            }
          }
          matches.push([i, j + part.path.length]);
        })();
      }

      j += part.path.length;
    }
  });

  if (DEBUG) {
    console.log('obj', obj);
    console.log('fullpath', fullpath);
    console.log('selector', selector);
    console.log('matches', matches);
    console.log();
  }

  if (!matches.length) {
    return false;
  } else {
    return (function selectorsForAll(selectorI, fullPathI) {
      var exists = matches.some(function(m) {
        return m[0] == selectorI && m[1] == fullPathI;
      });

      if (selectorI < 0 || selectorI <= 0 && exists) {
        // Base case. No selectors left to check.
        return true;
      } else if (exists) {
        for (var i = fullPathI - 1; i >= 0; i--) {
          if (selectorsForAll(selectorI - 1, i)) {
            return true;
          }
        }
        return false;
      } else {
        return false;
      }
    })(selector.length - 1, fullpath.length);
  }
}

function getSelectorScore(selector) {
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
    } else if (unit.type == 'string') {
      return [2];
    } else if (unit.type == 'any_object' || unit.type == 'any_number' ||
               unit.type == 'any_string' || unit.type == 'any_array') {
      return [1];
    } else if (unit.type == 'any') {
      return [0];
    } else {
      return [-1];
    }
  };

  return [selector.length].concat(selector.map(getPartScore));
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
    var ascore = getSelectorScore(a.selector);
    var bscore = getSelectorScore(b.selector);
    var result = (function compare(ascore, bscore) {
      for (var i = 0; i < Math.min(ascore.length, bscore.length); i++) {
        var aisarray = Array.isArray(ascore[i]);
        var bisarray = Array.isArray(bscore[i]);
        if (typeof assert != 'undefined') {
          assert.equal(aisarray, bisarray);
        }
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
function walk(selectors, topjson, escapefn) {
  var resolvefn = function(state) {
    return resolve(topjson, state);
  };

  var findBestSelector = function(state) {
    var bestMatch = null;
    selectors.forEach(function(selector) {
      var better = compareSelector(bestMatch, selector) > 0;
      if (better && matches(resolvefn, state, selector.selector)) {
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
          return oakstache.renderString(bestMatch.declaration, obj, escapefn);
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
  })([], topjson);
}

if (typeof require == 'function' && require.main == module) {
  // Test matching.

  var selector = walkerParse('{}')[0].selector;
  assert.ok(matches({}, [], selector));

  var selector = walkerParse('{}')[0].selector;
  assert.ok(!matches([], [], selector));

  var selector = walkerParse('{t=mytype}')[0].selector;
  assert.ok(matches({ t: 'mytype' }, [], selector));

  var selector = walkerParse('{bar=4}')[0].selector;
  assert.ok(!matches({ bar: 5 }, [], selector));

  var selector = walkerParse('{t}')[0].selector;
  assert.ok(matches({ t: 'mytype', bar: 5 }, [], selector));

  var selector = walkerParse('{t}')[0].selector;
  assert.ok(!matches({ bar: 5 }, [], selector));

  var selector = walkerParse('{b}')[0].selector;
  assert.ok(matches({ t: { b: 5 } }, ['t'], selector));

  var selector = walkerParse('{t} {b}')[0].selector;
  assert.ok(matches({ t: { b: 5 } }, ['t'], selector));

  var selector = walkerParse('[]')[0].selector;
  assert.ok(matches([], [], selector));

  var selector = walkerParse('{} [] ""')[0].selector;
  assert.ok(!matches(['test', { a: 'b' }], ['0'], selector));

  var selector = walkerParse('{} [] ""')[0].selector;
  assert.ok(matches([{ a: ['a', 'b', 'c'] }], ['0', 'a', '0'], selector));

  var selector = walkerParse('{}.a')[0].selector;
  assert.ok(matches({ a : 5 }, ['a'], selector));

  var selector = walkerParse('{}.a ""')[0].selector;
  assert.ok(!matches({ a : [''],  b: { a: [''], c: '' } },
            ['b', 'c'], selector));

  var selector = walkerParse('{} "bark"')[0].selector;
  assert.ok(matches({ a : 'bark' }, ['a'], selector));

  // Test comparing.

  var selectors = walkerParse('{a}\n{b}');
  assert.equal(compareSelector(selectors[0], selectors[1]), 0);

  var selectors = walkerParse('{a}\n{}');
  assert.ok(compareSelector(selectors[0], selectors[1]) < 0);

  var selectors = walkerParse('{}\n{a}');
  assert.ok(compareSelector(selectors[0], selectors[1]) > 0);

  var selectors = walkerParse('{a}\n{a} {b}');
  assert.ok(compareSelector(selectors[0], selectors[1]) > 0);

  var selectors = walkerParse('{}\n{} []');
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
  var tree = walkerParse(str);
  assert.equal(walk(tree, json),
              'Hello, <title>\n  hello\n</title>. <loop>test</loop>');

  var json = { a: { b: { c: 5 } } };
  var tree = walkerParse('*\n  {{a}}{{b}}{{c}}\n{c}\n  hello');
  assert.equal(walk(tree, json), 'hello');

  var json = [{ a: 5 }, { a: 6 }, { a: 7 }];
  var tree = walkerParse('[]\n  numbers are {{.}}\n{a}\n  {{a}}');
  assert.equal(walk(tree, json), 'numbers are 567');

  var json = ['x should be 5: ', { x: 5 }, '!'];
  var tree = walkerParse('{x}\n  {{x}}\n');
  assert.equal(walk(tree, json), 'x should be 5: 5!');
}

var exports = {};
exports.parse = walkerParse;
exports.walk = walk;
return exports;

})();

if (typeof module == 'object') {
  module.exports = walker;
}
