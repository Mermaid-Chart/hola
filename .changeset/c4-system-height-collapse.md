---
'mermaid': patch
---

fix: restore the size of C4 elements. A shape given only an explicit width no longer collapses to a fixed 10px height, and element labels wrap to `c4.width` again instead of running off the sides — `c4LabelHelper` was gating on the root `wrap` config, which has no default, rather than `c4.wrap`, which defaults to true.
