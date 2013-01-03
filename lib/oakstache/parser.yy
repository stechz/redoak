// Generates AST for mustache-like language.

%lex
%x decl if loop reg inner

%%

<INITIAL>"{/}"               { return 'OPEN_ENDBLOCK'; }

<reg>"}}}"                   { this.popState(); return 'CLOSE_UNESCAPED'; }
<reg>"}}"                    { this.popState(); return 'CLOSE'; }

<if>"not"                    { return 'NOT'; }
<if>"is"                     { return 'IS'; }
<if>".i"                     { return 'I'; }
<if>".last"                  { return 'LAST'; }

<if,loop,reg>[a-zA-Z0-9_$-]+ { return 'ID'; }
<if,loop,reg>"../"           { return 'BACKOUT'; }
<if,loop,reg>"."             { return 'SEP'; }
<if,loop,reg>\s+             { /* return 'WHITESPACE'; */ }
<if,loop>"}"                 { this.popState(); this.begin('inner');
                               return 'OPEN_CLOSE'; }

<inner>"{/}"                 { return 'OPEN_ENDBLOCK'; }

<inner,INITIAL>"{.if"        { this.begin('if'); return 'OPEN_IF'; }
<inner,INITIAL>"{.loop"      { this.begin('loop'); return 'OPEN_LOOP'; }
<inner,INITIAL>"{{{"         { this.begin('reg'); return 'OPEN_UNESCAPED'; }
<inner,INITIAL>"{{"          { this.begin('reg'); return 'OPEN'; }
<inner,INITIAL>[^\x00{]+     { return 'CONTENT'; }
<inner,INITIAL>"{"           { return 'CONTENT'; }
<inner,INITIAL><<EOF>>       { return 'EOF'; }

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
  | OPEN_LOOP pathSegments OPEN_CLOSE {
    oakstacheParse.tagStack.push(
        { obj: { type: 'loop', path: $2 }, open: true });
    $$ = null;
  }
  | OPEN_IF ifStatement OPEN_CLOSE {
    oakstacheParse.tagStack.push({
        obj: { type: 'if', clause: $2 }, open: true });
    $$ = null;
  }
  | OPEN_ENDBLOCK {
    var stmts = [];
    var tag;
    while (tag = oakstacheParse.tagStack.pop()) {
      if (tag.open) {
        stmts.reverse();
        $$ = tag.obj;
        $$.contents = stmts;
        return;
      }
      stmts.push(tag);
    }
    $$ = { close: true };
  }
  | COMMENT { $$ = null; }
  ;

ifStatement
  : lvalue { $$ = { type: 'simple', path: $1 }; }
  | NOT lvalue { $$ = { type: 'inverse', path: $2 }; }
  | lvalue IS rvalue {
    $$ = { type: 'eq', path: $1, value: $3 };
  }
  | NOT lvalue IS rvalue {
    $$ = { type: 'neq', path: $2, value: $4 };
  }
  ;

lvalue
  : pathSegments
  | I { $$ = { type: 'i' }; }
  ;

rvalue
  : ID
  | LAST { $$ = { type: 'last' }; }
  ;

contents
  : CONTENT
  | contents content { $$ = $1 + $2; }
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
  : pathSegment
  | backOuts pathSegment { $$ = [{ backout: $1 }].concat($2); }
  | SEP { $$ = []; }
  ;

pathSegment
  : ID { $$ = [$1]; }
  | pathSegment SEP ID { $$ = $1.concat([$3]); }
  ;

backOuts
  : backOuts BACKOUT { $$ = $1 + 1; }
  | BACKOUT { $$ = 1; }
  ;
