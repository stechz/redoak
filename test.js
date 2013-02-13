var child = require('child_process');
var path = require('path');

var TESTS = [
  'gentest/gentest.js',
  'lib/dependencies.js',
  'lib/fileobj/fileobj.js',
  'lib/html.js',
  'lib/oakstache/handler.js',
  'lib/queryselector.js',
  'lib/render.js',
  'lib/walker/handler.js',
  'reftest/reftest.js'
];

var output = new Array(TESTS.length);

var finish = function() {
  for (var i = 0; i < output.length; i++) {
    if (output[i]) {
      console.error('\nnode ' + TESTS[i] + ':');
      console.error('---------------------');
      console.error(output[i]);
      console.error();
      process.exit(1);
    }
  }
}

TESTS.forEach(function(test, i) {
  var file = path.resolve(__dirname, test);
  var proc = child.spawn('node', [file]);
  var out = '';
  var onoutput = function(data) { out += data.toString(); };
  proc.stdout.on('data', onoutput);
  proc.stderr.on('data', onoutput);
  proc.once('exit', function() {
    proc.stdout.removeListener('data', onoutput);
    proc.stderr.removeListener('data', onoutput);
    proc = null;
    output[i] = out;
    if (output.every(function(x) { return x !== undefined; })) {
      finish();
    }
  });
});
