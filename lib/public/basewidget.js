'require util.js';

/** Basic widget that handles rendering, hierarchies, and cleanup.  */
function BaseWidget(types) {
  this.children_ = [];
  this.parent_ = null;
  this.emit = BaseWidget.event.apply(BaseWidget.event, types).emitter(this);
  this.emit('init')(types);
}

BaseWidget.event = util.event('basewidget');

BaseWidget.prototype = {
  event: BaseWidget.event,

  /** Returns root node of this div. */
  getElement: function() {
    return this.element_;
  },

  /**
   * Adds a child widget. If widget is already rendered, inserts child's
   * element as a child of widget's element.
   */
  addChild: function(widget) {
    var parent = widget.parent_;
    if (parent) {
      var index = parent.children_.indexOf(widget);
      if (index == -1) {
        throw new Error(
            'Bad widget state. Widget has parent but not a child of parent.');
      }
      parent.children_.splice(index, 1);
      this.getElement().appendChild(widget.getElement());
    }
    widget.parent_ = this;
    this.children_.push(widget);
    this.emit('addChild')(widget);
  },

  /** Assigns widget to an element. Useful for pre-rendering. */
  assign: function(el, obj) {
    if (this.element_) {
      throw new Error('Already rendered.');
    }
    this.element_ = el;
    this.emit('rendered')(obj);
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

    if (!div) {
      throw new Error('Did not render any element. There is no template.');
    }

    this.emit('rendered')(obj);
  },

  /** Cleans up resources used by element. After this, don't use widget! */
  dispose: function() {
    this.emit('dispose')();
    if (this.element_ && this.element_.parentNode) {
      this.element_.parentNode.removeChild(this.element_);
      this.element_ = null;
    }
    if (this.children_) {
      for (var i = 0; i < this.children_.length; i++) {
        this.children_[i].dispose();
      }
      this.children_ = [];
    }
  }
};

(function() {
  var preserved = JSON.parse(localStorage.preserved || '{}');

  function create(widget, parent, obj) {
    if (!widget) {
      widget = new BaseWidget(obj.mixins);
      parent.addChild(widget);
      widget.render(parent.getElement(), null, obj.model);
    }
    var children = obj.children;
    for (var i = 0; i < children.length; i++) {
      create(null, widget, children[i]);
    }
    return widget;
  };

  function save(root) {
    if (root.model_) {
      var obj = {
        model: root.model_,
        mixins: root.mixins_
      };
      obj.children = [];
      for (var i = 0; i < root.children_.length; i++) {
        var child = save(root.children_[i]);
        if (child) {
          obj.children.push(child);
        }
      }
      return obj;
    }
    return null;
  }

  function onmodel(widget, model) {
    widget.model_ = model;
    if (widget.model_.id && preserved[widget.model_.id]) {
      // Root widget. We don't restore a root widget.
      return;
    }

    // Find root preserved widget.
    var root = widget;
    while ('model_' in root && root.parent_) {
      root = root.parent_;
    }

    if (root.model_ && root.model_.id) {
      preserved[root.model_.id] = save(root);
      localStorage.preserved = JSON.stringify(preserved);
    }
  }

  var self = this;
  BaseWidget.event('preserve').listen({
    init: function(mixins) {
      this.mixins_ = mixins;
    },

    rendered: function(model) {
      if (model) {
        onmodel(this, model);
      }
      if (this.model_.id && preserved[this.model_.id]) {
        // This is a root object to be restored.
        var json = preserved[this.model_.id];
        this.model_ = util.mixin(this.model_, json.model);
        create(this, null, json);
      }
    },

    dispose: function(model) {
      delete this.mixins_;
      if (this.model_) {
        delete this.model_;
      }
      if (this.parent_ && this.parent_.model_) {
        onmodel(this.parent_);
      }
    }
  });

})();

(function() {
  var lookup = {};

  BaseWidget.id = function(name) {
    return lookup[name];
  };

  BaseWidget.event('id').listen({
    rendered: function(model) {
      if (model && typeof model.id == 'string') {
        this.id_ = model.id;
        lookup[model.id] = this;
      }
    },

    dispose: function() {
      if (this.id_) {
        delete lookup[this.id_];
      }
    }
  });
})();
