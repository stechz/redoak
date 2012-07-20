{{#scripts}}
document.write('<script src={{{.}}}><\/script>');
{{/scripts}}

</script>
<script>

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
