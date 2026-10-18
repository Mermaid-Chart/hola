---
'mermaid': minor
---

**`hola` and `gipsec` now hand graphs they are ill-suited to over to ELK.**

Both build their drawing around a planar, grid-aligned core. That works on the
shape they were designed for and degrades on graphs that break its premises,
where a general-purpose layout does better. A structural pre-check now runs
before layout and redirects a diagram to `elk` when any one of these holds:

- the graph admits no planar embedding
- it has more than 4 subgraphs
- it has more than 10 nodes and at least one node of degree 5 or more

The check reads the abstract graph only — a planarity DFS and a degree count —
so it never costs a discarded layout. Diagrams that pass are laid out exactly as
before, and every other layout dispatches untouched.

The redirect is reported at `info` level, naming the condition that triggered
it. On the tiny build, which ships no ELK, it resolves to `dagre` through the
normal fallback chain.
