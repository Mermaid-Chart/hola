# Loop Fixtures

The curated corpus the `/hola-improve-loop` skill hill-climbs on. Everything here is
yours to edit — add, remove or reshape fixtures freely to steer what the loop optimises.

This folder is deliberately **separate from `../hola/`**. That corpus is guarded by
`scoreSweep.spec.ts` with a `KNOWN_INVALID` ratchet and is shared with other work; this
one has no ratchet and no floor, so a fixture that scores 0 here is a target for the
loop rather than a build failure.

## A fixture is a pair

Each fixture needs **two** files sharing one base name:

| file                | what it is                                                   |
| ------------------- | ------------------------------------------------------------ |
| `<name>.mmd`        | the diagram source                                           |
| `<name>.sizes.json` | captured node/label dimensions, so layout runs without a DOM |

**A `.mmd` with no matching `.sizes.json` is silently ignored.** That is the single
biggest trap here — the sweep will simply not see it, with no error. The sweep prints a
`LOOP-FIXTURES-AGG: skipped (no sizes)` line naming any such file; check it after adding
fixtures. (`<name>.json` is also accepted as the sizes file, for parity with `../hola/`.)

## Capturing sizes for a new fixture

Sizes come from a real browser render, because they are measured text metrics — there is
no way to compute them in Node. A capture harness is checked in at
`e2e/platform/ddlt-capture.html`, driven by `e2e/platform/ddlt-capture.mjs` (Playwright):

```bash
pnpm dev   # note the port it prints — worktrees do not all use 9000
MERMAID_PORT=<port> node e2e/platform/ddlt-capture.mjs          # every unpaired .mmd
MERMAID_PORT=<port> node e2e/platform/ddlt-capture.mjs "name"   # or one, by base name
```

It is idempotent: a fixture that already has sizes is skipped, so re-running only fills
gaps. Delete a `.sizes.json` to force its recapture.

The script writes `<name>.sizes.json` with the metadata block the DDLT harness expects,
including `sourceSha256` over the `.mmd`. Captures use **theme=default, look=classic**,
through the default (dagre) pipeline — that pipeline injects the `edge-label-*` dummy
nodes the sweep maps back onto edges, which HOLA itself never creates.

To capture by hand instead: open `ddlt-capture.html?f=/dev-diagrams/layout-tests/Loop%20Fixtures/<name>.mmd`,
then read `window.mermaidLastCapturedSizes`.

**Sizes go stale.** `sourceSha256` records the `.mmd` the capture was taken from. If you
edit a diagram's label text, recapture it — otherwise the layout is being scored against
dimensions it will never have in a browser. Theme and look matter too: they change the
font, and the font changes every measurement.

## Running the sweep

```bash
pnpm exec vitest run \
  packages/mermaid/src/rendering-util/layout-algorithms/hola/attached/loopFixturesSweep.spec.ts \
  --testTimeout=900000 2>&1 | grep 'LOOP-FIXTURES-AGG'
```

Add `LOOP_FIXTURES_ISSUES=1` to also print per-issue detail for each fixture.
