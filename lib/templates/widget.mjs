{loop resources}
Widget.event({{name}}).listen({

  init: function() {
    this.generatedChildren_ = [];
  }

  , html: function(obj) {
    {{code}}
  }

  {if els}
  , els: function() {
    var el = { };
    {loop els.stmts}
      el[{{name}}] = this.el().querySelectorAll({{qs}})[{{qsi}}];
    {/}
    return el;
  }
  {/}

  , claimGeneratedChildren: function(obj) {
    {{use_code}}
  }

  , fill: function(obj) {
  {if fill}
    if (!this.el()) {
      return;
    }

    {loop fill.children}
      {{code}}
      this.el({if ename}{{ename}}{/})
           {if childi}.childNodes[{{childi}}]{/}
           .nodeValue = result;
    {/}

    {loop fill.attrs}
      {{code}}
      this.el({{ename}}).setAttribute({{aname}}, result);
    {/}

    this.claimGeneratedChildren(obj);
    if (this.model) {
      this.model(obj);
    }
  {/}
  }

  {if rendered}
  , rendered: function(obj) {
    {loop rendered.events.stmts}
      this.el({{elname}}).addEventListener(
          {{ename}}, this.emit({{fname}}), false);
    {/}

    this.claimGeneratedChildren(obj);
  }
  {/}
});
{/}
