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

## The corpus is a folder you fill

`pnpm lab` lists **`diagram-lab/diagrams/`** and nothing else. Drop the `.mmd`
files you want to study in there. The folder is kept flat — one level, no
subdirectories — though a subfolder you add is still picked up and shows as a
`dir` prefix in the table. The folder's contents are gitignored, so your working
set never shows up in a diff.

It currently holds the repo's diagram corpus, de-duplicated by **content** rather
than by filename: 372 source files collapsed to 241 distinct diagrams. See
[`data/corpus-import.md`](data/corpus-import.md) for exactly what was dropped and
why — including the four basenames that occur twice with different content and
therefore kept a `__suffix`.

To study an existing tree instead of your own:

```bash
MERMAID_LAB_ROOT=e2e/platform/dev-diagrams pnpm lab
```

## What it measures, and what survives a layout change

Every row is one diagram under one layout — but the two halves of a row are
stored separately, because most of what is measured is a property of the
_diagram_, not of the drawing:

|                                                                                                | Stored per            | Behaviour when you switch layout  |
| ---------------------------------------------------------------------------------------------- | --------------------- | --------------------------------- |
| `N`, `E`, `E/N`, `deg max`, `deg med`, `lbl %`, `non-planar`, `tree`, `comp`, `sub`, `pierced` | **diagram**           | stay on screen — measured once    |
| `stress`, `size`, `valid`, `hard`, `cross`                                                     | **(diagram, layout)** | blank until that pair is measured |
| your score, `ok?` and notes                                                                    | **(diagram, layout)** | per pair, as they should be       |

Layout-dependent columns are marked with a `·` in the header and tinted, so it
is obvious at a glance which numbers move when you change the engine.

Both halves record the `sha256` of the `.mmd` they were measured from. Edit a
diagram and its row is flagged **stale** — the old numbers stay visible, dimmed,
and the next _Measure missing_ re-runs exactly those rows rather than leaving
them quietly wrong.

| Column       | Meaning                                                                                                                                                                       |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `N`          | **Pure nodes** — subgraph containers and edge-label placeholders excluded                                                                                                     |
| `E`          | Connections between nodes, after label placeholders are collapsed away                                                                                                        |
| `E/N`        | Edges per pure node. Above 1 means the graph carries cycles                                                                                                                   |
| `deg max`    | Highest number of edges touching any one node                                                                                                                                 |
| `deg med`    | Median number of edges touching a node                                                                                                                                        |
| `lbl %`      | Share of edges that carry a label                                                                                                                                             |
| `non-planar` | The graph admits **no** planar embedding, so every drawing of it must cross an edge                                                                                           |
| `tree`       | Connected and acyclic, read as an undirected graph                                                                                                                            |
| `comp`       | Connected components                                                                                                                                                          |
| `sub`        | Number of subgraphs                                                                                                                                                           |
| `pierced`    | Edges with exactly one endpoint inside a subgraph — they must cross its frame                                                                                                 |
| `stress`     | Normalised stress in `[0, 1]` at the best uniform scale. Lower is better                                                                                                      |
| `valid`      | `validateLayout` score in `[0, 1000]` — the same number the Dev Explorer's validation panel and the DDLT sweep read by. **Zero when the layout is invalid.** Higher is better |
| `hard`       | Issues that make the layout invalid, as opposed to merely lowering the score                                                                                                  |
| `cross`      | Edge crossings the validator counted. Read next to `non-planar`: a non-planar graph _must_ cross at least once, so anything above that floor is the layout's own doing        |
| `size`       | Bounding box of the drawing, `width × height` in layout px                                                                                                                    |
| `ok?`        | **Your** verdict — see _Scoring_ below                                                                                                                                        |

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

## Choosing which layouts to evaluate

Edit **`diagram-lab/layouts.json`** — it is config, not code:

```json
{
  "layouts": ["dagre", "elk", "ipsep-cola", "gipsec"]
}
```

The order is the order the buttons appear in. The server picks the file up on
save and the page reloads — no restart. `MERMAID_LAB_LAYOUTS=a,b,c` overrides it
for a single run.

Names must be layouts that route through the shared layout renderer, since that
is what produces the captures everything here is measured from. The full set is
in the file's `known` field; anything else is dropped with a console warning
rather than offered as a button that could only ever fail. A list that resolves
to nothing falls back to all of them, so the lab is never left with no layout to
select.

Narrowing the list **hides** the excluded layouts; it does not delete anything.
Measurements and scores you already recorded under a now-hidden layout stay in
`records.json` and come back if you re-add it, and `export.csv` still contains
them. Arriving with a hidden layout remembered from a previous session — or in a
`?layout=` URL — falls back to the first one on offer and says so.

## Picking a layout

The layout under evaluation is the tool's primary control, so it sits on its own
full-width row of buttons rather than in a dropdown — one per registered layout,
always all visible, one click to switch.

Each button doubles as that layout's scoreboard over the rows currently visible:

```
  dagre              elk                ipsep-cola   gipsec
  5/5 v 612 σ 0.160  5/5 v 884 σ 0.150  0/5          5/5 v 790 σ 0.110 ✓ 4/5 ★ 7.3
```

- `5/5` — measured on 5 of the 5 visible diagrams (green when complete)
- `v` — mean `validateLayout` score across them
- `σ` — mean normalised stress across them, so the calmest layout is visible
  without opening anything
- `✓ n/m` — how many of the pairs you have judged acceptable
- `★` — mean of the scores you have given, once you have given any

Filters apply first, so narrowing to a folder re-scopes every layout's numbers
to that folder.

### Comparing layouts on one diagram

With a diagram selected, **Layouts on this diagram** lists every layout's
`valid · stress · size · score · ok?` for it, with the lowest-stress one
marked green. The
structural columns are deliberately absent — they are identical on every line by
construction, so the only thing worth comparing is the placement. Clicking a
line switches to that layout, so an A/B is one click rather than a round trip
through a menu.

### The validator's score

`valid` is not a second opinion computed here — it is
`layout-utils/validateLayout.ts` itself, reached through
`window.mermaidValidateLastLayoutSummary()`, a sibling of the accessor the Dev
Explorer's validation panel already uses. Running the real validator rather than
a copy is the point: the lab's number and the Dev Explorer's are the same number
by construction, and were checked to match exactly — score, `ok`, issue count and
crossings — across several diagrams under both dagre and elk.

The hard/soft split comes from the validator's own `isSoftIssueType`, applied
inside that module where the predicate is in scope, so nothing out here can drift
from it.

A layout that produces no fresh capture for a diagram — a sequence diagram, say —
records **nothing**, rather than grading whichever drawing happened to be in the
buffer before.

## Scoring

Scores belong to the (diagram, layout) pair — the point is to judge a layout on
a diagram, not the diagram. Select a row and it renders on the right under the
current layout. Then:

- click a chip `0`–`10`, or type the score in the table cell, or
- set **acceptable** — a plain yes/no on whether this layout is good enough to
  ship for this diagram. Tri-state on purpose: "not judged yet" and "judged
  unacceptable" are different answers. It sits deliberately next to the
  validator's `valid`, because the interesting rows are the ones where the two
  disagree — a drawing the validator calls fine that you would not ship, or the
  reverse.
- keyboard: <kbd>↑</kbd>/<kbd>↓</kbd> (or <kbd>j</kbd>/<kbd>k</kbd>) to move,
  <kbd>0</kbd>–<kbd>9</kbd> to score, <kbd>Shift</kbd>+<kbd>0</kbd> for 10,
  <kbd>a</kbd> to cycle acceptable, <kbd>⌫</kbd> to clear.

### Seeing and editing the source

The **Code** switch in the detail header splits the pane: source on top,
rendered diagram below, so you can see what an edit does. The editor is the Dev
Explorer's CodeMirror component — Mermaid syntax highlighting, undo history,
<kbd>⌘S</kbd>/<kbd>Ctrl+S</kbd> — imported rather than copied, so the two cannot
drift apart.

Saving is explicit, and deliberately so. Every measurement is stamped with the
hash of the file **on disk**; measuring an unsaved draft would record numbers the
staleness check could never verify. So the render and the metrics always reflect
the saved file, and a save re-measures automatically — edit, <kbd>⌘S</kbd>, and
the row updates.

**Revert** discards the draft. Switching to another diagram with unsaved changes
asks first.

### Renaming and deleting

The diagram's name in the detail header is editable — click it, type,
<kbd>Enter</kbd> to save, <kbd>Esc</kbd> to cancel. The server refuses a name
that would clobber an existing file or climb out of the corpus root, and moves
every stored measurement and score across with the file rather than orphaning
them.

**Delete** asks first, naming exactly what goes: the `.mmd` and everything
recorded about it under every layout. The selection moves to the neighbouring
row afterwards.

Notes can be attached per pair. Everything is saved immediately to
`diagram-lab/data/records.json` (written atomically via a temp file, and
serialised so two saves cannot interleave).

**Measure missing** runs every visible row whose structure is missing or stale,
or that has no metrics for the layout currently selected; **Re-measure all**
redoes every visible row. Renders are strictly sequential, because
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

| Variable              | Default                  | Purpose                             |
| --------------------- | ------------------------ | ----------------------------------- |
| `MERMAID_LAB_PORT`    | `9200 + hash(cwd) % 100` | Server port                         |
| `MERMAID_LAB_ROOT`    | `diagram-lab/diagrams`   | Corpus root — the folder you fill   |
| `MERMAID_LAB_RECORDS` | `records.json`           | Filename inside `diagram-lab/data/` |

Pointing `MERMAID_LAB_RECORDS` at a second file is the way to keep two
independent scoring runs — for example one per reviewer — side by side.

## Layout

```
diagram-lab/
├── layouts.json           which layouts to evaluate — edit this, not the code
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
