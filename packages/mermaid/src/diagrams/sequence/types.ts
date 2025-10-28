import type { MermaidConfig } from '../../config.type.js';

export interface Box {
  name: string;
  wrap: boolean;
  fill: string;
  actorKeys: string[];
}

export interface Actor {
  box?: Box;
  name: string;
  description: string;
  wrap: boolean;
  prevActor?: string;
  nextActor?: string;
  links: Record<string, unknown>;
  properties: Record<string, unknown>;
  actorCnt: number | null;
  rectData: unknown;
  type: string;
}

export interface Message {
  id: string;
  from?: string;
  to?: string;
  message:
    | string
    | {
        start: number;
        step: number;
        visible: boolean;
      };
  wrap: boolean;
  answer?: unknown;
  type?: number;
  activate?: boolean;
  placement?: string;
  centralConnection?: number;
}

export interface AddMessageParams {
  from: string;
  to: string;
  msg: string;
  signalType: number;
  type:
    | 'addMessage'
    | 'sequenceIndex'
    | 'addParticipant'
    | 'createParticipant'
    | 'destroyParticipant'
    | 'activeStart'
    | 'activeEnd'
    | 'centralConnection'
    | 'centralConnectionReverse'
    | 'addNote'
    | 'addLinks'
    | 'addALink'
    | 'addProperties'
    | 'addDetails'
    | 'boxStart'
    | 'boxEnd'
    | 'loopStart'
    | 'loopEnd'
    | 'rectStart'
    | 'rectEnd'
    | 'optStart'
    | 'optEnd'
    | 'altStart'
    | 'else'
    | 'altEnd'
    | 'setAccTitle'
    | 'parStart'
    | 'parAnd'
    | 'parEnd'
    | 'and'
    | 'criticalStart'
    | 'criticalOption'
    | 'option'
    | 'criticalEnd'
    | 'breakStart'
    | 'breakEnd'
    | 'parOverStart'
    | 'parOverEnd'
    | 'parOverAnd';

  activate: boolean;
}

export interface Note {
  actor: { actor: string };
  placement: Message['placement'];
  message: string;
  wrap: boolean;
}

export interface DiagramStatement {
  type: string;
  originalIndex: number;
  data: unknown;
  sourceTokens?: { start: unknown; stop: unknown }; // Reference to original tokens
  sourceLine?: string; // Original source text for this statement - allows regenerating unchanged code
  dbIndex?: number; // DB message array index (includes control structure markers) - used for SVG data-id matching
}

export interface DiagramAST {
  header: string;
  statements: DiagramStatement[];
  metadata?: Record<string, unknown>;
}

/**
 * Sequence diagram specific AST interfaces
 */

export interface ParticipantData {
  id: string;
  alias?: string;
  displayName?: string;
  type?:
    | 'actor'
    | 'participant'
    | 'boundary'
    | 'control'
    | 'entity'
    | 'database'
    | 'collections'
    | 'queue';
}

export interface MessageData {
  from: string;
  to: string;
  arrow: string; // ->>, -->, ->, etc.
  message: string;
  activate?: boolean;
  deactivate?: boolean;
}

export interface LoopData {
  condition: string;
  statements: DiagramStatement[];
}

export interface NoteData {
  position: 'left' | 'right' | 'over';
  participant: string; // Deprecated: use participants array instead
  participants?: string[]; // Array of participants (for "over" notes with multiple actors)
  message: string;
}

export interface ActivateData {
  participant: string;
}

export interface DeactivateData {
  participant: string;
}

export interface AltData {
  condition: string;
  statements: DiagramStatement[];
  elseStatements?: DiagramStatement[];
}

export interface OptData {
  condition: string;
  statements: DiagramStatement[];
}

export interface ParData {
  statements: DiagramStatement[][];
}

export interface RectData {
  color?: string;
  statements: DiagramStatement[];
}

export interface BreakData {
  condition: string;
  statements: DiagramStatement[];
}

export interface CriticalData {
  condition: string;
  statements: DiagramStatement[][];
}

export interface BoxData {
  name?: string;
  participants: string[];
}

export interface CreateData {
  participant: string;
  alias?: string;
  type?: 'actor' | 'participant';
}

export interface DestroyData {
  participant: string;
}

export interface LinksData {
  participant: string;
  links: Record<string, string>;
}

export interface LinkData {
  participant: string;
  linkName: string;
  linkUrl: string;
}

export interface PropertiesData {
  participant: string;
  properties: Record<string, string>;
}

export interface DetailsData {
  participant: string;
  details: string;
}

export interface AutonumberData {
  start?: number;
  step?: number;
}

export interface TitleData {
  title: string;
}

export interface AccTitleData {
  title: string;
}

export interface AccDescrData {
  description: string;
}

export interface CommentData {
  text: string;
}

export type BlankLineData = Record<string, never>;

/**
 * Sequence diagram statement types
 */
export type SequenceStatementType =
  | 'participant'
  | 'actor'
  | 'message'
  | 'note'
  | 'activate'
  | 'deactivate'
  | 'loop'
  | 'alt'
  | 'opt'
  | 'par'
  | 'rect'
  | 'box'
  | 'break'
  | 'critical'
  | 'create'
  | 'destroy'
  | 'links'
  | 'link'
  | 'properties'
  | 'details'
  | 'autonumber'
  | 'title'
  | 'accTitle'
  | 'accDescr'
  | 'comment'
  | 'blankLine';

export interface SequenceStatement extends DiagramStatement {
  type: SequenceStatementType;
  data:
    | ParticipantData
    | MessageData
    | LoopData
    | NoteData
    | ActivateData
    | DeactivateData
    | AltData
    | OptData
    | ParData
    | RectData
    | BreakData
    | CriticalData
    | BoxData
    | CreateData
    | DestroyData
    | LinksData
    | LinkData
    | PropertiesData
    | DetailsData
    | AutonumberData
    | TitleData
    | AccTitleData
    | AccDescrData
    | CommentData
    | BlankLineData;
}

/**
 * Position information for bidirectional synchronization
 */
export interface ElementPosition {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startIndex: number;
  endIndex: number;
}

/**
 * Mapping between code elements and SVG elements
 */
export interface ElementMapping {
  id: string;
  type: SequenceStatementType;
  position: ElementPosition;
  svgId?: string;
  svgSelector?: string;
  data:
    | ParticipantData
    | MessageData
    | LoopData
    | NoteData
    | ActivateData
    | DeactivateData
    | AltData
    | OptData
    | ParData
    | RectData;
}

/**
 * Complete sequence diagram AST with bidirectional synchronization support
 */
export interface SequenceAST extends DiagramAST {
  header: 'sequenceDiagram';
  statements: SequenceStatement[];
  elementMappings?: ElementMapping[];
  metadata?: {
    title?: string;
    participants?: Map<string, ParticipantData>;
    theme?: string;
    config?: MermaidConfig;
  };

  // Bidirectional synchronization methods
  getElementAtPosition?(line: number, column: number): ElementMapping | undefined;
  getElementByDataId?(dataId: string): ElementMapping | undefined;
  getElementById?(id: string): ElementMapping | undefined;
  getElementAtIndex?(index: number): ElementMapping | undefined;
  getParticipants?(): ElementMapping[];
  getMessages?(): ElementMapping[];
  getNotes?(): ElementMapping[];
  getControlStructures?(): ElementMapping[];
  getStats?(): {
    participants: number;
    messages: number;
    notes: number;
    controlStructures: number;
    totalElements: number;
  };
}
