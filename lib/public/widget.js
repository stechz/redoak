'require util.js';

/** Basic widget that handles rendering, hierarchies, and cleanup. */
function Widget(types) {
  this.els_ = {};
  this.children_ = [];
  this.parent_ = null;
  this.isRegistered_ = false;
  this.types_ = types;
  var event = Widget.event.apply(Widget.event, types);
  event.mixin(this);
  this.emit = event.emitter(this);
  this.emit('init')(types);
}

Widget.event = util.event('widget');

Widget.implement = function() {
  var types = Array.prototype.slice.call(arguments, 0, -1);
  Widget.event.apply(null, types).listen(arguments[arguments.length - 1]);
};

/** Array of registered listeners for broadcasting. */
Widget.registered_ = [];

/** Escape HTML. */
Widget.escapeHtml = function(html) {
  var table = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;',
                '\'': '&#039;' };
  html = html !== undefined && html !== null ? html.toString() : '';
  return html.replace(/[\<\>\&'"]/g, function(match) { return table[match]; });
};

/** */
Widget.isEmptyObject = function(obj) {
  // Things that are empty: false, 0, undefined, null, [].
  return obj === 0 || !obj;
};

/** Broadcast a message for any widgets that match the given types. */
Widget.broadcast = function(types, name) {
  return function() {
    var params = Array.prototype.slice.call(arguments);
    var result = undefined;
    for (var i = 0; i < Widget.registered_.length; i++) {
      var widget = Widget.registered_[i];
      if (util.subset(types, widget.types_)) {
        result = widget.emit(name).apply(widget, params) || result;
      }
    }
    return result;
  };
};

Widget.implement({
  /** Allows this widget to be broadcasted to. */
  register: function() {
    if (!this.isRegistered_) {
      this.isRegistered_ = true;
      Widget.registered_.push(this);
    }
  },

  /**
   * Return an element contained in widget.  If no parameters, returns root
   * element of widget. If one parameter, returns the element specified by
   * name.
   *
   * Note that the named elements dictionary comes from els() event, and it
   * probably isn't wise to manually add your own elements to els_ because it
   * may change the way the fill() event works.
   */
  el: function(name) {
    if (name === undefined) {
      return this.element_;
    } else {
      return this.els_[name];
    }
  },

  /**
   * Adds a child widget. If widget is already rendered, inserts child's
   * element as a child of widget's element.
   */
  addChild: function(widget, i) {
    if (i === undefined) {
      i = this.children_.length;
    }
    var parent = widget.parent_;
    if (parent) {
      var index = parent.children_.indexOf(widget);
      if (index == -1) {
        throw new Error(
            'Bad widget state. Widget has parent but not a child of parent.');
      }
      parent.children_.splice(index, 1);
      this.el().appendChild(widget.el());
    }
    widget.parent_ = this;
    this.children_.splice(i, 0, widget);
    widget.emit('parented')(this);
  },

  /** Removes ith child. */
  removeChild: function(i) {
    if (i < 0) {
      return;
    }
    var child = this.children_.splice(i, 1)[0];
    if (child) {
      child.emit('orphaned')(this);
    }
  },

  /** Returns parent reference. */
  parent: function() {
    return this.parent_;
  },

  /** Returns array of children. */
  children: function() {
    return this.children_.slice();
  },

  /** Assigns widget to an element. Useful for pre-rendering. */
  assign: function(el, obj) {
    if (this.element_) {
      throw new Error('Already rendered.');
    }
    this.element_ = el;
    this.els_ = this.emit('els')() || {};
    this.emit('rendered')(obj);
    this.emit('model')(obj);
  },

  /**
   * Renders widget given obj and attaches it to the DOM.
   * @param to An element. If this is a child of another widget, it's commonly
   *           expected that to belongs to the parent.
   * @param before Insert this element as the sibling before 'before'.
   * @param obj Most widgets are templatized, and will require a view object
   *            for use in rendering the HTML.
   */
  render: function(to, before, obj) {
    if (this.element_) {
      throw new Error('Already rendered.');
    }

    var html = this.emit('html')(obj);
    if (html) {
      var div = document.createElement('div');
      div.innerHTML = html;

      // Widgets are expected to have one canonical parent element. If there
      // are more, then we expect the coder to wrap it all in a div.
      if (div.firstChild) {
        var element = div.firstChild;
        to.insertBefore(element, before);
        this.element_ = element;
      }
    }

    if (!this.element_) {
      throw new Error('Did not render any element. There is no template.');
    }

    this.els_ = this.emit('els')() || {};
    this.emit('rendered')(obj);
    this.emit('model')(obj);
  },

  /** Cleans up resources used by element. After this, don't use widget! */
  dispose: function() {
    this.els_ = {};
    if (this.element_ && this.element_.parentNode) {
      this.element_.parentNode.removeChild(this.element_);
    }
    if (this.parent_) {
      var index = this.parent_.children_.indexOf(this);
      this.parent_.removeChild(index);
    }
    this.element_ = null;
    if (this.children_) {
      for (var i = 0; i < this.children_.length; i++) {
        this.children_[i].dispose();
      }
      this.children_ = [];
    }
    if (this.isRegistered_) {
      this.isRegistered_ = false;
      var index = Widget.registered_.indexOf(this);
      if (index != -1) {
        Widget.registered_.splice(index, 1);
      }
    }
    this.emit = null;
  }
});
