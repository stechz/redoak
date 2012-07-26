{{#resources}}
BaseWidget.event({{{name}}}).listen({

  html: function(obj) {
    var data = {{{data}}};
    return Mustache.to_html(data, obj);
  }

  {{#els}}
  , els: function() {
    var el = {};
    {{#stmts}}
    el[{{{name}}}] = this.el().querySelectorAll({{{qs}}})[{{qsi}}];
    {{/stmts}}
    return el;
  }
  {{/els}}

  {{#fill}}
  , fill: function(obj) {
    if (!this.el()) {
      return;
    }

    {{#children}}
    this.el({{{ename}}}).childNodes[{{childi}}].nodeValue =
        Mustache.to_html({{value}}, obj);
    {{/children}}

    {{#attrs}}
    this.el({{{ename}}}).setAttribute(
        {{{aname}}}, Mustache.to_html({{{value}}}, obj));
    {{/attrs}}
  }
  {{/fill}}

  {{#rendered}}
  , rendered: function() {
    {{#events}}
    {{#stmts}}
    this.el({{{elname}}}).addEventListener(
        {{{ename}}}, this.emit({{{fname}}}), false);
    {{/stmts}}
    {{/events}}

    {{#child}}
    var widget;
    {{#stmts}}
    widget = new BaseWidget({{{mixins}}});
    this.addChild(widget);
    widget.assign(this.el().querySelectorAll(
        {{{qs}}})[{{qsi}}], {{{obj}}});
    {{/stmts}}
    {{/child}}
  }
  {{/rendered}}
});
{{/resources}}
