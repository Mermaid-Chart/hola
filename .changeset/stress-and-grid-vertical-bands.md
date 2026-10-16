---
'mermaid': patch
---

fix: Compact clear vertical bands using measured node heights and requested rank spacing rather than retaining width-derived square grid gaps. Preserve existing rows, straight routes, labels, explicit constraints and group-owned clearances, and reject compaction that introduces hard issues, crossings or extra bends.
