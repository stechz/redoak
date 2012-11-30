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
"literal"                    { return 'LITERAL'; }
[a-zA-Z0-9_$-]+              { return 'ID'; }
"number"                     { return 'NUMBER'; }
"*"                          { return 'ANY'; }
"{"                          { return 'OBJ_BEGIN'; }
"}"                          { return 'OBJ_END'; }
"["                          { return 'ARR_BEGIN'; }
"]"                          { return 'ARR_END'; }
"="                          { return 'EQ'; }
"\""                         { return 'QUOTE'; }
"'"                          { return 'QUOTE'; }
[ \t]+                       { return 'SEP_SPACE'; }
\.                           { return 'SEP_DOT'; }
\n+                          {}
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
  | selector SEP_SPACE LITERAL declaration {
    $$ = { selector: $1, declaration: $4, literal: true };
  }
  ;

selector
  : selector SEP_SPACE selector_part {
    $$ = $1.concat([$3]);
  }
  | selector_part { $$ = [$1]; }
  ;

selector_part
  : selector_unit { $$ = { unit: $1, path: [] }; }
  | selector_unit SEP_DOT selector_prop {
    $$ = { unit: $1, path: $3 };
  }
  | NUMBER { $$ = { unit: { type: 'any_number' }, path: [] }; }
  | QUOTE QUOTE { $$ = { unit: { type: 'any_string' }, path: [] }; }
  ;

selector_prop
  : ID { [$1] }
  | selector_prop SEP_DOT ID { $1.concat([$2]); }
  ;

selector_unit
  : OBJ_BEGIN OBJ_END { $$ = { type: 'any_object' }; }
  | OBJ_BEGIN selector_obj OBJ_END { $$ = { type: 'object', filters: $2 }; }
  | ARR_BEGIN ARR_END { $$ = { type: 'any_array' }; }
  | ANY { $$ = { type: 'any' }; }
  ;

selector_obj
  : selector_obj_unit { $$ = [$1]; }
  | selector_obj SEP_SPACE selector_obj_unit { $$ = $1.concat([$2]); }
  ;

selector_obj_unit
  : ID { $$ = { type: 'has', id: $1 }; }
  | ID EQ ID { $$ = { type: 'eq', lhs: $1, rhs: $3 }; }
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
