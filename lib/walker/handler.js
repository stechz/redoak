var parser = require('./parser');
var oakstache = require('../oakstache/handler');

var template = 'Hello, {{pagename}}. {{loop}}{{.}}{{/loop}}';
var ast = oakstache.parse(template);

var str = 'unbound[name=pagename]:literal\n' +
          '  <title>\n' +
          '    hello\n' +
          '  </title>\n\n' +
          'loop\n' +
          '  <loop>{{content}}</loop>';

var tree = parser.mparse(str);
console.log(JSON.stringify(tree, 0, 2));
