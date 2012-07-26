// Logic for todo app.

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
      widget.render(this.el(), null, view);
    }
    input.value = '';
    e.preventDefault();
    return false;
  },

  deleteTodos: function(e) {
    var children = this.children();
    for (var i = 0; i < children.length; i++) {
      var checkbox = children[i].el().querySelector('input');
      if (checkbox.checked) {
        children[i].dispose();
      }
    }
  }
});

BaseWidget.event('todo').listen({
  rendered: function() {
    var parentEl = this.parent_.el();
    var form = parentEl.querySelector('form');
    parentEl.insertBefore(this.el(), form.nextSibling);
  },

  click: function() {
    var checkbox = this.el().querySelector('input');
    if (checkbox.checked) {
      this.el().className = 'todo done';
    } else {
      this.el().className = 'todo';
    }
  }
});
