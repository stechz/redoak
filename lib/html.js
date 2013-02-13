var assert = require('assert');
var html5 = require('html5');
var jsdom = require('jsdom');
var oakstache = require('./oakstache/handler');

// jsdom options for html parsing.
var defaultFeatures = {
  // Used for easier scraping.
  QuerySelector: true,

  // No need to fetch anything.
  FetchExternalResources: [],

  // domjs doesn't implement document.write correctly.
  ProcessExternalResources: []
};

html5.Parser.prototype.on('setup', function(parser) {
  var open = [];
  var openBlocks = [];
  var countBlocks = function(str) {
    var oldCount = openBlocks.length;
    var ast = oakstache.parse(str);
    ast.forEach(function(x) {
      if (x.open) {
        openBlocks.push(x);
      } else if (x.close) {
        openBlocks.pop();
      }
    });
    return openBlocks.length - oldCount;
  };

  parser.tokenizer.on('token', function listen(t) {
    var openElements = parser.tree.open_elements;

    if (t.type == 'Characters') {
      var countDelta = countBlocks(t.data);

      if (countDelta != 0) {
        var lastInserted = openElements.last().lastChild;
        var isTextNode = lastInserted &&
                         lastInserted.nodeType == lastInserted.TEXT_NODE;
        var nodeValue = isTextNode ? lastInserted.nodeValue : '';
        nodeValue = nodeValue.replace(/^\s+|\s+$/g, '');
        var tokenData = t.data.replace(/^\s+|\s+$/g, '');
        if (isTextNode) {
          lastInserted.oakAddBlockDepth = countDelta;
        }
        if (!isTextNode || nodeValue != tokenData) {
          var table = parser.tree.getTableMisnestedNodePosition().insertBefore;
          var textNode = table.previousSibling;
          assert(textNode.nodeValue, t.data);

          var index = textNode.nodeValue.indexOf(t.data);
          if (index != 0) {
            var document = openElements.last().ownerDocument;
            var value = textNode.nodeValue;
            textNode.nodeValue = value.substring(0, index);
            textNode = document.createTextNode(value.substring(index));
          }
          openElements.last().appendChild(textNode);
        }
      }
    } else if (t.type == 'StartTag' && openBlocks.length > 0) {
      var count = openBlocks.length;
      var last = openElements.last();
      var element = last.lastChild ? last.lastChild : last;
      element.oakBlockDepth = count;
      element.oakOpenBlocks = openBlocks.slice();
    } else if (t.type == 'EOF') {
      parser.tokenizer.removeListener('token', listen);
    }
  });
});

/**
 * Parse HTML into a document structure.
 * @returns Root document element if data is a complete document.
 *          Returns the body element if this data looks like a fragment.
 */
function parseHTML(data) {
  // Some boilerplate to parse the DOM.
  var options = { features: defaultFeatures, parser: html5 };
  var window = jsdom.jsdom(null, null, options).createWindow();
  var document = window.document;
  var parser = new html5.Parser({ document: document });

  var isFragment = true;
  parser.tokenizer = new html5.Tokenizer(data, document);
  parser.setup();

  parser.tokenizer.on('token', function listen(t) {
    if (t.type != 'SpaceCharacters') {
      isFragment = t.type == 'StartTag' && !t.name.match(/^html|head$/i);
      parser.tokenizer.removeListener('token', listen);
    }
  });

  parser.tokenizer.tokenize();
  return isFragment ? document.body : document.documentElement;
}

if (require.main === module) {
  // Fragments are given body element back.
  var el = parseHTML('<div></div>');
  assert.equal(el, el.ownerDocument.body);

  // Full documents are given html element back.
  el = parseHTML('<html><body><div></div></body></html>');
  assert.equal(el, el.ownerDocument.firstChild);

  // Text nodes with loops inside tables remain inside tables. By default,
  // HTML parsers put extraneous non-table stuff right before the table.
  el = parseHTML('<table>{loop rows}<tr><td>test</td></tr>{/}</table>');
  assert.equal(el.firstChild.tagName, 'TABLE');
  var table = el.firstChild;
  var textNode = table.firstChild;
  assert.equal(textNode.nodeType, el.TEXT_NODE);
  assert.equal(table.rows[0].oakBlockDepth, 1);
  assert.equal(table.rows[0].cells[0].oakBlockDepth, 1);

  // Make sure inner loops work.
  el = parseHTML('{loop loop1}{loop loop2}<div></div>{/} ' +
                 '<div>etc</div>{/}');
  var divs = el.querySelectorAll('div');
  assert.equal(divs.length, 2);
  assert.equal(divs[0].oakBlockDepth, 2);
  assert.equal(divs[1].oakBlockDepth, 1);

  // Self-closing tags get oakBlockDepth.
  el = parseHTML('{loop loop}<div><img src="blah.jpg"></div>{/}');
  var div = el.querySelector('div');
  var img = el.querySelector('img');
  assert.equal(div.oakBlockDepth, 1);
  assert.equal(img.oakBlockDepth, 1);

  // HTML parsers remove extra whitespace from nodeValue. Make sure no errors
  // occur.
  parseHTML('<div>  \n{loop loop}  <div>test</div>{/}</div>');
}

module.exports.parseHTML = parseHTML;
