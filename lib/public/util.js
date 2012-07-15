var util = {
  /** Returns true if sub has all items that sup does. */
  subset: function(sub, sup) {
    for (var i = 0; i < sub.length; i++) {
      if (!sup.some(function(x) { return x == sub[i]; })) {
        return false;
      }
    }
    return true;
  },

  /**
   * Creates a namespace object that can be used to send and receive events.
   *
   * These objects can create listeners and emitters.
   * - The listeners are objects with associated 'mixin' names.
   * - The emitters have a list of 'mixin' names for filtering listeners.
   *
   * Emitters will fire to any listeners that match all of the emitter's mixin
   * names. For example:
   *   var event = util.event('all');
   *   event.listen({ describe: function() { alert('all'); } });
   *   event('red').listen({ describe: function() { alert('red'); } });
   *   event('blue').listen({ describe: function(s) { alert('blue' + s); } });
   *   var dragon = event('blue', 'large').emitter();
   *   dragon('describe')(' with scales and breathes fire');
   *   // ^^-- alert 'all' and then 'blue with scales and breathes fire'.
   *
   * Listeners can also have their 'this' reference bound by passing in your
   * own to emitter.
   */
  event: function(/* types... */) {
    var listeners = [];

    // Builds a function that calls all the fns we pass in, bound to thisObj.
    // For efficiency, we build the code using the Function constructor.
    function build(thisObj, fns) {
      var maxlength = 0;
      for (var i = 0; i < fns.length; i++) {
        maxlength = Math.max(maxlength, fns[i].length);
      }

      // Build up parameter string.
      var paramArr = [];
      for (var i = 0; i < maxlength; i++) {
        paramArr.push('a' + i);
      }
      var params = paramArr.length ? ',' + paramArr.toString() : '';

      // Build code.
      var code = [];
      code.push('var result, tmp;');
      var call = '].call(this' + params + '); result = tmp ? tmp : result;';
      for (var i = 0; i < fns.length; i++) {
        code.push('tmp = fns[' + i + call);
      }
      code.push('return result');

      return new Function('fns' + params, code.join('\n')).bind(thisObj, fns);
    }

    function listen(args, obj) {
      if (typeof obj != 'object') {
        throw 'Bad obj';
      }
      listeners.push({ names: args, obj: obj });
    }

    function emitter(args, thisObj) {
      // Build up a mapping from event names to lists of functions to call.
      var fns = {};
      for (var i = 0; i < listeners.length; i++) {
        if (util.subset(listeners[i].names, args)) {
          var keys = Object.keys(listeners[i].obj);
          for (var j = 0; j < keys.length; j++) {
            var name = keys[j];
            var fn = listeners[i].obj[name];
            if (fns[name]) {
              fns[name].push(fn);
            } else {
              fns[name] = [fn];
            }
          }
        }
      }

      // Map list of functions to a built function that calls all of them.
      for (var key in fns) {
        fns[key] = build(thisObj, fns[key]);
      }

      var defaultfn = function() {};
      return function(name) {
        return fns[name] || defaultfn;
      };
    }

    // Return an event builder object. The outer function builds up the mixin
    // types for a thisObj that is passed to emitter. It also allows listeners
    // to register mixins.
    return (function outer(/* types... */) {
      var newThis = this.slice().concat(Array.prototype.slice.call(arguments));
      var result = outer.bind(newThis);
      result.listen = listen.bind(null, newThis);
      result.emitter = emitter.bind(null, newThis);
      return result;
    }).apply(Array.prototype.slice.call(arguments));
  },

  /** Mix in properties of another object, but never override. */
  mixin: function(obj, otherobj) {
    Object.keys(otherobj).forEach(function(key) {
      if (!(key in obj)) {
        obj[key] = otherobj[key];
      }
    });
    return obj;
  }
};
