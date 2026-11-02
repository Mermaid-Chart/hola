/* eslint-disable no-console */
// This is a performance test file that intentionally uses console.log for benchmark output visibility

import { describe, it, expect } from 'vitest';
import { FlowDB } from '../flowDb.js';
import jisonParser from './flowParser.js';
import { ANTLRFlowParser } from './antlr/antlr-parser.js';
import { CharStream, CommonTokenStream } from 'antlr4ng';
import { FlowLexer } from './antlr/generated/FlowLexer.js';
import { FlowParser } from './antlr/generated/FlowParser.js';
import { FlowchartVisitor } from './antlr/FlowchartVisitor.js';
import { FlowchartASTBuilder } from './antlr/FlowchartASTBuilder.js';
import { setConfig } from '../../../config.js';

setConfig({
  securityLevel: 'strict',
});

/**
 * Performance threshold: ANTLR parser should not be more than 6x slower than Jison.
 * This threshold is based on historical benchmarks and ensures performance regressions are caught.
 * If this threshold is exceeded, investigate lexer optimizations (complete tokens, mode transitions).
 */
const MAX_ANTLR_TO_JISON_RATIO = 6;

const COMPLEX_FLOWCHART = `flowchart TB
    n1["Incoming PRs"] --> Review["Review"]
    n2["New Issues"] --> Triage["Triage"]
    n3["Comments on<br>Issues / PRs"] --> Classify["Classify<br>Intent"]
    n4["Scheduled<br>Triggers"] --> Sweep["Sweep"]
    Review --> approve["Approve"] & reqchange["Comment /<br>Request Changes"] & escR["Escalate to<br>Human"] & fixPR["Create<br>Fix PR"]
    Triage --> close["Close<br>(dupe / invalid /<br>wont-fix)"] & park["Label &<br>Park"] & assign["Label &<br>Assign"]
    Triage -- Evaluated to be hard/large or high risk --> escT["Escalate to<br>Human"]
    Triage -- PRs suitable for direct fix --> fixPR
    Classify --> respond["Respond"] & reReview["Re-trigger<br>Review"] & backlog["Add to<br>Backlog"] & escC["Escalate to<br>Human"]
    Sweep --> stale["Stale<br>Cleanup"] & deps["Dependency<br>PRs"] & health["Health<br>Report"]
    fixPR -. "agent-created PR" .-> Review
    reReview -. author updated .-> Review
    deps -. "dep-update PR" .-> Review
    approve --> Done["Done"]
    reqchange --> Done
    escR --> Done
    close --> Done
    park --> Done
    assign --> Done
    escT --> Done & n6["Refine issue/solution"]
    escT ~~~ n5["Large PRs should be broken up, approved by human"]
    respond --> Done
    backlog --> Done
    escC --> Done
    stale --> Done
    health --> Done
    n6 --> Triage
    n7["Agents per diagram"]

    n1@{ shape: rounded}
    Review@{ shape: diam}
    n2@{ shape: rounded}
    Triage@{ shape: rect}
    n3@{ shape: rounded}
    Classify@{ shape: diam}
    n4@{ shape: rounded}
    Sweep@{ shape: rect}
    Done@{ shape: dbl-circ}
    n6@{ shape: rect}
    n5@{ shape: rect}
    n7@{ shape: rect}
     n1:::Peach
     n2:::Peach
     n3:::Peach
     n4:::Peach
     escR:::Rose
     escT:::Rose
     escC:::Rose
     n5:::Ash
     n7:::Rose
    classDef Ash stroke-width:1px,stroke-dasharray:none,stroke:#999999,fill:#EEEEEE,color:#000000
    classDef Aqua stroke-width:1px,stroke-dasharray:none,stroke:#46EDC8,fill:#DEFFF8,color:#378E7A
    classDef Peach stroke-width:1px,stroke-dasharray:none,stroke:#FBB35A,fill:#FFEFDB,color:#8F632D
    classDef Sky stroke-width:1px,stroke-dasharray:none,stroke:#374D7C,fill:#E2EBFF,color:#374D7C
    classDef Rose stroke-width:1px, stroke-dasharray:none, stroke:#FF5978, fill:#FFDFE5, color:#8E2236`;

// Skip performance tests in CI - they are meant for local benchmarking only
describe.skip('Parser Performance Comparison: Jison vs ANTLR', () => {
  describe('Complex flowchart parsing performance', () => {
    it('should compare parsing time between Jison and ANTLR parsers', { timeout: 30000 }, () => {
      const iterations = 10;
      const jisonTimes: number[] = [];
      const antlrTimes: number[] = [];

      // Warm-up runs (not counted)
      for (let i = 0; i < 2; i++) {
        const jisonDb = new FlowDB();
        jisonDb.clear();
        jisonParser.parser.yy = jisonDb;
        jisonParser.parse(COMPLEX_FLOWCHART);

        const antlrDb = new FlowDB();
        const antlrParserInstance = new ANTLRFlowParser();
        antlrParserInstance.yy = antlrDb;
        antlrParserInstance.parse(COMPLEX_FLOWCHART);
      }

      // Jison parser timing
      for (let i = 0; i < iterations; i++) {
        const jisonDb = new FlowDB();
        jisonDb.clear();
        jisonParser.parser.yy = jisonDb;

        const startTime = performance.now();
        jisonParser.parse(COMPLEX_FLOWCHART);
        const endTime = performance.now();

        jisonTimes.push(endTime - startTime);
      }

      // ANTLR parser timing
      for (let i = 0; i < iterations; i++) {
        const antlrDb = new FlowDB();
        const antlrParserInstance = new ANTLRFlowParser();
        antlrParserInstance.yy = antlrDb;

        const startTime = performance.now();
        antlrParserInstance.parse(COMPLEX_FLOWCHART);
        const endTime = performance.now();

        antlrTimes.push(endTime - startTime);
      }

      // Calculate statistics
      const jisonAvg = jisonTimes.reduce((a, b) => a + b, 0) / jisonTimes.length;
      const antlrAvg = antlrTimes.reduce((a, b) => a + b, 0) / antlrTimes.length;
      const jisonMin = Math.min(...jisonTimes);
      const jisonMax = Math.max(...jisonTimes);
      const antlrMin = Math.min(...antlrTimes);
      const antlrMax = Math.max(...antlrTimes);

      // Output results (using console.log to ensure capture in test output)

      console.log('\n📊 Parser Performance Comparison Results:');
      console.log('='.repeat(50));
      console.log(`Iterations: ${iterations}`);
      console.log('');
      console.log('Jison Parser:');
      console.log(`  Average: ${jisonAvg.toFixed(3)} ms`);
      console.log(`  Min: ${jisonMin.toFixed(3)} ms`);
      console.log(`  Max: ${jisonMax.toFixed(3)} ms`);
      console.log('');
      console.log('ANTLR Parser:');
      console.log(`  Average: ${antlrAvg.toFixed(3)} ms`);
      console.log(`  Min: ${antlrMin.toFixed(3)} ms`);
      console.log(`  Max: ${antlrMax.toFixed(3)} ms`);
      console.log('');
      console.log(`Ratio (ANTLR/Jison): ${(antlrAvg / jisonAvg).toFixed(2)}x`);
      console.log('='.repeat(50));

      // Both parsers should successfully parse
      expect(jisonTimes.length).toBe(iterations);
      expect(antlrTimes.length).toBe(iterations);

      // Verify both parsers produce valid results
      const jisonDb = new FlowDB();
      jisonDb.clear();
      jisonParser.parser.yy = jisonDb;
      jisonParser.parse(COMPLEX_FLOWCHART);
      const jisonVertices = jisonDb.getVertices();
      const jisonEdges = jisonDb.getEdges();

      const antlrDb = new FlowDB();
      const antlrParserInstance = new ANTLRFlowParser();
      antlrParserInstance.yy = antlrDb;
      antlrParserInstance.parse(COMPLEX_FLOWCHART);
      const antlrVertices = antlrDb.getVertices();
      const antlrEdges = antlrDb.getEdges();

      // Both should parse successfully and produce results
      expect(jisonVertices.size).toBeGreaterThan(0);
      expect(antlrVertices.size).toBeGreaterThan(0);
      expect(jisonEdges.length).toBeGreaterThan(0);
      expect(antlrEdges.length).toBeGreaterThan(0);

      // Output vertex/edge counts for comparison
      console.log('\n📊 Parser Output Comparison:');
      console.log(`Jison: ${jisonVertices.size} vertices, ${jisonEdges.length} edges`);
      console.log(`ANTLR: ${antlrVertices.size} vertices, ${antlrEdges.length} edges`);

      // Performance assertion: ANTLR should not be more than 6x slower than Jison
      const ratio = antlrAvg / jisonAvg;
      expect(
        ratio,
        `ANTLR parser is ${ratio.toFixed(2)}x slower than Jison, exceeds threshold of ${MAX_ANTLR_TO_JISON_RATIO}x`
      ).toBeLessThanOrEqual(MAX_ANTLR_TO_JISON_RATIO);
    });

    it('should break down ANTLR parser performance by phase', { timeout: 30000 }, () => {
      const iterations = 10;
      const lexerTimes: number[] = [];
      const parserTimes: number[] = [];
      const astBuilderTimes: number[] = [];
      const visitorTimes: number[] = [];
      const totalTimes: number[] = [];

      // Warm-up run
      for (let i = 0; i < 2; i++) {
        const inputStream = CharStream.fromString(COMPLEX_FLOWCHART);
        const lexer = new FlowLexer(inputStream);
        const tokenStream = new CommonTokenStream(lexer);
        tokenStream.fill();
        const parser = new FlowParser(tokenStream);
        const tree = parser.start();
        const db = new FlowDB();
        const astBuilder = new FlowchartASTBuilder(COMPLEX_FLOWCHART);
        astBuilder.generateAST(tree);
        const visitor = new FlowchartVisitor(db);
        visitor.visit(tree);
      }

      for (let i = 0; i < iterations; i++) {
        const totalStart = performance.now();

        // Phase 1: Lexer
        const lexerStart = performance.now();
        const inputStream = CharStream.fromString(COMPLEX_FLOWCHART);
        const lexer = new FlowLexer(inputStream);
        const tokenStream = new CommonTokenStream(lexer);
        tokenStream.fill(); // Materialize all tokens
        const lexerEnd = performance.now();
        lexerTimes.push(lexerEnd - lexerStart);

        // Phase 2: Parser (parse tree generation)
        const parserStart = performance.now();
        const parser = new FlowParser(tokenStream);
        const tree = parser.start();
        const parserEnd = performance.now();
        parserTimes.push(parserEnd - parserStart);

        // Phase 3: AST Builder
        const astStart = performance.now();
        const astBuilder = new FlowchartASTBuilder(COMPLEX_FLOWCHART);
        astBuilder.generateAST(tree);
        const astEnd = performance.now();
        astBuilderTimes.push(astEnd - astStart);

        // Phase 4: Visitor (populates FlowDB)
        const db = new FlowDB();
        const visitorStart = performance.now();
        const visitor = new FlowchartVisitor(db);
        visitor.visit(tree);
        const visitorEnd = performance.now();
        visitorTimes.push(visitorEnd - visitorStart);

        const totalEnd = performance.now();
        totalTimes.push(totalEnd - totalStart);
      }

      // Calculate averages
      const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
      const lexerAvg = avg(lexerTimes);
      const parserAvg = avg(parserTimes);
      const astAvg = avg(astBuilderTimes);
      const visitorAvg = avg(visitorTimes);
      const totalAvg = avg(totalTimes);

      console.log('\n📊 ANTLR Parser Phase Breakdown:');
      console.log('='.repeat(50));
      console.log(
        `1. Lexer (tokenization):    ${lexerAvg.toFixed(3)} ms (${((lexerAvg / totalAvg) * 100).toFixed(1)}%)`
      );
      console.log(
        `2. Parser (parse tree):     ${parserAvg.toFixed(3)} ms (${((parserAvg / totalAvg) * 100).toFixed(1)}%)`
      );
      console.log(
        `3. AST Builder:             ${astAvg.toFixed(3)} ms (${((astAvg / totalAvg) * 100).toFixed(1)}%)`
      );
      console.log(
        `4. Visitor (FlowDB):        ${visitorAvg.toFixed(3)} ms (${((visitorAvg / totalAvg) * 100).toFixed(1)}%)`
      );
      console.log('-'.repeat(50));
      console.log(`   Total:                   ${totalAvg.toFixed(3)} ms`);
      console.log('='.repeat(50));

      // Verify test ran correctly
      expect(totalTimes.length).toBe(iterations);
    });

    it('should profile ANTLR parser decisions to identify bottlenecks', { timeout: 30000 }, () => {
      // Warm up the DFA cache
      for (let i = 0; i < 2; i++) {
        const inputStream = CharStream.fromString(COMPLEX_FLOWCHART);
        const lexer = new FlowLexer(inputStream);
        const tokenStream = new CommonTokenStream(lexer);
        tokenStream.fill();
        const parser = new FlowParser(tokenStream);
        parser.start();
      }

      // Now profile a fresh parse
      const inputStream = CharStream.fromString(COMPLEX_FLOWCHART);
      const lexer = new FlowLexer(inputStream);
      const tokenStream = new CommonTokenStream(lexer);
      tokenStream.fill();
      const parser = new FlowParser(tokenStream);

      // Enable profiling
      parser.setProfile(true);

      // Parse
      parser.start();

      // Get profiling info
      const parseInfo = parser.getParseInfo();
      expect(parseInfo).toBeDefined();

      if (parseInfo) {
        console.log('\n📊 ANTLR Parser Decision Profiling:');
        console.log('='.repeat(80));
        console.log(
          `Total prediction time: ${(parseInfo.getTotalTimeInPrediction() / 1e6).toFixed(3)} ms`
        );
        console.log(`Total SLL lookahead ops: ${parseInfo.getTotalSLLLookaheadOps()}`);
        console.log(`Total LL lookahead ops: ${parseInfo.getTotalLLLookaheadOps()}`);
        console.log(`Total DFA size: ${parseInfo.getDFASize()}`);
        console.log('-'.repeat(80));

        // Get decisions sorted by time
        const decisionInfo = parseInfo.getDecisionInfo();
        const sortedDecisions = [...decisionInfo]
          .filter((d) => d.timeInPrediction > 0)
          .sort((a, b) => b.timeInPrediction - a.timeInPrediction)
          .slice(0, 10);

        console.log('Top 10 slowest decisions:');
        console.log(
          'Decision | Time (ms) | Invocations | SLL Look | LL Look | LL Fallback | Ambiguities'
        );
        console.log('-'.repeat(80));

        for (const d of sortedDecisions) {
          const ruleIndex = parser.atn.decisionToState[d.decision]?.ruleIndex ?? -1;
          const ruleName = ruleIndex >= 0 ? parser.ruleNames[ruleIndex] : 'unknown';
          console.log(
            `${d.decision.toString().padStart(8)} | ` +
              `${(d.timeInPrediction / 1e6).toFixed(3).padStart(9)} | ` +
              `${d.invocations.toString().padStart(11)} | ` +
              `${d.sllTotalLook.toString().padStart(8)} | ` +
              `${d.llTotalLook.toString().padStart(7)} | ` +
              `${d.llFallback.toString().padStart(11)} | ` +
              `${d.ambiguities.length.toString().padStart(11)} | ${ruleName}`
          );
        }

        console.log('='.repeat(80));
      }

      expect(parseInfo).toBeDefined();
    });

    it('should profile lexer token distribution', { timeout: 30000 }, () => {
      const inputStream = CharStream.fromString(COMPLEX_FLOWCHART);
      const lexer = new FlowLexer(inputStream);

      // Collect all tokens
      const tokens: { type: number; name: string; text: string }[] = [];
      let token = lexer.nextToken();
      while (token.type !== -1) {
        // -1 is EOF
        tokens.push({
          type: token.type,
          name: lexer.symbolicNames[token.type] ?? `TYPE_${token.type}`,
          text: token.text ?? '',
        });
        token = lexer.nextToken();
      }

      // Count token types
      const tokenCounts = new Map<string, number>();
      for (const t of tokens) {
        tokenCounts.set(t.name, (tokenCounts.get(t.name) ?? 0) + 1);
      }

      // Sort by frequency
      const sortedCounts = [...tokenCounts.entries()].sort((a, b) => b[1] - a[1]);

      console.log('\n📊 Lexer Token Distribution:');
      console.log('='.repeat(60));
      console.log(`Total tokens: ${tokens.length}`);
      console.log('-'.repeat(60));
      console.log('Token Type                     | Count | % of Total');
      console.log('-'.repeat(60));

      for (const [name, count] of sortedCounts.slice(0, 15)) {
        const pct = ((count / tokens.length) * 100).toFixed(1);
        console.log(`${name.padEnd(30)} | ${count.toString().padStart(5)} | ${pct.padStart(5)}%`);
      }
      console.log('='.repeat(60));

      // Profile lexer performance by measuring tokenization with/without specific patterns
      const iterations = 10;
      const times: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const stream = CharStream.fromString(COMPLEX_FLOWCHART);
        const lex = new FlowLexer(stream);

        const start = performance.now();
        while (lex.nextToken().type !== -1) {
          // Just tokenize
        }
        const end = performance.now();
        times.push(end - start);
      }

      const avg = times.reduce((a, b) => a + b, 0) / times.length;
      console.log(`\nLexer-only average: ${avg.toFixed(3)} ms`);

      expect(tokens.length).toBeGreaterThan(0);
    });

    it('should profile mode transitions', { timeout: 30000 }, () => {
      // Count tokens that trigger mode transitions based on token type
      // These are the tokens that use pushMode or popMode
      const inputStream = CharStream.fromString(COMPLEX_FLOWCHART);
      const lexer = new FlowLexer(inputStream);

      const modeTransitionTokens = new Map<string, number>();
      const pushModeTokens = new Set([
        'SHAPE_DATA_START',
        'ACC_TITLE',
        'ACC_DESCR',
        'ACC_DESCR_MULTI',
        'CALL',
        'CLICK',
        'GRAPH',
        'MD_STRING_START',
        'ELLIPSE_START',
        'START_LINK_NORMAL',
        'START_LINK_NORMAL_NOSPACE',
        'START_LINK_THICK',
        'START_LINK_DOTTED',
        'PIPE',
        'DOUBLECIRCLE_START',
        'CIRCLE_START',
        'TRAP_START',
        'INVTRAP_START',
        'STADIUM_START',
        'SUBROUTINE_START',
        'CYLINDER_START',
        'SQS', // SQUARE_START
        'PS', // PAREN_START
        'DIAMOND_START',
        'TAGEND',
        'QUOTE',
      ]);
      const popModeTokens = new Set([
        'SHAPE_DATA_END',
        'ACC_TITLE_VALUE',
        'ACC_DESCR_VALUE',
        'ACC_DESCR_MULTILINE_END',
        'DIR',
        'NODIR',
        'MD_STRING_END',
        'ELLIPSE_END_TOKEN',
        'TRAPEND',
        'INVTRAPEND',
        'PE', // TEXT_PAREN_END
        'SQE', // TEXT_SQUARE_END
        'DIAMOND_STOP',
        'STADIUMEND',
        'SUBROUTINEEND',
        'CYLINDEREND',
        'DOUBLECIRCLEEND',
        'CIRCLEEND',
        'LINK_NORMAL', // In edge text modes
        'LINK_THICK',
        'LINK_DOTTED',
        'STR', // STRING_END (content token before pop)
      ]);

      let token = lexer.nextToken();
      let pushCount = 0;
      let popCount = 0;
      while (token.type !== -1) {
        const name = lexer.symbolicNames[token.type] ?? `TYPE_${token.type}`;
        if (pushModeTokens.has(name)) {
          modeTransitionTokens.set(name, (modeTransitionTokens.get(name) ?? 0) + 1);
          pushCount++;
        }
        if (popModeTokens.has(name)) {
          modeTransitionTokens.set(name, (modeTransitionTokens.get(name) ?? 0) + 1);
          popCount++;
        }
        token = lexer.nextToken();
      }

      const sortedTransitions = [...modeTransitionTokens.entries()].sort((a, b) => b[1] - a[1]);

      console.log('\n📊 Mode Transition Analysis:');
      console.log('='.repeat(60));
      console.log(`Total pushMode transitions: ${pushCount}`);
      console.log(`Total popMode transitions: ${popCount}`);
      console.log('-'.repeat(60));
      console.log('Token Type                     | Count | Type');
      console.log('-'.repeat(60));

      for (const [name, count] of sortedTransitions) {
        const type = pushModeTokens.has(name) ? 'push' : 'pop';
        console.log(`${name.padEnd(30)} | ${count.toString().padStart(5)} | ${type}`);
      }
      console.log('='.repeat(60));

      expect(pushCount).toBeGreaterThan(0);
    });
  });
});
