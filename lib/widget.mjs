{{#resources}}
BaseWidget.event({{{name}}}).listen({

  html: function(obj) {
    var data = {{{data}}};
    return obj ? Mustache.to_html(data, obj) : data;
  }

  {{#fill}}
  , fill: function(obj) {
    if (!this.getElement()) {
      return;
    }

    {{#elements}}
    var {{{name}}} = this.getElement().querySelectorAll({{{qs}}})[{{qsi}}];
    {{/elements}}

    {{#children}}
    {{{ename}}}.childNodes[{{childi}}].nodeValue =
        Mustache.to_html({{value}}, obj);
    {{/children}}

    {{#attrs}}
    {{{ename}}}.setAttribute({{{aname}}}, Mustache.to_html({{{value}}}, obj));
    {{/attrs}}
  }
  {{/fill}}

  {{#events}}
  , rendered: function() {
    {{#stmts}}
    this.getElement().querySelectorAll({{{qs}}})[{{qsi}}].addEventListener(
        {{{ename}}}, this.emit({{{fname}}}), false);
    {{/stmts}}
  }
  {{/events}}
});
{{/resources}}

{{#child}}
BaseWidget.event({{{name}}}).listen({
  rendered: function(bj) {
    var widget;
    {{#stmts}}
    widget = new BaseWidget({{{mixins}}});
    this.addChild(widget);
    widget.assign(this.getElement().querySelectorAll(
        {{{qs}}})[{{qsi}}], {{{obj}}});
    {{/stmts}}
  }
});
{{/child}}

{{#has_uses}}
(function() {
  var el, widget;

  {{#uses}}
  widget = new BaseWidget({{{mixins}}});
  widget.assign(document.querySelectorAll({{{qs}}})[{{qsi}}], {{{obj}}});
  {{/uses}}

})();
{{/has_uses}}
