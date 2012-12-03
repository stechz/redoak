util.namespace('widget');

widget.walker = {
  html: function(ast) {
    var html = '';
    for (var i = 0; i < ast.length; i++) {
      html += widget.walker.stmtHtml(ast[i]) + '</div>';
    }
    return html;
  },

  stmtHtml: function(selector) {
    var result = '<div class="selector"><div class="units">';
    for (var i = 0; i < selector.selector.length; i++) {
      result += widget.walker.unitHtml(selector.selector[i]);
    }
    return result + '</div><div class="declaration"> </div></div>';
  },

  unitHtml: function(unit) {
    var table = {
      any: '*',
      any_string: '""',
      any_object: '{}',
      any_number: 'number',
      any_array: '[]'
    };

    var result = '<div class="unit ' + unit.unit.type + '">';
    if (table[unit.unit.type]) {
      result += table[unit.unit.type];
    } else if (unit.unit.type == 'object') {
      for (var i = 0; i < unit.unit.filters.length; i++) {
        result += widget.walker.filterHtml(unit.unit.filters[i]);
      }
    }

    return result + '<div class="path"> </div></div>';
  },

  filterHtml: function(filter) {
    var result = '<div class="filter ' + filter.type + '">';
    if (filter.type == 'eq') {
      result += '{<span class="lhs"> </span><span class="eq">=</span>';
      result += '<span class="rhs"> </span>}';
    } else if (filter.type == 'has') {
      result += '{<span class="has"> </span>}';
    }
    return result + '</div>';
  }
};

Widget.implement('walker.stmt', {
  els: function() {
    return {
      units: this.el().firstChild,
      declaration: this.el().lastChild
    };
  },

  rendered: function(m) {
    var el = this.el('units').firstChild;
    for (var i = 0; i < m.selector.length; i++) {
      var widget = new Widget(['walker.unit']);
      widget.assign(el, m.selector[i]);
      this.addChild(widget);
      el = el.nextSibling;
    }

    this.el('declaration').firstChild.nodeValue = m.declaration;
  }
});

Widget.implement('walker.unit', {
  rendered: function(m) {
    if (m.unit.type == 'object') {
      var child = this.el().firstChild;
      for (var i = 0; i < m.unit.filters.length; i++) {
        var filter = m.unit.filters[i];
        if (filter.type == 'has') {
          child.firstChild.nextSibling.firstChild.nodeValue = filter.id;
        } else if (filter.type == 'eq') {
          child.firstChild.nextSibling.firstChild.nodeValue = filter.lhs;
          child.lastChild.previousSibling.firstChild.nodeValue = filter.rhs;
        }
        child = child.nextSibling;
      }
    }

    var path = [''].concat(m.path).join('.');
    this.el().lastChild.firstChild.nodeValue = path;
  }
});

Widget.implement('walker.result', {
  init: function() {
    this.register();
  },

  walker: function(ast) {
    this.walker_ = ast;
    this.update();
  },

  json: function(json) {
    this.json_ = json;
    this.update();
  },

  update: function() {
    if (this.walker_ && this.json_) {
      try {
        this.el().firstChild.nodeValue =
            walker.walk(this.walker_, this.json_);
      } catch(e) {}
    }
  }
});
