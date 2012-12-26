{{#resources}}
Widget.event({{{name}}}).listen({

  html: function(obj) {
    {{{code}}}
  }

  {{#els}}
  , els: function() {
    var el = {};
    {{#stmts}}
    el[{{{name}}}] = this.el().querySelectorAll({{{qs}}})[{{{qsi}}}];
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
      {{{code}}}
      this.el({{{ename}}}).childNodes[{{{childi}}}].nodeValue = result;
    {{/ename}}
    {{^ename}}
      {{{code}}}
      this.el().childNodes[{{{childi}}}].nodeValue = result;
    {{/ename}}
    {{/children}}

    {{#attrs}}
    {{#ename}}
      {{{code}}}
      this.el({{{ename}}}).setAttribute({{{aname}}}, result);
    {{/ename}}
    {{^ename}}
      {{{code}}}
      this.el().setAttribute({{{aname}}}, result);
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
        {{qs}})[{{{qsi}}}], {{{obj}}});
    {{/stmts}}
    {{/child}}
  }
  {{/rendered}}
});
{{/resources}}
