{{#has_uses}}
(function() {
  var el, widget;

  {{#uses}}
  widget = new BaseWidget({{{mixins}}});
  widget.assign(document.querySelectorAll({{{qs}}})[{{qsi}}], {{{obj}}});
  {{/uses}}

})();
{{/has_uses}}
