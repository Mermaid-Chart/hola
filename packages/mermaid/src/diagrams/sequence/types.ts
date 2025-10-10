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

import type { DiagramAST, DiagramStatement } from './DiagramASTService.js';

/**
 * Sequence diagram specific AST interfaces
 */

export interface ParticipantData {
  id: string;
  alias?: string;
  displayName?: string;
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
  participant: string;
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
  | 'break'
  | 'critical'
  | 'autonumber';

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
    | RectData;
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
    config?: any;
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
