(function() {
  var uri = 'ws://';
  {if host}uri += {{host}};{/}
  {if not host}uri += location.host;{/}
  uri += '/' + {{id}};

  var connection = new WebSocket(uri);
  connection.onmessage = function() {
    connection.close();
    window.location.reload(true);
  };
  connection.onclose = function() {
  };
})();
