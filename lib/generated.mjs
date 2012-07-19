{{#scripts}}
document.write('<script src={{{.}}}><\/script>');
{{/scripts}}

</script>
<script>

{{#resources}}
BaseWidget.event({{{name}}}).listen(
  { html: function() { return {{{data}}}; }

  {{#fill}}
  , fill: function(obj) {
    {{#elements}}
    var {{{name}}} = this.getElement().querySelectorAll({{{qs}}})[{{qsi}}];
    {{/elements}}

    {{#children}}
    {{{ename}}}.childNodes[{{childI}}].value =
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
