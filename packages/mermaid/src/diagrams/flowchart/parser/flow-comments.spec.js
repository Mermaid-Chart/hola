import { FlowDB } from '../flowDb.js';
import flow from './flowParser.ts';
import { setConfig } from '../../../config.js';
import { cleanupComments } from '../../../diagram-api/comments.js';

setConfig({
  securityLevel: 'strict',
});

describe('[Comments] when parsing', () => {
  beforeEach(function () {
    flow.parser.yy = new FlowDB();
    flow.parser.yy.clear();
  });

  it('should handle comments', function () {
    const res = flow.parser.parse(cleanupComments('graph TD;\n%% Comment\n A-->B;'));

    const vert = flow.parser.yy.getVertices();
    const edges = flow.parser.yy.getEdges();

    expect(vert.get('A').id).toBe('A');
    expect(vert.get('B').id).toBe('B');
    expect(edges.length).toBe(1);
    expect(edges[0].start).toBe('A');
    expect(edges[0].end).toBe('B');
    expect(edges[0].type).toBe('arrow_point');
    expect(edges[0].text).toBe('');
  });

  it('should keep a chained edge intact across a mid-chain comment (comments preserved)', function () {
    // Regression: the swimlane / inline-position pipeline parses with comments
    // preserved (a COMMENT token, not stripped). A %% comment sitting between
    // two links of a multi-line chain must not terminate the chain.
    // Note: parsed WITHOUT cleanupComments to exercise the COMMENT-token path.
    const res = flow.parser.parse('graph TD\n  A --> B\n  --> C\n  %% try make it longer\n  --> D');

    const edges = flow.parser.yy.getEdges();
    expect(edges.length).toBe(3);
    expect(edges.map((e) => `${e.start}->${e.end}`)).toEqual(['A->B', 'B->C', 'C->D']);
  });

  it('should handle comments at the start', function () {
    const res = flow.parser.parse(cleanupComments('%% Comment\ngraph TD;\n A-->B;'));

    const vert = flow.parser.yy.getVertices();
    const edges = flow.parser.yy.getEdges();

    expect(vert.get('A').id).toBe('A');
    expect(vert.get('B').id).toBe('B');
    expect(edges.length).toBe(1);
    expect(edges[0].start).toBe('A');
    expect(edges[0].end).toBe('B');
    expect(edges[0].type).toBe('arrow_point');
    expect(edges[0].text).toBe('');
  });

  it('should handle comments at the end', function () {
    const res = flow.parser.parse(cleanupComments('graph TD;\n A-->B\n %% Comment at the end\n'));

    const vert = flow.parser.yy.getVertices();
    const edges = flow.parser.yy.getEdges();

    expect(vert.get('A').id).toBe('A');
    expect(vert.get('B').id).toBe('B');
    expect(edges.length).toBe(1);
    expect(edges[0].start).toBe('A');
    expect(edges[0].end).toBe('B');
    expect(edges[0].type).toBe('arrow_point');
    expect(edges[0].text).toBe('');
  });

  it('should handle comments at the end no trailing newline', function () {
    const res = flow.parser.parse(cleanupComments('graph TD;\n A-->B\n%% Comment'));

    const vert = flow.parser.yy.getVertices();
    const edges = flow.parser.yy.getEdges();

    expect(vert.get('A').id).toBe('A');
    expect(vert.get('B').id).toBe('B');
    expect(edges.length).toBe(1);
    expect(edges[0].start).toBe('A');
    expect(edges[0].end).toBe('B');
    expect(edges[0].type).toBe('arrow_point');
    expect(edges[0].text).toBe('');
  });

  it('should handle comments at the end many trailing newlines', function () {
    const res = flow.parser.parse(cleanupComments('graph TD;\n A-->B\n%% Comment\n\n\n'));

    const vert = flow.parser.yy.getVertices();
    const edges = flow.parser.yy.getEdges();

    expect(vert.get('A').id).toBe('A');
    expect(vert.get('B').id).toBe('B');
    expect(edges.length).toBe(1);
    expect(edges[0].start).toBe('A');
    expect(edges[0].end).toBe('B');
    expect(edges[0].type).toBe('arrow_point');
    expect(edges[0].text).toBe('');
  });

  it('should handle no trailing newlines', function () {
    const res = flow.parser.parse(cleanupComments('graph TD;\n A-->B'));

    const vert = flow.parser.yy.getVertices();
    const edges = flow.parser.yy.getEdges();

    expect(vert.get('A').id).toBe('A');
    expect(vert.get('B').id).toBe('B');
    expect(edges.length).toBe(1);
    expect(edges[0].start).toBe('A');
    expect(edges[0].end).toBe('B');
    expect(edges[0].type).toBe('arrow_point');
    expect(edges[0].text).toBe('');
  });

  it('should handle many trailing newlines', function () {
    const res = flow.parser.parse(cleanupComments('graph TD;\n A-->B\n\n'));

    const vert = flow.parser.yy.getVertices();
    const edges = flow.parser.yy.getEdges();

    expect(vert.get('A').id).toBe('A');
    expect(vert.get('B').id).toBe('B');
    expect(edges.length).toBe(1);
    expect(edges[0].start).toBe('A');
    expect(edges[0].end).toBe('B');
    expect(edges[0].type).toBe('arrow_point');
    expect(edges[0].text).toBe('');
  });

  it('should handle a comment with blank rows in-between', function () {
    const res = flow.parser.parse(cleanupComments('graph TD;\n\n\n %% Comment\n A-->B;'));

    const vert = flow.parser.yy.getVertices();
    const edges = flow.parser.yy.getEdges();

    expect(vert.get('A').id).toBe('A');
    expect(vert.get('B').id).toBe('B');
    expect(edges.length).toBe(1);
    expect(edges[0].start).toBe('A');
    expect(edges[0].end).toBe('B');
    expect(edges[0].type).toBe('arrow_point');
    expect(edges[0].text).toBe('');
  });

  it('should handle a comment with mermaid flowchart code in them', function () {
    const res = flow.parser.parse(
      cleanupComments(
        'graph TD;\n\n\n %% Test od>Odd shape]-->|Two line<br>edge comment|ro;\n A-->B;'
      )
    );

    const vert = flow.parser.yy.getVertices();
    const edges = flow.parser.yy.getEdges();

    expect(vert.get('A').id).toBe('A');
    expect(vert.get('B').id).toBe('B');
    expect(edges.length).toBe(1);
    expect(edges[0].start).toBe('A');
    expect(edges[0].end).toBe('B');
    expect(edges[0].type).toBe('arrow_point');
    expect(edges[0].text).toBe('');
  });
});
