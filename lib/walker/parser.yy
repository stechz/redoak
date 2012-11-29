// Generates AST for mustache-like language.

%lex
%x decl

%%

<decl>\n[a-zA-Z0-9_$-]+      { this.popState(); return 'ID'; }
<decl>\n[ \t]+               { return 'WHITESPACE'; }
<decl>[^\x00\n]+             { return 'CONTENT'; }
<decl>\n+                    { this.popState(); }
<decl><<EOF>>                { this.popState(); return 'EOF'; }

\n[ \t]+                     { this.begin('decl'); return 'WHITESPACE'; }
[a-zA-Z0-9_$-]+              { return 'ID'; }
"["                          { return 'ATTR_BEGIN'; }
"="                          { return 'EQ'; }
"]"                          { return 'ATTR_END'; }
"\""                         { return 'QUOTE'; }
"'"                          { return 'QUOTE'; }
":literal"                   { return 'LITERAL'; }
[ \t]+                       { return 'SEP'; }
\n+                          {}
.                            { return 'INVALID'; }
<<EOF>>                      { return 'EOF'; }

/lex

%start root

%{
var whitespace;
var result;
exports.mparse = function(str) {
  exports.parse(str);
  return result;
};
%}

%%

root
  : statements EOF {
    result = $$;
  }
  ;

statements
  : statements statement { $$ = $1.concat([$2]); }
  | statement { $$ = [$1]; }
  ;

statement
  : selector { $$ = { selector: $1 }; }
  | selector declaration { $$ = { selector: $1, declaration: $2 }; }
  | selector LITERAL declaration {
    $$ = { selector: $1, declaration: $3, literal: true };
  }
  ;

selector
  : selector SEP selector_unit { $$ = $1.concat([$2]); }
  | selector_unit { $$ = [$1]; }
  ;

selector_unit
  : ID { $$ = { type: 'simple', id: $1 }; }
  | ID ATTR_BEGIN ID EQ ID ATTR_END {
    $$ = { type: 'eqattr', id: $1, lhs: $3, rhs: $5  };
  }
  | ID ATTR_BEGIN ID EQ ATTR_END {
    $$ = { type: 'eqattr', id: $1, lhs: $3, rhs: ''  };
  }
  | ID ATTR_BEGIN ID ATTR_END {
    $$ = { type: 'hasattr', id: $1, attr: $3 };
  }
  ;

declaration
  : WHITESPACE CONTENT { whitespace = $1.length - 1; $$ = $2; }
  | declaration WHITESPACE CONTENT {
    if ($2.length - 1 < whitespace) {
      throw new Error('Not enough whitespace');
    }
    $$ = $1 + '\n' + $2.substr(1, $2.length - whitespace - 1) + $3;
  }
  ;
