---
'mermaid': minor
---

fix: do not apply `positions` to the `hola` and `gipsec` layouts

`positions` predates both layouts and is not a feature they are meant to
support. It is now withheld from them, decided from the layout the diagram
asked for, so a graph redirected to ELK by the structural pre-check does not
have it reinstated on the way through.
