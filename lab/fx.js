/*
 * GREAT WORK! — playmat effects overlay (RENDER ONLY).
 *
 * This file paints on top of the simulation. It reads S.events (which the engine
 * emits for the renderer's benefit and which no digest, metric or fault depends on)
 * and the per-frame renderState; it never writes to either. Nothing here can change
 * cycles, area, cost or a verdict — pull the whole file out and the machine runs the
 * same, it just runs plainer.
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
    verd: [51, 112, 94], ink: [42, 35, 24], flare: [255, 244, 214],
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

  // which pass each effect draws in: 'under' sits beneath the atoms, 'over' above them
  const LAYER = {
    pulse: 'under', ring: 'under', inpulse: 'under',
    bond: 'over', debond: 'over', travel: 'over', ghost: 'over', product: 'over',
  };
  // lifetimes, in ticks
  const LIFE = {
    pulse: 0.95, bond: 1.15, debond: 0.95, ring: 1.25, travel: 0.9,
    ghost: 1.1, grow: 0.85, tint: 1.1, product: 1.7, inpulse: 0.85,
  };
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
    let evIdx = 0, enabled = true, motion = true, stepMs = 140, seeded = false, fault = null;

    const now = () => performance.now();
    const dur = (ticks) => { const d = ticks * stepMs; return d < 110 ? 110 : d > 900 ? 900 : d; };
    function push(fx) {
      if (list.length >= CAP) list.shift();
      list.push(fx);
    }

    // ---------- lifecycle ----------
    function reset(st) {
      list.length = 0;
      prev.clear(); tint.clear(); grow.clear(); doom.clear(); birth.clear(); grips.clear();
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
            glyphPulse(cells, COL.brass, at);
            push({ kind: 'bond', born: at, dur: dur(LIFE.bond), ids: [e.a, e.b], cells: cells });
            break;
          case 'debond':
            glyphPulse(cells, COL.ox, at);
            push({ kind: 'debond', born: at, dur: dur(LIFE.debond), ids: [e.a, e.b], cells: cells });
            break;
          case 'calcify':
            glyphPulse(cells, COL.brass, at);
            push({ kind: 'ring', mode: 'out', born: at, dur: dur(LIFE.ring), cell: cells[0], id: e.a, col: COL.brass });
            break;
          case 'duplicate':
            glyphPulse(cells, COL.brass, at);
            push({ kind: 'travel', born: at, dur: dur(LIFE.travel), from: cells[0], to: cells[1], hue: env.fill(e.elem) });
            break;
          case 'project':
            glyphPulse(cells, COL.brass, at);
            doom.set(e.b, { style: 'sink', to: cells[0], born: t0 });
            break;
          case 'purify':
            glyphPulse(cells, COL.brass, at);
            doom.set(e.a, { style: 'converge', to: cells[2], born: t0 });
            doom.set(e.b, { style: 'converge', to: cells[2], born: t0 });
            push({ kind: 'ring', mode: 'in', born: at, dur: dur(LIFE.ring), cell: cells[2], col: COL.brass });
            if (e.out != null) birth.set(e.out, { style: 'ring', born: t0 });
            break;
          case 'animismus': {
            glyphPulse(cells, COL.brass, at);
            const mid = cells.length >= 4
              ? [(cells[2][0] + cells[3][0]) / 2, (cells[2][1] + cells[3][1]) / 2] : cells[0];
            doom.set(e.a, { style: 'converge', to: mid, born: t0 });
            doom.set(e.b, { style: 'converge', to: mid, born: t0 });
            if (cells[2]) push({ kind: 'ring', mode: 'in', born: at, dur: dur(LIFE.ring), cell: cells[2], col: COL.verd });
            if (cells[3]) push({ kind: 'ring', mode: 'in', born: at, dur: dur(LIFE.ring), cell: cells[3], col: COL.ink });
            if (e.vi != null) birth.set(e.vi, { style: 'ring', born: t0 });
            if (e.mo != null) birth.set(e.mo, { style: 'ring', born: t0 });
            break;
          }
          case 'dispose':
            glyphPulse(cells, COL.ox, at);
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

    function glyphPulse(cells, col, at) {
      if (!cells || !cells.length) return;
      push({ kind: 'pulse', born: at, dur: dur(LIFE.pulse), cells: cells, col: col });
    }

    // The fault's detail string is the engine's, verbatim: "atom 7 × base a0 @ f=5/12",
    // "molecule 3", "tower a1". We only read it — the renderer never authors a verdict.
    function armFault(st) {
      const det = String(st.fault.detail || '');
      const objs = [];
      const re = /(atom|base|molecule|tower)\s+([A-Za-z0-9_.:-]+)/g;
      let m;
      while ((m = re.exec(det))) {
        if (m[2] === 'cap') continue;
        objs.push({ kind: m[1], id: m[2] });
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
          if (enabled) tint.set(a.id, { from: env.fill(p.elem), born: t, dur: dur(LIFE.tint) });
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
    function atomBody(x, y, r, fill, alpha) {
      const c = env.ctx;
      c.save();
      if (alpha !== undefined && alpha < 1) c.globalAlpha = alpha;
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
      c.restore();
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
    // to an atom follows it while it is carried.
    function draw(layer, atomPx, armPx) {
      const c = env.ctx, t = now(), s = env.s();
      c.save();
      c.lineCap = 'round';
      for (let i = 0; i < list.length; i++) {
        const fx = list[i];
        if (LAYER[fx.kind] !== layer) continue;
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
    // The bond's visible stretch is only the gap between the two atom bodies — everything
    // past `edge` is hidden under a ball. Bond and debond both work in this frame:
    // u = 0 is the midpoint, u = ±1 is an atom centre, u = ±edge is where it disappears.
    function span(p1, p2, s) {
      const dx = (p2[0] - p1[0]) / 2, dy = (p2[1] - p1[1]) / 2;
      const d = Math.hypot(dx, dy) || 1, r = s * ATOM_R;
      const edge = Math.max(0.12, Math.min(0.95, (d - r * 0.92) / d));
      return { mx: p1[0] + dx, my: p1[1] + dy, dx: dx, dy: dy, d: d, edge: edge };
    }

    function paint(c, s, fx, u, atomPx) {
      switch (fx.kind) {
        case 'pulse': {
          const a = clamp01(tri(u));
          for (const cell of fx.cells) {
            const p = env.Pc(cell);
            env.hex(p[0], p[1], s * PITCH / 2 * (1.08 + 0.05 * eOut(u)));
            c.fillStyle = rgba(fx.col, 0.26 * a); c.fill();
            c.strokeStyle = rgba(fx.col, 0.75 * a); c.lineWidth = 1.1 + 1.4 * a; c.stroke();
          }
          break;
        }
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
        case 'ring': {
          const p = (fx.id != null && atomPx && atomPx[fx.id]) ? atomPx[fx.id] : env.Pc(fx.cell);
          let r, a;
          if (fx.mode === 'in') { r = s * (0.35 + 1.35 * (1 - eOut(u))); a = 0.30 + 0.55 * u; }
          else { r = s * (ATOM_R + 1.05 * eOut(u)); a = 0.85 * (1 - u) * (1 - u); }
          c.beginPath(); c.arc(p[0], p[1], r, 0, TAU);
          c.strokeStyle = rgba(fx.col, clamp01(a)); c.lineWidth = s * 0.085 * (fx.mode === 'in' ? 0.5 + u : 1 - u * 0.7);
          c.stroke();
          break;
        }
        case 'bond': {
          const p1 = at(fx, 0, atomPx), p2 = at(fx, 1, atomPx);
          const sp = span(p1, p2, s), mx = sp.mx, my = sp.my;
          const g = sp.edge * eOut(clamp01(u * 2.1)), a = 1 - eIn(u);
          // the weld runs out from the middle to both atom rims, then settles
          c.beginPath();
          c.moveTo(mx - sp.dx * g, my - sp.dy * g);
          c.lineTo(mx + sp.dx * g, my + sp.dy * g);
          c.strokeStyle = rgba(COL.flare, 0.9 * a); c.lineWidth = s * 0.26 * (1 - 0.35 * u);
          c.stroke();
          const r = s * (0.16 + 0.42 * eOut(u));
          const rg = c.createRadialGradient(mx, my, 0, mx, my, r);
          rg.addColorStop(0, rgba(COL.flare, 0.85 * a));
          rg.addColorStop(0.5, rgba(COL.brass, 0.35 * a));
          rg.addColorStop(1, rgba(COL.brass, 0));
          c.beginPath(); c.arc(mx, my, r, 0, TAU); c.fillStyle = rg; c.fill();
          break;
        }
        case 'debond': {
          const p1 = at(fx, 0, atomPx), p2 = at(fx, 1, atomPx);
          const sp = span(p1, p2, s), mx = sp.mx, my = sp.my;
          const a = (1 - u) * (1 - u), k = eOut(u);
          // the two stumps snap back under their atoms...
          for (const sgn of [-1, 1]) {
            const u1 = sp.edge * k, u2 = sp.edge;
            c.beginPath();
            c.moveTo(mx + sp.dx * sgn * u1, my + sp.dy * sgn * u1);
            c.lineTo(mx + sp.dx * sgn * u2, my + sp.dy * sgn * u2);
            c.strokeStyle = rgba(COL.ink, 0.8 * a); c.lineWidth = s * 0.19 * (1 - 0.35 * u);
            c.stroke();
          }
          // ...and the break throws a few splinters across the gap
          const nx = -sp.dy / sp.d, ny = sp.dx / sp.d;
          for (let i = 0; i < 4; i++) {
            const sgn = i % 2 ? 1 : -1, spread = (i < 2 ? 0.5 : 1);
            const ex = mx + nx * sgn * s * 0.55 * k * spread;
            const ey = my + ny * sgn * s * 0.55 * k * spread;
            c.beginPath(); c.moveTo(mx, my); c.lineTo(ex, ey);
            c.strokeStyle = rgba(COL.ox, 0.85 * a); c.lineWidth = s * 0.075 * (1 - u);
            c.stroke();
          }
          // the flash of the parting itself
          const fr = s * (0.10 + 0.26 * k);
          const rg = c.createRadialGradient(mx, my, 0, mx, my, fr);
          rg.addColorStop(0, rgba(COL.flare, 0.75 * a));
          rg.addColorStop(0.55, rgba(COL.ox, 0.35 * a));
          rg.addColorStop(1, rgba(COL.ox, 0));
          c.beginPath(); c.arc(mx, my, fr, 0, TAU); c.fillStyle = rg; c.fill();
          break;
        }
        case 'travel': {
          const p1 = env.Pc(fx.from), p2 = env.Pc(fx.to);
          const k = smooth(u);
          const x = p1[0] + (p2[0] - p1[0]) * k, y = p1[1] + (p2[1] - p1[1]) * k;
          c.save();
          c.globalAlpha = 0.9 * (1 - eIn(u));
          c.beginPath(); c.moveTo(p1[0], p1[1]); c.lineTo(x, y);
          c.strokeStyle = rgba(COL.brass, 0.35); c.lineWidth = s * 0.06; c.stroke();
          c.beginPath(); c.arc(x, y, s * (0.20 - 0.06 * u), 0, TAU);
          c.fillStyle = fx.hue; c.fill();
          c.strokeStyle = rgba(COL.flare, 0.9); c.lineWidth = s * 0.05; c.stroke();
          c.restore();
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

    function paintFault(c, s, t, atomPx, armPx) {
      const age = t - fault.born;
      for (const o of fault.objs) {
        let p = null;
        if (o.kind === 'atom' || o.kind === 'molecule') p = atomPx && atomPx[o.id];
        else p = armPx && armPx[o.id];
        if (!p) continue;
        // throbs like a warning lamp, then settles into a standing mark on the jam
        const damp = Math.max(0, 1 - age / 3000);
        const beat = motion ? 0.5 + 0.5 * Math.sin(age / 150) * damp : 1;
        c.beginPath(); c.arc(p[0], p[1], s * (ATOM_R + 0.18 + (motion ? 0.05 * beat : 0)), 0, TAU);
        c.strokeStyle = rgba(COL.ox, 0.45 + 0.4 * beat); c.lineWidth = s * 0.09;
        c.stroke();
        if (motion && age < 700) {
          const u = age / 700;
          c.beginPath(); c.arc(p[0], p[1], s * (ATOM_R + 1.5 * eOut(u)), 0, TAU);
          c.strokeStyle = rgba(COL.ox, 0.7 * (1 - u)); c.lineWidth = s * 0.1 * (1 - u);
          c.stroke();
        }
      }
    }

    function debug() {
      return {
        effects: list.length, cap: CAP, tint: tint.size, grow: grow.size,
        doom: doom.size, birth: birth.size, prev: prev.size, grips: grips.size,
        evIdx: evIdx, fault: fault ? fault.objs.length : 0, enabled: enabled,
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
