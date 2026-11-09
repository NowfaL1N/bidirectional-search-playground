/* Bidirectional heuristic search engine.
   No DOM access, so the same file runs in the page and in the Node test harness. */
(function (root) {
  'use strict';

  const FREE = 0, WALL = 1, MUD = 2;
  const MUD_COST = 5;
  const TOL = 1e-9;
  const EPS = 1; // cheapest possible edge on these grids
  const NONE = 0, OPEN = 1, CLOSED = 2, PRUNED = 3;

  /* ---------- random numbers and maps ---------- */

  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function carveMaze(cells, w, h, rand) {
    cells.fill(WALL);
    const stack = [[1, 1]];
    cells[w + 1] = FREE;
    const dirs = [[2, 0], [-2, 0], [0, 2], [0, -2]];
    while (stack.length) {
      const [x, y] = stack[stack.length - 1];
      const options = dirs.filter(([dx, dy]) => {
        const nx = x + dx, ny = y + dy;
        return nx > 0 && ny > 0 && nx < w - 1 && ny < h - 1 && cells[ny * w + nx] === WALL;
      });
      if (!options.length) { stack.pop(); continue; }
      const [dx, dy] = options[Math.floor(rand() * options.length)];
      cells[(y + dy / 2) * w + x + dx / 2] = FREE;
      cells[(y + dy) * w + x + dx] = FREE;
      stack.push([x + dx, y + dy]);
    }
    // Remove some dead ends so the maze has more than one route.
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      if ((x % 2) !== (y % 2) && cells[y * w + x] === WALL && rand() < 0.1) cells[y * w + x] = FREE;
    }
  }

  function buildRooms(cells, w, h, rand) {
    const rw = 10, rh = 8;
    for (let x = rw; x < w - 3; x += rw) for (let y = 0; y < h; y++) cells[y * w + x] = WALL;
    for (let y = rh; y < h - 3; y += rh) for (let x = 0; x < w; x++) cells[y * w + x] = WALL;
    for (let x = rw; x < w - 3; x += rw) for (let y0 = 0; y0 < h; y0 += rh) {
      const y = y0 + 1 + Math.floor(rand() * Math.min(rh - 1, h - y0 - 1));
      if (y < h) cells[y * w + x] = FREE;
    }
    for (let y = rh; y < h - 3; y += rh) for (let x0 = 0; x0 < w; x0 += rw) {
      const x = x0 + 1 + Math.floor(rand() * Math.min(rw - 1, w - x0 - 1));
      if (x < w) cells[y * w + x] = FREE;
    }
  }

  function buildTraps(cells, w, h, sx, gx, mid) {
    const r = Math.max(3, Math.floor(h * 0.3));
    const arm = Math.max(3, Math.floor(w * 0.12));
    const put = (x, y) => { if (x >= 0 && y >= 0 && x < w && y < h) cells[y * w + x] = WALL; };
    for (let y = mid - r; y <= mid + r; y++) { put(sx + 3, y); put(gx - 3, y); }
    for (let i = 0; i <= arm; i++) {
      put(sx + 3 - i, mid - r); put(sx + 3 - i, mid + r);
      put(gx - 3 + i, mid - r); put(gx - 3 + i, mid + r);
    }
  }

  function reachable(cells, w, h, a, b, passNoise) {
    const prev = new Int32Array(w * h).fill(-1);
    const queue = [a];
    prev[a] = a;
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q];
      if (i === b) return prev;
      const x = i % w, y = (i - x) / w;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (prev[j] >= 0) continue;
        if (cells[j] === WALL && !(passNoise && passNoise[j])) continue;
        prev[j] = i;
        queue.push(j);
      }
    }
    return null;
  }

  function makeMap(preset, w, h, seed, noisePct, mudPct) {
    w |= 1; h |= 1; // odd sizes keep maze corridors aligned
    const rand = rng(seed);
    const cells = new Uint8Array(w * h);
    let mid = (h - 1) >> 1;
    if (mid % 2 === 0) mid -= 1;
    let sx = 1, gx = w - 2;
    if (preset === 'maze') carveMaze(cells, w, h, rand);
    else if (preset === 'rooms') buildRooms(cells, w, h, rand);
    else if (preset === 'traps') {
      sx = Math.round(w * 0.24); gx = w - 1 - sx;
      buildTraps(cells, w, h, sx, gx, mid);
    }
    const start = mid * w + sx, goal = mid * w + gx;
    cells[start] = FREE; cells[goal] = FREE;

    const noise = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) {
      if (cells[i] === FREE && i !== start && i !== goal && rand() < noisePct / 100) { cells[i] = WALL; noise[i] = 1; }
    }
    // Reopen just enough random walls to keep the two ends connected.
    if (!reachable(cells, w, h, start, goal, null)) {
      const prev = reachable(cells, w, h, start, goal, noise);
      if (prev) for (let i = goal; i !== start; i = prev[i]) if (noise[i]) cells[i] = FREE;
    }
    if (mudPct > 0) {
      const p = [rand() * 6, rand() * 6, rand() * 6, rand() * 6];
      const field = [];
      const value = new Float64Array(w * h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const v = Math.sin(x * 0.19 + p[0]) + Math.sin(y * 0.23 + p[1]) +
          Math.sin((x + y) * 0.11 + p[2]) + Math.sin((x - y) * 0.31 + p[3]);
        value[y * w + x] = v;
        if (cells[y * w + x] === FREE) field.push(v);
      }
      field.sort((a, b) => b - a);
      const cut = field[Math.min(field.length - 1, Math.floor(field.length * mudPct / 100))];
      for (let i = 0; i < w * h; i++) if (cells[i] === FREE && value[i] > cut && i !== start && i !== goal) cells[i] = MUD;
    }
    return { w, h, cells, start, goal };
  }

  /* ---------- graph, heuristics ---------- */

  function buildGraph(map, diag) {
    const { w, h, cells } = map;
    const adj = new Array(w * h);
    const terrain = (i) => (cells[i] === MUD ? MUD_COST : 1);
    const open = (x, y) => x >= 0 && y >= 0 && x < w && y < h && cells[y * w + x] !== WALL;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x, list = [];
      adj[i] = list;
      if (cells[i] === WALL) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        if (!open(x + dx, y + dy)) continue;
        const j = (y + dy) * w + x + dx;
        list.push(j, (terrain(i) + terrain(j)) / 2);
      }
      if (!diag) continue;
      for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        if (!open(x + dx, y + dy) || !open(x + dx, y) || !open(x, y + dy)) continue;
        const j = (y + dy) * w + x + dx;
        list.push(j, Math.SQRT2 * (terrain(i) + terrain(j)) / 2);
      }
    }
    return adj;
  }

  // Binary-heap Dijkstra from one source; used for landmarks and ground truth.
  function dijkstra(adj, src) {
    const dist = new Float64Array(adj.length).fill(Infinity);
    dist[src] = 0;
    const hk = [0], hv = [src];
    const push = (k, v) => {
      let i = hk.length; hk.push(k); hv.push(v);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (hk[p] <= k) break;
        hk[i] = hk[p]; hv[i] = hv[p]; i = p;
      }
      hk[i] = k; hv[i] = v;
    };
    const pop = () => {
      const k = hk[0], v = hv[0], lk = hk.pop(), lv = hv.pop();
      const n = hk.length;
      if (n) {
        let i = 0;
        for (;;) {
          let c = 2 * i + 1;
          if (c >= n) break;
          if (c + 1 < n && hk[c + 1] < hk[c]) c++;
          if (hk[c] >= lk) break;
          hk[i] = hk[c]; hv[i] = hv[c]; i = c;
        }
        hk[i] = lk; hv[i] = lv;
      }
      return [k, v];
    };
    while (hk.length) {
      const [d, u] = pop();
      if (d > dist[u]) continue;
      const list = adj[u];
      for (let e = 0; e < list.length; e += 2) {
        const nd = d + list[e + 1];
        if (nd < dist[list[e]]) { dist[list[e]] = nd; push(nd, list[e]); }
      }
    }
    return dist;
  }

  function pickLandmarks(adj, cells, start, count) {
    const out = [];
    const best = new Float64Array(adj.length).fill(Infinity);
    let source = start;
    for (let k = 0; k <= count; k++) {
      const d = dijkstra(adj, source);
      if (k > 0) out.push(d);
      let far = -1, farV = -1;
      for (let i = 0; i < adj.length; i++) {
        if (cells[i] === WALL || d[i] === Infinity) continue;
        best[i] = k === 0 ? d[i] : Math.min(best[i], d[i]);
        if (best[i] > farV) { farV = best[i]; far = i; }
      }
      if (far < 0) break;
      source = far;
    }
    return out;
  }

  const FEATURE_NAMES = ['manhattan', 'euclid', 'chebyshev', 'octile', 'landmark'];

  function makeProblem(map, options) {
    const adj = buildGraph(map, options.diag);
    const w = map.w;
    const features = options.features.slice();
    const weight = options.weight;
    let landmarks = null;
    const lm = () => landmarks || (landmarks = pickLandmarks(adj, map.cells, map.start, 4));

    function feature(name, a, b) {
      if (name === 'landmark') {
        let best = 0;
        for (const d of lm()) {
          if (d[a] === Infinity || d[b] === Infinity) continue;
          const v = Math.abs(d[a] - d[b]);
          if (v > best) best = v;
        }
        return best;
      }
      const ax = a % w, ay = (a - ax) / w, bx = b % w, by = (b - bx) / w;
      const dx = Math.abs(ax - bx), dy = Math.abs(ay - by);
      switch (name) {
        case 'manhattan': return dx + dy;
        case 'euclid': return Math.sqrt(dx * dx + dy * dy);
        case 'chebyshev': return Math.max(dx, dy);
        case 'octile': return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
        default: return 0;
      }
    }
    function h(a, b) {
      let best = 0;
      for (let i = 0; i < features.length; i++) {
        const v = feature(features[i], a, b);
        if (v > best) best = v;
      }
      return best * weight;
    }
    return { map, adj, n: adj.length, start: map.start, goal: map.goal, diag: !!options.diag, features, weight, h, feature };
  }

  function exactCost(problem) {
    return dijkstra(problem.adj, problem.start)[problem.goal];
  }

  /* ---------- algorithm definitions ---------- */

  const ALGOS = {
    astar: { name: 'A*', bi: false, side: 'forward', tie: 'high', key: (s, side, n, g, h, f) => f,
      lb: (F) => F.fmin },
    bidijkstra: { name: 'Bi-Dijkstra', bi: true, side: 'key', tie: 'low', noH: true, key: (s, side, n, g) => g,
      lb: (F, B) => F.gmin + B.gmin + EPS },
    bhpa: { name: 'BHPA', bi: true, side: 'smaller', tie: 'high', key: (s, side, n, g, h, f) => f,
      lb: (F, B) => Math.max(F.fmin, B.fmin) },
    bs: { name: 'BS*', bi: true, side: 'smaller', tie: 'high', prune: true, key: (s, side, n, g, h, f) => f,
      lb: (F, B) => Math.max(F.fmin, B.fmin) },
    mm: { name: 'MM', bi: true, side: 'key', tie: 'low', key: (s, side, n, g, h, f) => Math.max(f, 2 * g),
      lb: (F, B) => Math.max(Math.min(F.kmin, B.kmin), F.fmin, B.fmin, F.gmin + B.gmin + EPS) },
    nbs: { name: 'NBS', bi: true, pair: true, side: 'pair', tie: 'low', key: (s, side, n, g, h, f) => f, lb: () => 0 },
    balanced: { name: 'Balanced Bi-A*', bi: true, balanced: true, side: 'smaller', tie: 'high',
      key: (s, side, n, g) => {
        const p = (s.h_(0, n) - s.h_(1, n)) / 2;
        return side === 0 ? g + p : g - p;
      },
      lb: (F, B) => F.kmin + B.kmin },
    f2f: { name: 'Front-to-Front', bi: true, f2f: true, side: 'smaller', tie: 'high', key: (s, side, n, g, h, f) => f,
      lb: (F, B) => Math.max(F.fmin, B.fmin) },
  };
  const ALGO_ORDER = ['mm', 'nbs', 'bs', 'bhpa', 'balanced', 'f2f', 'bidijkstra', 'astar'];

  /* ---------- the search itself ---------- */

  class Search {
    constructor(problem, algo, sideRule) {
      const n = problem.n;
      this.p = problem;
      this.algo = algo;
      this.a = ALGOS[algo];
      this.sideRule = sideRule || 'auto';
      const f64 = (v) => new Float64Array(n).fill(v);
      const i32 = () => new Int32Array(n).fill(-1);
      this.g = [f64(Infinity), f64(Infinity)];
      this.hc = [f64(-1), f64(-1)];
      this.st = [new Uint8Array(n), new Uint8Array(n)];
      this.par = [i32(), i32()];
      this.ord = [i32(), i32()];
      this.pos = [i32(), i32()];
      this.open = [[], []];
      this.U = Infinity;
      this.meet = -1;
      this.expanded = [0, 0];
      this.nipped = 0;
      this.lb = 0;
      this.clb = 0;
      this.pending = -1;
      this.done = false;
      this.status = 'running';
      this.lastSide = -1;
      this.lastNode = -1;
      this.hExp = []; this.hLb = []; this.hU = []; this.hOF = []; this.hOB = [];

      this.g[0][problem.start] = 0;
      this.g[1][problem.goal] = 0;
      this.pushOpen(0, problem.start);
      if (this.a.bi) this.pushOpen(1, problem.goal);
      this.record();
    }

    get stepCount() { return this.hExp.length - 1; }
    get totalExpanded() { return this.expanded[0] + this.expanded[1]; }

    pushOpen(side, n) {
      this.st[side][n] = OPEN;
      this.pos[side][n] = this.open[side].length;
      this.open[side].push(n);
    }

    dropOpen(side, n, state) {
      const list = this.open[side], i = this.pos[side][n], last = list.pop();
      if (last !== n) { list[i] = last; this.pos[side][last] = i; }
      this.pos[side][n] = -1;
      this.st[side][n] = state;
    }

    record() {
      this.hExp.push(this.totalExpanded);
      this.hLb.push(this.lb);
      this.hU.push(this.U);
      this.hOF.push(this.open[0].length);
      this.hOB.push(this.open[1].length);
    }

    h_(side, n) {
      let v = this.hc[side][n];
      if (v < 0) {
        if (this.a.noH) v = 0;
        else if (this.a.f2f) v = this.frontH(side, n);
        else v = this.p.h(n, side === 0 ? this.p.goal : this.p.start);
        this.hc[side][n] = v;
      }
      return v;
    }

    frontH(side, n) {
      const o = 1 - side, list = this.open[o], go = this.g[o];
      let best = Infinity;
      for (let i = 0; i < list.length; i++) {
        const m = list[i], v = go[m] + this.p.h(n, m);
        if (v < best) best = v;
      }
      return best;
    }

    scan(side) {
      const a = this.a, list = this.open[side], gs = this.g[side];
      let fmin = Infinity, gmin = Infinity, kmin = Infinity, node = -1, nodeG = 0;
      for (let i = 0; i < list.length; i++) {
        const n = list[i], g = gs[n], h = this.h_(side, n), f = g + h;
        if (f < fmin) fmin = f;
        if (g < gmin) gmin = g;
        const k = a.key(this, side, n, g, h, f);
        const tied = Math.abs(k - kmin) <= TOL;
        if ((!tied && k < kmin) || (tied && (a.tie === 'high' ? g > nodeG : g < nodeG))) {
          kmin = k; node = n; nodeG = g;
        }
      }
      return { fmin, gmin, kmin, node };
    }

    // Front-to-front estimates go stale. A stale value is still a valid lower
    // bound, so only the node about to be chosen is refreshed.
    refreshFront(side, info) {
      for (;;) {
        const n = info.node;
        if (n < 0) return info;
        const old = this.hc[side][n], fresh = this.frontH(side, n);
        this.hc[side][n] = fresh;
        if (fresh <= old + TOL) return this.scan(side);
        info = this.scan(side);
      }
    }

    chooseSide(F, B) {
      if (!this.a.bi) return 0;
      const rule = this.sideRule === 'auto' ? this.a.side : this.sideRule;
      if (rule === 'smaller') return this.open[0].length <= this.open[1].length ? 0 : 1;
      if (rule === 'alternate') return this.totalExpanded % 2;
      return F.kmin <= B.kmin ? 0 : 1;
    }

    pickPair() {
      const ready = [{}, {}];
      const st = this;
      function sweep(side) {
        const list = st.open[side], gs = st.g[side];
        let gBest = Infinity, node = -1, wait = Infinity;
        for (let i = 0; i < list.length; i++) {
          const n = list[i], f = gs[n] + st.h_(side, n);
          if (f <= st.clb + TOL) { if (gs[n] < gBest) { gBest = gs[n]; node = n; } }
          else if (f < wait) wait = f;
        }
        ready[side] = { gBest, node, wait };
      }
      for (;;) {
        sweep(0); sweep(1);
        const both = ready[0].node >= 0 && ready[1].node >= 0;
        const sum = both ? ready[0].gBest + ready[1].gBest + EPS : Infinity;
        if (both && sum <= this.clb + TOL) return [ready[0].node, ready[1].node];
        const next = Math.min(ready[0].wait, ready[1].wait, sum);
        if (next === Infinity) return null;
        this.clb = Math.max(this.clb, next);
      }
    }

    trim() {
      for (let side = 0; side < 2; side++) {
        const list = this.open[side];
        for (let i = list.length - 1; i >= 0; i--) {
          const n = list[i];
          if (this.g[side][n] + this.h_(side, n) >= this.U - TOL) this.dropOpen(side, n, PRUNED);
        }
      }
    }

    expand(side, n) {
      const a = this.a, gs = this.g[side], go = this.g[1 - side], st = this.st[side];
      this.dropOpen(side, n, CLOSED);
      this.ord[side][n] = this.totalExpanded;
      this.expanded[side]++;
      this.lastSide = side;
      this.lastNode = n;
      const list = this.p.adj[n];
      for (let e = 0; e < list.length; e += 2) {
        const v = list[e], ng = gs[n] + list[e + 1];
        if (ng >= gs[v] - TOL) continue;
        gs[v] = ng;
        this.par[side][v] = n;
        if (go[v] < Infinity && ng + go[v] < this.U - TOL) {
          this.U = ng + go[v];
          this.meet = v;
          if (a.prune) this.trim();
        }
        if (a.prune && ng + this.h_(side, v) >= this.U - TOL) {
          if (st[v] === OPEN) this.dropOpen(side, v, PRUNED); else st[v] = PRUNED;
          continue;
        }
        if (st[v] !== OPEN) this.pushOpen(side, v);
      }
    }

    finish() {
      this.done = true;
      this.status = this.U < Infinity ? 'found' : 'nopath';
      this.record();
      return false;
    }

    step() {
      if (this.done) return false;
      const a = this.a;

      if (this.pending >= 0) {
        const v = this.pending;
        this.pending = -1;
        if (this.st[1][v] === OPEN && this.U > this.clb + TOL) {
          this.expand(1, v);
          this.record();
          return true;
        }
      }

      for (;;) {
        if (!this.open[0].length || (a.bi && !this.open[1].length)) return this.finish();

        if (a.pair) {
          const pair = this.pickPair();
          this.lb = Math.max(this.lb, this.clb);
          if (!pair || this.U <= this.clb + TOL) return this.finish();
          this.expand(0, pair[0]);
          this.pending = pair[1];
          this.record();
          return true;
        }

        const F = this.scan(0), B = a.bi ? this.scan(1) : null;
        const side = this.chooseSide(F, B);
        let chosen = side === 0 ? F : B;
        if (a.f2f) chosen = this.refreshFront(side, chosen);
        const bound = a.f2f
          ? a.lb(side === 0 ? chosen : F, side === 1 ? chosen : B)
          : a.lb(F, B);
        this.lb = Math.max(this.lb, bound);
        if (this.U <= this.lb + TOL) return this.finish();

        const n = chosen.node;
        if (a.prune && this.st[1 - side][n] === CLOSED) {
          // Nipping: the other direction has already settled this node.
          this.dropOpen(side, n, CLOSED);
          this.nipped++;
          continue;
        }
        this.expand(side, n);
        this.record();
        return true;
      }
    }

    run() { while (this.step()); return this; }

    path() {
      if (this.meet < 0) return [];
      const out = [];
      for (let v = this.meet; v !== -1; v = this.par[0][v]) out.push(v);
      out.reverse();
      for (let v = this.par[1][this.meet]; v !== -1; v = this.par[1][v]) out.push(v);
      return out;
    }

    pathCost() {
      const path = this.path(), adj = this.p.adj;
      let cost = 0;
      for (let i = 1; i < path.length; i++) {
        const list = adj[path[i - 1]];
        let found = Infinity;
        for (let e = 0; e < list.length; e += 2) if (list[e] === path[i]) found = list[e + 1];
        cost += found;
      }
      return cost;
    }
  }

  const api = { FREE, WALL, MUD, MUD_COST, NONE, OPEN, CLOSED, PRUNED, EPS, ALGOS, ALGO_ORDER, FEATURE_NAMES,
    makeMap, makeProblem, exactCost, Search };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BiHS = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
