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

  , fill: function(obj, el, aname) {
  {if fill}
    if (!this.el()) {
      return;
    }

    {loop fill.children}
      if (!el || el == this.el({if ename}{{ename}}{/}) && !aname) {
        {{code}}
        this.el({if ename}{{ename}}{/})
             {if childi}.childNodes[{{childi}}]{/}
             .nodeValue = result;
      }
    {/}

    {loop fill.attrs}
      if (!el || el == this.el({{ename}}) && aname == {{aname}}) {
        {{code}}
        this.el({{ename}}).setAttribute({{aname}}, result);
      }
    {/}

    if (!el) {
      // Assume that selectively filling elements doesn't require a complete
      // re-assigning of child widgets.
      this.claimGeneratedChildren(obj);
    }

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
