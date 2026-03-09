import type {
  ANTLRErrorListener,
  RecognitionException,
  Recognizer,
  ATNConfigSet,
  DFA,
  BitSet,
  ATNSimulator,
  Token,
  Parser,
} from 'antlr4ng';

/**
 * Custom error listener for ANTLR flowchart parser
 * Captures detailed syntax error information and stores it for later use
 */
export class FlowchartErrorListener implements ANTLRErrorListener {
  private errors: {
    line: number;
    column: number;
    message: string;
    offendingSymbol: unknown;
    startColumn?: number;
    endColumn?: number;
  }[] = [];

  /**
   * Called when a syntax error is encountered during parsing
   */
  syntaxError<S extends Token, T extends ATNSimulator>(
    recognizer: Recognizer<T>,
    offendingSymbol: S | null,
    line: number,
    column: number,
    message: string,
    exception: RecognitionException | null
  ): void {
    // Try to get better location information from the exception
    let startColumn = column;
    let endColumn = column;

    // If we have an exception with ctx, try to get the start of the problematic input
    if (exception?.ctx) {
      const ctx = exception.ctx;
      if (ctx.start) {
        startColumn = ctx.start.column;
        line = ctx.start.line;
      }
      if (ctx.stop) {
        endColumn = ctx.stop.column + (ctx.stop.text?.length || 1);
      }
    }

    // If we have an offending symbol that's a token, use its position
    if (offendingSymbol && typeof offendingSymbol === 'object' && 'column' in offendingSymbol) {
      const token = offendingSymbol as any;
      if (token.start !== undefined && token.stop !== undefined) {
        // For tokens, we want to highlight from the start of the token
        endColumn = column + (token.stop - token.start + 1);
      }
    }

    this.errors.push({
      line,
      column,
      message,
      offendingSymbol,
      startColumn,
      endColumn,
    });
  }

  /**
   * Called when an ambiguity is detected during parsing
   * We don't need to handle this for our use case
   */
  reportAmbiguity(
    _recognizer: Parser,
    _dfa: DFA,
    _startIndex: number,
    _stopIndex: number,
    _exact: boolean,
    _ambigAlts: BitSet | undefined,
    _configs: ATNConfigSet
  ): void {
    // Not needed for syntax error reporting
  }

  /**
   * Called when the parser attempts full context mode
   * We don't need to handle this for our use case
   */
  reportAttemptingFullContext(
    _recognizer: Parser,
    _dfa: DFA,
    _startIndex: number,
    _stopIndex: number,
    _conflictingAlts: BitSet | undefined,
    _configs: ATNConfigSet
  ): void {
    // Not needed for syntax error reporting
  }

  /**
   * Called when context sensitivity is detected
   * We don't need to handle this for our use case
   */
  reportContextSensitivity(
    _recognizer: Parser,
    _dfa: DFA,
    _startIndex: number,
    _stopIndex: number,
    _prediction: number,
    _configs: ATNConfigSet
  ): void {
    // Not needed for syntax error reporting
  }

  /**
   * Check if any errors were encountered
   */
  hasErrors(): boolean {
    return this.errors.length > 0;
  }

  /**
   * Get all collected errors
   */
  getErrors() {
    return this.errors;
  }

  /**
   * Format errors into a user-friendly message
   */
  getFormattedError(): string {
    if (this.errors.length === 0) {
      return 'Syntax error in flowchart diagram';
    }

    // Use the first error for the message
    const error = this.errors[0];
    return `Parse error on line ${error.line}:${error.column}\n${error.message}`;
  }

  /**
   * Create a Jison-compatible error object with hash property
   * This matches the format used by Jison parsers in Mermaid
   * Returns a DetailedError object that Mermaid's error handling expects
   */
  createDetailedError(): Error & { str: string; hash: any; loc: any; parser?: string } {
    if (this.errors.length === 0) {
      const err = new Error('Syntax error in flowchart diagram') as Error & {
        str: string;
        hash: any;
        loc: any;
        parser?: string;
      };
      err.str = 'Syntax error in flowchart diagram';
      err.hash = {};
      err.loc = {};
      err.parser = 'antlr';
      return err;
    }

    const error = this.errors[0];
    const errorMessage = `Parse error on line ${error.line}:${error.startColumn ?? error.column}\n${error.message}`;
    const err = new Error(errorMessage) as Error & {
      str: string;
      hash: any;
      loc: any;
      parser?: string;
    };

    // Add str property to match DetailedError interface
    err.str = errorMessage;

    // Create loc object with location information
    // Expose this at the top level for easy downstream access
    const loc = {
      first_line: error.line,
      last_line: error.line,
      first_column: error.startColumn ?? error.column,
      last_column: error.endColumn ?? error.column,
    };

    // Add loc at the top level for easy access
    err.loc = loc;

    // Add hash property to match Jison error format
    // This allows mermaid.parseError(err, hash) to work correctly
    // Use startColumn to point to the beginning of the problematic input
    err.hash = {
      text: error.offendingSymbol,
      token: error.offendingSymbol,
      line: error.line.toString(),
      loc: loc, // Reference the same loc object
      expected: [], // ANTLR doesn't provide expected tokens in the same way
    };

    // Add parser identifier to distinguish ANTLR errors from Jison errors
    // This helps downstream consumers know that the line numbers are accurate
    err.parser = 'antlr';

    return err;
  }

  /**
   * Clear all collected errors
   */
  clear(): void {
    this.errors = [];
  }
}
