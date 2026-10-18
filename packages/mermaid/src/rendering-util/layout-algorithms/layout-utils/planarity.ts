/**
 * Left-right planarity test (Brandes, *The Left-Right Planarity Test*, 2009).
 *
 * Answers one question: does this graph admit a planar embedding? A `false`
 * means every drawing of it has at least one edge crossing, no matter which
 * layout engine runs — which is exactly the thing worth knowing before blaming a
 * layout for the crossings in its output.
 *
 * The implementation follows the reference formulation (the same one NetworkX's
 * `check_planarity` uses): a DFS orientation that records lowpoints and a nesting
 * order, then a second DFS that maintains a stack of conflict pairs and fails the
 * moment two return-edge intervals cannot be separated onto opposite sides.
 * Both passes are iterative, so a deep diagram cannot overflow the JS stack.
 *
 * Only the yes/no answer is produced — the embedding itself is dropped, since
 * nothing here consumes it.
 *
 * Input must be a *simple* undirected graph: self-loops and parallel edges
 * change nothing about planarity but do break the Euler bound shortcut, so
 * `graphModel.simpleAdjacency` strips them before this runs.
 */

type PlanarEdge = readonly [string, string];

function edgeKey(edge: PlanarEdge): string {
  return `${edge[0]}\0${edge[1]}`;
}

/** Half-open interval of return edges, ordered by lowpoint. */
class Interval {
  constructor(
    public low: PlanarEdge | null = null,
    public high: PlanarEdge | null = null
  ) {}

  empty(): boolean {
    return this.low === null && this.high === null;
  }

  copy(): Interval {
    return new Interval(this.low, this.high);
  }
}

/** A pair of intervals that must end up on opposite sides of the tree edge. */
class ConflictPair {
  constructor(
    public left = new Interval(),
    public right = new Interval()
  ) {}

  swap(): void {
    const tmp = this.left;
    this.left = this.right;
    this.right = tmp;
  }
}

class LeftRightPlanarity {
  readonly #vertices: string[];
  readonly #adjacency: Map<string, string[]>;

  readonly #height = new Map<string, number>();
  readonly #lowpt = new Map<string, number>();
  readonly #lowpt2 = new Map<string, number>();
  readonly #nestingDepth = new Map<string, number>();
  readonly #parentEdge = new Map<string, PlanarEdge>();
  readonly #oriented = new Set<string>();
  readonly #orientedAdj = new Map<string, string[]>();
  readonly #orderedAdj = new Map<string, string[]>();
  readonly #ref = new Map<string, PlanarEdge | null>();
  readonly #side = new Map<string, number>();
  readonly #lowptEdge = new Map<string, PlanarEdge>();
  readonly #stackBottom = new Map<string, ConflictPair | null>();
  #stack: ConflictPair[] = [];
  readonly #roots: string[] = [];

  constructor(adjacency: Map<string, Set<string>>) {
    this.#vertices = [...adjacency.keys()];
    this.#adjacency = new Map();
    for (const [v, neighbours] of adjacency) {
      this.#adjacency.set(
        v,
        [...neighbours].filter((w) => w !== v)
      );
      this.#orientedAdj.set(v, []);
    }
  }

  run(): boolean {
    const n = this.#vertices.length;
    let degreeSum = 0;
    for (const neighbours of this.#adjacency.values()) {
      degreeSum += neighbours.length;
    }
    const m = degreeSum / 2;
    // Euler's bound for simple planar graphs. Cheap, and it settles the dense
    // cases (K5 and anything above it) before any DFS runs.
    if (n > 2 && m > 3 * n - 6) {
      return false;
    }

    for (const v of this.#vertices) {
      if (!this.#height.has(v)) {
        this.#height.set(v, 0);
        this.#roots.push(v);
        this.#orient(v);
      }
    }

    for (const v of this.#vertices) {
      const adj = [...(this.#orientedAdj.get(v) ?? [])];
      adj.sort(
        (a, b) =>
          (this.#nestingDepth.get(edgeKey([v, a])) ?? 0) -
          (this.#nestingDepth.get(edgeKey([v, b])) ?? 0)
      );
      this.#orderedAdj.set(v, adj);
    }

    for (const root of this.#roots) {
      if (!this.#test(root)) {
        return false;
      }
    }
    return true;
  }

  // ── Phase 1: orientation, lowpoints, nesting depth ─────────────────────────

  #orient(root: string): void {
    const stack: string[] = [root];
    const cursor = new Map<string, number>();
    const resumed = new Set<string>();

    while (stack.length > 0) {
      const v = stack.pop()!;
      const parent = this.#parentEdge.get(v);
      const parentKey = parent ? edgeKey(parent) : null;
      const adj = this.#adjacency.get(v) ?? [];
      let i = cursor.get(v) ?? 0;
      let descended = false;

      while (i < adj.length) {
        const w = adj[i];
        const vw: PlanarEdge = [v, w];
        const vwKey = edgeKey(vw);

        if (!resumed.has(vwKey)) {
          if (this.#oriented.has(vwKey) || this.#oriented.has(edgeKey([w, v]))) {
            i++;
            cursor.set(v, i);
            continue;
          }
          this.#oriented.add(vwKey);
          this.#orientedAdj.get(v)?.push(w);
          this.#lowpt.set(vwKey, this.#height.get(v)!);
          this.#lowpt2.set(vwKey, this.#height.get(v)!);

          if (!this.#height.has(w)) {
            // Tree edge: descend, and come back to this same adjacency slot.
            this.#parentEdge.set(w, vw);
            this.#height.set(w, this.#height.get(v)! + 1);
            cursor.set(v, i);
            stack.push(v, w);
            resumed.add(vwKey);
            descended = true;
            break;
          }
          // Back edge.
          this.#lowpt.set(vwKey, this.#height.get(w)!);
        }

        let nesting = 2 * this.#lowpt.get(vwKey)!;
        if (this.#lowpt2.get(vwKey)! < this.#height.get(v)!) {
          nesting += 1; // chordal
        }
        this.#nestingDepth.set(vwKey, nesting);

        if (parentKey !== null) {
          const childLow = this.#lowpt.get(vwKey)!;
          const parentLow = this.#lowpt.get(parentKey)!;
          if (childLow < parentLow) {
            this.#lowpt2.set(parentKey, Math.min(parentLow, this.#lowpt2.get(vwKey)!));
            this.#lowpt.set(parentKey, childLow);
          } else if (childLow > parentLow) {
            this.#lowpt2.set(parentKey, Math.min(this.#lowpt2.get(parentKey)!, childLow));
          } else {
            this.#lowpt2.set(
              parentKey,
              Math.min(this.#lowpt2.get(parentKey)!, this.#lowpt2.get(vwKey)!)
            );
          }
        }

        i++;
        cursor.set(v, i);
      }

      if (!descended) {
        cursor.set(v, i);
      }
    }
  }

  // ── Phase 2: conflict pairs ────────────────────────────────────────────────

  #test(root: string): boolean {
    const stack: string[] = [root];
    const cursor = new Map<string, number>();
    const resumed = new Set<string>();

    while (stack.length > 0) {
      const v = stack.pop()!;
      const parent = this.#parentEdge.get(v) ?? null;
      const adj = this.#orderedAdj.get(v) ?? [];
      let i = cursor.get(v) ?? 0;
      let descended = false;

      while (i < adj.length) {
        const w = adj[i];
        const ei: PlanarEdge = [v, w];
        const eiKey = edgeKey(ei);

        if (!resumed.has(eiKey)) {
          this.#stackBottom.set(eiKey, this.#top());
          const childParent = this.#parentEdge.get(w);
          if (childParent && childParent[0] === v && childParent[1] === w) {
            cursor.set(v, i);
            stack.push(v, w);
            resumed.add(eiKey);
            descended = true;
            break;
          }
          // Back edge: it is its own lowest return edge.
          this.#lowptEdge.set(eiKey, ei);
          this.#stack.push(new ConflictPair(new Interval(), new Interval(ei, ei)));
        }

        if (this.#lowpt.get(eiKey)! < this.#height.get(v)!) {
          if (w === adj[0]) {
            // The first outgoing edge inherits the return edge directly.
            if (parent) {
              this.#lowptEdge.set(edgeKey(parent), this.#lowptEdge.get(eiKey)!);
            }
          } else if (parent && !this.#addConstraints(ei, parent)) {
            return false;
          }
        }

        i++;
        cursor.set(v, i);
      }

      if (!descended) {
        cursor.set(v, i);
        if (parent) {
          this.#removeBackEdges(parent);
        }
      }
    }
    return true;
  }

  #addConstraints(ei: PlanarEdge, parent: PlanarEdge): boolean {
    const pair = new ConflictPair();
    const eiKey = edgeKey(ei);
    const parentKey = edgeKey(parent);

    // Merge the return edges of e_i into the right interval.
    for (;;) {
      const q = this.#stack.pop();
      if (!q) {
        break;
      }
      if (!q.left.empty()) {
        q.swap();
      }
      if (!q.left.empty()) {
        return false; // two intervals that cannot be separated
      }
      if (
        q.right.low !== null &&
        this.#lowpt.get(edgeKey(q.right.low))! > this.#lowpt.get(parentKey)!
      ) {
        if (pair.right.empty()) {
          pair.right = q.right.copy();
        } else {
          this.#setRef(pair.right.low, q.right.high);
        }
        pair.right.low = q.right.low;
      } else {
        this.#setRef(q.right.low, this.#lowptEdge.get(parentKey) ?? null);
      }
      if (this.#top() === this.#stackBottom.get(eiKey)) {
        break;
      }
    }

    // Merge every conflicting return edge of e_1..e_(i-1) into the left interval.
    while (this.#conflicting(this.#top()?.left, ei) || this.#conflicting(this.#top()?.right, ei)) {
      const q = this.#stack.pop()!;
      if (this.#conflicting(q.right, ei)) {
        q.swap();
      }
      if (this.#conflicting(q.right, ei)) {
        return false;
      }
      this.#setRef(pair.right.low, q.right.high);
      if (q.right.low !== null) {
        pair.right.low = q.right.low;
      }
      if (pair.left.empty()) {
        pair.left = q.left.copy();
      } else {
        this.#setRef(pair.left.low, q.left.high);
      }
      pair.left.low = q.left.low;
    }

    if (!(pair.left.empty() && pair.right.empty())) {
      this.#stack.push(pair);
    }
    return true;
  }

  #removeBackEdges(parent: PlanarEdge): void {
    const u = parent[0];
    const parentKey = edgeKey(parent);
    const uHeight = this.#height.get(u)!;

    while (this.#stack.length > 0 && this.#lowest(this.#top()!) === uHeight) {
      const dropped = this.#stack.pop()!;
      if (dropped.left.low !== null) {
        this.#side.set(edgeKey(dropped.left.low), -1);
      }
    }

    const pair = this.#stack.pop();
    if (pair) {
      while (pair.left.high !== null && pair.left.high[1] === u) {
        pair.left.high = this.#ref.get(edgeKey(pair.left.high)) ?? null;
      }
      if (pair.left.high === null && pair.left.low !== null) {
        this.#setRef(pair.left.low, pair.right.low);
        this.#side.set(edgeKey(pair.left.low), -1);
        pair.left.low = null;
      }
      while (pair.right.high !== null && pair.right.high[1] === u) {
        pair.right.high = this.#ref.get(edgeKey(pair.right.high)) ?? null;
      }
      if (pair.right.high === null && pair.right.low !== null) {
        this.#setRef(pair.right.low, pair.left.low);
        this.#side.set(edgeKey(pair.right.low), -1);
        pair.right.low = null;
      }
      this.#stack.push(pair);
    }

    if (this.#lowpt.get(parentKey)! < uHeight) {
      const top = this.#top();
      const highLeft = top?.left.high ?? null;
      const highRight = top?.right.high ?? null;
      const leftWins =
        highLeft !== null &&
        (highRight === null ||
          this.#lowpt.get(edgeKey(highLeft))! > this.#lowpt.get(edgeKey(highRight))!);
      this.#ref.set(parentKey, leftWins ? highLeft : highRight);
    }
  }

  #setRef(from: PlanarEdge | null, to: PlanarEdge | null): void {
    // The reference formulation writes through a null slot here; dropping the
    // write is the same thing, since nothing ever reads it back.
    if (from === null) {
      return;
    }
    this.#ref.set(edgeKey(from), to);
  }

  #conflicting(interval: Interval | undefined, edge: PlanarEdge): boolean {
    if (!interval || interval.empty() || interval.high === null) {
      return false;
    }
    return this.#lowpt.get(edgeKey(interval.high))! > this.#lowpt.get(edgeKey(edge))!;
  }

  #lowest(pair: ConflictPair): number {
    if (pair.left.empty()) {
      return pair.right.low === null
        ? Number.POSITIVE_INFINITY
        : this.#lowpt.get(edgeKey(pair.right.low))!;
    }
    if (pair.right.empty()) {
      return pair.left.low === null
        ? Number.POSITIVE_INFINITY
        : this.#lowpt.get(edgeKey(pair.left.low))!;
    }
    return Math.min(
      this.#lowpt.get(edgeKey(pair.left.low!))!,
      this.#lowpt.get(edgeKey(pair.right.low!))!
    );
  }

  #top(): ConflictPair | null {
    return this.#stack.length === 0 ? null : this.#stack[this.#stack.length - 1];
  }
}

/**
 * Whether the simple undirected graph described by `adjacency` is planar.
 *
 * @param adjacency - Symmetric neighbour sets, as produced by `simpleAdjacency`.
 */
export function isPlanar(adjacency: Map<string, Set<string>>): boolean {
  if (adjacency.size === 0) {
    return true;
  }
  return new LeftRightPlanarity(adjacency).run();
}
