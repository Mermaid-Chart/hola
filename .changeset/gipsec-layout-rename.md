---
'mermaid': major
---

**Breaking: the `stress-and-grid` layout is now called `gipsec`.**

Select it with `layout: 'gipsec'`:

```yaml
---
config:
  layout: gipsec
---
```

`layout: 'stress-and-grid'` no longer resolves. An unregistered layout falls
through the usual chain to `dagre` rather than erroring, so a diagram that still
names the old value renders — just with a different algorithm than it asks for.
Update any diagram, `mermaid.initialize` call or stored configuration that names
it.

Only the identifier changed. The algorithm, its geometry and its output are
unaffected.
