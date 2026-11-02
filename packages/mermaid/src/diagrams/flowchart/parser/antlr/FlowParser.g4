parser grammar FlowParser;

options {
    tokenVocab = FlowLexer;
}

// Entry point - includes header for directives and front matter
start: header graphConfig document;

// Header section - handles YAML front matter, header directives (%%{init}%%, etc.), and comments
// Comments before the flowchart header are preserved for round-trip code generation
header: (NEWLINE | HEADER_DIRECTIVE | FRONTMATTER | COMMENT | WS)*;

// Document structure - matches Jison's document rule
document:
    line*
    ;

// Line structure - matches Jison's line rule
line:
    statement
    | SEMI
    | NEWLINE
    | WS
    ;

// Graph configuration - matches Jison's graphConfig rule
graphConfig:
    WS graphConfig
    | NEWLINE graphConfig
    | GRAPH NODIR                           // Default TB direction
    | GRAPH DIR firstStmtSeparator          // Explicit direction
    ;

// Statement types - matches Jison's statement rule
statement:
    commentStatement separator             // Comments must be preserved for round-trip code generation
    | vertexStatement separator
    | standaloneVertex separator           // For edge property statements like e1@{curve: basis}
    | styleStatement separator
    | linkStyleStatement separator
    | classDefStatement separator
    | classStatement separator
    | clickStatement separator
    | subgraphStatement separator
    | direction
    | accTitle
    | accDescr
    ;

// Separators
// Allow optional inline comment before newline/EOF for round-trip code generation
separator: COMMENT? NEWLINE | COMMENT? EOF | SEMI;
firstStmtSeparator: SEMI | NEWLINE | spaceList NEWLINE;
// PERFORMANCE OPTIMIZATION: Use EBNF '+' instead of left-recursion for better ATN efficiency
spaceList: WS+;

// Comment statement - preserves comments for round-trip code generation
commentStatement:
    COMMENT
    ;

// Vertex statement - matches Jison's vertexStatement rule
vertexStatement:
    vertexStatement link node shapeData     // Chain with shape data
    | vertexStatement link node             // Chain without shape data
    | vertexStatement link node spaceList  // Chain with trailing space
    | node spaceList                        // Single node with space
    | node shapeData                        // Single node with shape data
    | node                                  // Single node
    ;

// Standalone vertex - for edge property statements like e1@{curve: basis}
standaloneVertex:
    NODE_STRING shapeData
    | LINK_ID shapeData                     // For edge IDs like e1@{curve: basis}
    ;

// Node definition - matches Jison's node rule
node:
    styledVertex
    | node spaceList AMP spaceList styledVertex
    ;

// Styled vertex - matches Jison's styledVertex rule
styledVertex:
    vertex shapeData
    | vertex
    | vertex STYLE_SEPARATOR idString
    ;

// Vertex shapes - matches Jison's vertex rule
// Left-factored to eliminate ambiguity: all alternatives now start with idString followed by optional shape
// This allows SLL mode to make faster decisions without fallback to LL mode
vertex:
    idString vertexShape?                                          // All vertices start with idString
    ;

// Vertex shape alternatives - the shape part that follows idString
// Separated from vertex rule to enable SLL-friendly parsing
// PERFORMANCE: Complete tokens (no mode transitions) come first for common simple cases
vertexShape:
    TRAPEZOID_COMPLETE                                            // Trapezoid: [/text\] - optimized complete token
    | INVTRAPEZOID_COMPLETE                                       // Inv trapezoid: [\text/] - optimized complete token
    | LEANRIGHT_COMPLETE                                          // Lean right: [/text/] - optimized complete token
    | LEANLEFT_COMPLETE                                           // Lean left: [\text\] - optimized complete token
    | CYLINDER_COMPLETE                                           // Cylinder: [(text)] - optimized complete token
    | SUBROUTINE_COMPLETE                                         // Subroutine: [[text]] - optimized complete token
    | SQUARE_COMPLETE                                             // Square: [text] - optimized complete token
    | HEXAGON_COMPLETE                                            // Hexagon: {{text}} - optimized complete token
    | DIAMOND_COMPLETE                                            // Diamond: {text} - optimized complete token
    | DOUBLECIRCLE_COMPLETE                                       // Double circle: (((text))) - optimized complete token
    | CIRCLE_COMPLETE                                             // Circle: ((text)) - optimized complete token
    | STADIUM_COMPLETE                                            // Stadium: ([text]) - optimized complete token
    | ROUND_COMPLETE                                              // Round: (text) - optimized complete token
    | SQS text SQE                                                // Square: [text] - fallback with mode
    | DOUBLECIRCLE_START text DOUBLECIRCLEEND                     // Double circle: (((text))) - fallback with mode
    | CIRCLE_START text CIRCLEEND                                 // Circle: ((text)) - fallback with mode
    | ELLIPSE_COMPLETE                                            // Ellipse: (-text-) - complete token
    | ELLIPSE_START text ELLIPSE_END_TOKEN                        // Ellipse: (-text-) - mode-based
    | STADIUM_START text STADIUMEND                               // Stadium: ([text]) - fallback with mode
    | SUBROUTINE_START text SUBROUTINEEND                         // Subroutine: [[text]] - fallback with mode
    | VERTEX_WITH_PROPS_START NODE_STRING COLON NODE_STRING PIPE text SQE  // Props: [|field:value|text]
    | CYLINDER_START text CYLINDEREND                             // Cylinder: [(text)] - fallback with mode
    | PS text PE                                                  // Round: (text)
    | DIAMOND_START text DIAMOND_STOP                             // Diamond: {text} - fallback with mode
    | DIAMOND_START DIAMOND_START text DIAMOND_STOP DIAMOND_STOP  // Hexagon: {{text}}
    | TAGEND text SQE                                             // Odd: >text]
    | TRAP_START text TRAPEND                                     // Trapezoid: [/text\] - fallback with mode
    | INVTRAP_START text INVTRAPEND                               // Inv trapezoid: [\text/] - fallback with mode
    | TRAP_START text INVTRAPEND                                  // Lean right: [/text/] - fallback with mode
    | INVTRAP_START text TRAPEND                                  // Lean left: [\text\] - fallback with mode
    ;

// Link definition - matches Jison's link rule
link:
    linkStatement arrowText spaceList?
    | linkStatement
    // Inline edge text patterns: A-- text -->B
    | START_LINK_NORMAL edgeText LINK_NORMAL
    | START_LINK_NORMAL_NOSPACE edgeText LINK_NORMAL
    | START_LINK_THICK edgeText LINK_THICK
    | START_LINK_DOTTED edgeText LINK_DOTTED
    | LINK_ID START_LINK_NORMAL edgeText LINK_NORMAL
    | LINK_ID START_LINK_NORMAL_NOSPACE edgeText LINK_NORMAL
    | LINK_ID START_LINK_THICK edgeText LINK_THICK
    | LINK_ID START_LINK_DOTTED edgeText LINK_DOTTED
    // Pipe-delimited edge text with trailing arrow: A--|text|-->B
    // The LINK_STATEMENT matches the opening (--), arrowText matches (|text|), LINK matches the closing (-->)
    | LINK_STATEMENT_NORMAL arrowText LINK_NORMAL
    | LINK_STATEMENT_THICK arrowText LINK_THICK
    | LINK_STATEMENT_DOTTED arrowText LINK_DOTTED
    | LINK_ID LINK_STATEMENT_NORMAL arrowText LINK_NORMAL
    | LINK_ID LINK_STATEMENT_THICK arrowText LINK_THICK
    | LINK_ID LINK_STATEMENT_DOTTED arrowText LINK_DOTTED
    ;

// Link statement - matches Jison's linkStatement rule
linkStatement:
    LINK_NORMAL
    | LINK_THICK
    | LINK_DOTTED
    | LINK_INVISIBLE
    | LINK_STATEMENT_NORMAL
    | LINK_STATEMENT_DOTTED
    | LINK_ID LINK_NORMAL
    | LINK_ID LINK_THICK
    | LINK_ID LINK_DOTTED
    | LINK_ID LINK_INVISIBLE
    | LINK_ID LINK_STATEMENT_NORMAL
    | LINK_ID LINK_STATEMENT_THICK
    ;

// Edge text - matches Jison's edgeText rule
edgeText:
    edgeTextToken
    | edgeText edgeTextToken
    | stringLiteral
    | MD_STR
    ;

// Arrow text - matches Jison's arrowText rule
arrowText:
    PIPE text PIPE
    ;

// Text definition - matches Jison's text rule
text:
    textToken
    | text textToken
    | stringLiteral
    | MD_STR
    | NODE_STRING
    | TEXT_CONTENT
    | ELLIPSE_TEXT
    | TRAP_TEXT
    | TRAP_TEXT_QUOTED
    ;

// Shape data - matches Jison's shapeData rule
// PERFORMANCE OPTIMIZATION: Use SHAPE_DATA_COMPLETE for simple cases without embedded strings
shapeData:
    SHAPE_DATA_COMPLETE                                    // Simple: @{shape: diamond}
    | SHAPE_DATA_START shapeDataContent SHAPE_DATA_END     // Complex: @{label: "text"}
    ;

// PERFORMANCE OPTIMIZATION: Use EBNF '*' instead of left-recursion for better ATN efficiency
// Each item is either raw content or a quoted string
shapeDataContent:
    shapeDataContentItem*
    ;

shapeDataContentItem:
    SHAPE_DATA_CONTENT
    | SHAPE_DATA_STRING_START SHAPE_DATA_STRING_CONTENT SHAPE_DATA_STRING_END
    ;

// Style statement - matches Jison's styleStatement rule
styleStatement:
    STYLE WS idString WS stylesOpt
    ;

// Link style statement - matches Jison's linkStyleStatement rule
linkStyleStatement:
    LINKSTYLE WS DEFAULT WS stylesOpt
    | LINKSTYLE WS numList WS stylesOpt
    | LINKSTYLE WS DEFAULT WS INTERPOLATE WS alphaNum WS stylesOpt
    | LINKSTYLE WS numList WS INTERPOLATE WS alphaNum WS stylesOpt
    | LINKSTYLE WS DEFAULT WS INTERPOLATE WS alphaNum
    | LINKSTYLE WS numList WS INTERPOLATE WS alphaNum
    ;

// Class definition statement - matches Jison's classDefStatement rule
classDefStatement:
    CLASSDEF WS idString WS stylesOpt
    ;

// Class statement - matches Jison's classStatement rule
classStatement:
    CLASS WS idString WS idString
    ;

// String rule to handle STR patterns
stringLiteral:
    STR
    ;

// Click statement - matches Jison's clickStatement rule
// CLICK token now contains both 'click' and node ID (like Jison)
clickStatement:
    CLICK CALLBACKNAME
    | CLICK CALLBACKNAME stringLiteral
    | CLICK CALLBACKNAME CALLBACKARGS
    | CLICK CALLBACKNAME CALLBACKARGS stringLiteral
    | CLICK CALL CALLBACKNAME
    | CLICK CALL CALLBACKNAME stringLiteral
    | CLICK CALL CALLBACKNAME CALLBACKARGS
    | CLICK CALL CALLBACKNAME CALLBACKARGS stringLiteral
    | CLICK CALL CALLBACKARGS                                // CLICK CALL callback() - call with args only
    | CLICK CALL CALLBACKARGS stringLiteral                  // CLICK CALL callback() "tooltip" - call with args and tooltip
    | CLICK HREF stringLiteral
    | CLICK HREF stringLiteral stringLiteral
    | CLICK HREF stringLiteral LINK_TARGET
    | CLICK HREF stringLiteral stringLiteral LINK_TARGET
    | CLICK stringLiteral                                    // CLICK STR - direct click with URL
    | CLICK stringLiteral stringLiteral                      // CLICK STR STR - click with URL and tooltip
    | CLICK stringLiteral LINK_TARGET                        // CLICK STR LINK_TARGET - click with URL and target
    | CLICK stringLiteral stringLiteral LINK_TARGET          // CLICK STR STR LINK_TARGET - click with URL, tooltip, and target
    ;

// Subgraph statement - matches Jison's subgraph rules
// Note: SQUARE_COMPLETE alternative handles cases like subgraph s1[Title] where [Title] is lexed as one token
subgraphStatement:
    SUBGRAPH WS textNoTags SQS text SQE separator document END
    | SUBGRAPH WS textNoTags SQUARE_COMPLETE separator document END
    | SUBGRAPH WS textNoTags separator document END
    | SUBGRAPH separator document END
    ;

// Direction statement - matches Jison's direction rule
direction:
    DIRECTION_TB
    | DIRECTION_BT
    | DIRECTION_RL
    | DIRECTION_LR
    ;

// Accessibility statements
accTitle: ACC_TITLE ACC_TITLE_VALUE;
accDescr: ACC_DESCR ACC_DESCR_VALUE | ACC_DESCR_MULTI ACC_DESCR_MULTILINE_VALUE ACC_DESCR_MULTILINE_END;

// Number list - matches Jison's numList rule
numList:
    NUM
    | numList COMMA NUM
    ;

// Styles - matches Jison's stylesOpt rule
stylesOpt:
    style
    | stylesOpt COMMA style
    ;

// Style components - matches Jison's style rule
style:
    styleComponent
    | style styleComponent
    ;

// Style component - matches Jison's styleComponent rule
styleComponent: NUM | NODE_STRING | COLON | WS | BRKT | STYLE | MULT | MINUS;

// Token definitions - matches Jison's token lists
idString:
    idStringToken
    | idString idStringToken
    ;

alphaNum:
    alphaNumToken
    | alphaNum alphaNumToken
    ;

textNoTags:
    textNoTagsToken
    | textNoTags textNoTagsToken
    | stringLiteral
    | MD_STR
    ;

// Token types - matches Jison's token definitions
idStringToken: NUM | NODE_STRING | DOWN | MINUS | DEFAULT | COMMA | COLON | AMP | BRKT | MULT | UNICODE_TEXT;
textToken: TEXT_CONTENT | TAGSTART | TAGEND | UNICODE_TEXT | NODE_STRING | WS;
textNoTagsToken: NUM | NODE_STRING | WS | MINUS | AMP | UNICODE_TEXT | COLON | MULT | BRKT | keywords | START_LINK_NORMAL;
edgeTextToken: EDGE_TEXT | EDGE_TEXT_QUOTED | THICK_EDGE_TEXT | DOTTED_EDGE_TEXT | DOTTED_EDGE_TEXT_QUOTED | UNICODE_TEXT;
alphaNumToken: NUM | UNICODE_TEXT | NODE_STRING | DIR | DOWN | MINUS | COMMA | COLON | AMP | BRKT | MULT;

// Keywords - matches Jison's keywords rule
keywords: STYLE | LINKSTYLE | CLASSDEF | CLASS | CLICK | GRAPH | DIR | SUBGRAPH | END | DOWN | UP;
