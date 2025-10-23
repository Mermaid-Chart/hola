import type { SequenceDB } from '../../sequenceDb.js';
import type { ParserRuleContext } from 'antlr4ng';

// Type for window with MERMAID_CONFIG
interface WindowWithConfig extends Window {
  MERMAID_CONFIG?: Record<string, string>;
}

/**
 * Core shared logic for both Listener and Visitor patterns for Sequence Diagrams
 * Contains all the proven parsing logic extracted from the monolithic antlr-parser.ts
 */
export class SequenceParserCore {
  protected db: SequenceDB;

  constructor(db: SequenceDB) {
    this.db = db;
  }

  // Helper method to get environment variables (same as flowchart)
  protected getEnvVar(name: string): string | undefined {
    try {
      if (typeof process !== 'undefined' && process.env) {
        return process.env[name];
      }
    } catch (_e) {
      // process is not defined in browser, continue to browser checks
    }

    // In browser, check for global variables
    if (typeof window !== 'undefined' && (window as WindowWithConfig).MERMAID_CONFIG) {
      return (window as WindowWithConfig).MERMAID_CONFIG?.[name];
    }
    return undefined;
  }

  // Signal type mapping helper
  protected mapSignalType(op: string): number | undefined {
    const LT = this.db?.LINETYPE;
    if (!LT) {
      return undefined;
    }
    switch (op) {
      case '->':
        return LT.SOLID_OPEN;
      case '-->':
        return LT.DOTTED_OPEN;
      case '->>':
        return LT.SOLID;
      case '-->>':
        return LT.DOTTED;
      case '<<->>':
        return LT.BIDIRECTIONAL_SOLID;
      case '<<-->>':
        return LT.BIDIRECTIONAL_DOTTED;
      case '-x':
        return LT.SOLID_CROSS;
      case '--x':
        return LT.DOTTED_CROSS;
      case '-)':
        return LT.SOLID_POINT;
      case '--)':
        return LT.DOTTED_POINT;
      // Half-arrows - solid variants
      case '-|\\':
        return LT.SOLID_TOP;
      case '-|/':
        return LT.SOLID_BOTTOM;
      case '-\\\\':
        return LT.STICK_TOP;
      case '-//':
        return LT.STICK_BOTTOM;
      case '/|-':
        return LT.SOLID_ARROW_TOP_REVERSE;
      case '\\|-':
        return LT.SOLID_ARROW_BOTTOM_REVERSE;
      case '//-':
        return LT.STICK_ARROW_TOP_REVERSE;
      case '\\\\-':
        return LT.STICK_ARROW_BOTTOM_REVERSE;
      // Half-arrows - dotted variants
      case '--|\\':
        return LT.SOLID_TOP_DOTTED;
      case '--|/':
        return LT.SOLID_BOTTOM_DOTTED;
      case '--\\\\':
        return LT.STICK_TOP_DOTTED;
      case '--//':
        return LT.STICK_BOTTOM_DOTTED;
      case '/|--':
        return LT.SOLID_ARROW_TOP_REVERSE_DOTTED;
      case '\\|--':
        return LT.SOLID_ARROW_BOTTOM_REVERSE_DOTTED;
      case '//--':
        return LT.STICK_ARROW_TOP_REVERSE_DOTTED;
      case '\\\\--':
        return LT.STICK_ARROW_BOTTOM_REVERSE_DOTTED;
      default:
        return undefined;
    }
  }

  // Loop block processing
  protected processLoopBlockEnter(ctx: ParserRuleContext): void {
    try {
      const rest = ctx.restOfLine?.();
      const raw = rest ? (rest.getText?.() as string | undefined) : undefined;
      const msgText =
        raw !== undefined ? (raw.startsWith(':') ? raw.slice(1) : raw).trim() : undefined;
      const msg = msgText !== undefined ? this.db.parseMessage(msgText) : undefined;
      this.db.addSignal(undefined, undefined, msg, this.db.LINETYPE.LOOP_START);
    } catch {}
  }

  protected processLoopBlockExit(): void {
    try {
      this.db.addSignal(undefined, undefined, undefined, this.db.LINETYPE.LOOP_END);
    } catch {}
  }

  // Participant statement processing
  protected processParticipantStatement(ctx: ParserRuleContext): void {
    // Extended participant syntax: participant <ACTOR>@{...}
    const awc = ctx.actorWithConfig?.();
    if (awc) {
      const awcCtx = Array.isArray(awc) ? awc[0] : awc;
      const idTok = awcCtx?.ACTOR?.();
      const id = (Array.isArray(idTok) ? idTok[0] : idTok)?.getText?.() as string | undefined;
      if (!id) {
        return;
      }
      const cfgObj = awcCtx?.configObject?.();
      const cfgCtx = Array.isArray(cfgObj) ? cfgObj[0] : cfgObj;
      const cfgTok = cfgCtx?.CONFIG_CONTENT?.();
      const metadata = (Array.isArray(cfgTok) ? cfgTok[0] : cfgTok)?.getText?.() as
        | string
        | undefined;

      // Check for alias (AS restOfLine)
      let display = id;
      if (ctx.AS) {
        let raw: string | undefined;
        const rest = ctx.restOfLine?.();
        raw = rest?.getText?.() as string | undefined;
        if (raw === undefined && ctx.TXT) {
          const t = ctx.TXT();
          raw = Array.isArray(t)
            ? (t[0]?.getText?.() as string | undefined)
            : (t?.getText?.() as string | undefined);
        }
        if (raw !== undefined) {
          const trimmed = raw.startsWith(':') ? raw.slice(1) : raw;
          const v = trimmed.trim();
          if (v) {
            display = v;
          }
        }
      }

      // Important: let errors from YAML parsing propagate for invalid configs
      this.db.addActor(id, id, { text: display, type: 'participant' }, 'participant', metadata);
      return;
    }

    try {
      const hasActor = !!ctx.PARTICIPANT_ACTOR?.();
      const draw = hasActor ? 'actor' : 'participant';

      const id = ctx.actor?.(0)?.getText?.() as string | undefined;
      if (!id) {
        return;
      }

      let display = id;
      if (ctx.AS) {
        let raw: string | undefined;
        const rest = ctx.restOfLine?.();
        raw = rest?.getText?.() as string | undefined;
        if (raw === undefined && ctx.TXT) {
          const t = ctx.TXT();
          raw = Array.isArray(t)
            ? (t[0]?.getText?.() as string | undefined)
            : (t?.getText?.() as string | undefined);
        }
        if (raw !== undefined) {
          const trimmed = raw.startsWith(':') ? raw.slice(1) : raw;
          const v = trimmed.trim();
          if (v) {
            display = v;
          }
        }
      }

      const desc = { text: display, type: draw };
      this.db.addActor(id, id, desc, draw);
    } catch (_e) {
      // swallow to keep parity with Jison robustness
    }
  }

  // Create statement processing
  protected processCreateStatement(ctx: ParserRuleContext): void {
    try {
      const hasActor = !!ctx.PARTICIPANT_ACTOR?.();
      const draw = hasActor ? 'actor' : 'participant';
      const id = ctx.actor?.()?.getText?.() as string | undefined;
      if (!id) {
        return;
      }

      let display = id;
      if (ctx.AS) {
        let raw: string | undefined;
        const rest = ctx.restOfLine?.();
        raw = rest?.getText?.() as string | undefined;
        if (raw === undefined && ctx.TXT) {
          const t = ctx.TXT();
          raw = Array.isArray(t)
            ? (t[0]?.getText?.() as string | undefined)
            : (t?.getText?.() as string | undefined);
        }
        if (raw !== undefined) {
          const trimmed = raw.startsWith(':') ? raw.slice(1) : raw;
          const v = trimmed.trim();
          if (v) {
            display = v;
          }
        }
      }

      this.db.addActor(id, id, { text: display, type: draw }, draw);
      const msgs = this.db.getMessages?.() ?? [];
      this.db.getCreatedActors?.().set(id, msgs.length);
    } catch (_e) {
      // ignore to keep resilience
    }
  }

  // Destroy statement processing
  protected processDestroyStatement(ctx: ParserRuleContext): void {
    try {
      const id = ctx.actor?.()?.getText?.() as string | undefined;
      if (!id) {
        return;
      }
      const msgs = this.db.getMessages?.() ?? [];
      this.db.getDestroyedActors?.().set(id, msgs.length);
    } catch (_e) {
      // ignore to keep resilience
    }
  }

  // Opt block processing
  protected processOptBlockEnter(ctx: ParserRuleContext): void {
    try {
      const raw = ctx.restOfLine?.()?.getText?.() as string | undefined;
      const msgText = raw ? (raw.startsWith(':') ? raw.slice(1) : raw).trim() : undefined;
      const msg = msgText !== undefined ? this.db.parseMessage(msgText) : undefined;
      this.db.addSignal(undefined, undefined, msg, this.db.LINETYPE.OPT_START);
    } catch {}
  }

  protected processOptBlockExit(): void {
    try {
      this.db.addSignal(undefined, undefined, undefined, this.db.LINETYPE.OPT_END);
    } catch {}
  }

  // Alt block processing
  protected processAltBlockEnter(ctx: ParserRuleContext): void {
    try {
      const raw = ctx.restOfLine?.()?.getText?.() as string | undefined;
      const msgText = raw ? (raw.startsWith(':') ? raw.slice(1) : raw).trim() : undefined;
      const msg = msgText !== undefined ? this.db.parseMessage(msgText) : undefined;
      this.db.addSignal(undefined, undefined, msg, this.db.LINETYPE.ALT_START);
    } catch {}
  }

  protected processAltBlockExit(): void {
    try {
      this.db.addSignal(undefined, undefined, undefined, this.db.LINETYPE.ALT_END);
    } catch {}
  }

  protected processElseSection(ctx: ParserRuleContext): void {
    try {
      const raw = ctx.restOfLine?.()?.getText?.() as string | undefined;
      const msgText = raw ? (raw.startsWith(':') ? raw.slice(1) : raw).trim() : undefined;
      const msg = msgText !== undefined ? this.db.parseMessage(msgText) : undefined;
      this.db.addSignal(undefined, undefined, msg, this.db.LINETYPE.ALT_ELSE);
    } catch {}
  }

  // Par block processing
  protected processParBlockEnter(ctx: ParserRuleContext): void {
    try {
      const raw = ctx.restOfLine?.()?.getText?.() as string | undefined;
      const msgText = raw ? (raw.startsWith(':') ? raw.slice(1) : raw).trim() : undefined;
      const msg = msgText !== undefined ? this.db.parseMessage(msgText) : undefined;
      this.db.addSignal(undefined, undefined, msg, this.db.LINETYPE.PAR_START);
    } catch {}
  }

  protected processParBlockExit(): void {
    try {
      this.db.addSignal(undefined, undefined, undefined, this.db.LINETYPE.PAR_END);
    } catch {}
  }

  protected processAndSection(ctx: ParserRuleContext): void {
    try {
      const raw = ctx.restOfLine?.()?.getText?.() as string | undefined;
      const msgText = raw ? (raw.startsWith(':') ? raw.slice(1) : raw).trim() : undefined;
      const msg = msgText !== undefined ? this.db.parseMessage(msgText) : undefined;
      this.db.addSignal(undefined, undefined, msg, this.db.LINETYPE.PAR_AND);
    } catch {}
  }

  // ParOver block processing
  protected processParOverBlockEnter(ctx: ParserRuleContext): void {
    try {
      const raw = ctx.restOfLine?.()?.getText?.() as string | undefined;
      const msgText = raw ? (raw.startsWith(':') ? raw.slice(1) : raw).trim() : undefined;
      const msg = msgText !== undefined ? this.db.parseMessage(msgText) : undefined;
      this.db.addSignal(undefined, undefined, msg, this.db.LINETYPE.PAR_OVER_START);
    } catch {}
  }

  protected processParOverBlockExit(): void {
    try {
      this.db.addSignal(undefined, undefined, undefined, this.db.LINETYPE.PAR_OVER_END);
    } catch {}
  }

  // Rect block processing
  protected processRectBlockEnter(ctx: ParserRuleContext): void {
    try {
      const raw = ctx.restOfLine?.()?.getText?.() as string | undefined;
      const line = raw ? (raw.startsWith(':') ? raw.slice(1) : raw).trim() : '';
      // RECT should generate RECT_START signal with parsed message, matching Jison behavior
      const parsedMessage = this.db.parseMessage(line);
      this.db.addSignal(undefined, undefined, parsedMessage, this.db.LINETYPE.RECT_START);
    } catch {}
  }

  protected processRectBlockExit(): void {
    try {
      // RECT should generate RECT_END signal, not box end
      this.db.addSignal(undefined, undefined, undefined, this.db.LINETYPE.RECT_END);
    } catch {}
  }

  // Box block processing
  protected processBoxBlockEnter(ctx: ParserRuleContext): void {
    try {
      const raw = ctx.restOfLine?.()?.getText?.() as string | undefined;
      const line = raw ? (raw.startsWith(':') ? raw.slice(1) : raw).trim() : '';
      const data = this.db.parseBoxData(line);
      this.db.addBox(data);
    } catch {}
  }

  protected processBoxBlockExit(): void {
    try {
      this.db.boxEnd();
    } catch {}
  }

  // Break block processing
  protected processBreakBlockEnter(ctx: ParserRuleContext): void {
    try {
      const raw = ctx.restOfLine?.()?.getText?.() as string | undefined;
      const msgText = raw ? (raw.startsWith(':') ? raw.slice(1) : raw).trim() : undefined;
      const msg = msgText !== undefined ? this.db.parseMessage(msgText) : undefined;
      this.db.addSignal(undefined, undefined, msg, this.db.LINETYPE.BREAK_START);
    } catch {}
  }

  protected processBreakBlockExit(): void {
    try {
      this.db.addSignal(undefined, undefined, undefined, this.db.LINETYPE.BREAK_END);
    } catch {}
  }

  // Critical block processing
  protected processCriticalBlockEnter(ctx: ParserRuleContext): void {
    try {
      const raw = ctx.restOfLine?.()?.getText?.() as string | undefined;
      const msgText = raw ? (raw.startsWith(':') ? raw.slice(1) : raw).trim() : undefined;
      const msg = msgText !== undefined ? this.db.parseMessage(msgText) : undefined;
      this.db.addSignal(undefined, undefined, msg, this.db.LINETYPE.CRITICAL_START);
    } catch {}
  }

  protected processCriticalBlockExit(): void {
    try {
      this.db.addSignal(undefined, undefined, undefined, this.db.LINETYPE.CRITICAL_END);
    } catch {}
  }

  protected processOptionSection(ctx: ParserRuleContext): void {
    try {
      const raw = ctx.restOfLine?.()?.getText?.() as string | undefined;
      const msgText = raw ? (raw.startsWith(':') ? raw.slice(1) : raw).trim() : undefined;
      const msg = msgText !== undefined ? this.db.parseMessage(msgText) : undefined;
      this.db.addSignal(undefined, undefined, msg, this.db.LINETYPE.CRITICAL_OPTION);
    } catch {}
  }

  // Helper method to ensure actor exists (matching Jison behavior)
  protected ensureActorExists(actorId: string): void {
    if (!this.db.getActors().has(actorId)) {
      // Create actor implicitly with default participant type
      this.db.addActor(actorId, actorId, { text: actorId, type: 'participant' }, 'participant');
    }
  }

  // Signal statement processing
  protected processSignalStatement(ctx: ParserRuleContext): void {
    try {
      const actors = ctx.actor?.();
      if (!actors || actors.length < 2) {
        return;
      }

      const from = actors[0]?.getText?.() as string | undefined;
      const to = actors[1]?.getText?.() as string | undefined;
      if (!from || !to) {
        return;
      }

      // Create actors implicitly if they don't exist (matching Jison behavior)
      this.ensureActorExists(from);
      this.ensureActorExists(to);

      const signalType = ctx.signaltype?.()?.getText?.() as string | undefined;
      if (!signalType) {
        return;
      }

      const rawText = ctx.text2?.()?.getText?.() as string | undefined;
      // Strip leading colon from TXT token (TXT includes ':' prefix)
      const msgText = rawText?.startsWith(':') ? rawText.slice(1).trim() : rawText?.trim();
      const msg = msgText ? this.db.parseMessage(msgText) : undefined;
      const lineType = this.mapSignalType(signalType);

      // Check for activation/deactivation symbols (matching original ANTLR logic)
      const hasPlus = !!ctx.PLUS?.();
      const hasMinus = !!ctx.MINUS?.();

      // Check for central connection patterns (matching Jison behavior)
      const parens = ctx.PAREN?.();
      const hasParen = parens && parens.length > 0;
      const parenCount = hasParen ? parens.length : 0;

      // Determine central connection type based on PAREN position and count
      // Pattern 1: actor signaltype () actor  -> CENTRAL_CONNECTION
      // Pattern 2: actor () signaltype actor  -> CENTRAL_CONNECTION_REVERSE
      // Pattern 3: actor () signaltype () actor -> CENTRAL_CONNECTION_DUAL
      let centralConnection: number | undefined;
      let activate = hasPlus;

      if (parenCount === 2) {
        // Pattern 3: actor () signaltype () actor (CENTRAL_CONNECTION_DUAL)
        centralConnection = this.db.LINETYPE.CENTRAL_CONNECTION_DUAL;
        activate = true; // DUAL always activates
      } else if (parenCount === 1) {
        // Need to determine if it's before or after signaltype
        // Check the full text to determine pattern
        const fullText = ctx.getText?.() ?? '';
        const signalTypeIndex = fullText.indexOf(signalType);
        const parenIndex = fullText.indexOf('()');

        if (parenIndex < signalTypeIndex) {
          // Pattern 2: actor () signaltype actor (CENTRAL_CONNECTION_REVERSE)
          centralConnection = this.db.LINETYPE.CENTRAL_CONNECTION_REVERSE;
          activate = false; // REVERSE doesn't activate
        } else {
          // Pattern 1: actor signaltype () actor (CENTRAL_CONNECTION)
          centralConnection = this.db.LINETYPE.CENTRAL_CONNECTION;
          activate = true; // CENTRAL_CONNECTION activates
        }
      }

      if (lineType !== undefined) {
        // Main signal; pass 'activate' flag and centralConnection
        this.db.addSignal(from, to, msg, lineType, activate, centralConnection);

        // Add central connection markers (matching Jison behavior)
        if (centralConnection === this.db.LINETYPE.CENTRAL_CONNECTION) {
          // Pattern 1: actor ->>() actor
          this.db.addSignal(to, undefined, undefined, this.db.LINETYPE.CENTRAL_CONNECTION);
        } else if (centralConnection === this.db.LINETYPE.CENTRAL_CONNECTION_REVERSE) {
          // Pattern 2: actor ()->> actor
          this.db.addSignal(
            from,
            undefined,
            undefined,
            this.db.LINETYPE.CENTRAL_CONNECTION_REVERSE
          );
        } else if (centralConnection === this.db.LINETYPE.CENTRAL_CONNECTION_DUAL) {
          // Pattern 3: actor ()->>() actor
          this.db.addSignal(to, undefined, undefined, this.db.LINETYPE.CENTRAL_CONNECTION);
          this.db.addSignal(
            from,
            undefined,
            undefined,
            this.db.LINETYPE.CENTRAL_CONNECTION_REVERSE
          );
        }

        // One-line activation/deactivation side-effects (matching original ANTLR logic)
        // Only apply if not using central connections
        if (!centralConnection) {
          if (hasPlus && to) {
            this.db.addSignal(to, undefined, undefined, this.db.LINETYPE.ACTIVE_START);
          }
          if (hasMinus && from) {
            this.db.addSignal(from, undefined, undefined, this.db.LINETYPE.ACTIVE_END);
          }
        }
      }
    } catch (error) {
      // Re-throw validation errors (like activation errors) so tests can catch them
      if (error instanceof Error && error.message.includes('inactivate an inactive participant')) {
        throw error;
      }
      // Silently ignore other parsing errors
    }
  }

  // Note statement processing
  protected processNoteStatement(ctx: ParserRuleContext): void {
    try {
      const placement = ctx.RIGHT_OF?.() ? 'rightOf' : ctx.LEFT_OF?.() ? 'leftOf' : 'over';
      const actors = ctx.actor?.();
      const actor1 = actors?.[0]?.getText?.() as string | undefined;
      const actor2 = actors?.[1]?.getText?.() as string | undefined;

      // Ensure actors exist
      if (actor1) {
        this.ensureActorExists(actor1);
      }
      if (actor2) {
        this.ensureActorExists(actor2);
      }

      const rawText = ctx.text2?.()?.getText?.() as string | undefined;
      // Strip leading colon from TXT token (TXT includes ':' prefix)
      const msgText = rawText?.startsWith(':') ? rawText.slice(1).trim() : rawText?.trim();
      const msg = msgText ? this.db.parseMessage(msgText) : { text: msgText ?? '' };

      // Use the same pattern as Jison parser: create addNote object and let db.apply() handle it
      if (placement === 'over' && actor2) {
        // Note over two actors: Alice,Bob (pass array of actor strings)
        const payload = {
          type: 'addNote' as const,
          placement: this.db.PLACEMENT.OVER,
          actor: [actor1, actor2],
          text: msg,
        };
        this.db.apply(payload);
      } else if (actor1) {
        // Note over single actor or left/right of actor (pass actor string)
        const placementValue =
          placement === 'over'
            ? this.db.PLACEMENT.OVER
            : placement === 'leftOf'
              ? this.db.PLACEMENT.LEFTOF
              : this.db.PLACEMENT.RIGHTOF;

        const payload = {
          type: 'addNote' as const,
          placement: placementValue,
          actor: actor1,
          text: msg,
        };
        this.db.apply(payload);
      }
    } catch {}
  }

  // Links statement processing
  protected processLinksStatement(ctx: ParserRuleContext): void {
    try {
      const actor = ctx.actor?.()?.getText?.() as string | undefined;
      if (!actor) {
        return;
      }
      const rawText = ctx.text2?.()?.getText?.() as string | undefined;
      // Strip leading colon from TXT token (TXT includes ':' prefix)
      const msgText = rawText?.startsWith(':') ? rawText.slice(1).trim() : rawText?.trim();
      const msg = msgText ? this.db.parseMessage(msgText) : undefined;
      this.db.addLinks(actor, msg);
    } catch {}
  }

  // Link statement processing
  protected processLinkStatement(ctx: ParserRuleContext): void {
    try {
      const actor = ctx.actor?.()?.getText?.() as string | undefined;
      if (!actor) {
        return;
      }
      const rawText = ctx.text2?.()?.getText?.() as string | undefined;
      // Strip leading colon from TXT token (TXT includes ':' prefix)
      const msgText = rawText?.startsWith(':') ? rawText.slice(1).trim() : rawText?.trim();
      const msg = msgText ? this.db.parseMessage(msgText) : undefined;
      // Use addALink for single link format (not addLink)
      this.db.addALink(actor, msg);
    } catch {}
  }

  // Properties statement processing
  protected processPropertiesStatement(ctx: ParserRuleContext): void {
    try {
      const actor = ctx.actor?.()?.getText?.() as string | undefined;
      if (!actor) {
        return;
      }
      const rawText = ctx.text2?.()?.getText?.() as string | undefined;
      // Strip leading colon from TXT token (TXT includes ':' prefix)
      const msgText = rawText?.startsWith(':') ? rawText.slice(1).trim() : rawText?.trim();
      const msg = msgText ? this.db.parseMessage(msgText) : undefined;
      this.db.addProperties(actor, msg);
    } catch {}
  }

  // Details statement processing
  protected processDetailsStatement(ctx: ParserRuleContext): void {
    try {
      const actor = ctx.actor?.()?.getText?.() as string | undefined;
      if (!actor) {
        return;
      }
      const rawText = ctx.text2?.()?.getText?.() as string | undefined;
      // Strip leading colon from TXT token (TXT includes ':' prefix)
      const msgText = rawText?.startsWith(':') ? rawText.slice(1).trim() : rawText?.trim();
      const msg = msgText ? this.db.parseMessage(msgText) : undefined;
      this.db.addDetails(actor, msg);
    } catch {}
  }

  // Activation statement processing
  protected processActivationStatement(ctx: ParserRuleContext): void {
    try {
      const actor = ctx.actor?.()?.getText?.() as string | undefined;
      if (!actor) {
        return;
      }

      const isActivate = !!ctx.ACTIVATE?.();
      const isDeactivate = !!ctx.DEACTIVATE?.();

      if (isActivate) {
        this.db.addSignal(actor, undefined, undefined, this.db.LINETYPE.ACTIVE_START);
      } else if (isDeactivate) {
        this.db.addSignal(actor, undefined, undefined, this.db.LINETYPE.ACTIVE_END);
      }
    } catch (error) {
      // Re-throw validation errors (like activation errors) so tests can catch them
      if (error instanceof Error && error.message.includes('inactivate an inactive participant')) {
        throw error;
      }
      // Silently ignore other parsing errors
    }
  }

  // Autonumber statement processing
  protected processAutonumberStatement(ctx: ParserRuleContext): void {
    try {
      const isOff = !!ctx.OFF?.();
      // The grammar uses ACTOR tokens for numbers, not NUM tokens
      const actorTok = ctx.ACTOR?.();
      const actors = Array.isArray(actorTok) ? actorTok : actorTok ? [actorTok] : [];
      const actorTexts = actors.map((n) => n.getText?.() as string).filter(Boolean);

      let start: number | undefined;
      let step: number | undefined;

      if (actorTexts.length >= 1) {
        const v = Number.parseInt(actorTexts[0], 10);
        if (!Number.isNaN(v)) {
          start = v;
        }
      }

      if (actorTexts.length >= 2) {
        const v = Number.parseInt(actorTexts[1], 10);
        if (!Number.isNaN(v)) {
          step = v;
        }
      }

      const visible = !isOff;
      if (visible) {
        this.db.enableSequenceNumbers();
      } else {
        this.db.disableSequenceNumbers();
      }

      const payload = {
        type: 'sequenceIndex' as const,
        sequenceIndex: start,
        sequenceIndexStep: step ?? (start !== undefined ? 1 : undefined),
        sequenceVisible: visible,
        signalType: this.db.LINETYPE.AUTONUMBER,
      };
      this.db.apply(payload);
    } catch {}
  }

  // Title statement processing
  protected processTitleStatement(ctx: ParserRuleContext): void {
    try {
      const msgText = ctx.restOfLine?.()?.getText?.() as string | undefined;
      if (msgText !== undefined) {
        const val = msgText.startsWith(':') ? msgText.slice(1).trim() : msgText.trim();
        if (val) {
          this.db.setDiagramTitle?.(val);
        }
      }
    } catch {}
  }

  // Legacy title statement processing
  protected processLegacyTitleStatement(ctx: ParserRuleContext): void {
    try {
      const fullText = ctx.LEGACY_TITLE?.()?.getText?.() as string | undefined;
      if (fullText) {
        const match = /^title\s*:\s*(.*)$/.exec(fullText);
        if (match?.[1]) {
          const val = match[1].trim();
          if (val) {
            this.db.setDiagramTitle?.(val);
          }
        }
      }
    } catch {}
  }

  // Accessibility title statement processing
  protected processAccTitleStatement(ctx: ParserRuleContext): void {
    try {
      const val = ctx.ACC_TITLE_VALUE?.()?.getText?.() as string | undefined;
      if (val !== undefined) {
        const trimmed = val.trim();
        if (trimmed) {
          this.db.setAccTitle?.(trimmed);
        }
      }
    } catch {}
  }

  // Accessibility description statement processing
  protected processAccDescrStatement(ctx: ParserRuleContext): void {
    try {
      const val = ctx.ACC_DESCR_VALUE?.()?.getText?.() as string | undefined;
      if (val !== undefined) {
        const trimmed = val.trim();
        if (trimmed) {
          this.db.setAccDescription?.(trimmed);
        }
      }
    } catch {}
  }

  // Accessibility multiline description statement processing
  protected processAccDescrMultilineStatement(ctx: ParserRuleContext): void {
    try {
      const val = ctx.ACC_DESCR_MULTILINE_VALUE?.()?.getText?.() as string | undefined;
      if (val !== undefined) {
        const trimmed = val.trim();
        if (trimmed) {
          this.db.setAccDescription?.(trimmed);
        }
      }
    } catch {}
  }
}
