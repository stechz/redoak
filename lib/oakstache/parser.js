/* Jison generated parser */
var parser = (function(){
var parser = {trace: function trace() { },
yy: {},
symbols_: {"error":2,"root":3,"statements":4,"EOF":5,"statement":6,"mustache":7,"contents":8,"OPEN":9,"CLOSE":10,"OPEN_LOOP":11,"pathSegments":12,"OPEN_CLOSE":13,"OPEN_IF":14,"ifStatement":15,"OPEN_ENDBLOCK":16,"COMMENT":17,"lvalue":18,"NOT":19,"IS":20,"rvalue":21,"I":22,"ID":23,"LAST":24,"CONTENT":25,"content":26,"OPEN_UNESCAPED":27,"CLOSE_UNESCAPED":28,"pathSegment":29,"backOuts":30,"SEP":31,"BACKOUT":32,"$accept":0,"$end":1},
terminals_: {2:"error",5:"EOF",9:"OPEN",10:"CLOSE",11:"OPEN_LOOP",13:"OPEN_CLOSE",14:"OPEN_IF",16:"OPEN_ENDBLOCK",17:"COMMENT",19:"NOT",20:"IS",22:"I",23:"ID",24:"LAST",25:"CONTENT",26:"content",27:"OPEN_UNESCAPED",28:"CLOSE_UNESCAPED",31:"SEP",32:"BACKOUT"},
productions_: [0,[3,2],[4,1],[4,2],[6,1],[6,1],[6,2],[6,3],[6,3],[6,1],[6,1],[15,1],[15,2],[15,3],[15,4],[18,1],[18,1],[21,1],[21,1],[8,1],[8,2],[7,3],[7,3],[12,1],[12,2],[12,1],[29,1],[29,3],[30,2],[30,1]],
performAction: function anonymous(yytext,yyleng,yylineno,yy,yystate,$$,_$) {

var $0 = $$.length - 1;
switch (yystate) {
case 1:
    this.$ = $$[$0-1].concat(oakstacheParse.tagStack);
    oakstacheParse.result = this.$;
  
break;
case 2:
    if (this.$ === null) {
      this.$ = [];
    } else {
      this.$ = [$$[$0]];
    }
  
break;
case 3:
    if ($$[$0] === null) {
    } else if (oakstacheParse.tagStack.length) {
      oakstacheParse.tagStack.push($$[$0]);
    } else {
      this.$ = $$[$0-1].concat([$$[$0]]);
    }
  
break;
case 6:
    this.$ = '';
  
break;
case 7:
    oakstacheParse.tagStack.push(
        { obj: { type: 'loop', path: $$[$0-1] }, open: true });
    this.$ = null;
  
break;
case 8:
    oakstacheParse.tagStack.push({
        obj: { type: 'if', clause: $$[$0-1] }, open: true });
    this.$ = null;
  
break;
case 9:
    var stmts = [];
    var tag;
    while (tag = oakstacheParse.tagStack.pop()) {
      if (tag.open) {
        stmts.reverse();
        this.$ = tag.obj;
        this.$.contents = stmts;
        return;
      }
      stmts.push(tag);
    }
    this.$ = { close: true };
  
break;
case 10: this.$ = null; 
break;
case 11: this.$ = { type: 'simple', path: $$[$0] }; 
break;
case 12: this.$ = { type: 'inverse', path: $$[$0] }; 
break;
case 13:
    this.$ = { type: 'eq', path: $$[$0-2], value: $$[$0] };
  
break;
case 14:
    this.$ = { type: 'neq', path: $$[$0-2], value: $$[$0] };
  
break;
case 16: this.$ = { type: 'i' }; 
break;
case 18: this.$ = { type: 'last' }; 
break;
case 20: this.$ = $$[$0-1] + $$[$0]; 
break;
case 21:
    this.$ = { type: 'unbound', path: $$[$0-1], escape: true };
  
break;
case 22:
    this.$ = { type: 'unbound', path: $$[$0-1], escape: false };
  
break;
case 24: this.$ = [{ backout: $$[$0-1] }].concat($$[$0]); 
break;
case 25: this.$ = []; 
break;
case 26: this.$ = [$$[$0]]; 
break;
case 27: this.$ = $$[$0-2].concat([$$[$0]]); 
break;
case 28: this.$ = $$[$0-1] + 1; 
break;
case 29: this.$ = 1; 
break;
}
},
table: [{3:1,4:2,6:3,7:4,8:5,9:[1,6],11:[1,7],14:[1,8],16:[1,9],17:[1,10],25:[1,12],27:[1,11]},{1:[3]},{5:[1,13],6:14,7:4,8:5,9:[1,6],11:[1,7],14:[1,8],16:[1,9],17:[1,10],25:[1,12],27:[1,11]},{5:[2,2],9:[2,2],11:[2,2],14:[2,2],16:[2,2],17:[2,2],25:[2,2],27:[2,2]},{5:[2,4],9:[2,4],11:[2,4],14:[2,4],16:[2,4],17:[2,4],25:[2,4],27:[2,4]},{5:[2,5],9:[2,5],11:[2,5],14:[2,5],16:[2,5],17:[2,5],25:[2,5],26:[1,15],27:[2,5]},{10:[1,16],12:17,23:[1,21],29:18,30:19,31:[1,20],32:[1,22]},{12:23,23:[1,21],29:18,30:19,31:[1,20],32:[1,22]},{12:27,15:24,18:25,19:[1,26],22:[1,28],23:[1,21],29:18,30:19,31:[1,20],32:[1,22]},{5:[2,9],9:[2,9],11:[2,9],14:[2,9],16:[2,9],17:[2,9],25:[2,9],27:[2,9]},{5:[2,10],9:[2,10],11:[2,10],14:[2,10],16:[2,10],17:[2,10],25:[2,10],27:[2,10]},{12:29,23:[1,21],29:18,30:19,31:[1,20],32:[1,22]},{5:[2,19],9:[2,19],11:[2,19],14:[2,19],16:[2,19],17:[2,19],25:[2,19],26:[2,19],27:[2,19]},{1:[2,1]},{5:[2,3],9:[2,3],11:[2,3],14:[2,3],16:[2,3],17:[2,3],25:[2,3],27:[2,3]},{5:[2,20],9:[2,20],11:[2,20],14:[2,20],16:[2,20],17:[2,20],25:[2,20],26:[2,20],27:[2,20]},{5:[2,6],9:[2,6],11:[2,6],14:[2,6],16:[2,6],17:[2,6],25:[2,6],27:[2,6]},{10:[1,30]},{10:[2,23],13:[2,23],20:[2,23],28:[2,23],31:[1,31]},{23:[1,21],29:32,32:[1,33]},{10:[2,25],13:[2,25],20:[2,25],28:[2,25]},{10:[2,26],13:[2,26],20:[2,26],28:[2,26],31:[2,26]},{23:[2,29],32:[2,29]},{13:[1,34]},{13:[1,35]},{13:[2,11],20:[1,36]},{12:27,18:37,22:[1,28],23:[1,21],29:18,30:19,31:[1,20],32:[1,22]},{13:[2,15],20:[2,15]},{13:[2,16],20:[2,16]},{28:[1,38]},{5:[2,21],9:[2,21],11:[2,21],14:[2,21],16:[2,21],17:[2,21],25:[2,21],27:[2,21]},{23:[1,39]},{10:[2,24],13:[2,24],20:[2,24],28:[2,24],31:[1,31]},{23:[2,28],32:[2,28]},{5:[2,7],9:[2,7],11:[2,7],14:[2,7],16:[2,7],17:[2,7],25:[2,7],27:[2,7]},{5:[2,8],9:[2,8],11:[2,8],14:[2,8],16:[2,8],17:[2,8],25:[2,8],27:[2,8]},{21:40,23:[1,41],24:[1,42]},{13:[2,12],20:[1,43]},{5:[2,22],9:[2,22],11:[2,22],14:[2,22],16:[2,22],17:[2,22],25:[2,22],27:[2,22]},{10:[2,27],13:[2,27],20:[2,27],28:[2,27],31:[2,27]},{13:[2,13]},{13:[2,17]},{13:[2,18]},{21:44,23:[1,41],24:[1,42]},{13:[2,14]}],
defaultActions: {13:[2,1],40:[2,13],41:[2,17],42:[2,18],44:[2,14]},
parseError: function parseError(str, hash) {
    throw new Error(str);
},
parse: function parse(input) {
    var self = this, stack = [0], vstack = [null], lstack = [], table = this.table, yytext = "", yylineno = 0, yyleng = 0, recovering = 0, TERROR = 2, EOF = 1;
    this.lexer.setInput(input);
    this.lexer.yy = this.yy;
    this.yy.lexer = this.lexer;
    this.yy.parser = this;
    if (typeof this.lexer.yylloc == "undefined")
        this.lexer.yylloc = {};
    var yyloc = this.lexer.yylloc;
    lstack.push(yyloc);
    var ranges = this.lexer.options && this.lexer.options.ranges;
    if (typeof this.yy.parseError === "function")
        this.parseError = this.yy.parseError;
    function popStack(n) {
        stack.length = stack.length - 2 * n;
        vstack.length = vstack.length - n;
        lstack.length = lstack.length - n;
    }
    function lex() {
        var token;
        token = self.lexer.lex() || 1;
        if (typeof token !== "number") {
            token = self.symbols_[token] || token;
        }
        return token;
    }
    var symbol, preErrorSymbol, state, action, a, r, yyval = {}, p, len, newState, expected;
    while (true) {
        state = stack[stack.length - 1];
        if (this.defaultActions[state]) {
            action = this.defaultActions[state];
        } else {
            if (symbol === null || typeof symbol == "undefined") {
                symbol = lex();
            }
            action = table[state] && table[state][symbol];
        }
        if (typeof action === "undefined" || !action.length || !action[0]) {
            var errStr = "";
            if (!recovering) {
                expected = [];
                for (p in table[state])
                    if (this.terminals_[p] && p > 2) {
                        expected.push("'" + this.terminals_[p] + "'");
                    }
                if (this.lexer.showPosition) {
                    errStr = "Parse error on line " + (yylineno + 1) + ":\n" + this.lexer.showPosition() + "\nExpecting " + expected.join(", ") + ", got '" + (this.terminals_[symbol] || symbol) + "'";
                } else {
                    errStr = "Parse error on line " + (yylineno + 1) + ": Unexpected " + (symbol == 1?"end of input":"'" + (this.terminals_[symbol] || symbol) + "'");
                }
                this.parseError(errStr, {text: this.lexer.match, token: this.terminals_[symbol] || symbol, line: this.lexer.yylineno, loc: yyloc, expected: expected});
            }
        }
        if (action[0] instanceof Array && action.length > 1) {
            throw new Error("Parse Error: multiple actions possible at state: " + state + ", token: " + symbol);
        }
        switch (action[0]) {
        case 1:
            stack.push(symbol);
            vstack.push(this.lexer.yytext);
            lstack.push(this.lexer.yylloc);
            stack.push(action[1]);
            symbol = null;
            if (!preErrorSymbol) {
                yyleng = this.lexer.yyleng;
                yytext = this.lexer.yytext;
                yylineno = this.lexer.yylineno;
                yyloc = this.lexer.yylloc;
                if (recovering > 0)
                    recovering--;
            } else {
                symbol = preErrorSymbol;
                preErrorSymbol = null;
            }
            break;
        case 2:
            len = this.productions_[action[1]][1];
            yyval.$ = vstack[vstack.length - len];
            yyval._$ = {first_line: lstack[lstack.length - (len || 1)].first_line, last_line: lstack[lstack.length - 1].last_line, first_column: lstack[lstack.length - (len || 1)].first_column, last_column: lstack[lstack.length - 1].last_column};
            if (ranges) {
                yyval._$.range = [lstack[lstack.length - (len || 1)].range[0], lstack[lstack.length - 1].range[1]];
            }
            r = this.performAction.call(yyval, yytext, yyleng, yylineno, this.yy, action[1], vstack, lstack);
            if (typeof r !== "undefined") {
                return r;
            }
            if (len) {
                stack = stack.slice(0, -1 * len * 2);
                vstack = vstack.slice(0, -1 * len);
                lstack = lstack.slice(0, -1 * len);
            }
            stack.push(this.productions_[action[1]][0]);
            vstack.push(yyval.$);
            lstack.push(yyval._$);
            newState = table[stack[stack.length - 2]][stack[stack.length - 1]];
            stack.push(newState);
            break;
        case 3:
            return true;
        }
    }
    return true;
}
};

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
/* Jison generated lexer */
var lexer = (function(){
var lexer = ({EOF:1,
parseError:function parseError(str, hash) {
        if (this.yy.parser) {
            this.yy.parser.parseError(str, hash);
        } else {
            throw new Error(str);
        }
    },
setInput:function (input) {
        this._input = input;
        this._more = this._less = this.done = false;
        this.yylineno = this.yyleng = 0;
        this.yytext = this.matched = this.match = '';
        this.conditionStack = ['INITIAL'];
        this.yylloc = {first_line:1,first_column:0,last_line:1,last_column:0};
        if (this.options.ranges) this.yylloc.range = [0,0];
        this.offset = 0;
        return this;
    },
input:function () {
        var ch = this._input[0];
        this.yytext += ch;
        this.yyleng++;
        this.offset++;
        this.match += ch;
        this.matched += ch;
        var lines = ch.match(/(?:\r\n?|\n).*/g);
        if (lines) {
            this.yylineno++;
            this.yylloc.last_line++;
        } else {
            this.yylloc.last_column++;
        }
        if (this.options.ranges) this.yylloc.range[1]++;

        this._input = this._input.slice(1);
        return ch;
    },
unput:function (ch) {
        var len = ch.length;
        var lines = ch.split(/(?:\r\n?|\n)/g);

        this._input = ch + this._input;
        this.yytext = this.yytext.substr(0, this.yytext.length-len-1);
        //this.yyleng -= len;
        this.offset -= len;
        var oldLines = this.match.split(/(?:\r\n?|\n)/g);
        this.match = this.match.substr(0, this.match.length-1);
        this.matched = this.matched.substr(0, this.matched.length-1);

        if (lines.length-1) this.yylineno -= lines.length-1;
        var r = this.yylloc.range;

        this.yylloc = {first_line: this.yylloc.first_line,
          last_line: this.yylineno+1,
          first_column: this.yylloc.first_column,
          last_column: lines ?
              (lines.length === oldLines.length ? this.yylloc.first_column : 0) + oldLines[oldLines.length - lines.length].length - lines[0].length:
              this.yylloc.first_column - len
          };

        if (this.options.ranges) {
            this.yylloc.range = [r[0], r[0] + this.yyleng - len];
        }
        return this;
    },
more:function () {
        this._more = true;
        return this;
    },
less:function (n) {
        this.unput(this.match.slice(n));
    },
pastInput:function () {
        var past = this.matched.substr(0, this.matched.length - this.match.length);
        return (past.length > 20 ? '...':'') + past.substr(-20).replace(/\n/g, "");
    },
upcomingInput:function () {
        var next = this.match;
        if (next.length < 20) {
            next += this._input.substr(0, 20-next.length);
        }
        return (next.substr(0,20)+(next.length > 20 ? '...':'')).replace(/\n/g, "");
    },
showPosition:function () {
        var pre = this.pastInput();
        var c = new Array(pre.length + 1).join("-");
        return pre + this.upcomingInput() + "\n" + c+"^";
    },
next:function () {
        if (this.done) {
            return this.EOF;
        }
        if (!this._input) this.done = true;

        var token,
            match,
            tempMatch,
            index,
            col,
            lines;
        if (!this._more) {
            this.yytext = '';
            this.match = '';
        }
        var rules = this._currentRules();
        for (var i=0;i < rules.length; i++) {
            tempMatch = this._input.match(this.rules[rules[i]]);
            if (tempMatch && (!match || tempMatch[0].length > match[0].length)) {
                match = tempMatch;
                index = i;
                if (!this.options.flex) break;
            }
        }
        if (match) {
            lines = match[0].match(/(?:\r\n?|\n).*/g);
            if (lines) this.yylineno += lines.length;
            this.yylloc = {first_line: this.yylloc.last_line,
                           last_line: this.yylineno+1,
                           first_column: this.yylloc.last_column,
                           last_column: lines ? lines[lines.length-1].length-lines[lines.length-1].match(/\r?\n?/)[0].length : this.yylloc.last_column + match[0].length};
            this.yytext += match[0];
            this.match += match[0];
            this.matches = match;
            this.yyleng = this.yytext.length;
            if (this.options.ranges) {
                this.yylloc.range = [this.offset, this.offset += this.yyleng];
            }
            this._more = false;
            this._input = this._input.slice(match[0].length);
            this.matched += match[0];
            token = this.performAction.call(this, this.yy, this, rules[index],this.conditionStack[this.conditionStack.length-1]);
            if (this.done && this._input) this.done = false;
            if (token) return token;
            else return;
        }
        if (this._input === "") {
            return this.EOF;
        } else {
            return this.parseError('Lexical error on line '+(this.yylineno+1)+'. Unrecognized text.\n'+this.showPosition(),
                    {text: "", token: null, line: this.yylineno});
        }
    },
lex:function lex() {
        var r = this.next();
        if (typeof r !== 'undefined') {
            return r;
        } else {
            return this.lex();
        }
    },
begin:function begin(condition) {
        this.conditionStack.push(condition);
    },
popState:function popState() {
        return this.conditionStack.pop();
    },
_currentRules:function _currentRules() {
        return this.conditions[this.conditionStack[this.conditionStack.length-1]].rules;
    },
topState:function () {
        return this.conditionStack[this.conditionStack.length-2];
    },
pushState:function begin(condition) {
        this.begin(condition);
    }});
lexer.options = {};
lexer.performAction = function anonymous(yy,yy_,$avoiding_name_collisions,YY_START) {

var YYSTATE=YY_START
switch($avoiding_name_collisions) {
case 0: return 16; 
break;
case 1: this.popState(); return 28; 
break;
case 2: this.popState(); return 10; 
break;
case 3: return 19; 
break;
case 4: return 20; 
break;
case 5: return 22; 
break;
case 6: return 24; 
break;
case 7: return 23; 
break;
case 8: return 32; 
break;
case 9: return 31; 
break;
case 10: /* return 'WHITESPACE'; */ 
break;
case 11: this.popState(); this.begin('inner');
                               return 13; 
break;
case 12: return 16; 
break;
case 13: this.begin('if'); return 14; 
break;
case 14: this.begin('loop'); return 11; 
break;
case 15: this.begin('reg'); return 27; 
break;
case 16: this.begin('reg'); return 9; 
break;
case 17: return 25; 
break;
case 18: return 25; 
break;
case 19: return 5; 
break;
}
};
lexer.rules = [/^(?:\{\/\})/,/^(?:\}\}\})/,/^(?:\}\})/,/^(?:not\b)/,/^(?:is\b)/,/^(?:\.i\b)/,/^(?:\.last\b)/,/^(?:[a-zA-Z0-9_$-]+)/,/^(?:\.\.\/)/,/^(?:\.)/,/^(?:\s+)/,/^(?:\})/,/^(?:\{\/\})/,/^(?:\{\.if\b)/,/^(?:\{\.loop\b)/,/^(?:\{\{\{)/,/^(?:\{\{)/,/^(?:[^\x00{]+)/,/^(?:\{)/,/^(?:$)/];
lexer.conditions = {"decl":{"rules":[],"inclusive":false},"if":{"rules":[3,4,5,6,7,8,9,10,11],"inclusive":false},"loop":{"rules":[7,8,9,10,11],"inclusive":false},"reg":{"rules":[1,2,7,8,9,10],"inclusive":false},"inner":{"rules":[12,13,14,15,16,17,18,19],"inclusive":false},"INITIAL":{"rules":[0,13,14,15,16,17,18,19],"inclusive":true}};
return lexer;})()
parser.lexer = lexer;
function Parser () { this.yy = {}; }Parser.prototype = parser;parser.Parser = Parser;
return new Parser;
})();
if (typeof require !== 'undefined' && typeof exports !== 'undefined') {
exports.parser = parser;
exports.Parser = parser.Parser;
exports.parse = function () { return parser.parse.apply(parser, arguments); }
exports.main = function commonjsMain(args) {
    if (!args[1])
        throw new Error('Usage: '+args[0]+' FILE');
    var source, cwd;
    if (typeof process !== 'undefined') {
        source = require('fs').readFileSync(require('path').resolve(args[1]), "utf8");
    } else {
        source = require("file").path(require("file").cwd()).join(args[1]).read({charset: "utf-8"});
    }
    return exports.parser.parse(source);
}
if (typeof module !== 'undefined' && require.main === module) {
  exports.main(typeof process !== 'undefined' ? process.argv.slice(1) : require("system").args);
}
}