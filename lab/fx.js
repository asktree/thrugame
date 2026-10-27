/*
 * GREAT WORK! — playmat effects overlay (RENDER ONLY).
 *
 * This file paints on top of the simulation. It reads S.events (which the engine
 * emits for the renderer's benefit and which no digest, metric or fault depends on)
 * and the per-frame renderState; it never writes to either. Nothing here can change
 * cycles, area, cost or a verdict — pull the whole file out and the machine runs the
 * same, it just runs plainer.
 *
 * Glyph firings are the "Light + Material" treatment: every glyph writes its operation in
 * signs of light, on a 'top' pass the host draws after the arms (draw('top', ...)); bonding,
 * unbonding and calcification also play their Material animation (weld bead, crack, frost),
 * and colour changes are painted across the atom body by atomBody() rather than crossfaded.
 * Until a host draws a 'top' pass the signs fall back into the 'over' pass.
 *
 * Effect lifetimes are expressed in ticks and multiplied by the page's stepMs, so an
 * effect reads the same at 0.25x as at 1x. At MAX (batched stepping) the host passes
 * enabled:false and nothing is enqueued at all — MAX exists to reach the stamp fast.
 */
(function (root) {
  'use strict';

  const TAU = Math.PI * 2;
  const PITCH = Math.sqrt(3);
  const ATOM_R = 0.35 * PITCH;                 // board units — the sim's own collision radius
  const COL = {
    brass: [160, 118, 43], gold: [138, 106, 30], ox: [140, 59, 46],
    verd: [51, 112, 94], ink: [42, 35, 24], flare: [255, 244, 214], hot: [255, 186, 84],
  };
  const rgba = (c, a) => 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
  const eOut = (t) => 1 - (1 - t) * (1 - t);
  const eIn = (t) => t * t;
  const smooth = (t) => t * t * (3 - 2 * t);
  const eBack = (t) => { const c = 1.70158, u = t - 1; return 1 + (c + 1) * u * u * u + c * u * u; };
  // triangular attack/decay — the shape of a glyph firing: quick to light, slow to fade
  const tri = (t) => (t < 0.18 ? t / 0.18 : 1 - (t - 0.18) / 0.82);
  // RENDER-PHASE easing. The host applies this to the f it hands renderState and to
  // nothing else: the simulation samples its own kinematics at k/12 and never sees f.
  // Mostly smoothstep, so each tick settles like a mechanism, with linear mixed back in
  // so a long sweep doesn't feel rubbery.
  const phaseEase = (t) => { const u = clamp01(t); return 0.78 * smooth(u) + 0.22 * u; };

  const hexCache = new Map();
  function toRGB(hex) {
    let v = hexCache.get(hex);
    if (v) return v;
    const h = String(hex).replace('#', '');
    v = h.length === 3
      ? [parseInt(h[0] + h[0], 16), parseInt(h[1] + h[1], 16), parseInt(h[2] + h[2], 16)]
      : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    if (v.some(isNaN)) v = [153, 153, 153];
    hexCache.set(hex, v);
    return v;
  }
  function mixHex(a, b, t) {
    const A = toRGB(a), B = toRGB(b), u = clamp01(t);
    return 'rgb(' + Math.round(A[0] + (B[0] - A[0]) * u) + ','
      + Math.round(A[1] + (B[1] - A[1]) * u) + ','
      + Math.round(A[2] + (B[2] - A[2]) * u) + ')';
  }

  // ---------- the glyph-firing kit: "Light + Material" ----------
  // Every glyph writes its operation in signs of light (the Sigil · Light study), drawn on
  // the topmost layer. Bonding, unbonding and calcification also play their Material
  // animation underneath: a weld bead laid along the new bond, the old one cracking and its
  // stubs springing back, a frost front closing over the atom. The other colour changes
  // come in from the side the operation arrived from. The page timings are in seconds at
  // 1x (one tick = 0.28 s); each effect plays them back scaled to its own lifetime.
  const SEC = 0.28;                                    // seconds per tick in the studies
  const sstep = (a, b, x) => smooth(clamp01((x - a) / (b - a)));
  const ease3 = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const lerp = (a, b, t) => a + (b - a) * t;
  const vadd = (a, b) => [a[0] + b[0], a[1] + b[1]], vsub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const vmul = (a, k) => [a[0] * k, a[1] * k], vmid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const vlerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const vdir = (a, b) => { const x = b[0] - a[0], y = b[1] - a[1], l = Math.hypot(x, y) || 1; return [x / l, y / l]; };
  const vrot = (v, a) => [v[0] * Math.cos(a) - v[1] * Math.sin(a), v[0] * Math.sin(a) + v[1] * Math.cos(a)];
  const perp = (d) => [d[1], -d[0]];
  const rnd = (i) => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
  // a colour that is cooling: white heat → straw → cherry → the ink of a bond
  const HEAT = [[255, 252, 236], [255, 222, 130], [240, 140, 52], [160, 62, 30], [42, 35, 24]];
  function heatRGB(v) {
    v = clamp01(v) * (HEAT.length - 1);
    const i = Math.min(HEAT.length - 2, Math.floor(v)), f = v - i;
    return HEAT[i].map((c, k) => Math.round(c + (HEAT[i + 1][k] - c) * f));
  }
  const hot = (v, a) => rgba(heatRGB(v), a === undefined ? 1 : a);
  const METALS = ['Pb', 'Sn', 'Fe', 'Cu', 'Ag', 'Au'];
  const arcPts = (cx, cy, r, a0, a1, n) => { const o = []; for (let i = 0; i <= n; i++) { const a = a0 + (a1 - a0) * i / n; o.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]); } return o; };
  const quadPts = (a, b, c, n) => { const o = []; for (let i = 0; i <= n; i++) { const u = i / n, w = 1 - u; o.push([w * w * a[0] + 2 * w * u * c[0] + u * u * b[0], w * w * a[1] + 2 * w * u * c[1] + u * u * b[1]]); } return o; };
  // the signs, in unit coordinates (y down), each a list of strokes in writing order
  const SIG = {
    fire: [[[0, -0.82], [0.74, 0.5], [-0.74, 0.5], [0, -0.82]]],
    water: [[[0, 0.82], [0.74, -0.5], [-0.74, -0.5], [0, 0.82]]],
    air: [[[0, -0.82], [0.74, 0.5], [-0.74, 0.5], [0, -0.82]], [[-0.62, 0.02], [0.62, 0.02]]],
    earth: [[[0, 0.82], [0.74, -0.5], [-0.74, -0.5], [0, 0.82]], [[-0.62, -0.02], [0.62, -0.02]]],
    salt: [arcPts(0, 0, 0.72, -Math.PI / 2, Math.PI * 1.5, 28), [[-0.72, 0], [0.72, 0]]],
    mercury: [arcPts(0, -0.86, 0.3, 0, Math.PI, 10), arcPts(0, -0.2, 0.32, -Math.PI / 2, Math.PI * 1.5, 18), [[0, 0.12], [0, 0.88]], [[-0.28, 0.56], [0.28, 0.56]]],
    lead: [[[-0.5, -0.52], [0.12, -0.52]], [[-0.2, -0.86], [-0.2, 0.3]], [[-0.2, 0.0], [0.08, -0.18], [0.36, -0.08], [0.44, 0.2], [0.26, 0.52], [0.2, 0.74], [0.4, 0.86]]],
    tin: [[[-0.56, -0.44], [-0.4, -0.7], [-0.1, -0.74], [0.06, -0.52], [-0.06, -0.22], [-0.56, 0.32], [0.62, 0.32]], [[0.3, -0.62], [0.3, 0.86]]],
    iron: [arcPts(-0.15, 0.2, 0.48, -Math.PI / 4, Math.PI * 1.75, 22), [[0.19, -0.14], [0.66, -0.62]], [[0.26, -0.62], [0.66, -0.62], [0.66, -0.22]]],
    copper: [arcPts(0, -0.32, 0.4, Math.PI / 2, Math.PI * 2.5, 22), [[0, 0.08], [0, 0.88]], [[-0.3, 0.5], [0.3, 0.5]]],
    silver: [arcPts(0.3, 0, 0.78, Math.PI * 0.62, Math.PI * 1.38, 16).concat(arcPts(-0.42, 0, 0.62, Math.PI * 1.3, Math.PI * 0.7, 16))],
    gold: [arcPts(0, 0, 0.7, -Math.PI / 2, Math.PI * 1.5, 26), [[-0.05, 0], [0.05, 0]]],
    vitae: [arcPts(0, 0, 0.42, -Math.PI / 2, Math.PI * 1.5, 22), [[0, -0.6], [0, -0.9]], [[0.6, 0], [0.9, 0]], [[0, 0.6], [0, 0.9]], [[-0.6, 0], [-0.9, 0]], [[0, -0.02], [0, 0.02]]],
    mors: [arcPts(0, 0, 0.62, -Math.PI / 2, Math.PI * 1.5, 26), [[-0.44, -0.44], [0.44, 0.44]], [[0.44, -0.44], [-0.44, 0.44]]],
    cross: [[[-0.6, -0.6], [0.6, 0.6]], [[0.6, -0.6], [-0.6, 0.6]]],
  };
  const cardSig = (el) => ({ Fi: 'fire', Wa: 'water', Ai: 'air', Ea: 'earth' })[el] || 'fire';
  const metalSig = (el) => ({ Pb: 'lead', Sn: 'tin', Fe: 'iron', Cu: 'copper', Ag: 'silver', Au: 'gold' })[el] || 'lead';
  const sig = (name, p, sz) => SIG[name].map(st => st.map(q => [p[0] + q[0] * sz, p[1] + q[1] * sz]));
  // a soft round light, drawn once per colour and only ever blitted
  const glowCache = new Map();
  function glowSprite(col) {
    const k = col.join(',');
    let cv = glowCache.get(k);
    if (cv || typeof document === 'undefined') return cv || null;
    cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, rgba(COL.hot, 0.95)); gr.addColorStop(0.35, rgba(col, 0.6)); gr.addColorStop(1, rgba(col, 0));
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    glowCache.set(k, cv);
    return cv;
  }
  function glow(c, p, r, a, col) {
    if (a <= 0.01 || r <= 0) return;
    const sp = glowSprite(col || COL.brass);
    if (!sp) return;
    const ga = c.globalAlpha; c.globalAlpha = ga * Math.min(1, a);
    c.drawImage(sp, p[0] - r, p[1] - r, 2 * r, 2 * r);
    c.globalAlpha = ga;
  }
  // write the first `frac` of a set of strokes as a line of light: a warm bloom, a gold
  // body, a white thread; a bright nib leads while it is still being written. k scales the
  // studies' pixel widths (drawn at 28 px per board unit) to the board's current scale.
  function lightPen(c, strokes, frac, alpha, opt, k) {
    if (alpha <= 0.01 || frac <= 0) return;
    opt = opt || {};
    let total = 0;
    for (const s of strokes) for (let i = 1; i < s.length; i++) total += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
    let left = total * Math.min(1, frac), head = null, hd = [1, 0];
    c.beginPath();
    for (const s of strokes) {
      if (left <= 0) break;
      c.moveTo(s[0][0], s[0][1]); head = s[0];
      for (let i = 1; i < s.length && left > 0; i++) {
        const L = Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
        const f = Math.min(1, left / (L || 1)), q = [lerp(s[i - 1][0], s[i][0], f), lerp(s[i - 1][1], s[i][1], f)];
        c.lineTo(q[0], q[1]); left -= L; head = q;
        if (L) hd = [(s[i][0] - s[i - 1][0]) / L, (s[i][1] - s[i - 1][1]) / L];
      }
    }
    if (opt.arrow && frac >= 0.999 && head) {
      const n = perp(hd), ak = opt.arrow * k;
      c.moveTo(head[0] - hd[0] * ak + n[0] * ak * 0.7, head[1] - hd[1] * ak + n[1] * ak * 0.7); c.lineTo(head[0], head[1]);
      c.lineTo(head[0] - hd[0] * ak - n[0] * ak * 0.7, head[1] - hd[1] * ak - n[1] * ak * 0.7);
    }
    const w = (opt.w || 1) * k, a = Math.pow(alpha, 0.7);
    c.save(); c.lineCap = 'round'; c.lineJoin = 'round'; c.globalAlpha = a;
    c.strokeStyle = 'rgba(214,150,48,0.27)'; c.lineWidth = 7 * w; c.stroke();
    c.strokeStyle = 'rgba(255,206,120,0.66)'; c.lineWidth = 3.2 * w; c.stroke();
    c.strokeStyle = 'rgba(255,251,240,1)'; c.lineWidth = 1.35 * w; c.stroke();
    c.restore();
    if (frac < 1 && head) {
      glow(c, head, 8 * w, Math.min(1, 1.15 * a), [255, 200, 110]);
      c.save(); c.globalAlpha = a; c.beginPath(); c.arc(head[0], head[1], 1.5 * w, 0, TAU); c.fillStyle = '#FFFDF4'; c.fill(); c.restore();
    }
  }

  // which pass each effect draws in: 'under' sits beneath the atoms, 'over' above them and
  // beneath the arms, 'top' above everything (the host calls it after the arms)
  const LAYER = {
    inpulse: 'under', stub: 'under', weld: 'over', crack: 'over', glint: 'over',
    ghost: 'over', product: 'over', sigil: 'top',
  };
  // lifetimes, in ticks. The glyph effects are the studies' durations at 1x.
  const LIFE = {
    ghost: 1.1, grow: 0.85, tint: 1.1, product: 1.7, inpulse: 0.85,
    weld: 0.7 / SEC, crack: 0.42 / SEC, glint: 0.6 / SEC, frost: 0.3 / SEC,
  };
  // how long each glyph's signs stay up, in seconds at 1x (the studies' fade-out ends)
  const SIGIL_T = { bond: 0.625, debond: 0.675, calcify: 0.7, duplicate: 0.7, project: 0.725, purify: 0.725, animismus: 0.775, dispose: 0.65 };
  // where the signs share a glyph with a Material animation they are drawn a touch lighter
  const SIGIL_SOFT = { bond: 0.72, debond: 0.72, calcify: 0.55 };
  const CAP = 80;               // hard ceiling on live effects; oldest is dropped first
  const LAG = 0.85;             // events fire at the END of a tick — hold them until the
                                // motion they belong to has finished playing

  /*
   * env: { ctx, s(), P(x,y), Pc(cell), hex(x,y,r), fill(elem) }
   *   s()   current pixels-per-board-unit
   *   P     board pixel -> canvas pixel
   *   Pc    lattice cell (may be fractional) -> canvas pixel
   *   hex   lay down a hex path of radius r at x,y
   *   fill  element symbol -> its body colour
   */
  function createFX(env) {
    const list = [];
    const prev = new Map();     // atomId -> {elem, x, y} as last drawn (board coords)
    const tint = new Map();     // atomId -> {from, born, dur}
    const grow = new Map();     // atomId -> {born, dur, style}
    const doom = new Map();     // atomId -> {style, to, born}  — how an atom is about to die
    const birth = new Map();    // atomId -> {style, born}      — how one is about to appear
    const grips = new Map();    // armId:grip -> smoothed claw closure, 0..1
    const sweep = new Map();    // atomId -> {style:'frost'|'wipe', from, born, dur, T, ...}: a colour
                                // change painted across the atom body instead of a crossfade
    let pend = null;            // the sweep atom() found for the body atomBody() paints next
    let topSeen = false;        // the host draws a 'top' pass; until it does, signs go in 'over'
    let evIdx = 0, enabled = true, motion = true, stepMs = 140, seeded = false, fault = null;

    // the clock: wall time on the page; a recording hands in its own, so effects
    // play out in the recording's time rather than in the encoder's
    const now = env.now || (() => performance.now());
    const dur = (ticks) => { const d = ticks * stepMs; return d < 110 ? 110 : d > 900 ? 900 : d; };
    function push(fx) {
      if (list.length >= CAP) list.shift();
      list.push(fx);
    }

    // ---------- lifecycle ----------
    function reset(st) {
      list.length = 0;
      prev.clear(); tint.clear(); grow.clear(); doom.clear(); birth.clear(); grips.clear(); sweep.clear(); pend = null;
      evIdx = st ? st.events.length : 0;
      seeded = false; fault = null;
    }

    function prune() {
      const t = now();
      let w = 0;
      for (let i = 0; i < list.length; i++) if (t - list[i].born < list[i].dur) list[w++] = list[i];
      list.length = w;
      // per-atom eases normally retire the next time that atom is painted; an atom that
      // was consumed mid-ease never gets painted again, so sweep them here too
      for (const [id, e] of tint) if (t - e.born > e.dur) tint.delete(id);
      for (const [id, e] of grow) if (t - e.born > e.dur) grow.delete(id);
      const stale = 8 * stepMs + 2000;
      for (const [id, d] of doom) if (t - d.born > stale) doom.delete(id);
      for (const [id, b] of birth) if (t - b.born > stale) birth.delete(id);
      for (const [id, e] of sweep) if (t - e.born > e.dur) sweep.delete(id);
    }

    // ---------- event harvesting ----------
    // opts: {stepMs, enabled, motion}. The index always advances, even while disabled,
    // so switching off MAX mid-run doesn't dump a backlog of stale effects on screen.
    function harvest(st, opts) {
      stepMs = opts.stepMs || stepMs;
      enabled = !!opts.enabled;
      motion = opts.motion !== false;
      const t0 = now(), at = t0 + stepMs * LAG;
      for (; evIdx < st.events.length; evIdx++) {
        const e = st.events[evIdx];
        if (!enabled) continue;
        const cells = e.cells || [];
        switch (e.fx || e.type) {
          case 'spawn':
            push({ kind: 'inpulse', born: at, dur: dur(LIFE.inpulse), cells: cells });
            break;
          case 'bond':
            sigil('bond', e, cells, at);
            push({ kind: 'weld', born: at, dur: dur(LIFE.weld), T: 0.7, ids: [e.a, e.b], cells: cells });
            break;
          case 'debond':
            sigil('debond', e, cells, at);
            push({ kind: 'stub', born: at, dur: dur(LIFE.crack), T: 0.42, ids: [e.a, e.b], cells: cells });
            push({ kind: 'crack', born: at, dur: dur(LIFE.crack), T: 0.42, ids: [e.a, e.b], cells: cells });
            break;
          case 'calcify':
            sigil('calcify', e, cells, at);
            sweepOn(e.a, { style: 'frost', T: 0.3, delay: 0, len: 0.3 }, at);
            push({ kind: 'glint', born: at, dur: dur(LIFE.glint), T: 0.6, ids: [e.a], cells: cells });
            break;
          case 'duplicate':
            sigil('duplicate', e, cells, at);
            sweepOn(e.b, { style: 'wipe', T: 0.35, delay: 0.21, len: 0.14, src: cells[0], dst: cells[1] }, at);
            break;
          case 'project':
            sigil('project', e, cells, at);
            sweepOn(e.a, { style: 'wipe', T: 0.4, delay: 0.22, len: 0.18, src: cells[1], dst: cells[0] }, at);
            doom.set(e.b, { style: 'sink', to: cells[0], born: t0 });
            break;
          case 'purify':
            sigil('purify', e, cells, at);
            doom.set(e.a, { style: 'converge', to: cells[2], born: t0 });
            doom.set(e.b, { style: 'converge', to: cells[2], born: t0 });
            if (e.out != null) birth.set(e.out, { style: 'ring', born: t0 });
            break;
          case 'animismus': {
            sigil('animismus', e, cells, at);
            const mid = cells.length >= 4
              ? [(cells[2][0] + cells[3][0]) / 2, (cells[2][1] + cells[3][1]) / 2] : cells[0];
            doom.set(e.a, { style: 'converge', to: mid, born: t0 });
            doom.set(e.b, { style: 'converge', to: mid, born: t0 });
            if (e.vi != null) birth.set(e.vi, { style: 'ring', born: t0 });
            if (e.mo != null) birth.set(e.mo, { style: 'ring', born: t0 });
            break;
          }
          case 'dispose':
            sigil('dispose', e, cells, at);
            doom.set(e.a, { style: 'spiral', to: cells[0], born: t0 });
            break;
          case 'product': {
            push({ kind: 'product', born: at, dur: dur(LIFE.product), cells: cells });
            let cx = 0, cy = 0;
            for (const c of cells) { cx += c[0]; cy += c[1]; }
            const mid = cells.length ? [cx / cells.length, cy / cells.length] : null;
            for (const id of (e.ids || [])) doom.set(id, { style: 'dissolve', to: mid, born: t0 });
            break;
          }
          default: break;
        }
      }
      if (st.fault && !fault) armFault(st);
    }

    // the signs of light every glyph writes when it fires (painted in the 'top' pass)
    function sigil(glyph, e, cells, at) {
      if (!cells || !cells.length) return;
      const p = prev.get(e.a);
      push({
        kind: 'sigil', glyph: glyph, born: at, dur: dur(SIGIL_T[glyph] / SEC), T: SIGIL_T[glyph], cells: cells,
        a: e.a, b: e.b, out: e.out, vi: e.vi, mo: e.mo, elem: e.elem, from: p ? p.elem : null,
      });
    }
    // a colour change painted across the body: frost closing in, or a front crossing it from
    // the side the operation came from. Its old colour is the one last drawn for that atom.
    function sweepOn(id, rec, at) {
      const p = prev.get(id);
      if (id == null || !p) return;
      rec.from = env.fill(p.elem); rec.born = at; rec.dur = dur(rec.T / SEC);
      sweep.set(id, rec);
    }

    // The fault's detail string is the engine's, verbatim: "atom 7 × base a0 @ f=5/12",
    // "molecule 3", "tower a1", "atom cap". We only read it — the renderer never authors
    // a verdict — and widen it to everything a player would call the offender: the whole
    // molecule and the arms holding it, a tower and its carriers, the reagent that
    // overfilled the board, the output that never got its product.
    function armFault(st) {
      const det = String(st.fault.detail || '');
      const objs = [], seen = new Set();
      const mark = (kind, id) => { const k = kind + ':' + id; if (!seen.has(k)) { seen.add(k); objs.push({ kind: kind, id: id }); } };
      const atomById = (id) => st.atoms.find(a => String(a.id) === String(id));
      const armById = (id) => st.arms.find(a => String(a.id) === String(id));
      const holdersOf = (ids) => {
        for (const arm of st.arms) for (const h of arm.holds) if (h && h.kind === 'atom' && ids.has(String(h.id))) mark('base', arm.id);
      };
      const re = /(atom|base|molecule|tower)\s+([A-Za-z0-9_.:-]+)/g;
      let m;
      while ((m = re.exec(det))) {
        if (m[2] === 'cap') continue;
        if (m[1] === 'molecule') {
          const root = atomById(m[2]);
          const ids = new Set(), stack = root ? [root] : [];
          if (root) ids.add(String(root.id));
          while (stack.length) {
            const a = stack.pop();
            for (const id of a.bonds) { const b = atomById(id); if (b && !ids.has(String(b.id))) { ids.add(String(b.id)); stack.push(b); } }
          }
          for (const id of ids) mark('atom', id);
          if (!ids.size) mark('atom', m[2]);
          holdersOf(ids);
        } else if (m[1] === 'tower') {
          mark('base', m[2]);
          const t = armById(m[2]);
          if (t) for (const c of t.carriers || []) mark('base', c.arm && c.arm.id !== undefined ? c.arm.id : c.arm);
        } else mark(m[1], m[2]);
      }
      if (st.fault.kind === 'exhaustion') {
        if (/atom cap/.test(det)) {
          for (const e of st.events) if (e.type === 'spawn' && e.tick === st.fault.tick) for (const id of e.ids || []) mark('atom', id);
        } else if (st.puzzle && st.puzzle.output) {
          for (const cell of st.puzzle.output.cells || []) objs.push({ kind: 'cell', cell: cell });
        }
      }
      const fm = det.match(/f=(\d+)\/(\d+)/);
      fault = { objs: objs, born: now(), f: fm ? +fm[1] / +fm[2] : null };
    }
    // where the animation should be frozen so a jam reads as a jam: the exact sweep
    // instant the collision was found at. null = play the tick out normally.
    const freezeF = () => (fault && fault.f !== null ? fault.f : null);

    // ---------- per-frame atom bookkeeping ----------
    // Called with the frame's renderState atoms (board coords). Element changes become
    // colour eases, first sightings become materialisations, disappearances become
    // ghosts styled by whatever the event log said was about to kill them.
    function noteAtoms(atoms) {
      const t = now();
      const seen = new Set();
      for (const a of atoms) {
        seen.add(a.id);
        const p = prev.get(a.id);
        if (!p) {
          if (seeded && enabled) {
            const b = birth.get(a.id);
            grow.set(a.id, { born: t, dur: dur(LIFE.grow), style: (b && b.style) || 'pop' });
          }
          birth.delete(a.id);
          prev.set(a.id, { elem: a.elem, x: a.x, y: a.y });
          continue;
        }
        if (p.elem !== a.elem) {
          // a sweep paints this change itself; otherwise ease the colour across
          if (enabled && !sweep.has(a.id)) tint.set(a.id, { from: env.fill(p.elem), born: t, dur: dur(LIFE.tint) });
          p.elem = a.elem;
        }
        p.x = a.x; p.y = a.y;
      }
      for (const [id, p] of prev) {
        if (seen.has(id)) continue;
        if (enabled) {
          const d = doom.get(id);
          push({
            kind: 'ghost', born: t, dur: dur(LIFE.ghost),
            style: (d && d.style) || 'fade', to: (d && d.to) || null,
            x: p.x, y: p.y, elem: p.elem,
          });
        }
        prev.delete(id); doom.delete(id);
      }
      seeded = true;
    }

    // How this atom should be painted right now: mid-ease colour, materialisation scale.
    function atom(id, elem) {
      const base = env.fill(elem);
      let fill = base, scale = 1, alpha = 1;
      const t = now();
      const ti = tint.get(id);
      if (ti) {
        const u = (t - ti.born) / ti.dur;
        if (u >= 1) tint.delete(id);
        else if (u > 0) fill = mixHex(ti.from, base, eOut(u));
      }
      const sw = sweep.get(id);
      pend = null;
      if (sw) {
        const u = (t - sw.born) / sw.dur;
        if (u >= 1) sweep.delete(id);
        else { pend = { rec: sw, u: Math.max(0, u) }; fill = base; }
      }
      const g = grow.get(id);
      if (g) {
        const u = (t - g.born) / g.dur;
        if (u >= 1) grow.delete(id);
        else if (u > 0) {
          scale = g.style === 'ring' ? 0.15 + 0.85 * eOut(u) : 0.28 + 0.72 * eBack(u);
          alpha = clamp01(u * 2.4);
        }
      }
      return { fill: fill, scale: scale, alpha: alpha };
    }

    // ---------- shared painting ----------
    // The atom body, used by both pages so a lead ball looks like a lead ball everywhere.
    function bodyAt(c, x, y, r, fill) {
      c.beginPath(); c.arc(x + r * 0.10, y + r * 0.15, r, 0, TAU);
      c.fillStyle = 'rgba(42,35,24,0.15)'; c.fill();
      c.beginPath(); c.arc(x, y, r, 0, TAU);
      c.fillStyle = fill; c.fill();
      // rim light from the upper left, as if off a lamp on the bench
      const g1 = c.createRadialGradient(x - r * 0.34, y - r * 0.40, r * 0.05, x - r * 0.10, y - r * 0.08, r * 1.15);
      g1.addColorStop(0, 'rgba(255,255,255,0.44)');
      g1.addColorStop(0.42, 'rgba(255,255,255,0.10)');
      g1.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g1; c.fill();
      const g2 = c.createRadialGradient(x + r * 0.44, y + r * 0.50, r * 0.05, x, y, r * 1.05);
      g2.addColorStop(0, 'rgba(42,35,24,0.20)');
      g2.addColorStop(1, 'rgba(42,35,24,0)');
      c.fillStyle = g2; c.fill();
      c.lineWidth = 1.5; c.strokeStyle = '#2A2318'; c.stroke();
    }
    // Paints the body last asked about through atom(): if that atom is mid-sweep, the old
    // colour is painted where the new one hasn't reached yet.
    function atomBody(x, y, r, fill, alpha) {
      const c = env.ctx, p = pend;
      pend = null;
      c.save();
      if (alpha !== undefined && alpha < 1) c.globalAlpha = alpha;
      bodyAt(c, x, y, r, fill);
      if (p) paintSweep(c, x, y, r, p.rec, p.u * p.rec.T);
      c.restore();
    }
    // tt: seconds into the sweep at 1x
    function paintSweep(c, x, y, r, rec, tt) {
      if (rec.style === 'frost') {
        // frost closes in from the rim: behind the front it is salt, ahead of it still the cardinal
        const rr = r * 1.02 * (1 - ease3(clamp01(tt / rec.len)));
        if (rr < 0.5) return;
        c.save(); c.beginPath(); c.arc(x, y, rr, 0, TAU); c.clip(); bodyAt(c, x, y, r, rec.from); c.restore();
        const s = env.s(), needles = () => {
          c.beginPath();
          for (let i = 0; i < 16; i++) {
            const an = i * TAU / 16 + rnd(i) * 0.3, len = s * (0.05 + 0.09 * rnd(i + 5)) * Math.min(1, rr / (r * 0.4));
            const co = Math.cos(an), sn = Math.sin(an), r0 = rr + s * 0.03, r1 = Math.max(0, rr - len);
            c.moveTo(x + co * r0, y + sn * r0); c.lineTo(x + co * r1, y + sn * r1);
            if (i % 2 === 0) { const bm = (r0 + r1) / 2, ba = an + 0.35; c.moveTo(x + co * bm, y + sn * bm); c.lineTo(x + Math.cos(ba) * (bm - len * 0.4), y + Math.sin(ba) * (bm - len * 0.4)); }
          }
        };
        const k = s / 28;
        c.lineCap = 'round';
        needles(); c.strokeStyle = 'rgba(70,110,140,0.55)'; c.lineWidth = 2.2 * k; c.stroke();
        needles(); c.strokeStyle = 'rgba(244,251,255,0.95)'; c.lineWidth = 1 * k; c.stroke();
        c.beginPath(); c.arc(x, y, rr, 0, TAU); c.strokeStyle = 'rgba(225,242,252,0.8)'; c.lineWidth = 1.2 * k; c.stroke();
        return;
      }
      // wipe: the old colour stays ahead of a straight front crossing from the source's side,
      // led by a hairline of light
      const v = clamp01((tt - rec.delay) / rec.len);
      if (v >= 1) return;
      const a = env.Pc(rec.src), b = env.Pc(rec.dst), d = vdir(a, b), n = perp(d);
      const sp = -r * 1.02 + 2.04 * r * ease3(v), o = [x + d[0] * sp, y + d[1] * sp], B = r * 3;
      c.save();
      c.beginPath(); c.arc(x, y, r, 0, TAU); c.clip();
      c.beginPath();
      c.moveTo(o[0] + n[0] * B, o[1] + n[1] * B); c.lineTo(o[0] - n[0] * B, o[1] - n[1] * B);
      c.lineTo(o[0] - n[0] * B + d[0] * B, o[1] - n[1] * B + d[1] * B); c.lineTo(o[0] + n[0] * B + d[0] * B, o[1] + n[1] * B + d[1] * B);
      c.closePath(); c.clip();
      bodyAt(c, x, y, r, rec.from);
      c.restore();
      if (v > 0) {
        const k = env.s() / 28;
        c.save(); c.beginPath(); c.arc(x, y, r, 0, TAU); c.clip();
        c.beginPath(); c.moveTo(o[0] + n[0] * r, o[1] + n[1] * r); c.lineTo(o[0] - n[0] * r, o[1] - n[1] * r);
        c.strokeStyle = 'rgba(255,206,120,0.6)'; c.lineWidth = 3 * k; c.stroke();
        c.strokeStyle = 'rgba(255,252,240,0.95)'; c.lineWidth = 1 * k; c.stroke();
        c.restore();
      }
    }

    // a whisper of a vignette so the mat reads as a surface, not a flat fill
    function mat(w, h) {
      const c = env.ctx;
      const g = c.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.max(w, h) * 0.72);
      g.addColorStop(0, 'rgba(42,35,24,0)');
      g.addColorStop(1, 'rgba(42,35,24,0.085)');
      c.save(); c.fillStyle = g; c.fillRect(0, 0, w, h); c.restore();
    }

    // claw closure, smoothed: shuts fast like a mechanism, opens a touch slower
    function grip(key, target, dt) {
      if (!motion || stepMs === 0) { grips.set(key, target); return target; }
      let v = grips.get(key);
      if (v === undefined) { grips.set(key, target); return target; }
      const span = Math.max(40, stepMs * (target > v ? 0.22 : 0.34));
      const k = clamp01(dt / span);
      v += (target - v) * k;
      if (Math.abs(target - v) < 0.004) v = target;
      grips.set(key, v);
      return v;
    }

    // ---------- effect painting ----------
    // atomPx / armPx: id -> [x,y] in canvas pixels for this frame, so an effect anchored
    // to an atom follows it while it is carried. layer: 'under' (before the atoms), 'over'
    // (after the atoms, before the arms), 'top' (after the arms: the glyph signs).
    function draw(layer, atomPx, armPx) {
      const c = env.ctx, t = now(), s = env.s();
      pend = null;
      c.save();
      c.lineCap = 'round';
      if (layer === 'top') topSeen = true;
      for (let i = 0; i < list.length; i++) {
        const fx = list[i];
        const L = LAYER[fx.kind];
        if (L !== layer && !(L === 'top' && layer === 'over' && !topSeen)) continue;
        const u = (t - fx.born) / fx.dur;
        if (u < 0 || u >= 1) continue;
        paint(c, s, fx, u, atomPx);
      }
      if (fault && layer === 'over') paintFault(c, s, t, atomPx, armPx);
      c.restore();
    }

    const at = (fx, i, atomPx) => {
      if (fx.ids && atomPx && atomPx[fx.ids[i]]) return atomPx[fx.ids[i]];
      return env.Pc(fx.cells[i]);
    };
    function paint(c, s, fx, u, atomPx) {
      switch (fx.kind) {
        case 'inpulse': {
          const a = clamp01(tri(u));
          for (const cell of fx.cells) {
            const p = env.Pc(cell);
            c.beginPath(); c.arc(p[0], p[1], s * (0.62 + 0.14 * eOut(u)), 0, TAU);
            c.strokeStyle = rgba(COL.ink, 0.45 * a); c.lineWidth = 1 + 1.6 * a;
            c.setLineDash([3, 3]); c.stroke(); c.setLineDash([]);
          }
          break;
        }
        case 'sigil': paintSigil(c, s, fx, u * fx.T, atomPx); break;
        case 'weld': {
          // a weld bead run from both atoms at once, meeting in the middle, cooling through
          // straw and cherry into the ink of the bond, with sparks thrown off sideways
          const t = u * fx.T, a = at(fx, 0, atomPx), b = at(fx, 1, atomPx), R = s * ATOM_R, k = s / 28;
          const d = vdir(a, b), n = perp(d), m = vmid(a, b);
          const ea = vadd(a, vmul(d, R * 0.86)), eb = vsub(b, vmul(d, R * 0.86));
          const run = clamp01(t / 0.11), cl = clamp01((t - 0.1) / 0.5);
          if (cl < 1) {
            const h1 = vlerp(ea, m, eOut(run)), h2 = vlerp(eb, m, eOut(run)), al = 1 - sstep(0.7, 1, cl);
            c.beginPath(); c.moveTo(ea[0], ea[1]); c.lineTo(h1[0], h1[1]); c.moveTo(eb[0], eb[1]); c.lineTo(h2[0], h2[1]);
            c.strokeStyle = hot(0.15 + 0.85 * cl, al); c.lineWidth = s * (0.27 - 0.07 * cl); c.stroke();
            c.strokeStyle = hot(Math.max(0, cl * 1.1 - 0.1), al * 0.95); c.lineWidth = s * 0.1; c.stroke();
            if (cl > 0.05 && cl < 0.8) {
              c.beginPath();
              for (let i = -2; i <= 2; i++) { const q = vadd(m, vmul(d, i * s * 0.1)); c.moveTo(q[0] + n[0] * s * 0.1, q[1] + n[1] * s * 0.1); c.lineTo(q[0] - n[0] * s * 0.1 + d[0] * 2 * k, q[1] - n[1] * s * 0.1 + d[1] * 2 * k); }
              c.strokeStyle = hot(cl + 0.15, 0.6 * (1 - cl)); c.lineWidth = k; c.stroke();
            }
            if (run < 1) { glow(c, h1, s * 0.32, 0.9); glow(c, h2, s * 0.32, 0.9); }
          }
          const sp = clamp01((t - 0.09) / 0.32);
          if (sp > 0 && sp < 1) {
            c.beginPath();
            for (let i = 0; i < 9; i++) {
              const side = i % 2 ? 1 : -1, v = vrot(vmul(n, side), (rnd(i) - 0.5) * 1.3);
              const r1 = s * (0.25 + 0.75 * rnd(i + 7)) * eOut(sp), r0 = Math.max(0, r1 - s * 0.16 * (1 - sp));
              c.moveTo(m[0] + v[0] * r0, m[1] + v[1] * r0 + s * 0.3 * sp * sp); c.lineTo(m[0] + v[0] * r1, m[1] + v[1] * r1 + s * 0.3 * sp * sp);
            }
            c.strokeStyle = rgba([255, 214, 130], 1 - sp); c.lineWidth = 1.2 * k; c.stroke();
          }
          break;
        }
        case 'stub': {
          // the cut bond's two halves spring back into their atoms (beneath the atom bodies)
          const t = u * fx.T, a = at(fx, 0, atomPx), b = at(fx, 1, atomPx), R = s * ATOM_R;
          const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, snap = 0.06, sv = clamp01((t - snap) / 0.3);
          const f = t < snap ? 0.5 : lerp(0.47, (R * 0.85) / L, eOut(sv));
          const ta = vlerp(a, b, f), tb = vlerp(b, a, f);
          c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(ta[0], ta[1]); c.moveTo(b[0], b[1]); c.lineTo(tb[0], tb[1]);
          c.strokeStyle = '#2A2318'; c.lineWidth = s * 0.2; c.stroke();
          if (t < snap) {
            c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]);
            c.strokeStyle = hot(0.3, t / snap); c.lineWidth = s * 0.08; c.stroke();
          } else {
            c.fillStyle = hot(0.2 + 0.8 * sv, 1 - sv);
            c.beginPath(); c.arc(ta[0], ta[1], s * 0.09, 0, TAU); c.fill();
            c.beginPath(); c.arc(tb[0], tb[1], s * 0.09, 0, TAU); c.fill();
          }
          break;
        }
        case 'crack': {
          // a bright jagged fracture straight across where the bond was, and chips flying off it
          const t = u * fx.T, snap = 0.06;
          if (t < snap) break;
          const a = at(fx, 0, atomPx), b = at(fx, 1, atomPx), k = s / 28;
          const d = vdir(a, b), n = perp(d), m = vmid(a, b), sv = clamp01((t - snap) / 0.3), q = 1 - sv;
          if (sv >= 1) break;
          const pts = [];
          for (let i = 0; i <= 6; i++) { const w = (i / 6 - 0.5) * s * 0.78 * (0.6 + 0.4 * eOut(sv)), j = (i % 2 ? 1 : -1) * s * 0.07; pts.push(vadd(m, vadd(vmul(n, w), vmul(d, j)))); }
          const path = () => { c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1]))); };
          c.lineJoin = 'miter'; c.lineCap = 'butt';
          path(); c.strokeStyle = rgba(COL.ox, 0.85 * q); c.lineWidth = 3.2 * k; c.stroke();
          path(); c.strokeStyle = hot(0.15 * sv, q); c.lineWidth = 1.4 * k; c.stroke();
          c.lineCap = 'round'; c.beginPath();
          for (let i = 0; i < 6; i++) {
            const side = i % 2 ? 1 : -1, v = vrot(vmul(n, side), (rnd(i + 3) - 0.5) * 0.9), r = s * (0.4 + 0.5 * rnd(i)) * eOut(sv);
            const p = vadd(m, vmul(v, r)); c.moveTo(p[0], p[1]); c.lineTo(p[0] + v[0] * 2.5 * k, p[1] + v[1] * 2.5 * k);
          }
          c.strokeStyle = rgba([60, 30, 20], 0.9 * q); c.lineWidth = 1.6 * k; c.stroke();
          break;
        }
        case 'glint': {
          // glints left on the new salt crystal as the frost front passes them
          const t = u * fx.T, p = at(fx, 0, atomPx), R = s * ATOM_R, k = s / 28;
          c.lineCap = 'round';
          for (let i = 0; i < 3; i++) {
            const rr = R * (0.45 + 0.45 * rnd(i + 20)), an = rnd(i + 30) * TAU;
            const tp = 1 - rr / (R * 1.02), born = 0.3 * (tp < 0 ? 0 : Math.acos(1 - 2 * Math.min(1, tp)) / Math.PI);
            const v = clamp01((t - born) / 0.28);
            if (v <= 0 || v >= 1) continue;
            const q = [p[0] + Math.cos(an) * rr, p[1] + Math.sin(an) * rr], z = s * 0.1 * Math.sin(Math.PI * v);
            const star = () => { c.beginPath(); c.moveTo(q[0] - z, q[1]); c.lineTo(q[0] + z, q[1]); c.moveTo(q[0], q[1] - z); c.lineTo(q[0], q[1] + z); };
            star(); c.strokeStyle = 'rgba(110,150,180,0.5)'; c.lineWidth = 2.2 * k; c.stroke();
            star(); c.strokeStyle = '#FFFFFF'; c.lineWidth = k; c.stroke();
          }
          break;
        }
        case 'ghost': {
          const p0 = env.P(fx.x, fx.y);
          const tgt = fx.to ? env.Pc(fx.to) : null;
          let x = p0[0], y = p0[1], r = s * ATOM_R, a = 1 - u;
          if (fx.style === 'sink' && tgt) {
            const k = eIn(u);
            x += (tgt[0] - x) * k; y += (tgt[1] - y) * k;
            r *= 1 - 0.85 * eOut(u); a = 1 - eIn(u);
          } else if (fx.style === 'converge' && tgt) {
            const k = smooth(u);
            x += (tgt[0] - x) * k; y += (tgt[1] - y) * k;
            r *= 1 - 0.55 * u; a = 1 - eIn(u);
          } else if (fx.style === 'spiral') {
            const th = u * 3.2, rad = s * 0.42 * (1 - u);
            x += Math.cos(th) * rad; y += Math.sin(th) * rad;
            r *= 1 - 0.9 * eIn(u); a = 1 - eIn(u);
          } else if (fx.style === 'dissolve') {
            let dx = 0, dy = -1;
            if (tgt) { dx = p0[0] - tgt[0]; dy = p0[1] - tgt[1]; }
            const nl = Math.hypot(dx, dy) || 1;
            x += (dx / nl) * s * 0.5 * eOut(u); y += (dy / nl) * s * 0.5 * eOut(u);
            r *= 1 + 0.3 * u; a = (1 - u) * 0.9;
          } else {
            r *= 1 - 0.25 * u;
          }
          if (r > 0.5 && a > 0.01) {
            c.save();
            c.globalAlpha = clamp01(a);
            c.beginPath(); c.arc(x, y, r, 0, TAU);
            c.fillStyle = env.fill(fx.elem); c.fill();
            c.strokeStyle = rgba(fx.style === 'dissolve' ? COL.gold : COL.ink, 0.7);
            c.lineWidth = 1.3; c.stroke();
            c.restore();
          }
          break;
        }
        case 'product': {
          // the assay: a gold wash runs over the molecule and lifts off the mat
          const a = (1 - u) * (1 - u);
          let cx = 0, cy = 0;
          for (const cell of fx.cells) { const p = env.Pc(cell); cx += p[0]; cy += p[1]; }
          cx /= fx.cells.length || 1; cy /= fx.cells.length || 1;
          for (const cell of fx.cells) {
            const p = env.Pc(cell);
            c.beginPath(); c.arc(p[0], p[1], s * (ATOM_R + 0.55 * eOut(u)), 0, TAU);
            c.strokeStyle = rgba(COL.gold, 0.65 * a); c.lineWidth = s * 0.07 * (1 - u);
            c.stroke();
          }
          const R = s * (0.9 + 1.5 * eOut(u));
          const rg = c.createRadialGradient(cx, cy, R * 0.55, cx, cy, R);
          rg.addColorStop(0, rgba(COL.gold, 0));
          rg.addColorStop(0.7, rgba(COL.gold, 0.20 * a));
          rg.addColorStop(1, rgba(COL.gold, 0));
          c.beginPath(); c.arc(cx, cy, R, 0, TAU); c.fillStyle = rg; c.fill();
          for (let i = 0; i < 5; i++) {
            const th = (i / 5) * TAU + u * 0.7;
            const rr = s * (0.5 + 1.5 * eOut(u));
            c.beginPath();
            c.arc(cx + Math.cos(th) * rr, cy + Math.sin(th) * rr, s * 0.05 * (1 - u), 0, TAU);
            c.fillStyle = rgba(COL.flare, 0.9 * a); c.fill();
          }
          break;
        }
        default: break;
      }
    }

    // The signs each glyph writes, in light (the Sigil · Light study). t: seconds at 1x.
    // Positions follow the atoms that survive the firing; consumed ones stay on their cells.
    function paintSigil(c, s, fx, t, atomPx) {
      const k = s / 28, R = s * ATOM_R, soft = SIGIL_SOFT[fx.glyph] || 1;
      const pc = (i) => env.Pc(fx.cells[i]);
      const ap = (id, i) => (id != null && atomPx && atomPx[id]) || pc(i);
      const pen = (st, fr, al, opt) => lightPen(c, st, fr, al * soft, opt, k);
      const fade = (a, b) => 1 - clamp01((t - a) / b);
      switch (fx.glyph) {
        case 'bond': {
          // two pens leave the atoms and write the bond itself, meeting at a small lozenge
          const a = ap(fx.a, 0), b = ap(fx.b, 1), d = vdir(a, b), n = perp(d), m = vmid(a, b);
          const w = clamp01(t / 0.13), f = fade(0.375, 0.25), z = clamp01((t - 0.12) / 0.08), q = s * 0.13;
          pen([[vadd(a, vmul(d, R * 0.88)), m], [vsub(b, vmul(d, R * 0.88)), m]], w, f, { w: 1.15 });
          pen([[vadd(m, vmul(n, q)), vadd(m, vmul(d, q)), vsub(m, vmul(n, q)), vsub(m, vmul(d, q)), vadd(m, vmul(n, q))]], z, f, { w: 0.8 });
          break;
        }
        case 'debond': {
          // a stroke cuts across the bond, and ")(" marks the parting
          const a = ap(fx.a, 0), b = ap(fx.b, 1), d = vdir(a, b), n = perp(d), m = vmid(a, b), f = fade(0.45, 0.225);
          const off = vadd(vmul(n, s * 0.42), vmul(d, -s * 0.12));
          pen([[vadd(m, off), vsub(m, off)]], clamp01(t / 0.1), f);
          for (const sg of [-1, 1]) {
            const base = vadd(m, vmul(d, sg * s * 0.16));
            pen([quadPts(vadd(base, vmul(n, s * 0.3)), vsub(base, vmul(n, s * 0.3)), vadd(base, vmul(d, -sg * s * 0.14)), 10)], clamp01((t - 0.12) / 0.14), f, { w: 0.85 });
          }
          break;
        }
        case 'calcify': {
          // the salt sign — a circle closed round the atom, then struck through — over the frost
          const p = ap(fx.a, 0), f = fade(0.525, 0.175);
          pen([arcPts(p[0], p[1], R + 2.6 * k, -Math.PI / 2, Math.PI * 1.5, 40)], clamp01((t - 0.1) / 0.22), f);
          pen([[[p[0] - R - 2.6 * k, p[1]], [p[0] + R + 2.6 * k, p[1]]]], clamp01((t - 0.31) / 0.07), f);
          break;
        }
        case 'duplicate': {
          // the cardinal's sign read off the source, carried straight down the channel, and
          // written into the salt
          const p0 = ap(fx.a, 0), p1 = ap(fx.b, 1), d = vdir(p0, p1), f = fade(0.525, 0.175), sg = cardSig(fx.elem);
          pen(sig(sg, p0, R * 0.48), clamp01(t / 0.1), f);
          pen([[vadd(p0, vmul(d, R * 0.58)), vsub(p1, vmul(d, R + 3 * k))]], clamp01((t - 0.06) / 0.16), f, { arrow: 4.5, w: 1.1 });
          pen(sig(sg, p1, R * 0.48), clamp01((t - 0.24) / 0.12), f);
          break;
        }
        case 'project': {
          // mercury's sign on the quicksilver, an arrow down the channel, the next metal's sign
          const pm = ap(fx.a, 0), pq = pc(1), d = vdir(pq, pm), f = fade(0.55, 0.175), dis = clamp01((t - 0.08) / 0.16);
          pen(sig('mercury', pq, R * 0.52), clamp01(t / 0.1), 1 - dis);
          pen([[vadd(pq, vmul(d, R * 0.1)), vsub(pm, vmul(d, R + 3 * k))]], dis, f, { arrow: 4.5, w: 1.1 });
          pen(sig(metalSig(fx.elem), pm, R * 0.5), clamp01((t - 0.26) / 0.12), f);
          break;
        }
        case 'purify': {
          // the two metals' sign on each, two arrows converging, the next metal's sign on the output
          const po = ap(fx.out, 2), f = fade(0.55, 0.175), dis = clamp01((t - 0.08) / 0.16);
          const from = METALS[Math.max(0, METALS.indexOf(fx.elem) - 1)];
          for (const i of [0, 1]) {
            const p = pc(i), dd = vdir(p, po);
            pen(sig(metalSig(from), p, R * 0.5), clamp01(t / 0.1), 1 - dis);
            pen([[vadd(p, vmul(dd, R * 0.1)), vsub(po, vmul(dd, R + 3 * k))]], dis, f, { arrow: 4.5, w: 1.1 });
          }
          pen(sig(metalSig(fx.elem), po, R * 0.5), clamp01((t - 0.26) / 0.12), f);
          break;
        }
        case 'animismus': {
          // two salt signs, strokes meeting at a knot, two arrows out to vitae and mors
          const p0 = pc(0), p1 = pc(1), pv = ap(fx.vi, 2), pm = ap(fx.mo, 3), m = vmid(p0, p1), f = fade(0.6, 0.175);
          const dis = clamp01((t - 0.08) / 0.14), strokes = [];
          for (const p of [p0, p1]) {
            pen(sig('salt', p, R * 0.45), clamp01(t / 0.1), 1 - dis);
            const dd = vdir(p, m); strokes.push([vadd(p, vmul(dd, R * 0.6)), vsub(m, vmul(dd, s * 0.2))]);
          }
          pen(strokes, dis, f);
          pen([arcPts(m[0], m[1], s * 0.18, -Math.PI / 2, Math.PI * 1.5, 16)], clamp01((t - 0.16) / 0.08), f);
          const out = clamp01((t - 0.22) / 0.12);
          for (const p of [pv, pm]) { const dd = vdir(m, p); pen([[vadd(m, vmul(dd, s * 0.2)), vsub(p, vmul(dd, R + 4 * k))]], out, f, { arrow: 4 }); }
          const s2 = clamp01((t - 0.32) / 0.12);
          pen(sig('vitae', pv, R * 0.5), s2, f); pen(sig('mors', pm, R * 0.5), s2, f);
          break;
        }
        case 'dispose': {
          // struck out, then the pen spirals down into the drain
          const p = pc(0), sp = clamp01((t - 0.1) / 0.26), f = fade(0.45, 0.2);
          pen(sig('cross', p, R * 0.55 * (1 - 0.75 * eIn(sp))), clamp01(t / 0.12), 1 - eIn(sp));
          const spiral = [];
          for (let i = 0; i <= 50; i++) { const v = i / 50, a = -Math.PI / 2 + v * TAU * 1.6, r = s * 0.74 * (1 - v * 0.92); spiral.push([p[0] + Math.cos(a) * r, p[1] + Math.sin(a) * r]); }
          pen([spiral], sp, f, { arrow: sp >= 1 ? 3.5 : 0 });
          break;
        }
        default: break;
      }
    }

    function paintFault(c, s, t, atomPx, armPx) {
      const age = t - fault.born;
      for (const o of fault.objs) {
        let p = null;
        if (o.kind === 'atom' || o.kind === 'molecule') p = atomPx && atomPx[o.id];
        else if (o.kind === 'cell') p = env.Pc(o.cell);
        else p = armPx && armPx[o.id];
        if (!p) continue;
        // a red square on the offender: throbs like a warning lamp, then settles into
        // a standing mark on the jam
        const damp = Math.max(0, 1 - age / 3000);
        const beat = motion ? 0.5 + 0.5 * Math.sin(age / 150) * damp : 1;
        const h = s * (ATOM_R + 0.2 + (motion ? 0.05 * beat : 0));
        c.beginPath(); c.rect(p[0] - h, p[1] - h, 2 * h, 2 * h);
        c.strokeStyle = rgba(COL.ox, 0.55 + 0.4 * beat); c.lineWidth = s * 0.1;
        c.lineJoin = 'miter';
        c.stroke();
        if (motion && age < 700) {
          const u = age / 700, hh = s * (ATOM_R + 1.5 * eOut(u));
          c.beginPath(); c.rect(p[0] - hh, p[1] - hh, 2 * hh, 2 * hh);
          c.strokeStyle = rgba(COL.ox, 0.7 * (1 - u)); c.lineWidth = s * 0.1 * (1 - u);
          c.stroke();
        }
      }
    }

    function debug() {
      return {
        effects: list.length, cap: CAP, sweep: sweep.size, top: topSeen, tint: tint.size, grow: grow.size,
        doom: doom.size, birth: birth.size, prev: prev.size, grips: grips.size,
        evIdx: evIdx, fault: fault ? fault.objs.length : 0, faultObjs: fault ? fault.objs.slice() : [], enabled: enabled,
        live: list.map(f => ({ k: f.kind, age: Math.round(now() - f.born), dur: Math.round(f.dur) })),
      };
    }

    return {
      reset: reset, prune: prune, harvest: harvest, noteAtoms: noteAtoms,
      atom: atom, atomBody: atomBody, mat: mat, grip: grip, draw: draw,
      freezeF: freezeF, debug: debug,
    };
  }

  const GWFX = { create: createFX, phaseEase: phaseEase, COL: COL, rgba: rgba, mixHex: mixHex };
  if (typeof module !== 'undefined' && module.exports) module.exports = GWFX;
  else root.GWFX = GWFX;
})(typeof self !== 'undefined' ? self : this);
