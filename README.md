# Overview

Thanks for checking out redoak! The aim of this project is to allow rapid
prototyping of HTML without getting in the way of your usual toolchain.  There
are no manifestos or revolutions, just faster development.

This tool currently provides:
- A server that serves up HTML that refreshes itself when it or any of its
  dependencies change.
- A method of creating widgets, which are basically HTML snippets and coupling
  it with some script logic  The widgets can be rendered server side or client
  side.
- A mixin system that allows widgets to take on multiple features.
- A straightforward way to split up components and test them with mock data.

Anti-goals:
- This project will never be a comprehensive toolkit. You are encouraged to use
  jQuery, backbone, underscore.js, whatever with redoak! It should be possible
  to use this with non-node projects: django, tornado, rails, and so forth.
- No database model middleware.
- Live updating of client code on your production server. The websocket
  connection is for development purposes only.

This project is brand new and is still evolving rapidly. Please give it a try
and file lots of bugs! Patches are appreciated as well.

# Diving in

The best way to get the gist of it is to try it. After you install redoak, just
run:

    bin/redoak public/todo.html

Navigate to http://localhost:3000/, fire up your favorite editor and start
playing. :) You can add files to public/, and they should be visible to the
webserver.

# Understanding the code

### Server side code

Check out `lib/dependencies.js`. It's responsible for parsing the HTML, picking
out any CSS links or script tags, and watching them all for any changes. The
other important file is `lib/render.js`. It processes the tree, and generates
widget code and the final HTML.

### Client side code

All in `lib/public/`. The important file is really `basewidget.js`, which
contains the BaseWidget prototype for widget objects that are created for <use>
tags. You can also create them in the client side. See `todo.html` for an
example.

`lib/public/util.js` contains the code for events.

# Testing

There's one test. :) Try it:

    node lib/reftest/reftest.js

It diffs the output of a sample oak file with the expected HTML. If nothing is
outputted, congratulations, it passed!

# Using it in your web app

Unless you want to contribute, I wouldn't recommend using it in anything
serious. Little thought has been given to browser compatibility or how to
incorporate it into a larger scope project. Optimization should be pretty
straightforward, but that work hasn't been done yet.

If that didn't scare you, here's how I'm doing it so far: I just require redoak
and use the express middleware with some static handlers for dependencies. For
session-specific data or DB model data, I've been including a separate JS file
so that everything else can stay static and cached. If you write a tag whose
src starts with a `/` like:

    <script src='/session.js'></script>

Then redoak will ignore it. There should probably be a way to render widgets
from your DB on the server, eventually.

# Contributors to redoak

- Emma Zhou: typo in README.
- Itai Zuckerman: todo example delete functionality. Bugfix for preserve mixin
  and disposing widgets. Bugfix for event listeners.
