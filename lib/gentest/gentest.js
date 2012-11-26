// Sets up a testing environment suitable for testing generated JS.

var _ = require('underscore');
var Mustache = require('../public/mustache.js');
var assert = require('assert');
var dependencies = require('../dependencies');
var fileobj = require('../fileobj');
var fs = require('fs');
var path = require('path');
var render = require('../render');

var document;

var files = fs.readdirSync(__dirname);
var LOAD_WIDGETS = _.compact(files.map(function(x) {
  if (x.match(/\.oak\.html$/)) {
    return {
      filename: path.resolve(__dirname, x),
      type: 'oak'
    };
  }
}));

function testBasic() {
  var widget = new Widget(['foo']);
  var model = { text: 'my button' };
  widget.render(document.body, null, model);
  assert.ok(widget.el('mydiv') == document.querySelector('div.foo > div'));
  assert.ok(widget.el('mydiv').textContent == 'Foo my button.');

  widget.emit('fill')({ text: 'new text' });
  assert.ok(widget.el('mydiv').textContent == 'Foo new text.');
}

// Set up browser-like environment.

document = fileobj.parseHTML('').ownerDocument;

var utilJsName = path.resolve(__dirname, '../public/util.js');
var utiljs = fs.readFileSync(utilJsName, 'utf-8');
eval(utiljs);

var widgetJsName = path.resolve(__dirname, '../public/widget.js');
var widgetjs = fs.readFileSync(widgetJsName, 'utf-8');
eval(widgetjs);

// Generate tree and test our generated code.

var tree = new dependencies.tree(LOAD_WIDGETS, function(tree) {
  var genwidgetjs = render.widgetJS(tree);
  eval(genwidgetjs);

  testBasic();
});
