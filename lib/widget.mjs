{{#child}}
BaseWidget.event({{{name}}}).listen({
  rendered: function(bj) {
    var widget;
    {{#stmts}}
    widget = new BaseWidget({{{mixins}}});
    this.addChild(widget);
    widget.emit('fill')({{{obj}}});
    widget.assign(this.getElement().querySelectorAll({{{qs}}})[{{qsi}}]);
    {{/stmts}}
  }
});
{{/child}}

{{#has_uses}}
(function() {
  var el, widget;

  {{#uses}}
  widget = new BaseWidget({{{mixins}}});
  widget.emit('fill')({{{obj}}});
  widget.assign(document.querySelectorAll({{{qs}}})[{{qsi}}]);
  {{/uses}}

})();
{{/has_uses}}

