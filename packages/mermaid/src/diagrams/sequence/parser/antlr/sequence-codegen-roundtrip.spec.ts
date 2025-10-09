import { describe, it, expect } from 'vitest';
import { CharStream, CommonTokenStream } from 'antlr4ng';
import { SequenceLexer } from './generated/SequenceLexer.js';
import { SequenceParser } from './generated/SequenceParser.js';
import { SequenceCodeGenerator } from './SequenceCodeGenerator.js';

function generateViaAntlr(input: string): string {
  const inputStream = CharStream.fromString(input);
  const lexer = new SequenceLexer(inputStream);
  const tokenStream = new CommonTokenStream(lexer);
  const parser = new SequenceParser(tokenStream);
  const tree = parser.start();

  console.debug('Generating code from parse tree with position tracking', tree);

  const generator = new SequenceCodeGenerator(input);
  const { code } = generator.generateCode(tree);
  return code;
}

function normalizeLines(txt: string): string {
  return txt
    .replace(/\r\n?/g, '\n') // normalize newlines
    .split('\n')
    .map((l) => l.replace(/[\t ]+$/g, '')) // trim trailing whitespace per line
    .join('\n')
    .trim(); // trim leading/trailing blank lines
}

// Add more diagrams to this array. Each entry should include the full diagram text.
export const ROUNDTRIP_CASES: { name: string; input: string }[] = [
  {
    name: 'basic actor and message',
    input: `sequenceDiagram
    actor Alice
    Alice->>Bob: Hi Bob`,
  },
  {
    name: 'basic actor and message with a comment',
    input: `sequenceDiagram
    %% I am a comment
    actor Alice
    Alice->>Bob: Hi Bob`,
  },
  {
    name: 'Activation',
    input: `sequenceDiagram
    Alice->>+John: Hello John, how are you?
    Alice->>+John: John, can you hear me?
    John-->>-Alice: Hi Alice, I can hear you!
    John-->>-Alice: I feel great!`,
  },
  {
    name: 'Grouping with box statements ',
    input: ` sequenceDiagram
    box Purple Alice & John
    participant A
    participant J
    end
    box Another Group
      participant B
      participant C
    end
    A->>J: Hello John, how are you?
    J->>A: Great!
    A->>B: Hello Bob, how is Charly ?
    B->>C: Hello Charly, how are you?`,
  },
  {
    name: 'Arrow statements ',
    input: `sequenceDiagram
      actor Alice
      actor Bob

      Alice->Bob:Solid line without arrow
  Alice-->Bob:Dotted line without arrow
  Alice->>Bob:Solid line with arrowhead
  Alice-->>Bob:Dotted line with arrowhead
  Alice-xBob:Solid line with a cross at the end
  Alice--xBob:Dotted line with a cross at the end.
  Alice-)Bob:Solid line with an open arrow at the end (async)
  Alice--)Bob:Dotted line with a open arrow at the end (async)
  `,
  },
  {
    name: 'Note statement ',
    input: `sequenceDiagram
      Alice->John: Hello John, how are you?
      Note over Alice,John: A typical interaction<br/>But now in two lines Alice ohn
  `,
  },
  {
    name: 'Note statement ',
    input: `sequenceDiagram
      Alice->John: Hello John, how are you?
      Note right of John: John thinks
  `,
  },
  {
    name: 'Auto numbering with loop statements',
    input: `sequenceDiagram
      autonumber
      Alice->>John: Hello John, how are you?
      loop Healthcheck
          John->>John: Fight against hypochondria
      end
      Note right of John: Rational thoughts!
      John-->>Alice: Great!
      John->>Bob: How about you?
      Bob-->>John: Jolly good!
  `,
  },
  {
    name: 'Loop & Alt and opt statements ',
    input: `sequenceDiagram
      Alice->John: Hello John, how are you?
      loop Every minute
      John-->Alice: Great!
      end
      alt is sick
          Bob->>Alice: Not so good :(
      else is well
          Bob->>Alice: Feeling fresh like a daisy
      end
      opt Extra response
          Bob->>Alice: Thanks for asking
      end
  `,
  },
  {
    name: 'Rect statements ',
    input: `sequenceDiagram
    participant Alice
    participant John

    rect rgb(191, 223, 255)
    note right of Alice: Alice calls John.
    Alice->>+John: Hello John, how are you?
    rect rgb(200, 150, 255)
    Alice->>+John: John, can you hear me?
    John-->>-Alice: Hi Alice, I can hear you!
    end
    John-->>-Alice: I feel great!
    end
    Alice ->>+ John: Did you want to go to the game tonight?
    John -->>- Alice: Yeah! See you there.`,
  },
  {
    name: 'More autonumbering ',
    input: `sequenceDiagram
autonumber 10
Alice->Bob: Hello
Bob-->Alice: Hi`,
  },
  {
    name: 'Multi auto numbering ',
    input: `sequenceDiagram
autonumber 5 2
Alice->Bob: Hello
Bob-->Alice: Hi`,
  },
  {
    name: 'Multi auto numbering ',
    input: `sequenceDiagram
autonumber off
Alice->Bob: Hello
Bob-->Alice: Hi`,
  },
  {
    name: 'Title statements ',
    input: `sequenceDiagram
title: Diagram Title
Alice->Bob:Hello Bob, how are you?
Note right of Bob: Bob thinks
Bob-->Alice: I am good thanks!`,
  },
  {
    name: 'Title statements alternate syntax ',
    input: `sequenceDiagram
title Diagram Title
Alice->Bob:Hello Bob, how are you?
Note right of Bob: Bob thinks
Bob-->Alice: I am good thanks!`,
  },
  {
    name: 'Accessability title and description ',
    input: `sequenceDiagram
title: Diagram Title
accTitle: This is the title
accDescr: Accessibility Description
Alice->Bob:Hello Bob, how are you?`,
  },
  {
    name: 'Accessability title and description alternate syntax ',
    input: `sequenceDiagram
accTitle: This is the title
accDescr {
Accessibility
Description
}
Alice->Bob:Hello Bob, how are you?`,
  },
  {
    name: 'Space in syntax ',
    input: `sequenceDiagram
Alice->Bob:Hello Bob, how are - you?
Bob-->Alice: I am good thanks!`,
  },
  {
    name: 'Participant aliases ',
    input: `sequenceDiagram
participant A as Alice
participant B as Bob
A->B:Hello Bob, how are you?
B-->A: I am good thanks!`,
  },
  {
    name: 'Participant actor mix ',
    input: `sequenceDiagram
  actor Alice as Alice2
  actor Bob
  participant John as John2
  participant Mandy
  Alice->>Bob: Hi Bob
  Bob->>Alice: Hi Alice
  Alice->>John: Hi John
  John->>Mandy: Hi Mandy
  Mandy ->>Joan: Hi Joan`,
  },
  {
    name: 'Async messages ',
    input: `sequenceDiagram
Alice-xBob:Hello Bob, how are you?`,
  },
  {
    name: 'Async dotted messages ',
    input: `sequenceDiagram
Alice--xBob:Hello Bob, how are you?`,
  },
  {
    name: 'Bi-directional ',
    input: `sequenceDiagram
    Alice<<-->>Bob:Hello Bob, how are you?`,
  },
  {
    name: 'Blank lines ',
    input: `sequenceDiagram
      Alice->Bob: Hello Bob, how are you?

      %% Comment
      Note right of Bob: Bob thinks
      Bob-->Alice: I am good thanks!`,
  },
  {
    name: 'Semi-colon delimiter ',
    input: `sequenceDiagram;Alice->Bob: Hello Bob, how are you?;Note right of Bob: Bob thinks;Bob-->Alice: I am good thanks!;`,
  },
  {
    name: 'Leading space in lines ',
    input: `sequenceDiagram
 Alice->Bob: Hello Bob, how are you?

%% Comment
Note right of Bob: Bob thinks
Bob-->Alice: I am good thanks!`,
  },
  {
    name: 'Line breaks ',
    input: `sequenceDiagram
participant 1 as multiline<br>text
participant 2 as multiline<br/>text
participant 3 as multiline<br />text
participant 4 as multiline<br \t/>text
1->>2: multiline<br>text
note right of 2: multiline<br>text
2->>3: multiline<br/>text
note right of 3: multiline<br/>text
3->>4: multiline<br />text
note right of 4: multiline<br />text
4->>1: multiline<br \t/>text
note right of 1: multiline<br \t/>text`,
  },
  {
    name: 'Critical statements ',
    input: `sequenceDiagram
    critical Establish a connection to the DB
        Service-->DB: connect
    option Network timeout
        Service-->Service: Log error
    option Credentials rejected
        Service-->Service: Log different error
    end`,
  },
  {
    name: 'Break statements ',
    input: `sequenceDiagram
    Consumer-->API: Book something
    API-->BookingService: Start booking process
    break when the booking process fails
        API-->Consumer: show failure
    end
    API-->BillingService: Start billing process`,
  },
  {
    name: 'Parallell statements ',
    input: `sequenceDiagram
par Parallel one
Alice->>Bob: Hello Bob, how are you?
Bob-->>Alice: I am good thanks!
and Parallel two
Alice->>Bob: Are you OK?
Bob-->>Alice: Fine!
and Parallel three
Alice->>Bob: What do you think about it?
Bob-->>Alice: It's good!
end`,
  },
  {
    name: 'par_over statements ',
    input: `sequenceDiagram
par_over Parallel overlap
Alice ->> Bob: Message
Note left of Alice: Alice note
Note right of Bob: Bob note
end`,
  },
  {
    name: 'No label loops ',
    input: `sequenceDiagram
Alice->Bob: Hello Bob, how are you?
loop
Bob-->Alice: I am good thanks!
end`,
  },
  {
    name: 'No label opt ',
    input: `sequenceDiagram
Alice->Bob: Hello Bob, how are you?
opt # comment
Bob-->Alice: I am good thanks!
end`,
  },
  {
    name: 'No label alt ',
    input: `sequenceDiagram
Alice->Bob: Hello Bob, how are you?
alt;Bob-->Alice: I am good thanks!
else # comment
Bob-->Alice: I am good thanks!
end`,
  },
  {
    name: 'No label par ',
    input: `sequenceDiagram
Alice->Bob: Hello Bob, how are you?
par;Bob-->Alice: I am good thanks!
and # comment
Bob-->Alice: I am good thanks!
end`,
  },
  {
    name: 'Links ',
    input: `sequenceDiagram
participant a as Alice
participant b as Bob
participant c as Charlie
links a: { "Repo": "https://repo.contoso.com/", "Dashboard": "https://dashboard.contoso.com/" }
links b: { "Dashboard": "https://dashboard.contoso.com/" }
links a: { "On-Call": "https://oncall.contoso.com/?svc=alice" }
link a: Endpoint @ https://alice.contoso.com
link a: Swagger @ https://swagger.contoso.com
link a: Tests @ https://tests.contoso.com/?svc=alice@contoso.com
`,
  },
  {
    name: 'property statements ',
    input: `sequenceDiagram
participant a as Alice
participant b as Bob
participant c as Charlie
properties a: {"class": "internal-service-actor", "icon": "@clock"}
properties b: {"class": "external-service-actor", "icon": "@computer"}

`,
  },
  {
    name: 'Actor creation ',
    input: `sequenceDiagram
  participant a as Alice
  a ->>b: Hello Bob?
  create participant c
  b-->>c: Hello c!
  c ->> b: Hello b?
  create actor d as Donald
  a ->> d: Hello Donald?
`,
  },
  {
    name: 'Actor destruction ',
    input: `sequenceDiagram
  participant a as Alice
  a ->>b: Hello Bob?
  destroy a
  b-->>a: Hello Alice!
  b ->> c: Where is Alice?
  destroy c
  b ->> c: Where are you?
`,
  },
  {
    name: 'Two actors in a box ',
    input: `sequenceDiagram
box rgb(34, 56, 0) Group1
participant Alice
participant Bob
end
Alice->Bob: Hello Bob, how are you?
`,
  },
  {
    name: 'Two actors and a init statement',
    input: `%%{init: {'logLevel': 0}}%%
sequenceDiagram
Alice->Bob: Hello Bob, how are you?
`,
  },
  {
    name: 'YAML statements',
    input: `---
  title: Front matter title
  config:
    theme: base
    themeVariables:
      primaryColor: "#00ff00"
  ---
  sequenceDiagram
  Alice->Bob: Hello Bob
`,
  },
  {
    name: 'Two actors and two statements',
    input: `sequenceDiagram
Alice->Bob: Hello Bob, how are you?
Note right of Bob: Bob thinks
Bob->Alice: Fine!
`,
  },
  {
    name: 'Wrap statements',
    input: `sequenceDiagram
%%{wrap}%%
Alice->>Bob: Hello Bob, how are you? If you are not available right now, I can leave you a message. Please get back to me as soon as you can!
Note left of Alice: Bob thinks
Bob->>Alice: Fine!
`,
  },
  {
    name: 'Quotes and properties',
    input: `sequenceDiagram
      participant Alice@{ "type" : "database" }
      participant Bob@{ "type" : "database" }
      participant Carl@{ type: "database" }
      participant David@{ "type" : 'database' }
      participant Eve@{ type: 'database' }
      participant Favela@{ "type" : "database"    }
      Bob->>+Alice: Hi Alice
      Alice->>+Bob: Hi Bob
`,
  },
  {
    name: 'Grouping with box statements ',
    input: `sequenceDiagram
%% comment 1
        Alice ->>  John: Hello John, how are you?
    Alice->>John: John, can you hear me?
%% comment 2
    John  -->>  Alice:    Hi Alice, I can hear you!
    John-->>Alice: I feel great!`,
  },
  {
    name: 'Preserve indentation ',
    input: `sequenceDiagram
%% I am a comment
 participant Alice as Alicia
   Alice   ->>  Bob: Hi Bob`,
  },
];

describe('Sequence ANTLR round-trip codegen', () => {
  for (const { name, input } of ROUNDTRIP_CASES) {
    it(`round-trips code for: ${name}`, () => {
      const generated = generateViaAntlr(input);

      const lhs = normalizeLines(generated);
      const rhs = normalizeLines(input);

      // Helpful debug on mismatch
      if (lhs !== rhs) {
        // eslint-disable-next-line no-console
        console.log('\n--- Original ---\n' + rhs + '\n--- Generated ---\n' + lhs + '\n');
      }

      expect(lhs).toBe(rhs);
    });
  }
});
