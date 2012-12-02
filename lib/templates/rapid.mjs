(function() {
  var connection = new WebSocket('ws://' + location.host + '/' + {{{id}}});
  connection.onmessage = function() {
    connection.close();
    window.location.reload(true);
  };
  connection.onclose = function() {
  };
})();
