# Corpus import

Imported from `e2e/platform/dev-diagrams` into `diagram-lab/diagrams`.

- source files: **372**
- unique by content: **241** (all copied)
- redundant duplicates skipped: **131**

Duplicates were found by content, never by filename — the source tree
contains files whose names promise something the content does not
(`GRAPH - Bipartite Graph k3,3.mmd` is byte-identical to its non-GRAPH
sibling, and is `flowchart LR` in both). Line endings, trailing
whitespace and blank lines are normalised before comparing; statement
order is not, because it changes what the layout engine is asked to do.

## Flattened to one level

The folder is kept flat — no subdirectories. Four basenames occurred twice with
_different_ content, which is the inverse of the duplicate-title problem above:
same name, different diagram. Blind flattening would have destroyed one of each,
so the canonical copy keeps the bare name and the other carries its source
folder as a `__suffix`.

| kept as                                       | was                                          | disambiguated because                         |
| --------------------------------------------- | -------------------------------------------- | --------------------------------------------- |
| `Company.mmd`                                 | `layout-tests/Company.mmd`                   | collides with `layout-tests/hola/Company.mmd` |
| `Company__hola.mmd`                           | `layout-tests/hola/Company.mmd`              | different diagram, same name                  |
| `edge-types.mmd`                              | `layout-tests/edge-types.mmd`                | collides with the `hola/` copy                |
| `edge-types__hola.mmd`                        | `layout-tests/hola/edge-types.mmd`           | different diagram, same name                  |
| `nested-sg-outgoing-3.mmd`                    | `layout-tests/nested-sg-outgoing-3.mmd`      | collides with the `hola/` copy                |
| `nested-sg-outgoing-3__hola.mmd`              | `layout-tests/hola/nested-sg-outgoing-3.mmd` | different diagram, same name                  |
| `state-diagram.mmd`                           | `layout-tests/state-diagram.mmd`             | collides with the faulty-diags copy           |
| `state-diagram__tmp-v12.0.0-faulty-diags.mmd` | `tmp-v12.0.0-faulty-diags/state-diagram.mmd` | different diagram, same name                  |

`records.json` is keyed by diagram path, so every key was remapped in the same
pass — measurements and scores survived the rename rather than being orphaned.

## Skipped as duplicates

| not copied                                                                                               | identical to                                                                                   |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `knsv/test.mmd`                                                                                          | `layout-tests/ortho1.mmd`                                                                      |
| `layout-tests/Loop Fixtures/4813-title-and-arrow-styling.mmd`                                            | `layout-tests/hola/4813-title-and-arrow-styling.mmd`                                           |
| `layout-tests/Loop Fixtures/Bipartite Graph k3,3.mmd`                                                    | `layout-tests/hola/Bipartite Graph k3,3.mmd`                                                   |
| `layout-tests/Loop Fixtures/Company.mmd`                                                                 | `layout-tests/hola/Company.mmd`                                                                |
| `layout-tests/Loop Fixtures/Extreme-Subgraphs-WindRose.mmd`                                              | `layout-tests/hola/Extreme-Subgraphs-WindRose.mmd`                                             |
| `layout-tests/Loop Fixtures/GRAPH - Bipartite Graph k3,3.mmd`                                            | `layout-tests/hola/Bipartite Graph k3,3.mmd`                                                   |
| `layout-tests/Loop Fixtures/GRAPH - complete_graph_k4.mmd`                                               | `layout-tests/hola/complete_graph_k4.mmd`                                                      |
| `layout-tests/Loop Fixtures/GRAPH - fuse 3 columns - scrumbling subgraphs.mmd`                           | `layout-tests/hola/GRAPH - fuse 3 columns - scrumbling subgraphs.mmd`                          |
| `layout-tests/Loop Fixtures/GRAPH - hola 4 nodes loop + trees - Long Labels.mmd`                         | `layout-tests/hola/GRAPH - hola 4 nodes loop + trees - Long Labels.mmd`                        |
| `layout-tests/Loop Fixtures/GRAPH - hola 4 nodes loop + trees.mmd`                                       | `layout-tests/hola/GRAPH - hola 4 nodes loop + trees.mmd`                                      |
| `layout-tests/Loop Fixtures/GRAPH - hola 5 nodes loop + trees.mmd`                                       | `layout-tests/hola/GRAPH - hola 5 nodes loop + trees.mmd`                                      |
| `layout-tests/Loop Fixtures/GRAPH - hola 7 nodes double loop + trees - easy - subgraph1.mmd`             | `layout-tests/hola/GRAPH - hola 7 nodes double loop + trees - easy - subgraph1.mmd`            |
| `layout-tests/Loop Fixtures/GRAPH - hola 7 nodes double loop + trees - easy - subgraph2.mmd`             | `layout-tests/hola/GRAPH - hola 7 nodes double loop + trees - easy - subgraph2.mmd`            |
| `layout-tests/Loop Fixtures/GRAPH - hola 7 nodes double loop + trees - easy.mmd`                         | `layout-tests/hola/GRAPH - hola 7 nodes double loop + trees - easy.mmd`                        |
| `layout-tests/Loop Fixtures/GRAPH - hola 7 nodes double loop + trees.mmd`                                | `layout-tests/hola/GRAPH - hola 7 nodes double loop + trees.mmd`                               |
| `layout-tests/Loop Fixtures/GRAPH - hola 7 nodes double loop.mmd`                                        | `layout-tests/hola/GRAPH - hola 7 nodes double loop.mmd`                                       |
| `layout-tests/Loop Fixtures/GRAPH - hola paper graph 5.mmd`                                              | `layout-tests/hola/GRAPH - hola paper graph 5.mmd`                                             |
| `layout-tests/Loop Fixtures/GRAPH - hola paper graph 7.mmd`                                              | `layout-tests/hola/GRAPH - hola paper graph 7.mmd`                                             |
| `layout-tests/Loop Fixtures/GRAPH - hola paper graph 8.mmd`                                              | `layout-tests/hola/GRAPH - hola paper graph 8.mmd`                                             |
| `layout-tests/Loop Fixtures/Render-stadium-shape.mmd`                                                    | `layout-tests/hola/Render-stadium-shape.mmd`                                                   |
| `layout-tests/Loop Fixtures/busy-core-many-trees.mmd`                                                    | `layout-tests/hola/busy-core-many-trees.mmd`                                                   |
| `layout-tests/Loop Fixtures/complete_graph_k4.mmd`                                                       | `layout-tests/hola/complete_graph_k4.mmd`                                                      |
| `layout-tests/Loop Fixtures/complete_graph_k5.mmd`                                                       | `layout-tests/hola/complete_graph_k5.mmd`                                                      |
| `layout-tests/Loop Fixtures/core-with-two-trees.mmd`                                                     | `layout-tests/hola/core-with-two-trees.mmd`                                                    |
| `layout-tests/Loop Fixtures/decision-flow.mmd`                                                           | `layout-tests/decision-flow.mmd`                                                               |
| `layout-tests/Loop Fixtures/decoupled-subgraph.mmd`                                                      | `layout-tests/decoupled-subgraph.mmd`                                                          |
| `layout-tests/Loop Fixtures/deploy-pipeline.mmd`                                                         | `layout-tests/deploy-pipeline.mmd`                                                             |
| `layout-tests/Loop Fixtures/domus1.mmd`                                                                  | `layout-tests/domus1.mmd`                                                                      |
| `layout-tests/Loop Fixtures/double-loop-with-subgraph-2.mmd`                                             | `layout-tests/hola/double-loop-with-subgraph-2.mmd`                                            |
| `layout-tests/Loop Fixtures/double-loop-with-subgraph.mmd`                                               | `layout-tests/hola/double-loop-with-subgraph.mmd`                                              |
| `layout-tests/Loop Fixtures/double-loop.mmd`                                                             | `layout-tests/hola/double-loop.mmd`                                                            |
| `layout-tests/Loop Fixtures/edge-to-node-in-subgraph.mmd`                                                | `layout-tests/edge-to-node-in-subgraph.mmd`                                                    |
| `layout-tests/Loop Fixtures/edge-to-subgraph.mmd`                                                        | `layout-tests/edge-to-subgraph.mmd`                                                            |
| `layout-tests/Loop Fixtures/edge-types.mmd`                                                              | `layout-tests/hola/edge-types.mmd`                                                             |
| `layout-tests/Loop Fixtures/event.mmd`                                                                   | `layout-tests/hola/event.mmd`                                                                  |
| `layout-tests/Loop Fixtures/flowchart-edge-styling.mmd`                                                  | `layout-tests/hola/flowchart-edge-styling.mmd`                                                 |
| `layout-tests/Loop Fixtures/identical-edges-in-subgraph.mmd`                                             | `layout-tests/identical-edges-in-subgraph.mmd`                                                 |
| `layout-tests/Loop Fixtures/incremental-editing.mmd`                                                     | `layout-tests/hola/incremental-editing.mmd`                                                    |
| `layout-tests/Loop Fixtures/labels-and-self-loop.mmd`                                                    | `layout-tests/hola/labels-and-self-loop.mmd`                                                   |
| `layout-tests/Loop Fixtures/labels-long.mmd`                                                             | `layout-tests/labels-long.mmd`                                                                 |
| `layout-tests/Loop Fixtures/life-choices.mmd`                                                            | `layout-tests/life-choices.mmd`                                                                |
| `layout-tests/Loop Fixtures/multiple-edges.mmd`                                                          | `layout-tests/multiple-edges.mmd`                                                              |
| `layout-tests/Loop Fixtures/nested-incoming.mmd`                                                         | `layout-tests/nested-incoming.mmd`                                                             |
| `layout-tests/Loop Fixtures/nested-outgoing-edges.mmd`                                                   | `layout-tests/nested-outgoing-edges.mmd`                                                       |
| `layout-tests/Loop Fixtures/nested-sb-edges-in-out.mmd`                                                  | `layout-tests/nested-sb-edges-in-out.mmd`                                                      |
| `layout-tests/Loop Fixtures/nested-sg-outgoing-2.mmd`                                                    | `layout-tests/nested-sg-outgoing-2.mmd`                                                        |
| `layout-tests/Loop Fixtures/nested-sg-outgoing-3.mmd`                                                    | `layout-tests/hola/nested-sg-outgoing-3.mmd`                                                   |
| `layout-tests/Loop Fixtures/nested-sg-outgoing-4.mmd`                                                    | `layout-tests/nested-sg-outgoing-4.mmd`                                                        |
| `layout-tests/Loop Fixtures/nested-subgraphs-2.mmd`                                                      | `layout-tests/nested-subgraphs-2.mmd`                                                          |
| `layout-tests/Loop Fixtures/nested-subgraphs-3.mmd`                                                      | `layout-tests/nested-subgraphs-3.mmd`                                                          |
| `layout-tests/Loop Fixtures/nested-subgraphs-reverse-order.mmd`                                          | `layout-tests/hola/nested-subgraphs-reverse-order.mmd`                                         |
| `layout-tests/Loop Fixtures/nested-subgraphs.mmd`                                                        | `layout-tests/nested-subgraphs.mmd`                                                            |
| `layout-tests/Loop Fixtures/non-rect-intersections.mmd`                                                  | `layout-tests/hola/non-rect-intersections.mmd`                                                 |
| `layout-tests/Loop Fixtures/ortho-mini.mmd`                                                              | `layout-tests/ortho-mini.mmd`                                                                  |
| `layout-tests/Loop Fixtures/ortho1.mmd`                                                                  | `layout-tests/ortho1.mmd`                                                                      |
| `layout-tests/Loop Fixtures/project-sox2.mmd`                                                            | `layout-tests/project-sox2.mmd`                                                                |
| `layout-tests/Loop Fixtures/pure-tree.mmd`                                                               | `layout-tests/hola/pure-tree.mmd`                                                              |
| `layout-tests/Loop Fixtures/self-loop-2.mmd`                                                             | `layout-tests/self-loop-2.mmd`                                                                 |
| `layout-tests/Loop Fixtures/self-loop-multi.mmd`                                                         | `layout-tests/self-loop-2.mmd`                                                                 |
| `layout-tests/Loop Fixtures/self-loop.mmd`                                                               | `layout-tests/self-loop.mmd`                                                                   |
| `layout-tests/Loop Fixtures/shapes-and-styling.mmd`                                                      | `layout-tests/shapes-and-styling.mmd`                                                          |
| `layout-tests/Loop Fixtures/shapes.mmd`                                                                  | `layout-tests/shapes.mmd`                                                                      |
| `layout-tests/Loop Fixtures/simple-graph.mmd`                                                            | `layout-tests/simple-graph.mmd`                                                                |
| `layout-tests/Loop Fixtures/subgraph-case.mmd`                                                           | `layout-tests/hola/subgraph-case.mmd`                                                          |
| `layout-tests/Loop Fixtures/subgraph-labels-2.mmd`                                                       | `layout-tests/subgraph-labels-2.mmd`                                                           |
| `layout-tests/Loop Fixtures/subgraph-labels-3.mmd`                                                       | `layout-tests/subgraph-labels-3.mmd`                                                           |
| `layout-tests/Loop Fixtures/subgraph-labels.mmd`                                                         | `layout-tests/subgraph-labels.mmd`                                                             |
| `layout-tests/Loop Fixtures/subgraph-variation-2.mmd`                                                    | `layout-tests/subgraph-variation-2.mmd`                                                        |
| `layout-tests/Loop Fixtures/subgraph-variation.mmd`                                                      | `layout-tests/subgraph-variation.mmd`                                                          |
| `layout-tests/Loop Fixtures/tree.mmd`                                                                    | `layout-tests/hola/tree.mmd`                                                                   |
| `layout-tests/Loop Fixtures/triple-loop.mmd`                                                             | `layout-tests/hola/triple-loop.mmd`                                                            |
| `layout-tests/Loop Fixtures/two-components.mmd`                                                          | `layout-tests/hola/two-components.mmd`                                                         |
| `layout-tests/elk-edge-cases/4813-title-and-arrow-styling.mmd`                                           | `layout-tests/hola/4813-title-and-arrow-styling.mmd`                                           |
| `layout-tests/elk-edge-cases/Render-stadium-shape.mmd`                                                   | `layout-tests/hola/Render-stadium-shape.mmd`                                                   |
| `layout-tests/elk-edge-cases/class-generic-no-html-labels.mmd`                                           | `layout-tests/hola/class-generic-no-html-labels.mmd`                                           |
| `layout-tests/elk-edge-cases/flowchart-edge-styling.mmd`                                                 | `layout-tests/hola/flowchart-edge-styling.mmd`                                                 |
| `layout-tests/elk-edge-cases/full-class-diagram.mmd`                                                     | `layout-tests/hola/full-class-diagram.mmd`                                                     |
| `layout-tests/elk-edge-cases/nested-subgraphs-reverse-order.mmd`                                         | `layout-tests/hola/nested-subgraphs-reverse-order.mmd`                                         |
| `layout-tests/elk-edge-cases/non-rect-intersections.mmd`                                                 | `layout-tests/hola/non-rect-intersections.mmd`                                                 |
| `layout-tests/elk-edge-cases/requirement-label-alignment.mmd`                                            | `layout-tests/hola/requirement-label-alignment.mmd`                                            |
| `layout-tests/elk-edge-cases/right-angles-not-curves.mmd`                                                | `layout-tests/hola/right-angles-not-curves.mmd`                                                |
| `layout-tests/elk-edge-cases/should-render-edge-labels-correctly-when-flowchart-htmlLabels-is-false.mmd` | `layout-tests/hola/should-render-edge-labels-correctly-when-flowchart-htmlLabels-is-false.mmd` |
| `layout-tests/elk-edge-cases/styled-edge-labels.mmd`                                                     | `layout-tests/hola/styled-edge-labels.mmd`                                                     |
| `layout-tests/hola/Company-simp.mmd`                                                                     | `layout-tests/Company-simp.mmd`                                                                |
| `layout-tests/hola/GRAPH - Bipartite Graph k3,3.mmd`                                                     | `layout-tests/hola/Bipartite Graph k3,3.mmd`                                                   |
| `layout-tests/hola/GRAPH - complete_graph_k4.mmd`                                                        | `layout-tests/hola/complete_graph_k4.mmd`                                                      |
| `layout-tests/hola/class-diagram-2.mmd`                                                                  | `layout-tests/class-diagram-2.mmd`                                                             |
| `layout-tests/hola/class-diagram-3.mmd`                                                                  | `layout-tests/class-diagram-3.mmd`                                                             |
| `layout-tests/hola/class-diagram.mmd`                                                                    | `layout-tests/class-diagram.mmd`                                                               |
| `layout-tests/hola/decision-flow.mmd`                                                                    | `layout-tests/decision-flow.mmd`                                                               |
| `layout-tests/hola/decoupled-subgraph.mmd`                                                               | `layout-tests/decoupled-subgraph.mmd`                                                          |
| `layout-tests/hola/deploy-pipeline-simplified.mmd`                                                       | `layout-tests/deploy-pipeline-simplified.mmd`                                                  |
| `layout-tests/hola/deploy-pipeline.mmd`                                                                  | `layout-tests/deploy-pipeline.mmd`                                                             |
| `layout-tests/hola/domus1.mmd`                                                                           | `layout-tests/domus1.mmd`                                                                      |
| `layout-tests/hola/edge-from-subgraph.mmd`                                                               | `layout-tests/edge-from-subgraph.mmd`                                                          |
| `layout-tests/hola/edge-to-node-in-subgraph.mmd`                                                         | `layout-tests/edge-to-node-in-subgraph.mmd`                                                    |
| `layout-tests/hola/edge-to-subgraph.mmd`                                                                 | `layout-tests/edge-to-subgraph.mmd`                                                            |
| `layout-tests/hola/identical-edges-in-subgraph.mmd`                                                      | `layout-tests/identical-edges-in-subgraph.mmd`                                                 |
| `layout-tests/hola/identical-edges.mmd`                                                                  | `layout-tests/identical-edges.mmd`                                                             |
| `layout-tests/hola/labels-long.mmd`                                                                      | `layout-tests/labels-long.mmd`                                                                 |
| `layout-tests/hola/life-choices.mmd`                                                                     | `layout-tests/life-choices.mmd`                                                                |
| `layout-tests/hola/multiple-edges.mmd`                                                                   | `layout-tests/multiple-edges.mmd`                                                              |
| `layout-tests/hola/nested-incoming.mmd`                                                                  | `layout-tests/nested-incoming.mmd`                                                             |
| `layout-tests/hola/nested-outgoing-edges.mmd`                                                            | `layout-tests/nested-outgoing-edges.mmd`                                                       |
| `layout-tests/hola/nested-sb-edges-in-out.mmd`                                                           | `layout-tests/nested-sb-edges-in-out.mmd`                                                      |
| `layout-tests/hola/nested-sg-outgoing-2.mmd`                                                             | `layout-tests/nested-sg-outgoing-2.mmd`                                                        |
| `layout-tests/hola/nested-sg-outgoing-4.mmd`                                                             | `layout-tests/nested-sg-outgoing-4.mmd`                                                        |
| `layout-tests/hola/nested-sg-outgoing-5.mmd`                                                             | `layout-tests/nested-sg-outgoing-5.mmd`                                                        |
| `layout-tests/hola/nested-subgraphs-2.mmd`                                                               | `layout-tests/nested-subgraphs-2.mmd`                                                          |
| `layout-tests/hola/nested-subgraphs-3.mmd`                                                               | `layout-tests/nested-subgraphs-3.mmd`                                                          |
| `layout-tests/hola/nested-subgraphs.mmd`                                                                 | `layout-tests/nested-subgraphs.mmd`                                                            |
| `layout-tests/hola/ortho-mini-2.mmd`                                                                     | `layout-tests/ortho-mini-2.mmd`                                                                |
| `layout-tests/hola/ortho-mini.mmd`                                                                       | `layout-tests/ortho-mini.mmd`                                                                  |
| `layout-tests/hola/ortho1.mmd`                                                                           | `layout-tests/ortho1.mmd`                                                                      |
| `layout-tests/hola/project-sox2.mmd`                                                                     | `layout-tests/project-sox2.mmd`                                                                |
| `layout-tests/hola/self-loop-2.mmd`                                                                      | `layout-tests/self-loop-2.mmd`                                                                 |
| `layout-tests/hola/self-loop-multi.mmd`                                                                  | `layout-tests/self-loop-2.mmd`                                                                 |
| `layout-tests/hola/self-loop.mmd`                                                                        | `layout-tests/self-loop.mmd`                                                                   |
| `layout-tests/hola/shapes-and-styling.mmd`                                                               | `layout-tests/shapes-and-styling.mmd`                                                          |
| `layout-tests/hola/shapes.mmd`                                                                           | `layout-tests/shapes.mmd`                                                                      |
| `layout-tests/hola/simple-graph.mmd`                                                                     | `layout-tests/simple-graph.mmd`                                                                |
| `layout-tests/hola/state-diagram.mmd`                                                                    | `layout-tests/state-diagram.mmd`                                                               |
| `layout-tests/hola/subgraph-labels-2.mmd`                                                                | `layout-tests/subgraph-labels-2.mmd`                                                           |
| `layout-tests/hola/subgraph-labels-3.mmd`                                                                | `layout-tests/subgraph-labels-3.mmd`                                                           |
| `layout-tests/hola/subgraph-labels.mmd`                                                                  | `layout-tests/subgraph-labels.mmd`                                                             |
| `layout-tests/hola/subgraph-variation-2.mmd`                                                             | `layout-tests/subgraph-variation-2.mmd`                                                        |
| `layout-tests/hola/subgraph-variation.mmd`                                                               | `layout-tests/subgraph-variation.mmd`                                                          |
| `layout-tests/self-loop-multi.mmd`                                                                       | `layout-tests/self-loop-2.mmd`                                                                 |
| `layout-tests/swimlanes/3-decisions-tb.mmd`                                                              | `layout-tests/swimlanes/2-decisions-lr.mmd`                                                    |
| `performance/flowcharts/huge4.mmd`                                                                       | `performance/flowcharts/huge2.mmd`                                                             |
| `performance/flowcharts/large3.mmd`                                                                      | `performance/flowcharts/large1.mmd`                                                            |
