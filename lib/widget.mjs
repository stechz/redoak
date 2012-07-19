{{#child}}
BaseWidget.event({{{name}}}).listen({
  rendered: function() {
    var el;
    var widget;
    {{#stmts}}
    el = this.getElement().querySelectorAll({{{qs}}})[{{qsi}}];
    widget = new BaseWidget({{{mixins}}}, {{{obj}}}, el);
    this.addChild(widget);
    {{/stmts}}
  }
});
{{/child}}

{{#has_uses}}
(function() {
  var el, widget;

  {{#uses}}
  el = document.querySelectorAll({{{qs}}})[{{qsi}}];
  widget = new BaseWidget({{{mixins}}}, {{{obj}}}, el);
  {{/uses}}

})();
{{/has_uses}}

