---
'mermaid': patch
---

fix(image-shape): stop drawing an unpainted rect just to measure the node

`imageSquare` sized the node by inserting a `fill: none; stroke: none` rect enclosing image and label, then reading its bbox. That rect is appended after the label, so it sorts above it, and any consumer that styles node `path` elements — for example a `:hover` rule that sets `fill` — turns it into a hit target covering the whole node, making the label unclickable. The outer box is already known arithmetically, so it is now passed to `updateNodeBounds` as known geometry and no rect is drawn. Rendered output is unchanged; hand-drawn image nodes report their nominal bounds instead of bounds inflated by the invisible rect's roughjs wobble.
