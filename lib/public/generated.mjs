{{#scripts}}
document.write('<script src={{{.}}}></scrip' + 't>');
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
  parentRendered: function() {
    {{#stmts}}
    document.querySelector({{{qs}}}).addEventListener(
        {{{ename}}}, this.emit({{{fname}}}), false);
    {{/stmts}}
  }
});
{{/has_fn}}
{{/resources}}
