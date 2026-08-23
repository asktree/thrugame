/*
 * GREAT WORK! — reference engine (v0.2 spec)
 *
 * Pure simulation, no DOM. Runs in Node (module.exports) and the browser
 * (window.GW). Commit-state arithmetic is exact integer hex math; the sweep
 * rule (§9) samples fractional kinematics in pixel space.
 */
(function (root) {
  'use strict';

  // ---------- hex math ----------
  const DIRS = [[1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1], [1, -1]]; // E SE SW W NW NE
  const SQ3 = Math.sqrt(3);
  const mod6 = (n) => ((n % 6) + 6) % 6;
  const cellKey = (c) => c[0] + ',' + c[1];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
  const scale = (v, k) => [v[0] * k, v[1] * k];
  const eq = (a, b) => a[0] === b[0] && a[1] === b[1];
  // rotate an axial vector k steps clockwise (exact)
  function rotK(v, k) {
    let [q, r] = v;
    k = mod6(k);
    for (let i = 0; i < k; i++) { const t = q; q = -r; r = t + r; }
    return [q, r];
  }
  const toPx = (c) => [SQ3 * (c[0] + c[1] / 2), 1.5 * c[1]];
  const dirRad = (d) => Math.atan2(1.5 * DIRS[mod6(d)][1], SQ3 * (DIRS[mod6(d)][0] + DIRS[mod6(d)][1] / 2));
  // continuous unit step in pixel space for a fractional direction (radians)
  const radVec = (a) => [Math.cos(a), Math.sin(a)];
  // NOTE: dir 0 (E) has pixel angle 0; each +1 dir step = +60° in screen space.
  const DIR0 = dirRad(0);
  const dirRadF = (dF) => DIR0 + dF * Math.PI / 3;
  function axialRound(x, y) {
    // invert toPx then cube-round
    const r = y / 1.5, q = x / SQ3 - r / 2;
    let rq = Math.round(q), rr = Math.round(r), rs = Math.round(-q - r);
    const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - (-q - r));
    if (dq > dr && dq > ds) rq = -rr - rs; else if (dr > ds) rr = -rq - rs;
    return [rq, rr];
  }

  // ---------- constants ----------
  const OFFSETS = { 1: [0], 2: [0, 3], 3: [0, 2, 4], 6: [0, 1, 2, 3, 4, 5] };
  const PRICE = { 1: 20, 2: 24, 3: 26, 6: 30 };
  const ELBOW_STEP = 5; // elbow surcharge compounds: 5g per order of attachment
  // transmutation roster adopted from Opus Magnum's campaign
  const METALS = ['Pb', 'Sn', 'Fe', 'Cu', 'Ag', 'Au'];
  const CARDINALS = ['Ai', 'Ea', 'Fi', 'Wa'];
  const GLYPH_PRICE = { bonders: 10, debonders: 15, calcifiers: 10, duplicators: 20,
    projectors: 20, purifiers: 20, animismus: 20, disposals: 0 };
  const RADIUS = 0.35, K_SAMPLES = 12;
  const OPS = 'GD+-PQW';
  const DEFAULT_CAPS = { parts: 24, elbowDepth: 4, tapeLen: 64, atoms: 64, cycles: 4000, goal: 10 };

  // ---------- simulation ----------
  function createSim(puzzle, machine) {
    const caps = Object.assign({}, DEFAULT_CAPS, puzzle.caps || {});
    // reagents may be single atoms ({cell, elem}) or whole molecules ({cells, elems, bonds});
    // a molecule reagent respawns whenever every one of its cells is empty
    const INPUTS = (puzzle.inputs || []).map(g => g.cell
      ? { cells: [g.cell], elems: [g.elem], bonds: [] }
      : { cells: g.cells, elems: g.elems, bonds: g.bonds || [] });
    const S = {
      puzzle, caps,
      tick: 0,
      atoms: [],            // {id, cell, elem, bonds:Set<id>}
      nextAtom: 1,
      arms: [],             // runtime arm records
      products: 0,
      fault: null,          // {kind, tick, detail}
      area: new Set(),
      cost: 0,
      cycles: null,
      events: [],
      motion: null,         // cached last-tick motion for rendering
    };

    // -- build arms --
    const byId = {};
    for (const a of machine.arms) {
      const arm = {
        id: a.id, grippers: a.grippers || 1, len: a.len || 1,
        mount: a.mount,                       // {ground:[q,r]} | {elbow:{parent,at}}
        angle: a.angle || 0,                  // relative angle, 0..5
        tape: { delay: (a.tape && a.tape.delay) || 0, ops: (a.tape && a.tape.ops) || ['W'] },
        baseRot: 0,                           // frame rotation for ground arms
        carriers: [],                         // [{arm, grip}] while carried (ground arms only)
        carryRel: 0,
        holds: [],                            // per gripper: null | {kind:'atom',id} | {kind:'tower',id}
      };
      arm.holds = OFFSETS[arm.grippers].map(() => null);
      byId[arm.id] = arm;
      S.arms.push(arm);
    }
    // pricing: elbow surcharge scales with attachment order (2nd order +5, 3rd +10, ...)
    for (const arm of S.arms) {
      let depth = 0, cur = arm;
      while (cur.mount.elbow) { cur = byId[cur.mount.elbow.parent]; depth++; }
      S.cost += PRICE[arm.grippers] + ELBOW_STEP * depth;
    }
    for (const fam in GLYPH_PRICE) S.cost += (puzzle[fam] || []).length * GLYPH_PRICE[fam];

    // -- validation --
    function reject(msg) { throw new Error('invalid machine: ' + msg); }
    if (S.arms.length > caps.parts) reject('too many parts');
    const baseCells = new Set();
    for (const arm of S.arms) {
      if (!OFFSETS[arm.grippers]) reject('bad gripper count ' + arm.grippers);
      if (arm.len < 1 || arm.len > 3) reject('bad arm length');
      if (arm.tape.ops.length + arm.tape.delay > caps.tapeLen) reject('tape too long');
      for (const op of arm.tape.ops) if (!OPS.includes(op)) reject('bad op ' + op);
      if (arm.mount.elbow) {
        const p = byId[arm.mount.elbow.parent];
        if (!p) reject('elbow parent missing');
        if (arm.mount.elbow.at < 1 || arm.mount.elbow.at > p.len) reject('elbow position off shaft');
        let d = 0, cur = arm;
        while (cur.mount.elbow) { cur = byId[cur.mount.elbow.parent]; if (++d > caps.elbowDepth) reject('elbow too deep'); }
      } else {
        const k = cellKey(arm.mount.ground);
        if (baseCells.has(k)) reject('two bases on one cell');
        baseCells.add(k);
        arm.basePos = arm.mount.ground.slice();
      }
    }

    // -- glyph shapes are fixed: placement is translation + rotation only (no mirroring) --
    // canonical footprints mirror Opus Magnum's: every two-cell glyph is an adjacent pair;
    // purification is inputs a, a+d with output a+rot(d); animismus is salts a, a+d with
    // vitae out a+rot(d) and mors out a+rot⁻¹(d); disposal is a cell plus its whole ring.
    const dirIndex = (v) => DIRS.findIndex(d => d[0] === v[0] && d[1] === v[1]);
    const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
    {
      const pair = (fam, g) => {
        if (g.length !== 2 || dirIndex(sub(g[1], g[0])) < 0) reject(fam + ' glyph must be two adjacent cells');
      };
      for (const fam of ['bonders', 'debonders', 'duplicators', 'projectors']) {
        for (const g of (puzzle[fam] || [])) pair(fam, g);
      }
      for (const g of (puzzle.purifiers || [])) {
        const k = g.length === 3 ? dirIndex(sub(g[1], g[0])) : -1;
        if (k < 0 || dirIndex(sub(g[2], g[0])) !== mod6(k + 1)) reject('purifier glyph shape is fixed');
      }
      for (const g of (puzzle.animismus || [])) {
        const k = g.length === 4 ? dirIndex(sub(g[1], g[0])) : -1;
        if (k < 0 || dirIndex(sub(g[2], g[0])) !== mod6(k + 1) || dirIndex(sub(g[3], g[0])) !== mod6(k + 5)) {
          reject('animismus glyph shape is fixed');
        }
      }
    }
    const disposalFootprint = (c) => [c, ...DIRS.map(d => add(c, d))];

    // -- layout validation: glyphs may not overlap each other; bases may not sit on glyphs --
    {
      const glyphCells = new Set();
      const claim = (c) => {
        const k = cellKey(c);
        if (glyphCells.has(k)) reject('glyph overlap at ' + k);
        glyphCells.add(k);
      };
      for (const fam in GLYPH_PRICE) for (const g of (puzzle[fam] || [])) {
        if (fam === 'disposals') { disposalFootprint(g).forEach(claim); continue; }
        for (const c of (Array.isArray(g[0]) ? g : [g])) claim(c);
      }
      for (const g of INPUTS) g.cells.forEach(claim);
      for (const c of ((puzzle.output && puzzle.output.cells) || [])) claim(c);
      for (const arm of S.arms) {
        if (!arm.mount.elbow && glyphCells.has(cellKey(arm.mount.ground))) {
          reject('base on glyph cell ' + cellKey(arm.mount.ground));
        }
      }
    }

    // initial atoms (tests/puzzles may pre-place)
    for (const a of (puzzle.atoms || [])) {
      S.atoms.push({ id: S.nextAtom++, cell: a.cell.slice(), elem: a.elem, bonds: new Set() });
    }

    for (const g of INPUTS) for (const c of g.cells) S.area.add(cellKey(c));
    for (const fam in GLYPH_PRICE) for (const g of (puzzle[fam] || [])) {
      if (fam === 'disposals') { disposalFootprint(g).forEach(c => S.area.add(cellKey(c))); continue; }
      for (const c of (Array.isArray(g[0]) ? g : [g])) S.area.add(cellKey(c));
    }
    for (const c of ((puzzle.output && puzzle.output.cells) || [])) S.area.add(cellKey(c));

    const atomAt = (cell) => S.atoms.find(a => eq(a.cell, cell));
    const groundArmAt = (cell) => S.arms.find(a => !a.mount.elbow && eq(pose(a).pos, cell));

    function molecule(anchor) {
      const seen = new Set([anchor.id]), out = [anchor], stack = [anchor];
      while (stack.length) {
        const a = stack.pop();
        for (const id of a.bonds) {
          if (seen.has(id)) continue;
          const b = S.atoms.find(x => x.id === id);
          if (b) { seen.add(id); out.push(b); stack.push(b); }
        }
      }
      return out;
    }

    // -- exact kinematics (integers) --
    // pose: {pos:[q,r], rot} — rot is the arm's frame rotation; global dir = rot+angle
    function pose(arm, guard) {
      guard = guard || new Set();
      if (guard.has(arm.id)) { S.fault = S.fault || { kind: 'grab-cycle', tick: S.tick }; return { pos: [0, 0], rot: 0 }; }
      guard.add(arm.id);
      if (arm.mount.elbow) {
        const p = byId[arm.mount.elbow.parent];
        const pp = pose(p, guard);
        const pd = mod6(pp.rot + p.angle);
        return { pos: add(pp.pos, scale(DIRS[pd], arm.mount.elbow.at)), rot: pd };
      }
      if (arm.carriers.length) {
        const { arm: h, grip } = arm.carriers[0];
        const hp = pose(h, guard);
        const hd = mod6(hp.rot + h.angle + OFFSETS[h.grippers][grip]);
        const hand = add(hp.pos, scale(DIRS[hd], h.len));
        return { pos: hand, rot: mod6(hd + arm.carryRel) };
      }
      return { pos: arm.basePos, rot: arm.baseRot };
    }
    const handCell = (arm, grip) => {
      const p = pose(arm);
      const hd = mod6(p.rot + arm.angle + OFFSETS[arm.grippers][grip]);
      return add(p.pos, scale(DIRS[hd], arm.len));
    };
    const handDir = (arm, grip) => mod6(pose(arm).rot + arm.angle + OFFSETS[arm.grippers][grip]);

    // supports(a): every arm whose motion carries a (elbow parents + carriers)
    function supportChain(arm) {
      const out = new Set(); const stack = [arm];
      while (stack.length) {
        const x = stack.pop();
        if (out.has(x.id)) continue;
        out.add(x.id);
        if (x.mount.elbow) stack.push(byId[x.mount.elbow.parent]);
        for (const c of x.carriers) stack.push(c.arm);
      }
      return out;
    }

    // -- fractional kinematics (pixels), valid during a cached motion --
    // M = S.motion: {angle0:{id:θ}, delta:{id:±1|0}, pivot:{id:±1|0}, carryRel0:{id}, snapshot atoms}
    function poseF(arm, f, M) {
      if (arm.mount.elbow) {
        const p = byId[arm.mount.elbow.parent];
        const pp = poseF(p, f, M);
        const pdF = pp.rotF + (M.angle0[p.id] + M.delta[p.id] * f);
        const dir = dirRadF(pdF);
        return { x: pp.x + arm.mount.elbow.at * SQ3 * Math.cos(dir), y: pp.y + arm.mount.elbow.at * SQ3 * Math.sin(dir), rotF: pdF };
      }
      if (M.carriers0[arm.id] && M.carriers0[arm.id].length) {
        const { arm: hid, grip } = M.carriers0[arm.id][0];
        const h = byId[hid];
        const hp = poseF(h, f, M);
        const hdF = hp.rotF + (M.angle0[h.id] + M.delta[h.id] * f) + OFFSETS[h.grippers][grip];
        const dir = dirRadF(hdF);
        return {
          x: hp.x + h.len * SQ3 * Math.cos(dir), y: hp.y + h.len * SQ3 * Math.sin(dir),
          rotF: hdF + (M.carryRel0[arm.id] + (M.pivot[hid] || 0) * f),
        };
      }
      const px = toPx(M.basePos0[arm.id]);
      return { x: px[0], y: px[1], rotF: M.baseRot0[arm.id] };
    }
    function handF(arm, grip, f, M) {
      const p = poseF(arm, f, M);
      const hdF = p.rotF + (M.angle0[arm.id] + M.delta[arm.id] * f) + OFFSETS[arm.grippers][grip];
      const dir = dirRadF(hdF);
      return { x: p.x + arm.len * SQ3 * Math.cos(dir), y: p.y + arm.len * SQ3 * Math.sin(dir), dF: hdF };
    }

    // -- tape --
    function opAt(arm, tick) { // tick is 1-based
      if (tick <= arm.tape.delay) return 'W';
      return arm.tape.ops[(tick - arm.tape.delay - 1) % arm.tape.ops.length];
    }

    // ---------- step ----------
    function step() {
      if (S.fault || S.cycles !== null) return S;
      S.tick++;
      const ev = (e) => S.events.push(Object.assign({ tick: S.tick }, e));

      // 1. spawn — a reagent refills only when its whole footprint is empty
      for (const g of INPUTS) {
        if (g.cells.every(c => !atomAt(c))) {
          const born = g.cells.map((c, i) => {
            const a = { id: S.nextAtom++, cell: c.slice(), elem: g.elems[i], bonds: new Set() };
            S.atoms.push(a); return a;
          });
          for (const [i, j] of g.bonds) { born[i].bonds.add(born[j].id); born[j].bonds.add(born[i].id); }
        }
      }
      if (S.atoms.length > caps.atoms) { S.fault = { kind: 'exhaustion', tick: S.tick, detail: 'atom cap' }; return S; }

      const ops = {}; for (const arm of S.arms) ops[arm.id] = opAt(arm, S.tick);

      // 2a. releases
      for (const arm of S.arms) {
        if (ops[arm.id] !== 'D') continue;
        arm.holds.forEach((h, gi) => {
          if (h && h.kind === 'tower') {
            const t = byId[h.id];
            const p = pose(t); // pose BEFORE detaching, while still carried
            t.carriers = t.carriers.filter(c => !(c.arm === arm && c.grip === gi));
            if (t.carriers.length === 0) { // re-anchor exactly where it stands
              t.basePos = p.pos.slice(); t.baseRot = p.rot; t.mount = { ground: t.basePos.slice() };
            }
          }
          arm.holds[gi] = null;
        });
      }
      // 2b. grabs (simultaneous, evaluated against post-release state)
      for (const arm of S.arms) {
        if (ops[arm.id] !== 'G') continue;
        OFFSETS[arm.grippers].forEach((_, gi) => {
          if (arm.holds[gi]) return;
          const cell = handCell(arm, gi);
          const atom = atomAt(cell);
          if (atom) { arm.holds[gi] = { kind: 'atom', id: atom.id }; return; }
          const tower = groundArmAt(cell);
          if (tower && tower !== arm) {
            if (supportChain(arm).has(tower.id)) { S.fault = { kind: 'grab-cycle', tick: S.tick }; return; }
            const preRot = pose(tower).rot; // pose before this carrier attaches
            arm.holds[gi] = { kind: 'tower', id: tower.id };
            tower.carriers.push({ arm, grip: gi });
            if (tower.carriers.length === 1) tower.carryRel = mod6(preRot - handDir(arm, gi));
          }
        });
      }
      if (S.fault) return S;

      // 3. motion — capture start, apply deltas, verify constraints, commit
      const M = {
        angle0: {}, delta: {}, pivot: {}, carryRel0: {}, basePos0: {}, baseRot0: {}, carriers0: {},
        atoms: [], // snapshot for rendering/sweep: {id, elem, px0, holder:{armId,grip,s}|null, cell0}
      };
      for (const arm of S.arms) {
        M.angle0[arm.id] = arm.angle;
        const op = ops[arm.id];
        M.delta[arm.id] = op === '+' ? 1 : op === '-' ? -1 : 0;
        M.pivot[arm.id] = op === 'P' ? 1 : op === 'Q' ? -1 : 0;
        M.carryRel0[arm.id] = arm.carryRel;
        M.carriers0[arm.id] = arm.carriers.map(c => ({ arm: c.arm.id, grip: c.grip }));
        if (!arm.mount.elbow && arm.carriers.length === 0) { M.basePos0[arm.id] = arm.basePos.slice(); M.baseRot0[arm.id] = arm.baseRot; }
      }
      // hand states before...
      const handBefore = {};
      for (const arm of S.arms) OFFSETS[arm.grippers].forEach((_, gi) => {
        handBefore[arm.id + ':' + gi] = { cell: handCell(arm, gi), dir: handDir(arm, gi) };
      });
      // ...apply joint deltas + pivots-on-towers...
      for (const arm of S.arms) {
        arm.angle = mod6(arm.angle + M.delta[arm.id]);
        if (M.pivot[arm.id]) arm.holds.forEach(h => {
          if (h && h.kind === 'tower') byId[h.id].carryRel = mod6(byId[h.id].carryRel + M.pivot[arm.id]);
        });
      }
      // ...hand states after
      const handAfter = {};
      for (const arm of S.arms) OFFSETS[arm.grippers].forEach((_, gi) => {
        handAfter[arm.id + ':' + gi] = { cell: handCell(arm, gi), dir: handDir(arm, gi) };
      });

      // molecule transforms with agreement checking
      const molXf = new Map(); // rootAtomId -> {k, b:[q,r], holder:{armId,grip,s}, atoms:[]}
      const molOf = new Map(); // atomId -> rootAtomId
      for (const arm of S.arms) arm.holds.forEach((h, gi) => {
        if (!h || h.kind !== 'atom') return;
        const anchor = S.atoms.find(a => a.id === h.id);
        if (!anchor) { arm.holds[gi] = null; return; }
        const mol = molecule(anchor);
        const rootId = Math.min(...mol.map(a => a.id));
        const b0 = handBefore[arm.id + ':' + gi], b1 = handAfter[arm.id + ':' + gi];
        const s = M.pivot[arm.id] || 0;
        const k = mod6(b1.dir - b0.dir + s);
        // M(p) = R^k (p - h0) + h1  →  affine b = h1 - R^k h0
        const b = [b1.cell[0] - rotK(b0.cell, k)[0], b1.cell[1] - rotK(b0.cell, k)[1]];
        const prev = molXf.get(rootId);
        if (prev && (prev.k !== k || !eq(prev.b, b))) {
          S.fault = { kind: 'overconstraint', tick: S.tick, detail: 'molecule ' + rootId };
        } else if (!prev) {
          molXf.set(rootId, { k, b, holder: { armId: arm.id, grip: gi, s }, atoms: mol });
          for (const a of mol) molOf.set(a.id, rootId);
        }
      });
      if (S.fault) return S;
      // held-by-static + moved-by-other is covered: static holder contributes k=0,b=0
      // multi-carrier tower agreement: poses from each carrier must match
      for (const arm of S.arms) {
        if (arm.carriers.length < 2) continue;
        const p0 = pose(arm);
        for (let i = 1; i < arm.carriers.length; i++) {
          const alt = { pos: null, rot: null };
          const { arm: h, grip } = arm.carriers[i];
          const hp = pose(h);
          const hd = mod6(hp.rot + h.angle + OFFSETS[h.grippers][grip]);
          alt.pos = add(hp.pos, scale(DIRS[hd], h.len)); alt.rot = mod6(hd + arm.carryRel);
          if (!eq(alt.pos, p0.pos) || alt.rot !== p0.rot) {
            S.fault = { kind: 'overconstraint', tick: S.tick, detail: 'tower ' + arm.id };
          }
        }
      }
      if (S.fault) return S;

      // snapshot atoms + commit molecule motion (exact)
      M.bonds0 = [];
      {
        const seen = new Set();
        for (const a of S.atoms) for (const id of a.bonds) {
          const kk = Math.min(a.id, id) + '-' + Math.max(a.id, id);
          if (!seen.has(kk)) { seen.add(kk); M.bonds0.push([a.id, id]); }
        }
      }
      for (const a of S.atoms) {
        const rootId = molOf.get(a.id);
        const xf = rootId !== undefined ? molXf.get(rootId) : null;
        M.atoms.push({ id: a.id, elem: a.elem, cell0: a.cell.slice(), holder: xf ? xf.holder : null });
      }
      for (const [, xf] of molXf) for (const a of xf.atoms) {
        a.cell = add(rotK(a.cell, xf.k), xf.b);
      }

      // 3b. sweep — K sample instants, full pair check + area accumulation
      S.motion = M;
      const collidables = (f) => {
        const out = [];
        for (const m of M.atoms) {
          if (m.holder) {
            const arm = byId[m.holder.armId];
            const hF = handF(arm, m.holder.grip, f, M);
            const h0F = handF(arm, m.holder.grip, 0, M);
            const p0 = toPx(m.cell0), h0 = [h0F.x, h0F.y];
            const dA = (hF.dF - h0F.dF + m.holder.s * f) * Math.PI / 3;
            const rx = p0[0] - h0[0], ry = p0[1] - h0[1];
            out.push({ kind: 'atom', id: m.id, elem: m.elem,
              x: hF.x + rx * Math.cos(dA) - ry * Math.sin(dA),
              y: hF.y + rx * Math.sin(dA) + ry * Math.cos(dA) });
          } else {
            const p = toPx(m.cell0);
            out.push({ kind: 'atom', id: m.id, elem: m.elem, x: p[0], y: p[1] });
          }
        }
        for (const arm of S.arms) {
          if (arm.mount.elbow) continue; // elbows don't collide
          const p = poseF(arm, f, M);
          out.push({ kind: 'base', id: arm.id, x: p.x, y: p.y });
        }
        return out;
      };
      const D2 = (2 * RADIUS * SQ3) * (2 * RADIUS * SQ3) - 1e-9; // radius is in pitch units; pixels are pitch·√3
      for (let k = 1; k <= K_SAMPLES && !S.fault; k++) {
        const f = k / K_SAMPLES;
        const objs = collidables(f);
        for (const o of objs) S.area.add(cellKey(axialRound(o.x, o.y)));
        for (const arm of S.arms) OFFSETS[arm.grippers].forEach((_, gi) => {
          const h = handF(arm, gi, f, M); S.area.add(cellKey(axialRound(h.x, h.y)));
        });
        for (let i = 0; i < objs.length; i++) for (let j = i + 1; j < objs.length; j++) {
          const dx = objs[i].x - objs[j].x, dy = objs[i].y - objs[j].y;
          if (dx * dx + dy * dy < D2) {
            S.fault = { kind: 'collision', tick: S.tick, detail: `${objs[i].kind} ${objs[i].id} × ${objs[j].kind} ${objs[j].id} @ f=${k}/${K_SAMPLES}` };
            break;
          }
        }
      }
      if (S.fault) return S;

      // 4. glyphs — every transmutation acts on whatever rests on its cells (held or not)
      for (const [c1, c2] of (puzzle.bonders || [])) {
        const a1 = atomAt(c1), a2 = atomAt(c2);
        if (a1 && a2 && !a1.bonds.has(a2.id)) { a1.bonds.add(a2.id); a2.bonds.add(a1.id); ev({ type: 'bond', a: a1.id, b: a2.id }); }
      }
      for (const [c1, c2] of (puzzle.debonders || [])) {
        const a1 = atomAt(c1), a2 = atomAt(c2);
        if (a1 && a2 && a1.bonds.has(a2.id)) { a1.bonds.delete(a2.id); a2.bonds.delete(a1.id); ev({ type: 'note', msg: 'bond severed' }); }
      }
      for (const g of (puzzle.calcifiers || [])) {
        const a = atomAt(g);
        if (a && CARDINALS.includes(a.elem)) { a.elem = 'Sa'; ev({ type: 'note', msg: 'calcified to salt' }); }
      }
      for (const [ce, cs] of (puzzle.duplicators || [])) {
        const src = atomAt(ce), dst = atomAt(cs);
        if (src && dst && CARDINALS.includes(src.elem) && dst.elem === 'Sa') { dst.elem = src.elem; ev({ type: 'note', msg: 'duplicated ' + src.elem }); }
      }
      const kill = new Set();
      // conversion glyphs can't see bonded or held atoms (matches Opus Magnum)
      const gripped = new Set();
      for (const arm of S.arms) for (const h of arm.holds) if (h && h.kind === 'atom') gripped.add(h.id);
      const loose = (a) => a && a.bonds.size === 0 && !gripped.has(a.id);
      for (const [cm, cq] of (puzzle.projectors || [])) {
        const m = atomAt(cm), q0 = atomAt(cq);
        const q = loose(q0) ? q0 : null;
        const rung = m ? METALS.indexOf(m.elem) : -1;
        if (m && q && q.elem === 'Hg' && rung >= 0 && rung < METALS.length - 1 && !kill.has(q.id)) {
          kill.add(q.id); m.elem = METALS[rung + 1];
          ev({ type: 'note', msg: 'projection → ' + m.elem });
        }
      }
      for (const [ca, cb, co] of (puzzle.purifiers || [])) {
        const a0 = atomAt(ca), b0 = atomAt(cb);
        const a = loose(a0) ? a0 : null, b = loose(b0) ? b0 : null;
        const rung = a ? METALS.indexOf(a.elem) : -1;
        if (a && b && a !== b && a.elem === b.elem && rung >= 0 && rung < METALS.length - 1
            && !atomAt(co) && !kill.has(a.id) && !kill.has(b.id)) {
          kill.add(a.id); kill.add(b.id);
          S.atoms.push({ id: S.nextAtom++, cell: co.slice(), elem: METALS[rung + 1], bonds: new Set() });
          ev({ type: 'note', msg: 'purified → ' + METALS[rung + 1] });
        }
      }
      for (const [ca, cb, cv, cm] of (puzzle.animismus || [])) {
        const a0 = atomAt(ca), b0 = atomAt(cb);
        const a = loose(a0) ? a0 : null, b = loose(b0) ? b0 : null;
        if (a && b && a !== b && a.elem === 'Sa' && b.elem === 'Sa' && !atomAt(cv) && !atomAt(cm)
            && !kill.has(a.id) && !kill.has(b.id)) {
          kill.add(a.id); kill.add(b.id);
          S.atoms.push({ id: S.nextAtom++, cell: cv.slice(), elem: 'Vi', bonds: new Set() });
          S.atoms.push({ id: S.nextAtom++, cell: cm.slice(), elem: 'Mo', bonds: new Set() });
          ev({ type: 'note', msg: 'animismus → vitae + mors' });
        }
      }
      for (const g of (puzzle.disposals || [])) {
        const a = atomAt(g);
        if (loose(a)) { kill.add(a.id); ev({ type: 'note', msg: 'disposed ' + a.elem }); }
      }
      if (kill.size) {
        S.atoms = S.atoms.filter(a => !kill.has(a.id));
        for (const a of S.atoms) for (const id of [...a.bonds]) if (kill.has(id)) a.bonds.delete(id);
        for (const arm of S.arms) arm.holds = arm.holds.map(h =>
          (h && h.kind === 'atom' && kill.has(h.id)) ? null : h);
      }

      // 5. output
      const out = puzzle.output;
      if (out) {
        const heldIds = new Set();
        for (const arm of S.arms) for (const h of arm.holds) if (h && h.kind === 'atom') for (const a of molecule(S.atoms.find(x => x.id === h.id) || { id: -1, bonds: new Set() })) heldIds.add(a.id);
        const got = out.cells.map((c, i) => {
          const a = atomAt(c);
          return a && a.elem === out.elems[i] && !heldIds.has(a.id) ? a : null;
        });
        if (got.every(Boolean)
          && out.bonds.every(([i, j]) => got[i].bonds.has(got[j].id))
          && molecule(got[0]).length === out.cells.length) {
          S.atoms = S.atoms.filter(a => !got.includes(a));
          S.products++;
          ev({ type: 'product', n: S.products });
          if (S.products >= caps.goal) { S.cycles = S.tick; ev({ type: 'complete', cycles: S.cycles }); }
        }
      }

      if (S.cycles === null && S.tick >= caps.cycles) S.fault = { kind: 'exhaustion', tick: S.tick, detail: 'cycle cap' };
      return S;
    }

    // ---------- render geometry ----------
    function renderState(f) {
      const M = S.motion;
      const arms = S.arms.map(arm => {
        let base, rotF, angF;
        if (M) { const p = poseF(arm, f, M); base = [p.x, p.y]; rotF = p.rotF; angF = M.angle0[arm.id] + M.delta[arm.id] * f; }
        else { const p = pose(arm); const px = toPx(p.pos); base = px; rotF = p.rot; angF = arm.angle; }
        const hands = OFFSETS[arm.grippers].map((off, gi) => {
          const dF = rotF + angF + off;
          const a = dirRadF(dF);
          return { x: base[0] + arm.len * SQ3 * Math.cos(a), y: base[1] + arm.len * SQ3 * Math.sin(a), holding: !!arm.holds[gi], ang: a };
        });
        return { id: arm.id, base, hands, len: arm.len, elbow: !!arm.mount.elbow, carried: arm.carriers.length > 0 };
      });
      let atoms;
      if (M && f < 1) {
        atoms = M.atoms.map(m => {
          if (!m.holder) { const p = toPx(m.cell0); return { id: m.id, elem: m.elem, x: p[0], y: p[1] }; }
          const arm = byId[m.holder.armId];
          const hF = handF(arm, m.holder.grip, f, M), h0F = handF(arm, m.holder.grip, 0, M);
          const p0 = toPx(m.cell0);
          const dA = (hF.dF - h0F.dF + m.holder.s * f) * Math.PI / 3;
          const rx = p0[0] - h0F.x, ry = p0[1] - h0F.y;
          return { id: m.id, elem: m.elem, x: hF.x + rx * Math.cos(dA) - ry * Math.sin(dA), y: hF.y + rx * Math.sin(dA) + ry * Math.cos(dA) };
        });
      } else {
        atoms = S.atoms.map(a => { const p = toPx(a.cell); return { id: a.id, elem: a.elem, x: p[0], y: p[1] }; });
      }
      // during the animated tick, show only bonds that existed BEFORE the motion —
      // a bond formed this tick appears when its atom lands, not while approaching
      let bondPairs;
      if (M && f < 1) {
        bondPairs = M.bonds0;
      } else {
        bondPairs = [];
        const seen = new Set();
        for (const a of S.atoms) for (const id of a.bonds) {
          const kk = Math.min(a.id, id) + '-' + Math.max(a.id, id);
          if (!seen.has(kk)) { seen.add(kk); bondPairs.push([a.id, id]); }
        }
      }
      return { arms, atoms, bonds: bondPairs, tick: S.tick, products: S.products, fault: S.fault };
    }

    return {
      step,
      renderState,
      get state() { return S; },
      metrics() {
        return { cost: S.cost, cycles: S.cycles, area: S.area.size,
          sum: S.cycles !== null ? S.cost + S.cycles + S.area.size : null };
      },
      run(n) { for (let i = 0; i < n && !S.fault && S.cycles === null; i++) step(); return this; },
    };
  }

  const GW = { createSim, DIRS, rotK, toPx, PRICE, RADIUS, K_SAMPLES, DEFAULT_CAPS };
  if (typeof module !== 'undefined' && module.exports) module.exports = GW;
  else root.GW = GW;
})(typeof self !== 'undefined' ? self : this);
