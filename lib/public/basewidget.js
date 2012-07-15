'require util.js';

/** Basic widget that handles rendering and cleanup. */
function BaseWidget(types, obj) {
  this.element_ = null;
  this.children_ = [];
  this.parent_ = null;
  this.emit = BaseWidget.event.apply(BaseWidget.event, types).emitter(this);
  this.emit('init')(types, obj);

  var template = this.emit('html')();
  if (template) {
    this.renderHTML_ = Mustache.to_html(template, obj);
  }
}

BaseWidget.event = util.event('basewidget');

/** Convenience function. Creates a derivative of BaseWidget. */
BaseWidget.protoCreate = function(types, proto) {
  // TODO: this should go away.
  // Convenience way could be: BaseWidget.event('mytype', { ... });
  // but that doesn't allow you to add functions to it.
  // So this might still be necessary???
  var Obj = function(obj) {
    BaseWidget.call(this, types, obj);
  };
  Obj.prototype = proto;
  util.mixin(Obj.prototype, BaseWidget.prototype);
  return Obj;
};

BaseWidget.prototype = {
  event: BaseWidget.event,

  /** Returns root node of this div. */
  getElement: function() {
    return this.element_;
  },

  /** Returns default place that elements of children are added. */
  getChildrenElement: function() {
    // TODO: should determine result by running emit('getChildrenElement')(w)?
    //       or have a result object.
    return this.element_;
  },

  /**
   * Adds a child widget. If widget is already rendered, inserts element at
   * default place.
   */
  addChild: function(widget) {
    var parent = widget.parent_;
    if (parent) {
      var index = parent.children_.indexOf(widget);
      if (index == -1) {
        throw 'Bad widget state. Widget has parent but not a child of parent.';
      }
      parent.children_.splice(index, 1);
      this.getChildrenElement().appendChild(widget.getElement());
    }
    this.children_.push(widget);
    this.emit('addChild')(widget);
  },

  /**
   * Renders widget and attaches it to an element.
   * @param to An element or a BaseWidget. If a BaseWidget, will call addChild
   *           if it hasn't been called already.
   */
  render: function(to) {
    if (this.element_) {
      throw 'Already rendered.';
    }

    if (this.renderHTML_) {
      var div = document.createElement('div');
      div.innerHTML = this.renderHTML_;

      // Widgets are expected to have one canonical parent element. If there
      // are more, then we expect the coder to wrap it all in a div and simply
      // ignore it here.
      if (div.firstChild) {
        var element = div.firstChild;
        if (to instanceof Element) {
          to.appendChild(element);
        } else {
          if (to.parent_ != this) {
            to.addChild(this);
            this.parent_ = to;
          }
          to.getChildrenElement().appendChild(element);
        }
        this.element_ = element;
      }
    }

    if (!div) {
      throw 'Did not render any element. There is no template.';
    }

    this.emit('parentRendered')();

    // Ensure all child elements are rendered.
    for (var i = 0; i < this.children_.length; i++) {
      if (!this.children_[i].element_) {
        // We could pass in 'this' to render, but it is unnecessary. Obviously,
        // the widget hierarchy has already been set up.
        this.children_[i].render(this.getChildrenElement());
      }
    }

    this.emit('allRendered')();
  },

  /** Cleans up resources used by element. After this, don't use element! */
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

  function create(widget, obj) {
    if (!widget) {
      widget = new BaseWidget(obj.type, obj.model, obj.mixins);
    }
    var children = obj.children;
    for (var i = 0; i < children.length; i++) {
      var child = create(null, children[i]);
      if (child) {
        widget.addChild(child);
      }
    }
    return widget;
  };

  function save(root) {
    if (root.model_) {
      var obj = {
        type:  root.type_,
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

  BaseWidget.event('preserve').listen({
    init: function(type, model, mixins) {
      this.type_ = type;
      this.mixins_ = mixins;
      if (model.id && preserved[model.id]) {
        // This is a root object to be restored.
        var json = preserved[model.id];
        this.model_ = util.mixin(json.model, model);
        create(this, json);
      } else {
        // Not a root object or hasn't been saved yet.
        this.model_ = model;
      }
    },

    allRendered: function() {
      // Find root preserved widget.
      var root = this;
      while ('model_' in root && root.parent_) {
        root = root.parent_;
      }

      if (root.model_.id) {
        preserved[root.model_.id] = save(root);
        localStorage.preserved = JSON.stringify(preserved);
      }
    }
  });
})();
