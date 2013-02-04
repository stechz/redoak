(function() {
  var el, widget;
  {loop uses}
  widget = new Widget([{loop mixins}{.}{if not .i is .last}, {/}{/}]);
  widget.assign(document.querySelectorAll({qs})[{{qsi}}], {{obj}});
  {/}
})();
