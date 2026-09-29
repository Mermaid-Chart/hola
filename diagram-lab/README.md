# Diagram Lab

A standalone dev tool for studying **(diagram, layout)** pairs: walk a diagram
corpus, measure each diagram's graph structure and the drawing a layout produced
for it, and record a hand-given score next to the numbers.

It is deliberately separate from the Dev Explorer (`pnpm dev`, `.esbuild/`). That
tool is untouched: different server, different port, different routes, and the
two can run at the same time.

```bash
pnpm lab          # starts on http://localhost:92xx (the exact port is printed)
```

## What it measures

Every row is one diagram under one layout. Structural metrics come out the same
whichever layout ran; `stress` and the drawing box do not — which is the reason
the pair, rather than the diagram, is the unit.

| Column       | Meaning                                                                             |
| ------------ | ----------------------------------------------------------------------------------- |
| `N`          | **Pure nodes** — subgraph containers and edge-label placeholders excluded           |
| `E`          | Connections between nodes, after label placeholders are collapsed away              |
| `E/N`        | Edges per pure node. Above 1 means the graph carries cycles                         |
| `deg max`    | Highest number of edges touching any one node                                       |
| `deg med`    | Median number of edges touching a node                                              |
| `lbl %`      | Share of edges that carry a label                                                   |
| `non-planar` | The graph admits **no** planar embedding, so every drawing of it must cross an edge |
| `tree`       | Connected and acyclic, read as an undirected graph                                  |
| `comp`       | Connected components                                                                |
| `sub`        | Number of subgraphs                                                                 |
| `pierced`    | Edges with exactly one endpoint inside a subgraph — they must cross its frame       |
| `stress`     | Normalised stress in `[0, 1]` at the best uniform scale. Lower is better            |
| `size`       | Bounding box of the drawing, `width × height` in layout px                          |

The detail panel additionally shows raw stress, the ideal edge length that
minimises it, how many vertices stress covered, `isForest`, and which subgraphs
are pierced.

### Definitions worth knowing

**Pure nodes.** A layout may inject a node to reserve space for an edge label,
splitting `A --> B` into `A → label → B`. Counted naively that would make every
degree, ratio and planarity answer depend on which layout ran, so those
placeholders are collapsed back into the edge they came from
(`src/metrics/graphModel.ts`). Subgraph containers are excluded from `N` too,
but a subgraph used as an edge _endpoint_ (`A --> SomeSubgraph`) does become a
vertex of the topology graph, because the layout really does have to connect it.

**Planarity** is the left-right planarity test (Brandes 2009) — the real thing,
not the Euler-bound shortcut, so `K3,3` and its subdivisions are caught. Both
passes are iterative, so a deep diagram cannot overflow the stack.

**Stress** is the objective the stress-majorisation layouts in this repo
minimise (`hola/core/stress/stressModel.ts`):

```
stress(L) = Σ_{i<j} w_ij · (‖p_i − p_j‖ − L · d_ij)²      w_ij = 1 / d_ij²
```

A _measurement_ cannot be handed an ideal edge length `L` — the same drawing
scaled 2× would score differently, and two layouts with different default
spacings would never be comparable. So the reported value is the stress at the
`L` that minimises it, plus a scale-invariant `[0, 1]` normalisation. Pairs in
different connected components are skipped, as they are in the layouts
themselves.

**Pierced subgraphs.** An edge with exactly one endpoint among a subgraph's
descendants has to cross its frame. An edge landing _on_ the container attaches
to the frame instead, and does not count. Nesting is handled: an edge from
outside into `Outer > Inner` pierces both.

## Scoring

Select a row and the diagram renders on the right under the current layout. Then:

- click a chip `0`–`10`, or type the score in the table cell, or
- keyboard: <kbd>↑</kbd>/<kbd>↓</kbd> (or <kbd>j</kbd>/<kbd>k</kbd>) to move,
  <kbd>0</kbd>–<kbd>9</kbd> to score, <kbd>Shift</kbd>+<kbd>0</kbd> for 10,
  <kbd>⌫</kbd> to clear.

Notes can be attached per pair. Everything is saved immediately to
`diagram-lab/data/records.json` (written atomically via a temp file, and
serialised so two saves cannot interleave).

**Measure missing** runs every visible row that has no metrics yet;
**Re-measure all** redoes them. Renders are strictly sequential, because
`mermaid.initialize` writes global config and two overlapping runs would race
over which layout is in force. A sweep can be stopped, and results are flushed
in batches of 20 so a long run is never lost.

**Export CSV** downloads the current layout's rows.

## How the numbers are obtained

Two captures, both behind the single `window.mermaidCaptureValidation` flag that
`layout-algorithms/ddlt/validationCapture.ts` already owns:

| Capture                              | When                                        | Feeds                   |
| ------------------------------------ | ------------------------------------------- | ----------------------- |
| `window.mermaidLastStructureCapture` | **before** any layout touches `data4Layout` | every structural metric |
| `window.mermaidLastLayoutCapture`    | after layout and paint                      | `stress*`, `size`       |

Structure has to come from the pre-layout snapshot, because a layout is free to
rewrite `data4Layout` on its way through. Dagre does: `applyDagreLayoutResult`
replaces `data4Layout.edges` with the edges rendered at the top level, so a
diagram whose edges all live inside a subgraph is _edgeless_ in the post-layout
object (the limitation is documented on that function). Measuring that would
make node and edge counts depend on which layout ran — which is exactly what
these metrics must not do.

With the split in place the invariant holds by measurement: over the 198
flowcharts in `layout-tests/`, all 13 structural metrics come out **identical**
under `dagre` and under `elk`.

The runner grafts the laid-out geometry onto the structural nodes. A node the
layout never positioned — dagre leaves nested cluster children in their own
coordinate space — simply arrives without coordinates and drops out of the
stress sum rather than being given an invented position. `stress covers` in the
detail panel (`stressNodeCount` in the CSV) says how many vertices the number
was actually computed over, so a partial figure is never mistaken for a
whole-graph one.

A layout that does **not** route through the shared layout renderer will render
fine and then record a "produced no structure capture" error rather than
silently reporting metrics from a stale drawing.

## Configuration

| Variable              | Default                                                       | Purpose                             |
| --------------------- | ------------------------------------------------------------- | ----------------------------------- |
| `MERMAID_LAB_PORT`    | `9200 + hash(cwd) % 100`                                      | Server port                         |
| `MERMAID_LAB_ROOT`    | `MERMAID_DEV_EXPLORER_ROOT`, else `e2e/platform/dev-diagrams` | Corpus root                         |
| `MERMAID_LAB_RECORDS` | `records.json`                                                | Filename inside `diagram-lab/data/` |

Pointing `MERMAID_LAB_RECORDS` at a second file is the way to keep two
independent scoring runs — for example one per reviewer — side by side.

## Layout

```
diagram-lab/
├── server.ts              express + esbuild: builds mermaid, serves the UI and the API
├── src/
│   ├── server-utils.ts    pure server helpers (diagram-type detection, record merge, CSV)
│   ├── metrics/           the measurement pass — no DOM, no mermaid runtime
│   │   ├── graphModel.ts  LayoutData → plain graph, with label placeholders collapsed
│   │   ├── degrees.ts     max / median connectivity
│   │   ├── connectivity.ts components, tree, forest
│   │   ├── planarity.ts   left-right planarity test
│   │   ├── stress.ts      scale-optimal and normalised stress
│   │   ├── subgraphs.ts   containment and frame-piercing edges
│   │   └── computeMetrics.ts
│   └── client/            Lit UI: table, preview, scoring
│       └── runner.ts      renders, then merges the two captures
└── data/records.json      the results table
```

`src/metrics/` has no runtime dependency on Mermaid — only type-level structural
mirrors — so it is unit-testable on its own:

```bash
vitest run diagram-lab
```

## API

| Route                                  | Purpose                                                        |
| -------------------------------------- | -------------------------------------------------------------- |
| `GET /api/corpus`                      | Every `.mmd` under the corpus root, with detected diagram type |
| `GET /api/file?path=`                  | One diagram's source                                           |
| `GET /api/records`                     | The whole records store                                        |
| `POST /api/records`                    | Upsert `{ records: LabRecord[] }`, merging scores and metrics  |
| `DELETE /api/records?diagram=&layout=` | Drop one pair                                                  |
| `GET /api/export.csv?layout=`          | CSV of the table                                               |
