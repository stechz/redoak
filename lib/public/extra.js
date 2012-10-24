(function() {
  var preserved = JSON.parse(localStorage.preserved || '{}');

  function create(widget, parent, obj) {
    if (!widget) {
      widget = new Widget(obj.mixins);
      parent.addChild(widget);
      widget.render(parent.el(), null, obj.model);
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

  function findAndSaveRoot(widget) {
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
  Widget.event('preserve').listen({
    init: function(mixins) {
      this.mixins_ = mixins;
    },

    rendered: function(model) {
      if (!model) {
        return;
      }

      this.model_ = model;
      if (model.id && preserved[model.id]) {
        // This is a root object to be restored.
        var json = preserved[model.id];
        this.model_ = util.mixin(this.model_, json.model);
        create(this, null, json);
      } else {
        findAndSaveRoot(this);
      }
    },

    dispose: function(model) {
      delete this.mixins_;
      if (this.model_) {
        delete this.model_;
      }
      if (this.parent_ && this.parent_.model_) {
        findAndSaveRoot(this.parent_);
      }
    }
  });

})();

(function() {
  var lookup = {};

  Widget.id = function(name) {
    return lookup[name];
  };

  Widget.event('id').listen({
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
