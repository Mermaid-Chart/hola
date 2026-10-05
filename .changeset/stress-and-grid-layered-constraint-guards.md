---
'mermaid': patch
---

fix: Skip optional stress-and-grid layered workflow adjustments when edges have explicit ports or non-default minimum rank separation, or nodes have local directions, so these adjustments cannot overwrite the supplied constraints.
