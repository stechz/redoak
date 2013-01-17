(function() {
  var el, widget;
  {.loop uses}
  widget = new Widget({{mixins}});
  widget.assign(document.querySelectorAll({qs})[{{qsi}}], {{obj}});
  {/}
})();
