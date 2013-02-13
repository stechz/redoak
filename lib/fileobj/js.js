var jsp = require('uglify-js');

module.exports = function(fileObj, data) {
  var fileObjs = [];
  if (data) {
    var ast = jsp.parse(data);
    var types = { require: 'js' };
    for (var i = 0; i < ast.body.length; i++) {
      var stmt = ast.body[i];
      if (stmt.start.type == 'string') {
        var match = stmt.start.value.match(/^(.*)? (.*)/);
        if (match && types[match[1]]) {
          var name = match[2];
          fileObjs.push({ type: types[match[1]], filename: name });
        }
      } else {
        // After non-string statements, we no longer have any more
        // directives.
        break;
      }
    }
  }

  return { data: data, fileObjs: fileObjs };
};
