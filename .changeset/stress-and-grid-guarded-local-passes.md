---
'mermaid': patch
---

fix: Extend shared atomic geometry guards to optional stress-and-grid diamond fans, framed terminal fans, sibling-frame rows, and external sibling-frame cycles. Reject invalid coordinates and measurements without retaining partial moves, restore geometry before propagating write errors, and share conservative fan caption sizing while preserving valid layouts.
