(function() {
  var connection = new WebSocket(
        'ws://' + location.host + location.pathname);
  connection.onmessage = function() {
    connection.close();
    window.location.reload(true);
  };
  connection.onclose = function() {
  };
})();
