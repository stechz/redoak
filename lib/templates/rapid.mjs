(function() {
  var uri = 'ws://';
  {{#host}}uri += {{{host}}};{{/host}}
  {{^host}}uri += location.host;{{/host}}
  uri+= '/' + {{{id}}};

  var connection = new WebSocket(uri);
  connection.onmessage = function() {
    connection.close();
    window.location.reload(true);
  };
  connection.onclose = function() {
  };
})();
