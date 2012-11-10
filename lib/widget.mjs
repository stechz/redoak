{{#resources}}
Widget.event({{{name}}}).listen({

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
    {{#ename}}
    this.el({{{ename}}}).childNodes[{{childi}}].nodeValue =
        Mustache.to_html({{value}}, obj);
    {{/ename}}
    {{^ename}}
    this.el().childNodes[{{childi}}].nodeValue =
        Mustache.to_html({{value}}, obj);
    {{/ename}}
    {{/children}}

    {{#attrs}}
    {{#ename}}
    this.el({{{ename}}}).setAttribute(
        {{{aname}}}, Mustache.to_html({{{value}}}, obj));
    {{/ename}}
    {{^ename}}
    this.el().setAttribute({{{aname}}}, Mustache.to_html({{{value}}}, obj));
    {{/ename}}
    {{/attrs}}

    this.emit('model')(obj);
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
    widget = new Widget({{{mixins}}});
    this.addChild(widget);
    widget.assign(this.el().querySelectorAll(
        {{{qs}}})[{{qsi}}], {{{obj}}});
    {{/stmts}}
    {{/child}}
  }
  {{/rendered}}
});
{{/resources}}
