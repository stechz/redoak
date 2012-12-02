// Generates AST for mustache-like language.

%lex

%%

"{{!"[\s\S]*?"}}"            { /* return 'COMMENT'; */ }

"{{#"                        { return 'OPEN_BLOCK'; }
"{{/"                        { return 'OPEN_ENDBLOCK'; }
"{{^"                        { return 'OPEN_INVERSE'; }
"{{{"                        { return 'OPEN_UNESCAPED'; }
"{{"                         { return 'OPEN'; }

"}}}"                        { return 'CLOSE_UNESCAPED'; }
"}}"                         { return 'CLOSE'; }
[a-zA-Z0-9_$-]+              { return 'ID'; }
\.                           { return 'SEP'; }

\s+                          { return 'WHITESPACE'; }
[^\x00{]+                    { return 'CONTENT'; }
"{"                          { return 'CONTENT'; }

<<EOF>>                      { return 'EOF'; }

/lex

%nonassoc UIDCONTENT
%nonassoc ID CONTENT SEP WHITESPACE
%start root

%{
var oakstacheParse = (function(parser) {
  return function(str) {
    oakstacheParse.tagStack = [];
    parser.parse(str);
    return oakstacheParse.result;
  };
})(parser);

if (typeof exports == 'object') {
  exports.mparse = oakstacheParse;
}

if (typeof window == 'object') {
  window.oakstacheParse = oakstacheParse;
}
%}

%%

root
  : statements EOF {
    $$ = $1.concat(oakstacheParse.tagStack);
    oakstacheParse.result = $$;
  }
  ;

statements
  : statement {
    if ($$ === null) {
      $$ = [];
    } else {
      $$ = [$1];
    }
  }
  | statements statement {
    if ($2 === null) {
    } else if (oakstacheParse.tagStack.length) {
      oakstacheParse.tagStack.push($2);
    } else {
      $$ = $1.concat([$2]);
    }
  }
  ;

statement
  : mustache
  | contents %prec UIDCONTENT
  | OPEN CLOSE {
    $$ = '';
  }
  | OPEN_BLOCK pathSegments CLOSE {
    oakstacheParse.tagStack.push({ openPath: $2, type: 'loop' });
    $$ = null;
  }
  | OPEN_INVERSE pathSegments CLOSE {
    oakstacheParse.tagStack.push({ openPath: $2, type: 'inverse' });
    $$ = null;
  }
  | OPEN_ENDBLOCK pathSegments CLOSE {
    var stmts = [];
    var tag;
    while (tag = oakstacheParse.tagStack.pop()) {
      if (tag.openPath && $2.join('.') == tag.openPath.join('.')) {
        stmts.reverse();
        $$ = { type: tag.type, path: $2, contents: stmts };
        return;
      }
      stmts.push(tag);
    }
    stmts.reverse();
    stmts.push($2);
    $$ = null;
  }
  | COMMENT { $$ = null; }
  ;

contents
  : content
  | contents content { $$ = $1 + $2; }
  ;

content
  : ID
  | CONTENT
  | SEP
  | WHITESPACE
  ;

mustache
  : OPEN pathSegments CLOSE {
    $$ = { type: 'unbound', path: $2, escape: true };
  }
  | OPEN_UNESCAPED pathSegments CLOSE_UNESCAPED {
    $$ = { type: 'unbound', path: $2, escape: false };
  }
  ;

pathSegments
  : pathSegments SEP pathSegment { $$ = $1.concat([$3]); }
  | pathSegment { $$ = [$1]; }
  | SEP { $$ = ['.']; }
  ;

pathSegment
  : ID
  | WHITESPACE { $$ = ''; }
  ;
