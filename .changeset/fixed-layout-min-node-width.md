---
'mermaid': patch
---

fix: keep flowchart labels centred inside fixed-layout nodes narrower than `minNodeWidth`. An explicit node width now fully overrides the diagram-level minimum label width instead of widening the label box past the node's rect.
