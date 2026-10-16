---
'mermaid': patch
---

Use facing vertices for lone diamond inputs and sloped-side midpoint ports for outputs in gipsec. Spread crowded ports symmetrically, recognize diamond aliases, and keep terminal routes attached to the outline and outside the shape. Coordinate mixed labelled/unlabelled parallel and reciprocal edges as one bundle to prevent shared ports, overlaps, and crossings.

Keep crowded non-diamond ports clear of corners on short sides and honor the configured corner inset on vertical sides, including distributions with a reserved center port.

Extend gipsec terminal lanes to the actual trapezoid and left-leaning parallelogram outlines, eliminating gaps left by rectangular-bound attachments. Validate these polygons using their drawn boundaries and vertices without changing geometric thresholds.

Align isolated unlabelled diamond-to-circle bundles with their outgoing slope midpoint and route ordered straight lanes to the circular outline, avoiding crossings, short arrowhead approaches, and crowded parallel sections.

Compact nested three-node shortcut fans and coordinate their direct and indirect routes, keeping parallel shortcut lanes above the indirect branch without long perimeter detours.

Centre free terminal decision branches on their source in either flow axis, align unequal-sized targets by their facing borders, and use mirrored lateral routing corridors after group-exit placement.
