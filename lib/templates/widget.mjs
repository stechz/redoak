{{#resources}}
Widget.event({{{name}}}).listen({

  init: function() {
    this.generatedChildren_ = [];
  }

  , html: function(obj) {
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

  , claimGeneratedChildren: function(obj) {
    {{{use_code}}}
  }

  , fill: function(obj) {
  {{#fill}}
    if (!this.el()) {
      return;
    }

    {{#children}}
      {{{code}}}
      this.el({{#ename}}{{{.}}}{{/ename}})
           {{#childi}}.childNodes[{{{.}}}]{{/childi}}
           .innerHTML = result;
    {{/children}}

    {{#attrs}}
      {{{code}}}
      this.el({{{ename}}}).setAttribute({{{aname}}}, result);
    {{/attrs}}

    this.claimGeneratedChildren(obj);
    if (this.model) {
      this.model(obj);
    }
  {{/fill}}
  }

  {{#rendered}}
  , rendered: function(obj) {
    {{#events}}
    {{#stmts}}
    this.el({{{elname}}}).addEventListener(
        {{{ename}}}, this.emit({{{fname}}}), false);
    {{/stmts}}
    {{/events}}

    this.claimGeneratedChildren(obj);
  }
  {{/rendered}}
});
{{/resources}}
