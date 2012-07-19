{{#child}}
BaseWidget.event({{{name}}}).listen({
  rendered: function(obj) {
    var el, widget, newObj;
    {{#stmts}}
    el = this.getElement().querySelectorAll({{{qs}}})[{{qsi}}];
    newObj = Mustache.to_html({{{obj}}}, obj);
    widget = new BaseWidget({{{mixins}}}, newObj, el);
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

