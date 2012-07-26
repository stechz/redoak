// Logic for todo app.
// By Benjamin Stover

BaseWidget.event('todo:app').listen({
  newTodo: function(e) {
    var input = e.target.elements.input;
    var value = input.value.replace(/^\s+|\s+$/, '');
    if (value) {
      var widget = new BaseWidget(['todo', 'preserve']);
      var view = {
        text: value,
        id: this.children_.length + 1
      };
      this.addChild(widget);
      widget.render(this.getElement(), null, view);
    }
    input.value = '';
    e.preventDefault();
    return false;
  }
});

BaseWidget.event('todo').listen({
  deleteTodo: function(e) {
    his.dispose();
  },
  rendered: function() {
    var parentEl = this.parent_.getElement();
    var form = parentEl.querySelector('form');
    parentEl.insertBefore(this.getElement(), form.nextSibling);
  }
});
