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
  // RENDER ONLY (§ deterministic arithmetic below owns every simulation decision):
  // toPx / dirRadF / axialRound are float helpers kept for the canvas and the editor's
  // pointer picking. Nothing that decides a fault, an area cell or a cycle count may call them.
  const toPx = (c) => [SQ3 * (c[0] + c[1] / 2), 1.5 * c[1]];
  const dirRad = (d) => Math.atan2(1.5 * DIRS[mod6(d)][1], SQ3 * (DIRS[mod6(d)][0] + DIRS[mod6(d)][1] / 2));
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

  // ==========================================================================
  // deterministic arithmetic
  // --------------------------------------------------------------------------
  // Every value below is Q16.16 fixed point: an ordinary JS number holding an
  // INTEGER equal to round(real · 65536). No floats, no Math.sqrt/cos/sin, and
  // never a JS bitwise operator (<<, >>, |, &) — those truncate to 32 bits and
  // would silently wreck Q16.16 magnitudes.
  //
  // Division is FLOOR division everywhere (see fdiv). C's `/` truncates toward
  // zero, so the on-chain oracle must implement an explicit floored divide for
  // negative operands or it will disagree by one ulp and, eventually, by a verdict.
  //
  // The constants in this block (SQRT3, HALF_SQRT3, THRESH2_*, COS, SIN) are
  // NORMATIVE: the verifier must copy the literals verbatim rather than recompute
  // them from a math library. Collision, area accrual and therefore cycles/SUM all
  // fall out of these operations, so the on-chain verifier must reproduce them
  // bit-for-bit. int64 is sufficient and required for every intermediate.
  // ==========================================================================
  const ONE = 65536;                              // Q16.16 scale, 2^16
  // Floor division. C oracle: NOT `a / b` (which truncates toward zero) — use a
  // floored variant, e.g. `q = a / b; if ((a % b) && ((a < 0) != (b < 0))) q--;`
  // Math.floor(a/b) here is exact for every magnitude this engine produces: |a| < 2^46,
  // so the IEEE quotient's absolute error is below 2^-30, while a non-multiple integer
  // dividend sits at least 1/b ≈ 2^-17 away from an integer quotient — the two can never
  // meet, so the floor never lands on the wrong side of an integer boundary.
  const fdiv = (a, b) => Math.floor(a / b);
  // Q16.16 multiply. Magnitude bound: board coords satisfy |q|,|r| <= ~40, so px
  // values stay under 2^23 in Q16.16 and any product here is under ~2^46 < 2^53.
  const fmul = (a, b) => fdiv(a * b, ONE);
  const fabs = (a) => (a < 0 ? -a : a);
  // round-half-up to a plain integer; identical to JS Math.round on these ranges.
  const qround = (a) => fdiv(a + 32768, ONE);

  const SQRT3 = 113512;        // round(sqrt(3) * 65536) = round(113511.6817...)
  const HALF_SQRT3 = 56756;    // round(sqrt(3)/2 * 65536) = round(56755.8409...) = SQRT3/2
  // Collision discs are Opus Magnum's, taken from the game's hex tile texture:
  // 82 px between hex centers, atoms 29 px, arm bases 20 px. Radii in pitches:
  // atom 29/82, base 20/82. Compared as SQUARED distance so no sqrt is ever needed;
  // one pitch is sqrt(3) px here, so for radii ra, rb the threshold is
  //   T2 = round(3 * (ra + rb)^2 * 65536)
  const THRESH2_AA = 98362;   // atom-atom:  3*(58/82)^2 = 1.5008923... -> round(98362.48)
  const THRESH2_AB = 70205;   // atom-base:  3*(49/82)^2 = 1.0712374... -> round(70204.61)
  const THRESH2_BB = 46784;   // base-base:  3*(40/82)^2 = 0.7138608... -> round(46783.58)
  // Sweep instants land on multiples of 60°/64 = 0.9375°, so all trigonometry is
  // table lookup at that granularity. 65 entries cover one sextant, 0°..60°:
  // COS[k] = round(cos(k*0.9375°) * 65536), SIN[k] = round(sin(k*0.9375°) * 65536).
  const COS = [65536, 65527, 65501, 65457, 65396, 65317, 65220, 65107, 64975, 64827, 64661, 64477, 64277, 64059, 63824, 63572, 63303, 63017, 62714, 62394, 62058, 61705, 61336, 60950, 60547, 60129, 59694, 59244, 58777, 58295, 57798, 57284, 56756, 56212, 55653, 55080, 54491, 53888, 53271, 52639, 51993, 51333, 50660, 49973, 49273, 48559, 47832, 47093, 46341, 45577, 44800, 44011, 43211, 42399, 41576, 40741, 39896, 39040, 38173, 37297, 36410, 35513, 34607, 33692, 32768];
  const SIN = [0, 1072, 2144, 3216, 4286, 5356, 6424, 7490, 8554, 9616, 10676, 11732, 12785, 13835, 14882, 15924, 16962, 17995, 19024, 20048, 21066, 22078, 23085, 24086, 25080, 26067, 27047, 28020, 28986, 29944, 30893, 31835, 32768, 33692, 34607, 35513, 36410, 37297, 38173, 39040, 39896, 40741, 41576, 42399, 43211, 44011, 44800, 45577, 46341, 47093, 47832, 48559, 49273, 49973, 50660, 51333, 51993, 52639, 53271, 53888, 54491, 55080, 55653, 56212, 56756];
  const ANG_TURN = 384;                           // angle units in a full turn
  const ANG_DIR = 64;                             // angle units in one lattice direction (60°)
  const modA = (u) => ((u % ANG_TURN) + ANG_TURN) % ANG_TURN;
  // trigQ(u) = [cos, sin] in Q16.16 of the angle u*0.9375°, u any integer.
  // The sextant (the whole-lattice-direction part) is applied as an exact 60°
  // rotation using cos60 = 1/2 and sin60 = sqrt(3)/2 = HALF_SQRT3; only the
  // remaining 0..59.0625° reads the table.
  function trigQ(u) {
    u = modA(u);
    const s = fdiv(u, ANG_DIR), k = u - s * ANG_DIR;   // s in 0..5, k in 0..63
    const c = COS[k], n = SIN[k];
    switch (s) {
      case 0: return [c, n];
      case 1: return [fdiv(c, 2) - fmul(HALF_SQRT3, n), fmul(HALF_SQRT3, c) + fdiv(n, 2)];
      case 2: return [-fdiv(c, 2) - fmul(HALF_SQRT3, n), fmul(HALF_SQRT3, c) - fdiv(n, 2)];
      case 3: return [-c, -n];
      case 4: return [-fdiv(c, 2) + fmul(HALF_SQRT3, n), -fmul(HALF_SQRT3, c) - fdiv(n, 2)];
      default: return [fdiv(c, 2) + fmul(HALF_SQRT3, n), -fmul(HALF_SQRT3, c) + fdiv(n, 2)];
    }
  }
  // lattice cell -> pixel, in Q16.16. x = sqrt(3)*(q + r/2) = sqrt(3)*(2q+r)/2;
  // y = 1.5*r is exact (r * 98304) with no rounding at all.
  const toPxQ = (q, r) => [fdiv(SQRT3 * (2 * q + r), 2), r * 98304];
  // step of `n` lattice units along the direction u (in angle units), in Q16.16 px.
  // One pitch is sqrt(3) px, so the leg length is n*SQRT3 (n <= 3 here).
  function stepQ(n, u) {
    const t = trigQ(u);
    return [fmul(SQRT3 * n, t[0]), fmul(SQRT3 * n, t[1])];
  }
  // rotate the Q16.16 offset (dx,dy) by u angle units about the origin.
  function rotQ(dx, dy, u) {
    const t = trigQ(u);
    return [fmul(t[0], dx) - fmul(t[1], dy), fmul(t[1], dx) + fmul(t[0], dy)];
  }
  // THE collision predicate. Squared distance in Q16.16 (Q32.32 descaled back by
  // fmul) against the normative squared threshold for the pair of disc kinds.
  // No sqrt, no epsilon: `<` means exactly-touching is not a collision.
  function tooCloseQ(ax, ay, bx, by, t2 = THRESH2_AA) {
    const dx = ax - bx, dy = ay - by;
    return fmul(dx, dx) + fmul(dy, dy) < t2;
  }
  // How many sweep instants a tick gets — Opus Magnum's rule. d is the largest
  // rotation radius in the tick: the farthest any moving atom ends up from the
  // pivot it turned about, in hex steps (hexicab). The game's increment is
  // 0.25 / 2^round(log2 d), at most 0.125, i.e. N = 4 * 2^round(log2 d) instants,
  // at least 8. Capped at 64, the trig table's resolution (out of reach anyway:
  // no machine within the caps has a rotation radius above ~15).
  const K_MAX = 64;
  function roundLog2(d) {                 // round(log2(d)), integer d >= 1, exactly
    let f = 0;
    while ((2 << f) <= d) f++;            // f = floor(log2 d)
    return d * d >= (2 << (2 * f)) ? f + 1 : f;   // up when d >= 2^(f + 1/2)
  }
  function samplesFor(maxDist) {
    return Math.min(K_MAX, Math.max(8, 4 * (1 << roundLog2(Math.max(1, maxDist)))));
  }
  // inverse of toPxQ + cube rounding, for area accrual. Q16.16 in, lattice cell out.
  function axialRoundQ(x, y) {
    const rQ = fdiv(y * 2, 3);                     // y / 1.5
    const qQ = fdiv(x * ONE, SQRT3) - fdiv(rQ, 2); // x / sqrt(3) - r/2
    const sQ = -qQ - rQ;
    let rq = qround(qQ), rr = qround(rQ);
    const rs = qround(sQ);
    const dq = fabs(rq * ONE - qQ), dr = fabs(rr * ONE - rQ), ds = fabs(rs * ONE - sQ);
    if (dq > dr && dq > ds) rq = -rr - rs; else if (dr > ds) rr = -rq - rs;
    return [rq, rr];
  }

  // ---------- constants ----------
  const OFFSETS = { 1: [0], 2: [0, 3], 3: [0, 2, 4], 6: [0, 1, 2, 3, 4, 5] };
  const PRICE = { 1: 20, 2: 24, 3: 26, 6: 30 };
  const ELBOW_COST = 10;   // mounting an arm on an arm
  const GRABBER_COST = 5;  // the grabber head's share of an arm's price

  // Arm pricing. Mounting on an arm costs ELBOW_COST. A child mounted at the
  // parent's TIP replaces the parent's grabber head outright — the parent can
  // no longer grab or pivot (validated in createSim) and its GRABBER_COST is
  // refunded. Mid-shaft mounts leave the parent's grabber alone.
  function tipParentIds(arms) {
    const byId = new Map(arms.map(a => [a.id, a]));
    const tips = new Set();
    for (const a of arms) {
      if (!a.mount.elbow) continue;
      const p = byId.get(a.mount.elbow.parent);
      if (p && a.mount.elbow.at === (p.len || 1)) tips.add(p.id);
    }
    return tips;
  }
  function armsCost(arms) {
    let cost = 0;
    for (const a of arms) cost += PRICE[a.grippers || 1] + (a.mount.elbow ? ELBOW_COST : 0);
    return cost - GRABBER_COST * tipParentIds(arms).size;
  }
  // transmutation roster adopted from Opus Magnum's campaign
  const METALS = ['Pb', 'Sn', 'Fe', 'Cu', 'Ag', 'Au'];
  const CARDINALS = ['Ai', 'Ea', 'Fi', 'Wa'];
  const GLYPH_PRICE = { bonders: 10, debonders: 15, calcifiers: 10, duplicators: 20,
    projectors: 20, purifiers: 20, animismus: 20, disposals: 0 };
  // RADIUS (atoms) and BASE_RADIUS are render/export only, in pitches — the simulation
  // compares against THRESH2_*, their normative Q16.16 squared-sum forms. The number of
  // sweep instants per tick is samplesFor(...) (8..64), so every sweep angle is an exact
  // multiple of 60/64 = 0.9375°, hence the 65-entry COS/SIN table.
  const RADIUS = 29 / 82, BASE_RADIUS = 20 / 82, K_SAMPLES = K_MAX;
  const OPS = 'GD+-PQWR';
  const DEFAULT_CAPS = { parts: 24, elbowDepth: 4, tapeLen: 64, atoms: 64, cycles: 4000, goal: 9 };

  // -- repeat expansion (NORMATIVE) --
  // A tape may carry 'R' repeat markers (Opus Magnum semantics): each marker
  // expands to a copy of the ops accumulated since the end of the previous
  // repeat block (consecutive markers copy that SAME segment); after a run of
  // markers the segment origin advances. The simulation always runs the
  // expanded tape — the marker survives serialization purely for legibility,
  // and the on-chain verifier must expand identically. `cells` maps display
  // positions for editors: {src} entries are the author's ops ('R' shown as a
  // marker), {ghost} entries are the copies, `engine` is the expanded index.
  function expandTape(src) {
    const ops = [], cells = [];
    let segStart = 0, i = 0;
    while (i < src.length) {
      if (src[i] !== 'R') {
        cells.push({ src: i, op: src[i], ghost: false, engine: ops.length });
        ops.push(src[i]); i++;
      } else {
        const seg = ops.slice(segStart);      // frozen once per run of consecutive markers
        while (i < src.length && src[i] === 'R') {
          cells.push({ src: i, op: '⟲', ghost: false, engine: null });
          for (const op of seg) { cells.push({ src: null, op, ghost: true, engine: ops.length }); ops.push(op); }
          i++;
        }
        segStart = ops.length;
      }
    }
    return { ops, cells };
  }

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
      const srcOps = (a.tape && a.tape.ops) || ['W'];
      const arm = {
        id: a.id, grippers: a.grippers || 1, len: a.len || 1,
        mount: a.mount,                       // {ground:[q,r]} | {elbow:{parent,at}}
        angle: a.angle || 0,                  // relative angle, 0..5
        // src is as authored (repeat markers intact); ops is what runs
        tape: { delay: (a.tape && a.tape.delay) || 0, src: srcOps, ops: expandTape(srcOps).ops },
        baseRot: 0,                           // frame rotation for ground arms
        carriers: [],                         // [{arm, grip}] while carried (ground arms only)
        carryRel: 0,
        holds: [],                            // per gripper: null | {kind:'atom',id} | {kind:'tower',id}
      };
      arm.holds = OFFSETS[arm.grippers].map(() => null);
      byId[arm.id] = arm;
      S.arms.push(arm);
    }
    S.cost += armsCost(S.arms);
    for (const fam in GLYPH_PRICE) S.cost += (puzzle[fam] || []).length * GLYPH_PRICE[fam];

    // -- validation --
    function reject(msg) { throw new Error('invalid machine: ' + msg); }
    if (S.arms.length > caps.parts) reject('too many parts');
    const baseCells = new Set();
    for (const arm of S.arms) {
      if (!OFFSETS[arm.grippers]) reject('bad gripper count ' + arm.grippers);
      if (arm.len < 1 || arm.len > 3) reject('bad arm length');
      // the cap binds both the authored tape and its expansion — what runs must fit
      if (arm.tape.src.length + arm.tape.delay > caps.tapeLen) reject('tape too long');
      if (arm.tape.ops.length + arm.tape.delay > caps.tapeLen) reject('tape too long');
      for (const op of arm.tape.src) if (!OPS.includes(op)) reject('bad op ' + op);
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
    // a tip-mounted child replaces the parent's grabber head entirely: no
    // grabs, no releases, no pivots — turns only. Checked on the EXPANDED tape.
    {
      const tips = tipParentIds(S.arms);
      for (const arm of S.arms) {
        if (!tips.has(arm.id)) continue;
        for (const op of arm.tape.ops) {
          if (op === 'G' || op === 'D' || op === 'P' || op === 'Q') {
            reject('arm ' + arm.id + ' has no grabber (tip-mounted child) and cannot ' + op);
          }
        }
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

    // -- fractional kinematics, DETERMINISTIC (Q16.16), valid during a cached motion --
    // These are the simulation's own kinematics: the sweep, the collision test and area
    // accrual all read them. They are sampled only at the N instants f = k/N of a tick,
    // N dividing 64, so every angle is an exact multiple of 60°/64. Angles are therefore
    // carried as INTEGER counts of that unit ("rotU"/"dU"/"u"), never radians: a float
    // dF of (n + m*k/N) is exactly the integer 64n + m*u with u = 64k/N here.
    // M = S.motion: {angle0:{id:θ}, delta:{id:±1|0}, pivot:{id:±1|0}, carryRel0:{id}, snapshot atoms}
    function poseQ(arm, u, M) {
      if (arm.mount.elbow) {
        const p = byId[arm.mount.elbow.parent];
        const pp = poseQ(p, u, M);
        const dU = pp.rotU + ANG_DIR * M.angle0[p.id] + M.delta[p.id] * u;
        const v = stepQ(arm.mount.elbow.at, dU);
        return { x: pp.x + v[0], y: pp.y + v[1], rotU: dU };
      }
      if (M.carriers0[arm.id] && M.carriers0[arm.id].length) {
        const { arm: hid, grip } = M.carriers0[arm.id][0];
        const h = byId[hid];
        const hp = poseQ(h, u, M);
        const hdU = hp.rotU + ANG_DIR * (M.angle0[h.id] + OFFSETS[h.grippers][grip]) + M.delta[h.id] * u;
        const v = stepQ(h.len, hdU);
        return {
          x: hp.x + v[0], y: hp.y + v[1],
          rotU: hdU + ANG_DIR * M.carryRel0[arm.id] + (M.pivot[hid] || 0) * u,
        };
      }
      const b = M.basePos0[arm.id];
      const px = toPxQ(b[0], b[1]);
      return { x: px[0], y: px[1], rotU: ANG_DIR * M.baseRot0[arm.id] };
    }
    function handQ(arm, grip, u, M) {
      const p = poseQ(arm, u, M);
      const dU = p.rotU + ANG_DIR * (M.angle0[arm.id] + OFFSETS[arm.grippers][grip]) + M.delta[arm.id] * u;
      const v = stepQ(arm.len, dU);
      return { x: p.x + v[0], y: p.y + v[1], dU };
    }

    // -- fractional kinematics (float pixels) -- RENDER ONLY, arbitrary f in [0,1].
    // Never consulted by step(); see poseQ/handQ above for the simulation's version.
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
      if (!arm.tape.ops.length) return 'W';  // an all-marker tape expands to nothing
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
          // render-only: tells a renderer where a reagent just refilled. Events are not
          // part of the conformance digest and the C oracle does not implement them.
          ev({ type: 'spawn', cells: g.cells.map(c => c.slice()), elems: g.elems.slice(), ids: born.map(a => a.id) });
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

      // 3b. sweep — N sample instants, full pair check + area accumulation
      S.motion = M;
      // How many instants: Opus Magnum's rule on the largest rotation radius of the
      // tick. For every held atom, walk its carrier chain to the ground: if any joint
      // on the way turns, the radius is measured from the root base; if only the
      // gripper pivots, from that gripper. (see samplesFor)
      let maxDist = 1;
      const hexicab = (c) => Math.max(Math.abs(c[0]), Math.abs(c[1]), Math.abs(c[0] + c[1]));
      for (const m of M.atoms) {
        if (!m.holder) continue;
        const atom = S.atoms.find(x => x.id === m.id);
        if (!atom) continue;
        const holder = byId[m.holder.armId];
        // turn: a joint anywhere in the chain turns (the whole chain swings about the
        // root base); selfPivot: only the holder's own gripper pivots the molecule
        let arm = holder, turn = false;
        for (;;) {
          if (M.delta[arm.id] || (arm !== holder && M.pivot[arm.id])) turn = true;
          if (arm.mount.elbow) arm = byId[arm.mount.elbow.parent];
          else if (M.carriers0[arm.id] && M.carriers0[arm.id].length) arm = byId[M.carriers0[arm.id][0].arm];
          else break;
        }
        const selfPivot = !!M.pivot[holder.id];
        if (!turn && !selfPivot) continue;                // nothing rotates this atom
        let pivot;
        if (turn) pivot = M.basePos0[arm.id];
        else { const h = handQ(holder, m.holder.grip, ANG_DIR, M); pivot = axialRoundQ(h.x, h.y); }
        maxDist = Math.max(maxDist, hexicab(sub(atom.cell, pivot)));
      }
      const N = samplesFor(maxDist), step = ANG_DIR / N;
      // Angle u = k*step is the whole sweep instant; every position below is Q16.16.
      const collidables = (u) => {
        const out = [];
        for (const m of M.atoms) {
          if (m.holder) {
            const arm = byId[m.holder.armId];
            const hK = handQ(arm, m.holder.grip, u, M);
            const h0 = handQ(arm, m.holder.grip, 0, M);
            const p0 = toPxQ(m.cell0[0], m.cell0[1]);
            // angle swept by the held molecule, in angle units (s is the gripper pivot)
            const dU = hK.dU - h0.dU + m.holder.s * u;
            const rel = rotQ(p0[0] - h0.x, p0[1] - h0.y, dU);
            out.push({ kind: 'atom', id: m.id, elem: m.elem, x: hK.x + rel[0], y: hK.y + rel[1] });
          } else {
            const p = toPxQ(m.cell0[0], m.cell0[1]);
            out.push({ kind: 'atom', id: m.id, elem: m.elem, x: p[0], y: p[1] });
          }
        }
        for (const arm of S.arms) {
          if (arm.mount.elbow) continue; // elbows don't collide
          const p = poseQ(arm, u, M);
          out.push({ kind: 'base', id: arm.id, x: p.x, y: p.y });
        }
        return out;
      };
      const pairT2 = (a, b) => a.kind === 'atom' ? (b.kind === 'atom' ? THRESH2_AA : THRESH2_AB)
        : (b.kind === 'atom' ? THRESH2_AB : THRESH2_BB);
      for (let k = 1; k <= N && !S.fault; k++) {
        const u = k * step;
        const objs = collidables(u);
        for (const o of objs) S.area.add(cellKey(axialRoundQ(o.x, o.y)));
        for (const arm of S.arms) OFFSETS[arm.grippers].forEach((_, gi) => {
          const h = handQ(arm, gi, u, M); S.area.add(cellKey(axialRoundQ(h.x, h.y)));
        });
        for (let i = 0; i < objs.length; i++) for (let j = i + 1; j < objs.length; j++) {
          if (tooCloseQ(objs[i].x, objs[i].y, objs[j].x, objs[j].y, pairT2(objs[i], objs[j]))) {
            S.fault = { kind: 'collision', tick: S.tick, detail: `${objs[i].kind} ${objs[i].id} × ${objs[j].kind} ${objs[j].id} @ f=${k}/${N}` };
            break;
          }
        }
      }
      if (S.fault) return S;

      // 4. glyphs — every transmutation acts on whatever rests on its cells (held or not)
      for (const [c1, c2] of (puzzle.bonders || [])) {
        const a1 = atomAt(c1), a2 = atomAt(c2);
        if (a1 && a2 && !a1.bonds.has(a2.id)) { a1.bonds.add(a2.id); a2.bonds.add(a1.id); ev({ type: 'bond', a: a1.id, b: a2.id, cells: [c1.slice(), c2.slice()] }); }
      }
      for (const [c1, c2] of (puzzle.debonders || [])) {
        const a1 = atomAt(c1), a2 = atomAt(c2);
        if (a1 && a2 && a1.bonds.has(a2.id)) { a1.bonds.delete(a2.id); a2.bonds.delete(a1.id); ev({ type: 'note', msg: 'bond severed', fx: 'debond', a: a1.id, b: a2.id, cells: [c1.slice(), c2.slice()] }); }
      }
      for (const g of (puzzle.calcifiers || [])) {
        const a = atomAt(g);
        if (a && CARDINALS.includes(a.elem)) { a.elem = 'Sa'; ev({ type: 'note', msg: 'calcified to salt', fx: 'calcify', a: a.id, cells: [g.slice()] }); }
      }
      for (const [ce, cs] of (puzzle.duplicators || [])) {
        const src = atomAt(ce), dst = atomAt(cs);
        if (src && dst && CARDINALS.includes(src.elem) && dst.elem === 'Sa') { dst.elem = src.elem; ev({ type: 'note', msg: 'duplicated ' + src.elem, fx: 'duplicate', a: src.id, b: dst.id, elem: src.elem, cells: [ce.slice(), cs.slice()] }); }
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
          ev({ type: 'note', msg: 'projection → ' + m.elem, fx: 'project', a: m.id, b: q.id, elem: m.elem, cells: [cm.slice(), cq.slice()] });
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
          ev({ type: 'note', msg: 'purified → ' + METALS[rung + 1], fx: 'purify', a: a.id, b: b.id, out: S.nextAtom - 1, elem: METALS[rung + 1], cells: [ca.slice(), cb.slice(), co.slice()] });
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
          ev({ type: 'note', msg: 'animismus → vitae + mors', fx: 'animismus', a: a.id, b: b.id, vi: S.nextAtom - 2, mo: S.nextAtom - 1, cells: [ca.slice(), cb.slice(), cv.slice(), cm.slice()] });
        }
      }
      for (const g of (puzzle.disposals || [])) {
        const a = atomAt(g);
        if (loose(a)) { kill.add(a.id); ev({ type: 'note', msg: 'disposed ' + a.elem, fx: 'dispose', a: a.id, elem: a.elem, cells: [g.slice()] }); }
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
          ev({ type: 'product', n: S.products, cells: out.cells.map(c => c.slice()), elems: out.elems.slice(), ids: got.map(a => a.id) });
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

  const GW = {
    createSim, expandTape, DIRS, rotK, PRICE, GLYPH_PRICE, ELBOW_COST, GRABBER_COST,
    armsCost, tipParentIds, RADIUS, BASE_RADIUS, K_SAMPLES, DEFAULT_CAPS,
    toPx, fromPx: axialRound,   // float, render/editor-pointer use only (see note above)
    // the deterministic core, exported so a C reimplementation can be conformance-tested
    // primitive by primitive against this oracle.
    Q: { ONE, fdiv, fmul, SQRT3, HALF_SQRT3, THRESH2_AA, THRESH2_AB, THRESH2_BB, COS, SIN, ANG_TURN, ANG_DIR,
      K_MAX, roundLog2, samplesFor, trigQ, toPxQ, stepQ, rotQ, tooCloseQ, axialRoundQ },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = GW;
  else root.GW = GW;
})(typeof self !== 'undefined' ? self : this);
