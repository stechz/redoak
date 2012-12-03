util.namespace('widget');

widget.json = {
  literal: function(value) {
    return (typeof value == 'number' || typeof value == 'string' ||
            typeof value == 'boolean');
  },

  /** Returns false if obj isn't considered "small enough." */
  smallObjectSize: function(obj, max) {
    var count = 0;
    for (var i in obj) {
      if (!widget.json.literal(obj[i])) {
        return false;
      }

      // Early exit is important for performance. Firebug profile showed
      // a significant savings for large JSON objects with this early
      // return.
      count += i.toString().length + obj.toString().length;
      if (count >= max) {
        return false;
      }
    }
    return true;
  },

  /** Generate entire HTML tree for JSON widgets. */
  html: function html(obj) {
    var keyResult = '';
    var result = ' ';
    var value = obj.value;

    if (typeof obj.key == 'string') {
      keyResult = '<div class="key"> </div>';
    }

    if (widget.json.literal(value)) {
      result = '<div class="value ' + typeof value + '"> ';
      if (typeof value == 'string' && value.length > 80) {
        result += '<span class="more">More</span>';
      }
      result += '</div>';
    } else if (Array.isArray(value)) {
      result = '[ <div class="children">';
      for (var i = 0; i < value.length; i++) {
        result += widget.json.html({ key: i, value: value[i] });
      }
      result += '</div> ]';
    } else if (typeof value == 'object') {
      result = '{ <div class="children">';
      for (var i in value) {
        result += html({ key: i, value: value[i] });
      }
      result += '</div> }';
    }

    return '<div class="branch">' + keyResult + result + '</div>';
  }
};

Widget.implement({
  disposeChildren: function() {
    var children = this.children();
    for (var i = 0; i < children.length; i++) {
      children[i].dispose();
    }
  }
});

Widget.implement('jsonchild', {
  find: function(el) {
    while (el && el.className.indexOf('branch') == -1) {
      el = el.parentNode;
    }
    if (el) {
      el = (function recurse(w) {
        if (w.el() == el) {
          return w;
        }
        var children = w.children();
        for (var i = 0; i < children.length; i++) {
          var result = recurse(children[i]);
          if (result) {
            return result;
          }
        }
      })(this);
    }
    return el;
  },

  html: function(obj) {
    return widget.json.html(obj);
  },

  els: function() {
    return { children: this.el().querySelector('div.children') };
  },

  rendered: function(obj) {
    if (typeof obj.key == 'string') {
      this.el().firstChild.firstChild.nodeValue = obj.key;
    }

    if (widget.json.smallObjectSize(obj.value, 40)) {
      this.el().className += ' simple';
    }

    var value = obj.value;
    if (widget.json.literal(value)) {
      if (typeof value == 'string' && value.length > 80) {
        value = value.replace(/\s+/g, ' ');
        this.expandedValue_ = value;
        value = value.substr(0, 80);
        this.el().className += ' more';
      }

      this.el().lastChild.firstChild.nodeValue = value;
    }

    var self = this;
    var makeWidget = function(key, value, child) {
      var widget = new Widget(['jsonchild']);
      var model = { key: i, value: obj.value[i] };
      widget.assign(child, model);
      self.addChild(widget);
    };

    if (Array.isArray(obj.value)) {
      var child = this.el('children').firstChild;
      for (var i = 0; i < obj.value.length; i++) {
        makeWidget(i, obj.value[i], child);
        child = child.nextSibling;
      }
    } else if (typeof obj.value == 'object') {
      var child = this.el('children').firstChild;
      for (var i in obj.value) {
        makeWidget(i, obj.value[i], child);
        child = child.nextSibling;
      }
    }
  },

  expand: function() {
    if (this.expandedValue_) {
      this.expanded_ = !this.expanded_;
      if (this.expanded_) {
        this.el().lastChild.firstChild.nodeValue = this.expandedValue_;
      } else {
        this.el().lastChild.firstChild.nodeValue =
            this.expandedValue_.substr(0, 80);
      }
    }
  }
});

Widget.implement('json', {
  rendered: function(obj) {
    this.el().addEventListener('click', this.click, false);
  },

  model: function(obj) {
    this.disposeChildren();

    var widget = new Widget(['jsonchild']);
    widget.render(this.el(), null, { key: null, value: obj });
    this.addChild(widget);
  },

  click: function(ev) {
    var widget = this.children()[0].find(ev.target);
    widget.expand();
  }
});
