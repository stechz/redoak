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
var tagStack = [];
var result;
exports.mparse = function(str) {
  exports.parse(str);
  return result;
};
%}

%%

root
  : statements EOF {
    $$ = $1.concat(tagStack);
    result = $$;
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
    } else if (tagStack.length) {
      tagStack.push($2);
    } else {
      $$ = $1.concat([$2]);
    }
  }
  ;

statement
  : mustache
  | contents %prec UIDCONTENT
  | OPEN_BLOCK pathSegments CLOSE {
    tagStack.push({ openPath: $2, type: 'loop' });
    $$ = null;
  }
  | OPEN_INVERSE pathSegments CLOSE {
    tagStack.push({ openPath: $2, type: 'inverse' });
    $$ = null;
  }
  | OPEN_ENDBLOCK pathSegments CLOSE {
    var stmts = [];
    var tag;
    while (tag = tagStack.pop()) {
      if ($2 == tag.openPath) {
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
  : OPEN pathSegments CLOSE
    { $$ = { type: 'unbound', name: $2, escape: true }; }
  | OPEN_UNESCAPED pathSegments CLOSE_UNESCAPED
    { $$ = { type: 'unbound', name: $2, escape: false }; }
  ;

pathSegments
  : pathSegments SEP pathSegment { $$ = $1 + $3; }
  | pathSegment
  | SEP
  ;

pathSegment
  : ID
  | WHITESPACE { $$ = ''; }
  ;
