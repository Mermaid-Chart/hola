lexer grammar FlowLexer;
import HeaderCommon;

// Virtual tokens for parser
tokens {
    NODIR, DIR, PIPE, PE, SQE, DIAMOND_STOP, STADIUMEND, SUBROUTINEEND, CYLINDEREND, DOUBLECIRCLEEND,
    ELLIPSE_END_TOKEN, TRAPEND, INVTRAPEND, PS, SQS, TEXT, CIRCLEEND, STR, CALLBACKARGS, COMMENT
}

// Comments - do NOT skip, make them part of the parse tree for round-trip code generation
// Exclude %%{init}%% and similar directives by checking next char is not '{'
// IMPORTANT: PERCENT_COMMENT must come before other %% patterns
// NOTE: Hash comments (#) are NOT supported in flowcharts because # is used as BRKT token for styling
// Only percent comments (%%) are preserved for round-trip code generation
// HeaderCommon provides PERCENT_COMMENT (skip) and HASH_COMMENT (skip) for header section
// After header, we need to handle comments differently for flowcharts
PERCENT_COMMENT_FLOW: '%%' ~['{''\r''\n'] ~[\r\n]* -> type(COMMENT);

// Inline directives: %%{...}%% appearing after the graph header (when headerMode is false)
// These are already processed by the preprocessor, so we skip them
// This handles cases where users put init directives after the graph header
// MUST come after HEADER_DIRECTIVE (which only matches when headerMode is true)
INLINE_DIRECTIVE: { !this.headerMode }? '%%{' .*? '}%%' -> skip;

// Lexer modes to match Jison's state-based lexing
// Based on Jison: %x string, md_string, acc_title, acc_descr, acc_descr_multiline, dir, vertex, text, etc.

// Shape data tokens - MUST be defined FIRST for absolute precedence over LINK_ID
// Match exactly "@{" like Jison does (no whitespace allowed between @ and {)
// PERFORMANCE OPTIMIZATION: Match simple shape data without strings as a complete token
// This avoids pushMode/popMode overhead for common cases like @{shape: diamond}
// Pattern: @{ content without quotes, braces, or newlines }
// Excluding \r\n prevents greedy matching across line boundaries on malformed input
SHAPE_DATA_COMPLETE: '@{' (~[}"\r\n]+) '}';
// For complex shape data with embedded strings, use mode transitions
SHAPE_DATA_START: '@{' -> pushMode(SHAPE_DATA_MODE);

// Accessibility tokens
ACC_TITLE: 'accTitle' WS* ':' WS* -> pushMode(ACC_TITLE_MODE);
ACC_DESCR: 'accDescr' WS* ':' WS* -> pushMode(ACC_DESCR_MODE);
ACC_DESCR_MULTI: 'accDescr' WS* '{' WS* -> pushMode(ACC_DESCR_MULTILINE_MODE);

// Interactivity tokens
CALL: 'call' WS+ -> pushMode(CALLBACKNAME_MODE);
HREF: 'href' WS;
// CLICK token - matches 'click' + whitespace + node ID (like Jison: <click>[^\s\n]*)
// Node IDs can contain hyphens and other non-whitespace characters
CLICK: 'click' WS+ ~[\r\n \t]+ -> pushMode(CLICK_MODE);

// Graph declaration tokens - these trigger direction mode
GRAPH: ('flowchart-elk' | 'graph' | 'flowchart') { this.headerMode = false; } -> pushMode(DIR_MODE);
SUBGRAPH: 'subgraph';
END: 'end';

// Link targets
LINK_TARGET: ('_self' | '_blank' | '_parent' | '_top');

// Style and class tokens
STYLE: 'style';
DEFAULT: 'default';
LINKSTYLE: 'linkStyle';
INTERPOLATE: 'interpolate';
CLASSDEF: 'classDef';
CLASS: 'class';

// String tokens - must come early to avoid conflicts with QUOTE
MD_STRING_START: '"`' -> pushMode(MD_STRING_MODE);

// Direction tokens - matches Jison's direction_tb, direction_bt, etc.
// These handle "direction TB", "direction BT", etc. statements within subgraphs
DIRECTION_TB: 'direction' WS+ 'TB' ~[\n]*;
DIRECTION_BT: 'direction' WS+ 'BT' ~[\n]*;
DIRECTION_RL: 'direction' WS+ 'RL' ~[\n]*;
DIRECTION_LR: 'direction' WS+ 'LR' ~[\n]*;

// ELLIPSE_START must come very early to avoid conflicts with PAREN_START
// Simplified ellipse pattern - match the entire ellipse in one token
// Excluding \r\n prevents greedy matching across line boundaries on malformed input
ELLIPSE_COMPLETE: '(-' (~[)\r\n]|')'~[-\r\n])* '-)';
ELLIPSE_START: '(-' -> pushMode(ELLIPSE_TEXT_MODE);

// Link ID token - matches edge IDs like "e1@" when followed by link patterns
// Uses a negative lookahead pattern to match the Jison lookahead (?=[^\{\"])
// This prevents LINK_ID from matching "e1@{" and allows SHAPE_DATA_START to match "@{" correctly
// The pattern matches any non-whitespace followed by @ but only when NOT followed by { or "
// Character codes: '{'=123, '"'=34
LINK_ID: ~[ \t\r\n"]+ '@' {this.inputStream.LA(1) != 123 && this.inputStream.LA(1) != 34}?;

NUM: [0-9]+;
BRKT: '#';
STYLE_SEPARATOR: ':::';
COLON: ':';
AMP: '&';
SEMI: ';';
COMMA: ',';
MULT: '*';

// Edge patterns - these are complex in Jison, need careful translation
// PERFORMANCE OPTIMIZATION: Use raw character codes instead of charCodeAt(0) calls
// Character codes: '|'=124, '-'=45, '<'=60
// Normal edges without text: A-->B (matches Jison: \s*[xo<]?\-\-+[-xo>]\s*) - must come first to avoid conflicts
// Note: LEADING_WS allows newlines/spaces before links (continuation links like "A\n-->B")
// This matches Jison's \s* which includes all whitespace including newlines
// IMPORTANT: Only match when NOT in header mode to avoid consuming YAML front matter '---'
// We check headerMode BEFORE consuming any whitespace to prevent consuming newlines in front matter
LINK_NORMAL: { !this.headerMode }? LEADING_WS [xo<]? '--' '-'* [-xo>] TRAILING_WS;
// Normal edges with text: A-- text ---B (matches Jison: <INITIAL>\s*[xo<]?\-\-\s* -> START_LINK)
START_LINK_NORMAL: { !this.headerMode }? LEADING_WS [xo<]? '--' WS+ -> pushMode(EDGE_TEXT_MODE);
// Normal edges with text (no space): A--text---B - match -- followed by any non-dash character
// Allow | when followed by - (like --|-->), but not when followed by text (like --|text|-->)
// Predicate: Either not followed by pipe, OR followed by pipe then dash (single-pipe edge text)
START_LINK_NORMAL_NOSPACE: { !this.headerMode }? LEADING_WS [xo<]? '--' {this.inputStream.LA(1) != 124 || this.inputStream.LA(2) == 45}? -> pushMode(EDGE_TEXT_MODE);
// Pipe-delimited edge text: A--x| (linkStatement for arrowText) - matches Jison linkStatement pattern
// Predicates: 1) Trailing < only when NOT followed by << 2) NOT match when followed by |- (single-pipe edge text)
LINK_STATEMENT_NORMAL: { !this.headerMode }? LEADING_WS [xo<]? '--' '-'* ([xo] | '<' {this.inputStream.LA(1) != 60}?)? {!(this.inputStream.LA(1) == 124 && this.inputStream.LA(2) == 45)}?;

// Thick edges with text: A== text ===B (matches Jison: <INITIAL>\s*[xo<]?\=\=\s* -> START_LINK)
START_LINK_THICK: LEADING_WS [xo<]? '==' WS+ -> pushMode(THICK_EDGE_TEXT_MODE);
// Thick edges without text: A==>B (matches Jison: \s*[xo<]?\=\=+[=xo>]\s*)
LINK_THICK: LEADING_WS [xo<]? '==' '='* [=xo>] TRAILING_WS;
LINK_STATEMENT_THICK: LEADING_WS [xo<]? '==' '='* [xo<]?;

// Dotted edges with text: A-. text .->B (matches Jison: <INITIAL>\s*[xo<]?\-\.\s* -> START_LINK)
START_LINK_DOTTED: LEADING_WS [xo<]? '-.' WS* -> pushMode(DOTTED_EDGE_TEXT_MODE);
// Dotted edges without text: A-.->B (matches Jison: \s*[xo<]?\-?\.+\-[xo>]?\s*)
LINK_DOTTED: LEADING_WS [xo<]? '-' '.'+ '-' [xo>]? TRAILING_WS;
// LINK_STATEMENT_DOTTED is for pipe-delimited edge text like A-.x|text|.->B
// The trailing [xo<] is optional but must NOT be followed by a letter (to avoid matching "-.on" as "-." + "o" + "n")
// Use predicate to check: either no trailing modifier, OR trailing modifier NOT followed by letter/digit/underscore
// PERFORMANCE: Direct char code comparison instead of arrow function
// Character codes: a-z: 97-122, A-Z: 65-90, 0-9: 48-57, underscore: 95
LINK_STATEMENT_DOTTED: LEADING_WS [xo<]? '-' '.'+ (
    [xo<] {(() => { const c = this.inputStream.LA(1); return !(c >= 97 && c <= 122) && !(c >= 65 && c <= 90) && !(c >= 48 && c <= 57) && c !== 95; })()}?
)?;

// Special link
LINK_INVISIBLE: LEADING_WS '~~' '~'+ TRAILING_WS;

// Fragment for leading whitespace including newlines (for continuation links like "A\n-->B")
fragment LEADING_WS: (WS | '\r'? '\n')*;

// Fragment for trailing whitespace including multiple newlines (for line continuation after arrows)
fragment TRAILING_WS: (WS | '\r'? '\n')*;

// PIPE handling: push to TEXT_MODE to handle content between pipes
// Put this AFTER link patterns to avoid interference with edge parsing
PIPE: '|' -> pushMode(TEXT_MODE);

// Vertex shape tokens - MUST come first (longer patterns before shorter ones)
DOUBLECIRCLE_START: '(((' -> pushMode(TEXT_MODE);
CIRCLE_START: '((' -> pushMode(TEXT_MODE);
// ELLIPSE_START moved to top of file for precedence

// PERFORMANCE OPTIMIZATION: Complete tokens match entire vertex patterns without mode transitions
// These patterns are matched in priority order (longer/more specific first)
// For simple text without nested brackets, this avoids push/pop overhead

// Complete cylinder pattern: [(text)] without nested parens (no spaces in unquoted text)
// MUST come before SQUARE_COMPLETE to avoid '[(Database)]' being matched as '[' + '(Database)' + ']'
// Exclude: ) ] " ( | { } space \r\n to match TEXT_CONTENT exclusion set (no line-crossing)
CYLINDER_COMPLETE: '[(' ('"' (~["\r\n])* '"' | ~[)\]"(|{} \r\n]+) ')]';

// Complete subroutine pattern: [[text]] without nested brackets
// MUST come before SQUARE_COMPLETE to avoid '[[text]]' being matched incorrectly
// Exclude: [ ] " ( ) | { } space \r\n to match TEXT_CONTENT exclusion set (no line-crossing)
SUBROUTINE_COMPLETE: '[[' ('"' (~["\r\n])* '"' | ~[\]"()|{} \r\n]+) ']]';

// Complete trapezoid patterns: MUST come before SQUARE_COMPLETE to avoid [/text\] matching as [/text\]
// All patterns exclude \r\n and TEXT_CONTENT chars to prevent greedy matching and ensure consistency
// Trapezoid: [/text\] - forward slash start, backslash end
TRAPEZOID_COMPLETE: '[/' ('"' (~["\r\n])* '"' | ~[\]"\\/[()|{} \r\n]+) '\\]';
// Inv Trapezoid: [\text/] - backslash start, forward slash end
INVTRAPEZOID_COMPLETE: '[\\' ('"' (~["\r\n])* '"' | ~[\]"\\/[()|{} \r\n]+) '/]';
// Lean right (parallelogram): [/text/] - forward slash both ends
LEANRIGHT_COMPLETE: '[/' ('"' (~["\r\n])* '"' | ~[\]"\\/[()|{} \r\n]+) '/]';
// Lean left (parallelogram alt): [\text\] - backslash both ends
LEANLEFT_COMPLETE: '[\\' ('"' (~["\r\n])* '"' | ~[\]"\\/[()|{} \r\n]+) '\\]';

// Complete square bracket pattern: [text] for UNQUOTED simple text only
// Match: [ followed by simple text (NO SPACES, NO QUOTES, NO NEWLINES), then ]
// This handles cases like [text], [simple_id]
// IMPORTANT: We DO NOT match quoted strings like ["text"] here because:
// 1. That conflicts with subgraph titles: subgraph s1["My Title"]
// 2. Quoted strings should use mode transitions (SQS text SQE) for proper parsing
// We exclude / and \ to avoid matching trapezoid patterns
// Exclude | ( ) { } to match TEXT_CONTENT exclusion set
// Excluding \r\n prevents greedy matching across line boundaries on malformed input
SQUARE_COMPLETE: '[' ~[\]"[ \\/|(){}\r\n]+ ']';

// Complete hexagon pattern: {{text}} without nested braces (no spaces/newlines in unquoted text)
// MUST come before DIAMOND_COMPLETE to avoid '{{text}}' being matched as '{' + '{text}' + '}'
// Exclude ( ) | [ ] to match TEXT_CONTENT exclusion set
// Excluding \r\n prevents greedy matching across line boundaries on malformed input
HEXAGON_COMPLETE: '{{' ('"' (~["\r\n])* '"' | ~[}"[()|{} \r\n]+) '}}';

// Complete diamond pattern: {text} without nested braces (no spaces/newlines in unquoted text)
// Exclude ( ) | to match TEXT_CONTENT exclusion set
// Excluding \r\n prevents greedy matching across line boundaries on malformed input
DIAMOND_COMPLETE: '{' ('"' (~["\r\n])* '"' | ~[}"[{()|  \r\n]+) '}';

// Complete double circle pattern: (((text))) without nested parens (no spaces/newlines in unquoted text)
// MUST come before CIRCLE_COMPLETE to avoid '(((text)))' being matched as '((' + '(text)' + '))'
// Exclude | { } [ ] to match TEXT_CONTENT exclusion set
// Excluding \r\n prevents greedy matching across line boundaries on malformed input
DOUBLECIRCLE_COMPLETE: '(((' ('"' (~["\r\n])* '"' | ~[\])"(|{}[ \r\n]+) ')))';

// Complete circle pattern: ((text)) without nested parens (no spaces/newlines in unquoted text)
// Exclude | { } to match TEXT_CONTENT exclusion set
// Excluding \r\n prevents greedy matching across line boundaries on malformed input
CIRCLE_COMPLETE: '((' ('"' (~["\r\n])* '"' | ~[)"(|{} \r\n]+) '))';

// Complete stadium pattern: ([text]) without nested brackets (no spaces/newlines in unquoted text)
// Exclude ( ) | { } to match TEXT_CONTENT exclusion set
// Excluding \r\n prevents greedy matching across line boundaries on malformed input
STADIUM_COMPLETE: '([' ('"' (~["\r\n])* '"' | ~[\]"()|{} \r\n]+) '])';

// Complete round pattern: (text) without nested parens (no spaces/newlines in unquoted text)
// MUST come after all other '(' patterns (DOUBLECIRCLE_COMPLETE, CIRCLE_COMPLETE, STADIUM_COMPLETE)
// Exclude | { } [ ] to match TEXT_CONTENT exclusion set
// Excluding \r\n prevents greedy matching across line boundaries on malformed input
ROUND_COMPLETE: '(' ('"' (~["\r\n])* '"' | ~[\])"(|{}[ \r\n]+) ')';

// Basic shape tokens - IMPORTANT: longer patterns MUST come before shorter ones for proper precedence
// These are fallbacks when the complete patterns don't match (e.g., nested structures)
// Trapezoid patterns must come before SQUARE_START to avoid '[' matching first
TRAP_START: '[/' -> pushMode(TRAP_TEXT_MODE);
INVTRAP_START: '[\\' -> pushMode(TRAP_TEXT_MODE);
// Other bracket-based patterns
SUBROUTINE_START: '[[' -> pushMode(TEXT_MODE);
VERTEX_WITH_PROPS_START: '[|';
CYLINDER_START: '[(' -> pushMode(TEXT_MODE);
// SQUARE_START must come AFTER all other '[' patterns to avoid conflicts
SQUARE_START: '[' -> pushMode(TEXT_MODE), type(SQS);
// STADIUM_START must come BEFORE PAREN_START to ensure '([' is matched before '('
// (explicit priority, not relying solely on longest-match semantics)
STADIUM_START: '([' -> pushMode(TEXT_MODE);
// PAREN_START must come AFTER ELLIPSE_START and STADIUM_START to avoid consuming '(' before longer patterns
PAREN_START: '(' -> pushMode(TEXT_MODE), type(PS);
DIAMOND_START: '{' -> pushMode(TEXT_MODE);

// Other basic shape tokens
TAGSTART: '<';
TAGEND: '>' -> pushMode(TEXT_MODE);
UP: '^';
DOWN: 'v';
MINUS: '-';

// Node string - allow dashes with lookahead to prevent conflicts with links (matches Jison pattern)
// Pattern: ([A-Za-z0-9!"\#$%&'*+\.`?\\_\/]|\-(?=[^\>\-\.])|=(?!=))+
// Note: Removed '"' from character class to prevent NODE_STRING from matching quoted strings
// The QUOTE token should handle '"' to enter STRING_MODE for proper string parsing
// PERFORMANCE OPTIMIZATION:
// 1. Greedy base char matching with + to reduce loop iterations
// 2. Semantic predicates for - and = to avoid consuming following characters
// 3. Character codes: '>'=62, '-'=45, '.'=46, '='=61
NODE_STRING: (NODE_STRING_BASE_CHARS | NODE_STRING_DASH | NODE_STRING_EQUALS)+;
// Match one or more base characters greedily (no predicates needed for these)
fragment NODE_STRING_BASE_CHARS: [A-Za-z0-9!#$%&'*+.`?\\/_]+;
// Match dash only when not followed by '>', '-', or '.' (to avoid link patterns)
fragment NODE_STRING_DASH: '-' {this.inputStream.LA(1) != 62 && this.inputStream.LA(1) != 45 && this.inputStream.LA(1) != 46}?;
// Match equals only when not followed by another '=' (to avoid == thick edges)
// Fixed: Use predicate instead of ~'=' to avoid consuming the following character
fragment NODE_STRING_EQUALS: '=' {this.inputStream.LA(1) != 61}?;

// Unicode text support - includes Latin Extended, Greek, Cyrillic, CJK, Japanese, Korean, Arabic, Hebrew, etc.
// Based on Jison's extensive Unicode ranges plus CJK/Asian character support
UNICODE_TEXT: (
    [\u00AA\u00B5\u00BA\u00C0-\u00D6\u00D8-\u00F6\u00F8-\u02C1\u02C6-\u02D1\u02E0-\u02E4\u02EC\u02EE]  // Latin Extended, etc.
    | [\u0370-\u03FF]  // Greek and Coptic
    | [\u0400-\u04FF]  // Cyrillic
    | [\u0590-\u05FF]  // Hebrew
    | [\u0600-\u06FF]  // Arabic
    | [\u3040-\u309F]  // Hiragana
    | [\u30A0-\u30FF]  // Katakana
    | [\u4E00-\u9FFF]  // CJK Unified Ideographs (Chinese, Japanese Kanji, Korean Hanja)
    | [\uAC00-\uD7AF]  // Hangul Syllables (Korean)
)+;

// String handling - matches Jison's <*>["] behavior (any mode can enter string mode)
QUOTE: '"' -> pushMode(STRING_MODE), skip;

NEWLINE: ('\r'? '\n')+;
// Include non-breaking space (U+00A0) as whitespace - users may copy-paste content with NBSP
WS: [ \t\u00A0]+;

// Lexer modes
mode ACC_TITLE_MODE;
ACC_TITLE_VALUE: (~[\n;#])* -> popMode;

mode ACC_DESCR_MODE;
ACC_DESCR_VALUE: (~[\n;#])* -> popMode;

mode ACC_DESCR_MULTILINE_MODE;
ACC_DESCR_MULTILINE_END: '}' -> popMode;
ACC_DESCR_MULTILINE_VALUE: (~[}])*;

mode SHAPE_DATA_MODE;
SHAPE_DATA_STRING_START: '"' -> pushMode(SHAPE_DATA_STRING_MODE);
SHAPE_DATA_CONTENT: (~[}"]+);
SHAPE_DATA_END: '}' -> popMode;

mode SHAPE_DATA_STRING_MODE;
SHAPE_DATA_STRING_END: '"' -> popMode;
SHAPE_DATA_STRING_CONTENT: (~["]+);

mode CALLBACKNAME_MODE;
// Simplified approach: match the entire callback with arguments as one token
CALLBACKNAME_WITH_ARGS: [A-Za-z0-9_]+ '(' (~[)])* ')' -> popMode, type(CALLBACKARGS);
CALLBACKNAME_PAREN_EMPTY: '(' WS* ')' -> popMode, type(CALLBACKARGS);
CALLBACKNAME: [A-Za-z0-9_]+;

mode CLICK_MODE;
CLICK_NEWLINE: ('\r'? '\n')+ -> popMode, type(NEWLINE);
CLICK_WS: WS -> skip;
CLICK_CALL: 'call' WS+ -> type(CALL), pushMode(CALLBACKNAME_MODE);
CLICK_HREF: 'href' -> type(HREF);
CLICK_STR: '"' (~["])* '"' -> type(STR);
CLICK_LINK_TARGET: ('_self' | '_blank' | '_parent' | '_top') -> type(LINK_TARGET);
CLICK_CALLBACKNAME: [A-Za-z0-9_]+ -> type(CALLBACKNAME);



mode DIR_MODE;
DIR_NEWLINE: ('\r'? '\n')* WS* '\n' -> popMode, type(NODIR);
DIR_LR: WS* 'LR' -> popMode, type(DIR);
DIR_RL: WS* 'RL' -> popMode, type(DIR);
DIR_TB: WS* 'TB' -> popMode, type(DIR);
DIR_BT: WS* 'BT' -> popMode, type(DIR);
DIR_TD: WS* 'TD' -> popMode, type(DIR);
DIR_BR: WS* 'BR' -> popMode, type(DIR);
DIR_LEFT: WS* '<' -> popMode, type(DIR);
DIR_RIGHT: WS* '>' -> popMode, type(DIR);
DIR_UP: WS* '^' -> popMode, type(DIR);
DIR_DOWN: WS* 'v' -> popMode, type(DIR);

mode STRING_MODE;
STRING_END: '"' -> popMode, skip;
STR: (~["]+);

mode MD_STRING_MODE;
MD_STRING_END: '`"' -> popMode;
MD_STR: (~[`"])+;

mode TEXT_MODE;
// Allow nested diamond starts (for hexagon nodes)
TEXT_DIAMOND_START: '{' -> pushMode(TEXT_MODE), type(DIAMOND_START);

// Handle nested parentheses and brackets like Jison
TEXT_PAREN_START: '(' -> pushMode(TEXT_MODE), type(PS);
TEXT_SQUARE_START: '[' -> pushMode(TEXT_MODE), type(SQS);

// Handle quoted strings in text mode - matches Jison's <*>["] behavior
// Skip the opening quote token, just push to STRING_MODE like Jison does
TEXT_STRING_START: '"' -> pushMode(STRING_MODE), skip;

// Handle closing pipe in text mode - pop back to default mode
TEXT_PIPE_END: '|' -> popMode, type(PIPE);

TEXT_PAREN_END: ')' -> popMode, type(PE);
TEXT_SQUARE_END: ']' -> popMode, type(SQE);
TEXT_DIAMOND_END: '}' -> popMode, type(DIAMOND_STOP);
TEXT_STADIUM_END: '])' -> popMode, type(STADIUMEND);
TEXT_SUBROUTINE_END: ']]' -> popMode, type(SUBROUTINEEND);
TEXT_CYLINDER_END: ')]' -> popMode, type(CYLINDEREND);
TEXT_DOUBLECIRCLE_END: ')))' -> popMode, type(DOUBLECIRCLEEND);
TEXT_CIRCLE_END: '))' -> popMode, type(CIRCLEEND);
// Now allow all characters except the specific end tokens for this mode
TEXT_CONTENT: (~[(){}|\]"])+;

mode ELLIPSE_TEXT_MODE;
ELLIPSE_END: '-)' -> popMode, type(ELLIPSE_END_TOKEN);
// Match Jison behavior: allow any char except ()[]{}  OR  - not followed by )
// Jison pattern: [^\(\)\[\]\{\}]|-\!\)+
// Fixed: Allow hyphens in the middle of text, but not when they form the end pattern '-)'
// Character code: ')'=41
ELLIPSE_TEXT: (
    ~[()[\]{}]
    | '-' {this.inputStream.LA(1) != 41}?
)+;

mode TRAP_TEXT_MODE;
// End patterns must come first for proper precedence
TRAP_END_BRACKET: '\\]' -> popMode, type(TRAPEND);
INVTRAP_END_BRACKET: '/]' -> popMode, type(INVTRAPEND);
// Handle quoted strings in trapezoid text - quotes protect the content including parentheses
// The quoted string content is included in the TRAP_TEXT_QUOTED token
// This matches Jison's <*>["] behavior which pushes to string mode from any state
TRAP_TEXT_QUOTED: '"' (~["])* '"';
// Match all other content including parentheses, braces, newlines, etc.
// Only exclude / and \ which are handled separately to detect the end markers
// Allow: / not followed by ], \ not followed by ], or any other character except \, /, [, ]
// Character code: ']'=93
TRAP_TEXT: (
    '/' {this.inputStream.LA(1) != 93}?
    | '\\' {this.inputStream.LA(1) != 93}?
    | ~[\\/\][]
)+;

mode EDGE_TEXT_MODE;
// Handle space-delimited pattern: A-- text ----B or A-- text -->B (matches Jison: [^-]|\-(?!\-)+)
// Must handle both cases: extra dashes without arrow (----) and dashes with arrow (-->)
// Use TRAILING_WS_EDGE to consume optional newlines + spaces after the arrow for multiline support
EDGE_TEXT_LINK_END: WS* '--' '-'* [-xo>]? TRAILING_WS_EDGE -> popMode, type(LINK_NORMAL);
fragment TRAILING_WS_EDGE: ([ \t\u00A0] | '\r'? '\n' [ \t\u00A0]*)*;
// Handle quoted strings in edge text - quotes protect the content from being parsed as link end
// The quoted string content is included in the EDGE_TEXT token
EDGE_TEXT_QUOTED: '"' (~["])* '"';
// Match any character including spaces and single dashes, but not double dashes or quotes
EDGE_TEXT: (~[-"] | '-' ~[-])+;

mode THICK_EDGE_TEXT_MODE;
// Handle thick edge patterns: A== text ====B or A== text ==>B
THICK_EDGE_TEXT_LINK_END: WS* '==' '='* [=xo>]? WS* -> popMode, type(LINK_THICK);
THICK_EDGE_TEXT: (~[=] | '=' ~[=])+;

mode DOTTED_EDGE_TEXT_MODE;
// Handle dotted edge patterns: A-. text ...-B or A-. text .->B
DOTTED_EDGE_TEXT_LINK_END: WS* '.'+ '-' [xo>]? WS* -> popMode, type(LINK_DOTTED);
// Handle quoted strings in dotted edge text - quotes protect the content from being parsed as link end
DOTTED_EDGE_TEXT_QUOTED: '"' (~["])* '"';
// Match any character except dots and quotes (dots trigger link end check, quotes are handled above)
DOTTED_EDGE_TEXT: (~[."] | '.' ~[-xo>])+;

// YAML_MODE is provided by HeaderCommon
