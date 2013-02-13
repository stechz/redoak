var _ = require('underscore');
var sheet = require('Sheet');

module.exports = function(fileObj, data) {
  if (!fileObj.process || !data) {
    return { data: data };
  }

  data = data.replace(/\n/g, '');

  var prefixRules = [
      'background-clip', 'background-origin', 'background-size',
      'border-radius', 'border-top-left-radius', 'border-top-right-radius',
      'border-bottom-left-radius', 'border-bottom-right-radius',
      'box-shadow', 'transform', 'transform-origin',
      'transition', 'transition-property', 'transition-duration',
      'transition-timing-function', 'transition-delay',
      'animation', 'animation-property', 'animation-duration',
      'animation-timing-function', 'animation-name', 'animation-delay',
      'animation-direction', 'animation-iteration-count',
      'user-select'];
  prefixRules = _(prefixRules).groupBy(function(s) { return s; });
  // TODO gradients work a little differently in old webkit browsers
  //      http://css-tricks.com/css3-gradients/
  var stylesheet = new sheet.Sheet(data);

  var selectorPrefix = '';

  function addPrefixer(str) {
    return function(prefix) {
      return prefix + str;
    };
  }

  function valueReplacer(cssTokens, value) {
    return function(prefix) {
      var result = value;
      for (var i = 0; i < cssTokens.length; i++) {
        result = result.replace(
            RegExp(cssTokens[i] + '(\\((rgba?(.*?)|.*?)*\\))?'),
            prefix + '$&');
      }
      return result;
    };
  }

  var prefixes = ['-moz-', '-webkit-', '-o-', '-ms-', ''];
  function doStyles(prefix, style) {
    return ['{', _(style).map(function(name) {
      var names = [name];
      var value = style[name];
      var values = [value];

      if (name == 'background-image' || name == 'background') {
        var atoms = ['linear-gradient', 'radial-gradient'];
        values = prefixes.map(valueReplacer(atoms, value));
      } else if (name == 'transition-property' || name == 'transition') {
        var atoms = ['transform'];
        names = prefixes.map(addPrefixer(name));
        values = prefixes.map(valueReplacer(atoms, value));
      }

      if (prefixRules[name]) {
        if (prefix === undefined) {
          names = prefixes.map(addPrefixer(name));
        } else {
          names = [prefix + name];
        }
      }

      if (values[0] == values[1]) {
        values = [values[0]];
      }
      var maxlength = Math.max(names.length, values.length);
      var result = [];
      for (var i = 0; i < maxlength; i++) {
        var namei = Math.min(i, names.length - 1);
        var valuei = Math.min(i, values.length - 1);
        result.push.call(result, names[namei], ':', values[valuei], ';');
      }
      return result;
    }), '}'];
  }

  function doAnimSubRule(prefix, rule) {
    if (rule.cssRules) {
      return [rule.name, '{',
              _(rule.cssRules).map(doAnimSubRule.bind(null, prefix)), '}'];
    } else if (rule.selectorText) {
      return [rule.selectorText, doStyles(prefix, rule.style)];j
    } else {
      return rule.cssText;
    }
  }

  var text = _(stylesheet.cssRules).map(function doRule(rule) {
    if (rule.kind == '@keyframes') {
      function insideText(prefix) {
        return ['{', _(rule.cssRules).map(
            doAnimSubRule.bind(null, prefix)), '}'];
      }
      return ['@-moz-keyframes', rule.name, insideText('-moz-'),
              '@-webkit-keyframes', rule.name, insideText('-webkit-'),
              '@-ms-keyframes', rule.name, insideText('-ms-'),
              '@-o-keyframes', rule.name, insideText('-o-'),
              '@keyframes', rule.name, insideText('')];
    } else if (rule.kind == '@media') {
      return ['@media', rule.name, '{', _(rule.cssRules).map(doRule), '}'];
    } else if (rule.selectorText) {
      var selectorText = selectorPrefix + rule.selectorText;
      return [selectorText, doStyles(undefined, rule.style)];
    } else {
      return rule.cssText;
    }
  });
  return { data: _.flatten(text).join(' ') };
};
