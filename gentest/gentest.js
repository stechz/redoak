// Sets up a testing environment suitable for testing generated JS.

var _ = require('underscore');
var assert = require('assert');
var dependencies = require('../lib/dependencies');
var html = require('../lib/html');
var fs = require('fs');
var path = require('path');
var render = require('../lib/render');

var document;

var files = fs.readdirSync(__dirname);
var LOAD_WIDGETS = _.compact(files.map(function(x) {
  if (x.match(/\.oak\.html$/)) {
    return { filename: path.resolve(__dirname, x), type: 'oak' };
  }
}));

function testBasic() {
  var widget = new Widget(['foo']);
  var model = { text: 'my button' };
  widget.render(document.body, null, model);
  assert.equal(widget.el('mydiv'), document.querySelector('div.foo > div'));
  assert.equal(widget.el('mydiv').textContent, 'Foo my button.');

  widget.emit('fill')({ text: 'new text' });
  assert.equal(widget.el('mydiv').textContent, 'Foo new text.');

  widget.dispose();
  assert.ok(!document.querySelector('div.foo'));
}

function testList() {
  var widget = new Widget(['list']);
  var model = {
    children: [
      { type: 'header', value: 'Numbers' },
      { type: 'item', value: 1 },
      { type: 'item', value: 2 }
    ]
  };
  widget.render(document.body, null, model);

  var lis = document.querySelectorAll('li');
  assert.equal(lis.length, 3);
  assert.equal(lis[0].firstChild.tagName, 'H2');
  assert.equal(lis[1].textContent, '1');
  assert.equal(lis[2].textContent, '2');

  assert.equal(widget.children().length, 3);
  assert.equal(widget.children()[0].el(), lis[0]);
  assert.equal(widget.children()[1].el(), lis[1]);
  assert.equal(widget.children()[2].el(), lis[2]);
}

function testContainer() {
  var widget = new Widget(['container']);
  var model = { type: 'child', x: 'spam' };
  widget.render(document.body, null, model);

  assert.equal(widget.el().tagName, 'DIV');

  //TODO
  //var p = widget.el().firstElementChild;
  //assert.equal(p.tagName, 'P');
  //assert.equal(p.textContent, 'A paragraph of spam!');
}

// Set up browser-like environment.

document = html.parseHTML('').ownerDocument;

var utilJsName = path.resolve(__dirname, '../lib/public/util.js');
var utiljs = fs.readFileSync(utilJsName, 'utf-8');
eval(utiljs);

var widgetJsName = path.resolve(__dirname, '../lib/public/widget.js');
var widgetjs = fs.readFileSync(widgetJsName, 'utf-8');
eval(widgetjs);

// Generate tree and test our generated code.

var tree = new dependencies.tree(LOAD_WIDGETS, function(tree) {
  var genwidgetjs = render.widgetJS(tree);

  try {
    eval(genwidgetjs);

    testBasic();
    testList();
    testContainer();
  } catch(e) {
    console.log('genwidgetjs:');
    console.log(genwidgetjs);
    throw e;
  }
});
