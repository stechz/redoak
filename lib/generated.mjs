{{#scripts}}
document.write('<script src={{{.}}}><\/script>');
{{/scripts}}

</script>
<script>

{{#resources}}
{{#hasnt_fn}}
BaseWidget.event({{{name}}}).listen({ html: function() {
  return {{{data}}};
}});
{{/hasnt_fn}}
{{#has_fn}}
BaseWidget.event({{{name}}}).listen({
  html: function() { return {{{data}}}; },
  rendered: function() {
    {{#stmts}}
    this.getElement().querySelectorAll({{{qs}}})[{{qsi}}].addEventListener(
        {{{ename}}}, this.emit({{{fname}}}), false);
    {{/stmts}}
  }
});
{{/has_fn}}
{{/resources}}
