---
'mermaid': patch
---

fix: restore the size of C4 System and System_Ext elements. A shape given only an explicit width no longer collapses to a fixed 10px height, and its label now wraps to the pinned width instead of overflowing the sides.
