if (typeof require == 'function') {
  var assert = require('assert');
  var oakstache = require('../oakstache/handler');
  var walkerParse = require('./parser').mparse;
}

var walker = (function() {

var DEBUG = false;
var resolve = oakstache.resolve;

/** TODO. */
function matches(obj, fullpath, selector) {
  if (selector.length > fullpath.length + 1) {
    return false;
  }

  var unitMatches = function(path, unit) {
    var newobj = resolve(obj, path);
    if (unit.type == 'any') {
      return true;
    } else if (unit.type == 'any_object') {
      return typeof newobj == 'object' && !Array.isArray(newobj);
    } else if (unit.type == 'any_string') {
      return typeof newobj == 'string';
    } else if (unit.type == 'any_number') {
      return typeof newobj == 'number';
    } else if (unit.type == 'any_array') {
      return Array.isArray(newobj);
    } else if (unit.type == 'string') {
      return unit.content === newobj;
    } else if (unit.type == 'object') {
      var every = unit.filters.every(function(f) {
        if (f.type == 'has') {
          return newobj[f.id] !== undefined;
        } else if (f.type == 'eq') {
          return (newobj && newobj[f.lhs] !== undefined &&
                  newobj[f.id] !== null &&
                  newobj[f.lhs].toString() == f.rhs.toString());
        } else {
          return false;
        }
      });
      return every;
    }
  };

  var matches = [];
  for (var i = 0; i < selector.length; i++) {
    var part = selector[i];
    for (var j = 0; j <= fullpath.length; j++) {
      var k = j;
      var haveMatch = (function decompose(part) {
        if (part.sep === '') {
          return unitMatches(fullpath.slice(0, k), part.unit);
        } else if (part.sep == '.') {
          if (!decompose(part.lhs)) {
            return false;
          }
          k++;
          return part.rhs == fullpath[k - 1];
        } else if (part.sep == '>') {
          if (!decompose(part.lhs)) {
            return false;
          }
          k++;
          return unitMatches(fullpath.slice(0, k), part.rhs);
        }
      })(part);

      if (haveMatch) {
        j = k;
        matches.push([i, j]);
      }
    }
  }

  if (DEBUG) {
    console.log('obj', obj);
    console.log('fullpath', fullpath);
    console.log('selector', JSON.stringify(selector, 0, 2));
    console.log('matches', matches.map(function(x) {
      return ['s', x[0], 'p', x[1], fullpath.slice(0, x[1]).join('.')];
    }));
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

  var getUnitScore = function(unit) {
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

  var getPartScore = function(part) {
    if (part.sep == '') {
      return [0, getUnitScore(part.unit)];
    } else if (part.sep == '>') {
      return [1, getPartScore(part.lhs).concat(getUnitScore(part.rhs))];
    } else if (part.sep == '.') {
      return [2, getPartScore(part.lhs)];
    } else {
      return [-1];
    }
  };

  var getPartScoreLength = function(part) {
    if (part.sep == '') {
      return 1;
    } else if (part.sep == '>') {
      return getPartScoreLength(part.lhs) + getPartScoreLength(part.rhs);
    } else if (part.sep == '.') {
      return 1 + getPartScoreLength(part.lhs);
    } else {
      return -1;
    }
  };
  var add = function(a, b) { return a + b };
  var totalPartScore = selector.map(getPartScoreLength).reduce(add, 0);

  return [totalPartScore, selector.map(getPartScore)];
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
      if (better && matches(topjson, state, selector.selector)) {
        bestMatch = selector;
      }
    });
    return bestMatch;
  };

  // First pass: make a "copy" of object.
  var jsoncopy = (function copy(obj) {
    if (obj === null || obj === undefined) {
      return '';
    } else if (typeof obj === 'boolean') {
      return obj;
    } else if (typeof obj == 'string' || typeof obj == 'number') {
      return obj.toString();
    } else if (Array.isArray(obj)) {
      return obj.map(copy);
    } else if (typeof obj == 'object') {
      var result = {};
      Object.keys(obj).forEach(function(prop) {
        result[prop] = copy(obj[prop]);
      });
      return result;
    } else {
      return '';
    }
  })(topjson);
  
  // Second pass: match with selectors and apply templates.
  var result = (function walk(state) {
    var bestMatch = findBestSelector(state);
    var json = resolve(jsoncopy, state);
    var copyToJson;
    if (Array.isArray(json)) {
      copyToJson = json.map(function(json, i) {
        return walk(state.concat([i]));
      });
    } else if (typeof json == 'object') {
      copyToJson = {};
      Object.keys(json).forEach(function(prop) {
        copyToJson[prop] = walk(state.concat([prop]), json[prop]);
      });
    }

    if (copyToJson) {
      if (state.length > 0) {
        var lastPart = state[state.length - 1];
        resolve(jsoncopy, state.slice(0, -1))[lastPart] = copyToJson;
      } else {
        jsoncopy = copyToJson;
      }
    }

    var result;
    if (bestMatch && bestMatch.declaration) {
      if (bestMatch.literal) {
        result = bestMatch.declaration;
      } else {
        result = oakstache.renderString(
            bestMatch.declaration, jsoncopy, escapefn, state);
        if (DEBUG) {
          console.log('rendered a template to an object');
          console.log('  copyToJson', copyToJson);
          console.log('  decl', bestMatch.declaration);
          console.log('  jsoncopy', jsoncopy);
          console.log('  state', state);
          console.log('  result', result);
        }
      }
    } else {
      result = resolve(jsoncopy, state);
    }

    return result;
  })([]);

  if (Array.isArray(result)) {
    return result.map(function(x) {
      return (typeof x == 'object') ? '' : x;
    }).join('');
  } else if (typeof result == 'object') {
    return '';
  } else {
    return result;
  }
}

if (typeof require == 'function' && require.main == module) {
  // Test matching.

  var selector = walkerParse('{}')[0].selector;
  assert.ok(matches({}, [], selector));

  var selector = walkerParse('{}')[0].selector;
  assert.ok(!matches([], [], selector));

  var selector = walkerParse('{t=mytype}')[0].selector;
  assert.ok(matches({ t: 'mytype' }, [], selector));

  var selector = walkerParse('{a t=true}')[0].selector;
  assert.ok(matches({ a: 5, t: true }, [], selector));
  assert.ok(!matches({ a: 5, t: false }, [], selector));

  var selector = walkerParse('{t=false}')[0].selector;
  assert.ok(!matches({ t: true }, [], selector));
  assert.ok(matches({ t: false }, [], selector));

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

  var json = { a: 4, test: { b: 5 } };
  var tree = walkerParse('{a=4}\n  {{test.b}}\n');
  assert.ok(matches(json, [], tree[0].selector));
  assert.ok(!matches(json, ['test'], tree[0].selector));
  assert.ok(!matches(json, ['test', 'b'], tree[0].selector));

  var selector = walkerParse('[] > ""')[0].selector;
  assert.ok(matches(['a', 'b', 'c'], ['0'], selector));
  assert.ok(!matches([{ a: 'b' }], ['0', 'a'], selector));

  var selector = walkerParse('{}.arr > ""')[0].selector;
  assert.ok(matches({ arr: ['a', 'b', 'c'] }, ['arr', '0'], selector));

  var selector = walkerParse('{}.arr')[0].selector;
  var json = ['test', { type: 'blah', arr: [['a'], ['a', 'b']] }];
  assert.ok(matches(json, ['1', 'arr'], selector));
  assert.ok(!matches(json, ['1', 'arr', '0'], selector));

  var selector = walkerParse('{}.arr *')[0].selector;
  var json = ['test', { type: 'blah', arr: [['a'], ['a', 'b']] }];
  assert.ok(matches(json, ['1', 'arr', '0'], selector));
  assert.ok(matches(json, ['1', 'arr', '0', '0'], selector));

  var selector = walkerParse('{}.arr *')[0].selector;
  var json = ['test', { type: 'blah', clause: { arr: [['a'], ['a', 'b']] }}];
  assert.ok(matches(json, ['1', 'clause', 'arr', '0'], selector));

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

  var selectors = walkerParse('* []\n{}.mything');
  assert.ok(compareSelector(selectors[0], selectors[1]) > 0);

  var selectors = walkerParse('[] > ""\n{}.mything *');
  assert.ok(compareSelector(selectors[0], selectors[1]) > 0);

  var selectors = walkerParse('[]\n* []');
  assert.ok(compareSelector(selectors[0], selectors[1]) > 0);

  // Test rendering.

  var json = { a: { b: { c: 5 } } };
  var tree = walkerParse('*\n  {{a}}{{b}}{{c}}\n{c}\n  hello');
  assert.equal(walk(tree, json), 'hello');

  var json = { a: { b: { c: 5 }, value: 'hello' } };
  var tree = walkerParse('*\n  {{a}}{{b}}{{c}}\n{c}\n  -{{../value}}-');
  assert.equal(walk(tree, json), '-hello-');

  var json = [{ a: 5 }, { a: 6 }, { a: 7 }];
  var tree = walkerParse('[]\n  numbers are {loop .}{{.}}{/}\n{a}\n  {{a}}');
  assert.equal(walk(tree, json), 'numbers are 567');

  var json = ['x should be 5: ', { x: 5 }, '!'];
  var tree = walkerParse('{x}\n  {{x}}\n');
  assert.equal(walk(tree, json), 'x should be 5: 5!');

  var tree = walkerParse('{}.arr\n  {0.0}{1.1}\n{}\n  {arr}');
  var json = ['test', { type: 'blah', arr: [['a'], ['a', 'b']] }];
  assert.equal(walk(tree, json), 'testab');

  var tree = walkerParse('{type=a}')
  var json = { type: undefined };
  assert.equal(walk(tree, json), '');

  var template = 'Hello, {{pagename}}. {loop loop}test{/}';
  var json = oakstache.parse(template);
  var str = '{type=unbound path=pagename} literal\n' +
            '  <title>\n' +
            '    hello\n' +
            '  </title>\n\n' +
            '{type=loop}\n' +
            '  <loop>{loop contents}{{.}}{/}</loop>';
  var tree = walkerParse(str);
  assert.equal(walk(tree, json),
              'Hello, <title>\n  hello\n</title>. <loop>test</loop>');
}

var exports = {};
exports.parse = walkerParse;
exports.walk = walk;
return exports;

})();

if (typeof module == 'object') {
  module.exports = walker;
}
