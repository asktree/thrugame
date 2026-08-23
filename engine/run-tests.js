/* GREAT WORK! — golden tests for the reference engine */
'use strict';
const GW = require('./engine.js');
const EXAMPLES = require('./examples.js');
const CODEC = require('./codec.js');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ok  ' + name); }
  else { fail++; console.log('FAIL  ' + name + (detail ? ' — ' + detail : '')); }
}

// ---- example machines complete with expected cycle counts ----
for (const ex of EXAMPLES) {
  const sim = GW.createSim(ex.puzzle, ex.machine);
  sim.run(500);
  const m = sim.metrics(), st = sim.state;
  if (ex.expect.fault) {
    check(`${ex.key}: faults with ${ex.expect.fault}`, st.fault && st.fault.kind === ex.expect.fault,
      JSON.stringify(st.fault));
    continue;
  }
  check(`${ex.key}: completes without fault`, !st.fault && st.cycles !== null,
    st.fault ? JSON.stringify(st.fault) : `products=${st.products}`);
  if (ex.expect.cycles !== undefined) {
    check(`${ex.key}: cycles == ${ex.expect.cycles}`, st.cycles === ex.expect.cycles, `got ${st.cycles}`);
  }
  check(`${ex.key}: metrics sane`, m.cost > 0 && m.area > 0 && m.sum === m.cost + m.cycles + m.area,
    JSON.stringify(m));
  console.log(`      ${ex.key}: cost=${m.cost} cycles=${m.cycles} area=${m.area} sum=${m.sum}`);
}

// ---- determinism: same machine, identical outcome ----
{
  const ex = EXAMPLES[2];
  const a = GW.createSim(ex.puzzle, ex.machine).run(500).metrics();
  const b = GW.createSim(ex.puzzle, ex.machine).run(500).metrics();
  check('determinism: identical metrics', JSON.stringify(a) === JSON.stringify(b));
}

// ---- double-hold agreement, then conflict ----
{
  const puzzle = { atoms: [{ cell: [2, -1], elem: 'Pb' }, { cell: [3, -1], elem: 'Hg' }] };
  // pre-bond the pair via a bonder placed under them (bond fires end of tick 1)
  puzzle.bonders = [[[2, -1], [3, -1]]];
  const machine = {
    arms: [
      { id: 'P', grippers: 1, len: 2, mount: { ground: [0, 0] }, angle: 0,
        tape: { ops: ['W', 'W', '+', 'W', 'W'] } },
      { id: 'C1', grippers: 1, len: 1, mount: { elbow: { parent: 'P', at: 1 } }, angle: 5,
        tape: { ops: ['W', 'G', 'W', '+', 'W'] } },
      { id: 'C2', grippers: 1, len: 1, mount: { elbow: { parent: 'P', at: 2 } }, angle: 5,
        tape: { ops: ['W', 'G', 'W', 'W', 'W'] } },
    ],
  };
  const sim = GW.createSim(puzzle, machine);
  sim.step(); // t1: bond forms
  sim.step(); // t2: both children grab the molecule
  sim.step(); // t3: parent turns — both holders impose the same motion: legal
  const st = sim.state;
  check('double-hold: parent turn is legal', !st.fault, st.fault && JSON.stringify(st.fault));
  const a1 = st.atoms.find(a => a.elem === 'Pb'), a2 = st.atoms.find(a => a.elem === 'Hg');
  check('double-hold: molecule rotated about parent base',
    a1 && a2 && a1.cell[0] === 1 && a1.cell[1] === 1 && a2.cell[0] === 1 && a2.cell[1] === 2,
    a1 && a2 && `Pb@${a1.cell} Hg@${a2.cell}`);
  sim.step(); // t4: C1 turns alone while C2 holds — tug of war
  check('double-hold: lone child turn faults', st.fault && st.fault.kind === 'overconstraint',
    JSON.stringify(st.fault));
}

// ---- swept collision ----
{
  const puzzle = { atoms: [{ cell: [1, 0], elem: 'Pb' }, { cell: [1, -1], elem: 'Hg' }] };
  const machine = { arms: [
    { id: 'A', grippers: 1, len: 1, mount: { ground: [0, 0] }, angle: 0, tape: { ops: ['G', '-', 'W'] } },
  ] };
  const sim = GW.createSim(puzzle, machine);
  sim.step(); sim.step();
  check('sweep: carried atom into stationary atom faults', sim.state.fault && sim.state.fault.kind === 'collision',
    JSON.stringify(sim.state.fault));
}

// ---- base collision: carrying a tower's base through an atom ----
{
  const puzzle = { atoms: [{ cell: [1, 1], elem: 'Pb' }] };
  const machine = { arms: [
    { id: 'A', grippers: 1, len: 2, mount: { ground: [0, 0] }, angle: 0, tape: { ops: ['G', '+', 'W'] } },
    { id: 'B', grippers: 1, len: 1, mount: { ground: [2, 0] }, angle: 0, tape: { ops: ['W'] } },
  ] };
  // A grabs B's base at (2,0), turns CW: B's base sweeps toward (0,2) passing near (2,1)... the
  // arc from (2,0) about (0,0) passes right through the vicinity of the atom at (2,1).
  const sim = GW.createSim(puzzle, machine);
  sim.step(); sim.step();
  check('sweep: carried base through atom faults', sim.state.fault && sim.state.fault.kind === 'collision',
    JSON.stringify(sim.state.fault));
}

// ---- delay blocks: first pass only, period unchanged ----
{
  const machine = { arms: [
    { id: 'A', grippers: 1, len: 1, mount: { ground: [0, 0] }, angle: 0, tape: { ops: ['+'] } },
    { id: 'B', grippers: 1, len: 1, mount: { ground: [3, 0] }, angle: 0, tape: { delay: 2, ops: ['+'] } },
  ] };
  const sim = GW.createSim({}, machine);
  sim.step(); sim.step(); sim.step(); // t1..t3
  const A = sim.state.arms.find(a => a.id === 'A'), B = sim.state.arms.find(a => a.id === 'B');
  check('delay: A turned 3, B turned 1', A.angle === 3 && B.angle === 1, `A=${A.angle} B=${B.angle}`);
  sim.step();
  check('delay: after first pass B keeps full period', B.angle === 2, `B=${B.angle}`);
}

// ---- grab cycle faults ----
{
  const machine = { arms: [
    { id: 'A', grippers: 1, len: 1, mount: { ground: [0, 0] }, angle: 0, tape: { ops: ['G', 'W'] } },
    { id: 'B', grippers: 1, len: 1, mount: { ground: [1, 0] }, angle: 3, tape: { ops: ['G', 'W'] } },
  ] };
  // A's hand is at (1,0) = B's base; B's hand is at (0,0) = A's base. Both grab at t1.
  const sim = GW.createSim({}, machine);
  sim.step();
  check('grab cycle: mutual base grab faults', sim.state.fault && sim.state.fault.kind === 'grab-cycle',
    JSON.stringify(sim.state.fault));
}


// ---- transmutation glyph pack (one tick, static atoms) ----
{
  const puzzle = {
    atoms: [
      { cell: [0, 0], elem: 'Fi' },
      { cell: [2, 0], elem: 'Wa' }, { cell: [3, 0], elem: 'Sa' },
      { cell: [5, 0], elem: 'Pb' }, { cell: [6, 0], elem: 'Hg' },
      { cell: [8, 0], elem: 'Cu' }, { cell: [9, 0], elem: 'Cu' },
      { cell: [12, 0], elem: 'Sa' }, { cell: [13, 0], elem: 'Sa' },
      { cell: [16, 0], elem: 'Au' },
      { cell: [18, 0], elem: 'Ea' }, { cell: [19, 0], elem: 'Ea' },
    ],
    calcifiers: [[0, 0]],
    duplicators: [[[2, 0], [3, 0]]],
    projectors: [[[5, 0], [6, 0]]],
    purifiers: [[[8, 0], [9, 0], [8, 1]]],
    animismus: [[[12, 0], [13, 0], [12, 1], [13, -1]]],
    disposals: [[16, 0]],
    bonders: [[[18, 0], [19, 0]]],
  };
  const machine = { arms: [{ id: 'A', grippers: 1, len: 1, mount: { ground: [0, 5] }, angle: 0, tape: { ops: ['W'] } }] };
  const sim = GW.createSim(puzzle, machine); sim.step();
  const at = (c) => sim.state.atoms.find(a => a.cell[0] === c[0] && a.cell[1] === c[1]);
  check('calcification: cardinal to salt', at([0, 0]).elem === 'Sa');
  check('duplication: salt copies cardinal', at([3, 0]).elem === 'Wa' && at([2, 0]).elem === 'Wa');
  check('projection: consumes Hg, promotes Pb to Sn', at([5, 0]).elem === 'Sn' && !at([6, 0]));
  check('purification: two Cu become Ag', !at([8, 0]) && !at([9, 0]) && at([8, 1]).elem === 'Ag');
  check('animismus: two salt become vitae and mors', at([12, 1]).elem === 'Vi' && at([13, -1]).elem === 'Mo');
  check('disposal: atom destroyed', !at([16, 0]));
  check('bond glyph joins the pair', at([18, 0]).bonds.size === 1);
  check('no fault in glyph pack', !sim.state.fault, JSON.stringify(sim.state.fault));
}

// ---- debond glyph severs a bond (glyphs may no longer stack, so carry the pair over) ----
{
  const puzzle = {
    atoms: [{ cell: [0, 0], elem: 'Ea' }, { cell: [1, 0], elem: 'Ea' }],
    bonders: [[[0, 0], [1, 0]]],
    debonders: [[[2, 0], [2, -1]]],
  };
  const machine = { arms: [
    { id: 'A', grippers: 1, len: 1, mount: { ground: [1, 1] }, angle: 4,
      tape: { ops: ['W', 'G', '+', 'W'] } },
  ] };
  const sim = GW.createSim(puzzle, machine);
  sim.step(); // t1: bond forms on the bonder
  const bonded = sim.state.atoms.every(a => a.bonds.size === 1);
  sim.step(); sim.step(); // t2: grab; t3: swing pair onto the debonder
  const severed = sim.state.atoms.every(a => a.bonds.size === 0);
  check('debond: pair bonds, then debonder severs', bonded && severed && !sim.state.fault,
    JSON.stringify({ bonded, severed, fault: sim.state.fault }));
}

// ---- layout: overlapping glyphs and bases on glyphs are rejected ----
{
  const arms = [{ id: 'A', grippers: 1, len: 1, mount: { ground: [5, 5] }, angle: 0, tape: { ops: ['W'] } }];
  const rejects = (puzzle, machine) => {
    try { GW.createSim(puzzle, machine); return false; } catch (e) { return /glyph|base/.test(String(e)); }
  };
  check('layout: stacked bonders rejected',
    rejects({ bonders: [[[0, 0], [1, 0]], [[0, 0], [0, 1]]] }, { arms }));
  check('layout: glyph on product glyph rejected',
    rejects({ calcifiers: [[0, 0]], output: { cells: [[0, 0]], elems: ['Sa'], bonds: [] } }, { arms }));
  check('layout: input on glyph rejected',
    rejects({ inputs: [{ cell: [0, 0], elem: 'Wa' }], disposals: [[0, 0]] }, { arms }));
  check('layout: ground base on glyph cell rejected',
    rejects({ calcifiers: [[5, 5]] }, { arms }));
  check('layout: disjoint glyphs accepted',
    !rejects({ bonders: [[[0, 0], [1, 0]]], calcifiers: [[3, 0]] }, { arms }));
}

// ---- glyph shapes are fixed: translation + rotation only ----
{
  const arms = [{ id: 'A', grippers: 1, len: 1, mount: { ground: [5, 5] }, angle: 0, tape: { ops: ['W'] } }];
  const rejects = (puzzle) => {
    try { GW.createSim(puzzle, { arms }); return false; } catch (e) { return /shape|adjacent/.test(String(e)); }
  };
  check('shape: straight-line purifier rejected', rejects({ purifiers: [[[0, 0], [1, 0], [2, 0]]] }));
  check('shape: straight-line animismus rejected', rejects({ animismus: [[[0, 0], [1, 0], [2, 0], [3, 0]]] }));
  check('shape: mirrored animismus rejected', rejects({ animismus: [[[0, 0], [1, 0], [1, -1], [0, 1]]] }));
  check('shape: non-adjacent bonder rejected', rejects({ bonders: [[[0, 0], [2, 0]]] }));
  check('shape: rotated animismus accepted',
    !rejects({ animismus: [[[0, 0], [0, 1], [-1, 1], [1, 0]]] })); // k=1 orientation
}

// ---- molecule reagents: spawn pre-bonded, refill only when the footprint clears ----
{
  const puzzle = {
    inputs: [{ cells: [[0, 0], [1, 0]], elems: ['Fe', 'Sa'], bonds: [[0, 1]] }],
  };
  const machine = { arms: [
    { id: 'A', grippers: 1, len: 2, mount: { ground: [0, -2] }, angle: 1,
      tape: { ops: ['G', '+', 'W', 'W', 'D', 'W'] } },
  ] };
  const sim = GW.createSim(puzzle, machine);
  sim.step();
  const m0 = sim.state.atoms;
  check('molecule reagent: spawns bonded pair', m0.length === 2 && m0[0].bonds.size === 1);
  sim.step(); // arm grabbed the Fe end at t1, turn moves the whole molecule away
  check('molecule reagent: half-clear footprint does not respawn',
    sim.state.atoms.length === 2, `atoms=${sim.state.atoms.length}`);
  sim.step();
  check('molecule reagent: respawns when both cells clear', sim.state.atoms.length === 4,
    `atoms=${sim.state.atoms.length}`);
}

// ---- codec: every example machine round-trips byte-for-byte and runs identically ----
for (const ex of EXAMPLES) {
  const s = CODEC.encodeString(ex.machine);
  const back = CODEC.decodeString(s);
  const a = GW.createSim(ex.puzzle, ex.machine).run(500);
  const b = GW.createSim(ex.puzzle, back).run(500);
  const same = JSON.stringify(a.metrics()) === JSON.stringify(b.metrics())
    && JSON.stringify(a.state.fault) === JSON.stringify(b.state.fault);
  check(`codec: ${ex.key} round-trips (${s.length} chars)`, same
    && CODEC.encodeString(back) === s);
}
// ---- codec v2: full board layouts round-trip ----
{
  const sol = {
    arms: [{ id: 'A', grippers: 2, len: 3, mount: { ground: [-4, 7] }, angle: 5,
      tape: { delay: 2, ops: ['G', '+', 'P', 'D', 'W'] } }],
    glyphs: [{ type: 'bonders', at: [0, 0], rot: 3 }, { type: 'animismus', at: [2, -5], rot: 5 },
      { type: 'calcifiers', at: [-1, -1], rot: 0 }],
    inputs: [{ ri: 0, at: [3, 3], rot: 4 }, { ri: 2, at: [-6, 0], rot: 1 }],
    output: { at: [9, -9], rot: 2 },
  };
  const s = CODEC.encodeString(sol);
  const back = CODEC.decodeString(s);
  check('codec v2: layout round-trips',
    JSON.stringify(back.glyphs) === JSON.stringify(sol.glyphs)
    && JSON.stringify(back.inputs) === JSON.stringify(sol.inputs)
    && JSON.stringify(back.output) === JSON.stringify(sol.output)
    && CODEC.encodeString(back) === s,
    s);
  check('codec v2: arms-only still encodes as v1', CODEC.fromString(CODEC.encodeString({ arms: sol.arms }))[0] === 1);
}
{
  const bad = (fn) => { try { fn(); return false; } catch (e) { return /codec/.test(String(e)); } };
  check('codec: rejects op garbage', bad(() => CODEC.encodeMachine({ arms: [
    { id: 'A', grippers: 1, len: 1, mount: { ground: [0, 0] }, angle: 0, tape: { ops: ['X'] } }] })));
  check('codec: rejects forward elbow reference', bad(() => CODEC.encodeMachine({ arms: [
    { id: 'A', grippers: 1, len: 1, mount: { elbow: { parent: 'B', at: 1 } }, angle: 0, tape: { ops: ['W'] } },
    { id: 'B', grippers: 1, len: 1, mount: { ground: [0, 0] }, angle: 0, tape: { ops: ['W'] } }] })));
  check('codec: rejects truncated bytes', bad(() => CODEC.decodeMachine(Uint8Array.from([1, 1, 0]))));
}

// ---- arm-on-arm pricing and the tip-mount grabber replacement ----
{
  // A (len 1) tip-carries B; B (len 2) mid-shaft-carries C.
  // A: 20, loses its grabber to B: -5. B: 20+10. C: 20+10 (mid-shaft, no refund).
  const machine = { arms: [
    { id: 'A', grippers: 1, len: 1, mount: { ground: [0, 0] }, angle: 0, tape: { ops: ['W'] } },
    { id: 'B', grippers: 1, len: 2, mount: { elbow: { parent: 'A', at: 1 } }, angle: 0, tape: { ops: ['W'] } },
    { id: 'C', grippers: 1, len: 1, mount: { elbow: { parent: 'B', at: 1 } }, angle: 0, tape: { ops: ['W'] } },
  ] };
  const sim = GW.createSim({}, machine);
  check('pricing: tip mount refunds the grabber (20-5 + 30 + 30 = 75)',
    sim.metrics().cost === 75, 'got ' + sim.metrics().cost);
  check('pricing: GW.armsCost agrees with createSim', GW.armsCost(machine.arms) === 75);

  const grabber = (op) => ({ arms: [
    { id: 'A', grippers: 1, len: 1, mount: { ground: [0, 0] }, angle: 0, tape: { ops: [op] } },
    { id: 'B', grippers: 1, len: 1, mount: { elbow: { parent: 'A', at: 1 } }, angle: 0, tape: { ops: ['W'] } },
  ] });
  const rejects = (m) => { try { GW.createSim({}, m); return false; } catch (e) { return /no grabber/.test(e.message); } };
  check('tip mount: parent cannot grab, release, or pivot (turns still fine)',
    rejects(grabber('G')) && rejects(grabber('D')) && rejects(grabber('P')) && rejects(grabber('Q'))
    && !rejects(grabber('+')) && !rejects(grabber('W')));
  // the ban applies to the EXPANDED tape: + R expands clean, G R does not
  check('tip mount: ban sees through repeat markers',
    rejects({ arms: [
      { id: 'A', grippers: 1, len: 1, mount: { ground: [0, 0] }, angle: 0, tape: { ops: ['G', 'R'] } },
      { id: 'B', grippers: 1, len: 1, mount: { elbow: { parent: 'A', at: 1 } }, angle: 0, tape: { ops: ['W'] } },
    ] }));
}

// ==========================================================================
// The blocks below pin the deterministic core. A C port of this engine has to
// reproduce every literal and every bound stated here bit-for-bit; the numbers
// in the assertions were MEASURED against this oracle, not assumed.
// ==========================================================================

// ---- shared helpers for the property/fuzz blocks ----
const Q = GW.Q;
// structural equality — the fuzz blocks compare decoded machines and sim snapshots
function deepEq(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEq(a[k], b[k])) return false;
  }
  return true;
}
// 32-bit LCG (Numerical Recipes constants) — Math.imul keeps it exact, so the
// fuzz corpus is byte-identical on every run and on every platform.
function lcg(seed) {
  let s = seed >>> 0;
  const next = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0);
  const r = (n) => next() % n;
  r.pick = (a) => a[r(a.length)];
  return r;
}

// ---- Q16.16: fdiv FLOORS, it does not truncate toward zero ----
{
  const { fdiv, fmul, ONE } = Q;
  check('fdiv: floors negative quotients (-3/2 = -2, not -1)', fdiv(-3, 2) === -2, 'got ' + fdiv(-3, 2));
  check('fdiv: one ulp past -1.0 floors to -2', fdiv(-65537, 65536) === -2, 'got ' + fdiv(-65537, 65536));
  check('fdiv: positive side still floors', fdiv(3, 2) === 1 && fdiv(65537, 65536) === 1);
  check('fdiv: any negative non-multiple drops a whole unit',
    fdiv(-1, 2) === -1 && fdiv(-65535, 65536) === -1 && fdiv(-65536, 65536) === -1);
  check('fdiv: exact multiples are unaffected by the floor', fdiv(-4, 2) === -2 && fdiv(4, 2) === 2);
  check('fdiv: negative divisor floors too (7/-2 = -4, -7/-2 = 3)',
    fdiv(7, -2) === -4 && fdiv(-7, -2) === 3);
  {
    let ok = true, ex = null;
    for (let a = -400; a <= 400 && ok; a++) for (let b = -12; b <= 12; b++) {
      if (b === 0) continue;
      if (fdiv(a, b) !== Math.floor(a / b)) { ok = false; ex = a + '/' + b; break; }
    }
    check('fdiv: agrees with Math.floor over the whole small-operand sweep', ok, ex);
  }
  check('fmul: ONE is a two-sided identity',
    [0, 1, -1, 3, -3, 12345, -777, 4194304, -4194304].every(x => fmul(x, ONE) === x && fmul(ONE, x) === x));
  check('fmul: negating one operand negates the product at full scale',
    fmul(-ONE, ONE) === -ONE && fmul(-ONE, -ONE) === ONE && fmul(-ONE, 12345) === -12345);
  check('fmul: half times half is a quarter', fmul(ONE / 2, ONE / 2) === ONE / 4
    && fmul(-ONE / 2, ONE / 2) === -ONE / 4);
  // the floor is a *bias*, not a symmetry: sub-ulp products round DOWN on both signs
  check('fmul: sub-ulp products floor, so fmul(1,1)=0 but fmul(-1,1)=-1',
    fmul(1, 1) === 0 && fmul(-1, 1) === -1 && fmul(1, -1) === -1);
  check('fmul: 0.99998^2 floors to 65534, its negation to -65535',
    fmul(65535, 65535) === 65534 && fmul(-65535, 65535) === -65535);
  {
    let ok = true;
    for (let i = -30; i <= 30 && ok; i++) for (let j = -30; j <= 30; j++) {
      const a = i * 2179, b = j * 4093;
      if (fmul(a, b) !== fmul(b, a)) { ok = false; break; }
    }
    check('fmul: commutative over a signed sweep', ok);
  }
  // qround(a) = fdiv(a + ONE/2, ONE) — the rounding axialRoundQ uses internally
  {
    const qround = (a) => fdiv(a + 32768, ONE);
    check('qround: half-up at every boundary, including the negative half',
      qround(0) === 0 && qround(32767) === 0 && qround(32768) === 1 && qround(65535) === 1
      && qround(-1) === 0 && qround(-32768) === 0 && qround(-32769) === -1 && qround(-65536) === -1);
    let ok = true;
    for (let a = -600000; a <= 600000; a += 1013) if (qround(a) !== Math.round(a / ONE)) { ok = false; break; }
    check('qround: matches Math.round over a wide sweep', ok);
  }
  check('normative literals: SQRT3/HALF_SQRT3/THRESH2 unchanged',
    Q.SQRT3 === 113512 && Q.HALF_SQRT3 === 56756 && Q.THRESH2 === 96338
    && Q.ONE === 65536 && Q.ANG_TURN === 72 && Q.ANG_DIR === 12);
  check('normative literals: HALF_SQRT3 is exactly SQRT3/2 (no rounding drift)',
    Q.HALF_SQRT3 * 2 === Q.SQRT3 && fdiv(Q.SQRT3, 2) === Q.HALF_SQRT3);
  check('trig table: 13 entries spanning 0..60 degrees, anchored at the exact corners',
    Q.COS5.length === 13 && Q.SIN5.length === 13
    && Q.COS5[0] === ONE && Q.SIN5[0] === 0
    && Q.COS5[12] === ONE / 2 && Q.SIN5[12] === Q.HALF_SQRT3
    && Q.COS5[6] === Q.HALF_SQRT3 && Q.SIN5[6] === ONE / 2);
  {
    // sin(5k) = cos(90 - 5k) = cos(5*(18-k)), reachable in-table only for k >= 6
    let ok = true;
    for (let k = 6; k <= 12; k++) if (Q.SIN5[k] !== Q.COS5[18 - k]) ok = false;
    let maxErr = 0;
    for (let k = 0; k <= 12; k++) {
      maxErr = Math.max(maxErr, Math.abs(fmul(Q.COS5[k], Q.COS5[k]) + fmul(Q.SIN5[k], Q.SIN5[k]) - ONE));
    }
    check('trig table: complementary entries agree and every entry is unit-norm to 1 ulp',
      ok && maxErr === 1, 'maxErr=' + maxErr);
  }
}

// ---- trigQ: anchors, periodicity, norm, and the symmetries that actually hold ----
{
  const { trigQ, fmul, ONE, ANG_TURN } = Q;
  const same = (a, b) => a[0] === b[0] && a[1] === b[1];
  check('trigQ: exact anchor at u=0 (0 degrees)', same(trigQ(0), [65536, 0]), JSON.stringify(trigQ(0)));
  check('trigQ: exact anchor at u=6 (30 degrees)', same(trigQ(6), [56756, 32768]), JSON.stringify(trigQ(6)));
  check('trigQ: exact anchor at u=12 (60 degrees)', same(trigQ(12), [32768, 56756]), JSON.stringify(trigQ(12)));
  check('trigQ: exact anchor at u=18 (90 degrees)', same(trigQ(18), [0, 65536]), JSON.stringify(trigQ(18)));
  check('trigQ: exact anchor at u=36 (180 degrees)', same(trigQ(36), [-65536, 0]), JSON.stringify(trigQ(36)));
  check('trigQ: exact anchor at u=54 (270 degrees)', same(trigQ(54), [0, -65536]), JSON.stringify(trigQ(54)));
  {
    let ok = true, ex = null;
    for (let u = -216; u <= 216 && ok; u++) {
      if (!same(trigQ(u), trigQ(u + ANG_TURN)) || !same(trigQ(u), trigQ(u - ANG_TURN))) { ok = false; ex = 'u=' + u; }
    }
    check('trigQ: exactly 72-periodic over u in [-216, 216]', ok, ex);
  }
  {
    let mag = 0;
    for (let u = 0; u < ANG_TURN; u++) { const t = trigQ(u); mag = Math.max(mag, Math.abs(t[0]), Math.abs(t[1])); }
    check('trigQ: never exceeds unit magnitude', mag === ONE, 'max=' + mag);
  }
  {
    // measured over all 72 angles: the worst |cos^2 + sin^2 - 1| is exactly 3 ulps
    // (~4.58e-5), attained at 16 of the 72 angles.
    let maxErr = 0, attained = 0;
    for (let u = 0; u < ANG_TURN; u++) {
      const [c, s] = trigQ(u);
      const e = Math.abs(fmul(c, c) + fmul(s, s) - ONE);
      if (e > maxErr) { maxErr = e; attained = 1; } else if (e === maxErr) attained++;
    }
    check('trigQ: unit-norm to within 3 ulps of ONE, and 3 is tight', maxErr === 3 && attained === 16,
      `maxErr=${maxErr} attained=${attained}`);
  }
  // symmetry survey: only the point reflection is EXACT; the reflections about the
  // axes go through a different fdiv path and land within 1 ulp.
  const dev = (f) => {
    let m = 0;
    for (let u = 0; u < ANG_TURN; u++) { const [a, b] = f(u); m = Math.max(m, Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])); }
    return m;
  };
  {
    const d = dev(u => [trigQ(u + 36), [-trigQ(u)[0], -trigQ(u)[1]]]);
    check('trigQ: point reflection trigQ(u+36) == -trigQ(u) is EXACT', d === 0, 'maxdev=' + d);
  }
  {
    const d = dev(u => [trigQ(-u), [trigQ(u)[0], -trigQ(u)[1]]]);
    check('trigQ: even/odd reflection trigQ(-u) == [c,-s] holds to exactly 1 ulp', d === 1, 'maxdev=' + d);
  }
  {
    const d = dev(u => [trigQ(36 - u), [-trigQ(u)[0], trigQ(u)[1]]]);
    check('trigQ: reflection trigQ(36-u) == [-c,s] holds to exactly 1 ulp', d === 1, 'maxdev=' + d);
  }
  {
    const d = Math.max(dev(u => [trigQ(u + 18), [-trigQ(u)[1], trigQ(u)[0]]]),
      dev(u => [trigQ(18 - u), [trigQ(u)[1], trigQ(u)[0]]]));
    check('trigQ: quarter-turn swaps cos/sin to exactly 1 ulp', d === 1, 'maxdev=' + d);
  }
}

// ---- geometry: toPxQ / axialRoundQ round-trip, perturbation margin, rotQ vs the lattice ----
{
  const { toPxQ, axialRoundQ, rotQ, ANG_DIR } = Q;
  {
    let bad = 0, ex = null;
    for (let q = -30; q <= 30; q++) for (let r = -30; r <= 30; r++) {
      const p = toPxQ(q, r), c = axialRoundQ(p[0], p[1]);
      if (c[0] !== q || c[1] !== r) { bad++; if (!ex) ex = `${q},${r} -> ${c}`; }
    }
    check('geometry: axialRoundQ(toPxQ(c)) == c for all 3721 cells with |q|,|r| <= 30', bad === 0, ex);
  }
  check('geometry: toPxQ y is exact (r * 98304, no rounding at all)',
    [-30, -7, 0, 7, 30].every(r => toPxQ(3, r)[1] === r * 98304));
  {
    // measured: the largest box half-width D with every (+-D, +-D) offset still
    // rounding home is 41547; 41548 is the first that escapes. (Theory: the cell's
    // inscribed axis-aligned square has half-width ONE/(1 + 1/sqrt(3)) = 41548.16.)
    const dense = (D, lim, step) => {
      for (let q = -lim; q <= lim; q++) for (let r = -lim; r <= lim; r++) {
        const p = toPxQ(q, r);
        for (let dx = -D; dx <= D; dx += step) for (let dy = -D; dy <= D; dy += step) {
          const c = axialRoundQ(p[0] + dx, p[1] + dy);
          if (c[0] !== q || c[1] !== r) return `${q},${r} +(${dx},${dy}) -> ${c}`;
        }
      }
      return null;
    };
    const e1 = dense(15000, 30, 1500);
    check('geometry: +-15000 perturbation still rounds home (|q|,|r| <= 30)', e1 === null, e1);
    const e2 = dense(40000, 20, 4000);
    check('geometry: +-40000 perturbation still rounds home (|q|,|r| <= 20)', e2 === null, e2);
    const corners = (D, lim) => {
      for (let q = -lim; q <= lim; q++) for (let r = -lim; r <= lim; r++) {
        const p = toPxQ(q, r);
        for (const dx of [-D, 0, D]) for (const dy of [-D, 0, D]) {
          const c = axialRoundQ(p[0] + dx, p[1] + dy);
          if (c[0] !== q || c[1] !== r) return false;
        }
      }
      return true;
    };
    check('geometry: the safe box half-width is exactly 41547 (41548 escapes the cell)',
      corners(41547, 20) && !corners(41548, 20));
  }
  {
    // measured: rotating a cell's pixel position by one lattice direction lands within
    // 17 Q16.16 ulps (2.6e-4 px) of the exact lattice image, over |q|,|r| <= 20 and all
    // six sextants; the worst case is the far corner (-20,-20) at u=12.
    let maxDev = 0, ex = null;
    for (let k = 0; k < 6; k++) for (let q = -20; q <= 20; q++) for (let r = -20; r <= 20; r++) {
      const p = toPxQ(q, r);
      const rp = rotQ(p[0], p[1], k * ANG_DIR);
      const t = GW.rotK([q, r], k), tp = toPxQ(t[0], t[1]);
      const d = Math.max(Math.abs(rp[0] - tp[0]), Math.abs(rp[1] - tp[1]));
      if (d > maxDev) { maxDev = d; ex = `k=${k} cell=${q},${r}`; }
    }
    check('geometry: rotQ by 60 degrees tracks the lattice to within 17 ulps (bound is tight)',
      maxDev === 17, `maxDev=${maxDev} at ${ex}`);
  }
  {
    let bad = 0, ex = null;
    for (let k = 0; k < 6; k++) for (let q = -20; q <= 20; q++) for (let r = -20; r <= 20; r++) {
      const p = toPxQ(q, r);
      const rp = rotQ(p[0], p[1], k * ANG_DIR);
      const c = axialRoundQ(rp[0], rp[1]), t = GW.rotK([q, r], k);
      if (c[0] !== t[0] || c[1] !== t[1]) { bad++; if (!ex) ex = `k=${k} cell=${q},${r} -> ${c} want ${t}`; }
    }
    check('geometry: rotQ then axialRoundQ == exact lattice rotK, every sextant', bad === 0, ex);
  }
  {
    let idOk = true, negOk = true;
    for (let q = -20; q <= 20; q++) for (let r = -20; r <= 20; r++) {
      const p = toPxQ(q, r);
      const a = rotQ(p[0], p[1], 0), b = rotQ(p[0], p[1], 36);
      if (a[0] !== p[0] || a[1] !== p[1]) idOk = false;
      if (b[0] !== -p[0] || b[1] !== -p[1]) negOk = false;
    }
    check('geometry: rotQ(u=0) is the identity and rotQ(u=36) negates exactly', idOk && negOk);
  }
}

// ---- codec fuzz (a): arbitrary bytes either throw cleanly or are an encode fixpoint ----
{
  const rnd = lcg(0x9e3779b9);
  const OPS = ['G', 'D', '+', '-', 'P', 'Q', 'W'], GRIPS = [1, 2, 3, 6];
  const randMachine = (maxArms) => {
    const n = 1 + rnd(maxArms), arms = [], used = new Set();
    for (let i = 0; i < n; i++) {
      const grippers = rnd.pick(GRIPS), len = 1 + rnd(3);
      let mount;
      if (i > 0 && rnd(2) === 0) { const p = arms[rnd(i)]; mount = { elbow: { parent: p.id, at: 1 + rnd(p.len) } }; }
      else {
        let q, r, k;
        do { q = rnd(13) - 6; r = rnd(13) - 6; k = q + ',' + r; } while (used.has(k));
        used.add(k); mount = { ground: [q, r] };
      }
      arms.push({ id: 'a' + i, grippers, len, mount, angle: rnd(6),
        tape: { delay: rnd(4), ops: Array.from({ length: 1 + rnd(8) }, () => rnd.pick(OPS)) } });
    }
    return { arms };
  };
  let decoded = 0, threw = 0, dirty = [], notFixpoint = null;
  for (let n = 0; n < 500; n++) {
    let bytes;
    switch (n % 6) {
      case 0: bytes = Uint8Array.from({ length: rnd(61) }, () => rnd(256)); break;
      case 1: { const s = Array.from(CODEC.encodeMachine(randMachine(3)));      // byte smashes
        for (let j = 1 + rnd(3); j > 0; j--) s[rnd(s.length)] = rnd(256);
        bytes = Uint8Array.from(s.slice(0, 60)); break; }
      case 2: { const s = Array.from(CODEC.encodeMachine(randMachine(3)));      // truncation
        s.length = rnd(s.length + 1); bytes = Uint8Array.from(s); break; }
      case 3: { const s = Array.from(CODEC.encodeMachine(randMachine(3)));      // trailing junk
        for (let j = rnd(4); j > 0; j--) s.push(rnd(256));
        bytes = Uint8Array.from(s.slice(0, 60)); break; }
      case 4: { const a = [1 + rnd(2), rnd(3)];                                 // plausible header
        for (let j = rnd(30); j > 0; j--) a.push(rnd(256));
        bytes = Uint8Array.from(a); break; }
      default: { const s = Array.from(CODEC.encodeMachine(randMachine(3)));     // single bit flip
        const bi = rnd(s.length); s[bi] ^= (1 << rnd(8));
        bytes = Uint8Array.from(s); break; }
    }
    let d1;
    try { d1 = CODEC.decodeMachine(bytes); }
    catch (e) {
      threw++;
      if (!/^codec:/.test(String(e.message)) && dirty.length < 4) dirty.push(String(e.message));
      continue;
    }
    decoded++;
    // the tape is bit-packed, so the raw bytes need not survive — the STRUCTURE must.
    try {
      const d2 = CODEC.decodeMachine(CODEC.encodeMachine(d1));
      if (!deepEq(d1, d2) && !notFixpoint) notFixpoint = JSON.stringify(d1) + ' vs ' + JSON.stringify(d2);
    } catch (e) { if (!notFixpoint) notFixpoint = 're-encode threw: ' + e.message + ' on ' + JSON.stringify(d1); }
  }
  check(`codec fuzz: 500 byte strings — ${threw} rejected, ${decoded} decoded, no stray exceptions`,
    dirty.length === 0 && decoded > 0 && threw > 0, dirty.join(' | '));
  check('codec fuzz: every decode is a canonical fixpoint of encode(decode(.))',
    notFixpoint === null, notFixpoint);
}

// ---- codec fuzz (b): random VALID machines round-trip to their canonical form ----
{
  const rnd = lcg(0x5bf03635);
  const OPS = ['G', 'D', '+', '-', 'P', 'Q', 'W'], GRIPS = [1, 2, 3, 6];
  // decode regenerates ids as a0, a1, ... and fills every default — that is the canon.
  const canon = (m) => {
    const idx = new Map(m.arms.map((a, i) => [a.id, i]));
    return { arms: m.arms.map((a, i) => ({
      id: 'a' + i, grippers: a.grippers || 1, len: a.len || 1,
      mount: a.mount.elbow
        ? { elbow: { parent: 'a' + idx.get(a.mount.elbow.parent), at: a.mount.elbow.at } }
        : { ground: [a.mount.ground[0], a.mount.ground[1]] },
      angle: ((a.angle || 0) % 6 + 6) % 6,
      tape: { delay: (a.tape && a.tape.delay) || 0, ops: ((a.tape && a.tape.ops) || ['W']).slice() },
    })) };
  };
  let bad = null, badStr = null, elbows = 0, maxArms = 0;
  for (let n = 0; n < 100; n++) {
    const count = 1 + rnd(6), arms = [], used = new Set();
    for (let i = 0; i < count; i++) {
      const grippers = rnd.pick(GRIPS), len = 1 + rnd(3);
      let mount;
      if (i > 0 && rnd(2) === 0) {
        const p = arms[rnd(i)];                       // elbows may only reference earlier arms
        mount = { elbow: { parent: p.id, at: 1 + rnd(p.len) } };   // and only positions on the shaft
        elbows++;
      } else {
        let q, r, k;
        do { q = rnd(21) - 10; r = rnd(21) - 10; k = q + ',' + r; } while (used.has(k));
        used.add(k); mount = { ground: [q, r] };
      }
      arms.push({ id: 'arm' + i, grippers, len, mount, angle: rnd(6),
        tape: { delay: rnd(9), ops: Array.from({ length: 1 + rnd(20) }, () => rnd.pick(OPS)) } });
    }
    maxArms = Math.max(maxArms, count);
    const m = { arms };
    const back = CODEC.decodeMachine(CODEC.encodeMachine(m));
    if (!bad && !deepEq(back, canon(m))) bad = JSON.stringify(canon(m)) + '\n got ' + JSON.stringify(back);
    if (!badStr && !deepEq(CODEC.decodeString(CODEC.encodeString(m)), canon(m))) badStr = JSON.stringify(m);
  }
  check(`codec fuzz: 100 valid machines round-trip through bytes (${elbows} elbow mounts, up to ${maxArms} arms)`,
    bad === null, bad);
  check('codec fuzz: the base64url share string round-trips identically', badStr === null, badStr);
}

// ---- simulation: seeded-random machines are bit-identical across independent runs ----
{
  const rnd = lcg(0x1234567);
  const OPS = ['G', 'D', '+', '-', 'P', 'Q', 'W'], GRIPS = [1, 2, 3, 6];
  // a minimal factory: two reagents, one bonder, one two-atom product
  const PUZZLE = {
    inputs: [{ cell: [2, -1], elem: 'Pb' }, { cell: [2, 0], elem: 'Hg' }],
    bonders: [[[-1, 0], [0, -1]]],
    output: { cells: [[0, 1], [-1, 1]], elems: ['Hg', 'Pb'], bonds: [[0, 1]] },
  };
  const CLAIMED = new Set(['2,-1', '2,0', '-1,0', '0,-1', '0,1', '-1,1']);
  const FREE = [];
  for (let q = -3; q <= 3; q++) for (let r = -3; r <= 3; r++) if (!CLAIMED.has(q + ',' + r)) FREE.push([q, r]);
  const randMachine = () => {
    const n = 1 + rnd(4), arms = [], used = new Set();
    for (let i = 0; i < n; i++) {
      const grippers = rnd.pick(GRIPS), len = 1 + rnd(3);
      let mount;
      if (i > 0 && rnd(3) === 0) { const p = arms[rnd(i)]; mount = { elbow: { parent: p.id, at: 1 + rnd(p.len) } }; }
      else {
        let c, k, tries = 0;
        do { c = rnd.pick(FREE); k = c[0] + ',' + c[1]; } while (used.has(k) && ++tries < 50);
        if (used.has(k)) continue;                  // board is full of bases; that arm is dropped
        used.add(k); mount = { ground: [c[0], c[1]] };
      }
      arms.push({ id: 'a' + i, grippers, len, mount, angle: rnd(6),
        tape: { delay: rnd(3), ops: Array.from({ length: 1 + rnd(10) }, () => rnd.pick(OPS)) } });
    }
    return { arms };
  };
  // everything a verifier would have to agree on, in a canonical order
  const snapshot = (sim) => {
    const S = sim.state;
    return {
      tick: S.tick, products: S.products, cycles: S.cycles, area: S.area.size, cost: S.cost,
      fault: S.fault ? { kind: S.fault.kind, tick: S.fault.tick, detail: S.fault.detail || null } : null,
      atoms: S.atoms.map(a => ({ id: a.id, cell: [a.cell[0], a.cell[1]], elem: a.elem,
        bonds: [...a.bonds].sort((x, y) => x - y) })).sort((x, y) => x.id - y.id),
      arms: S.arms.map(a => ({ id: a.id, angle: a.angle, carryRel: a.carryRel, baseRot: a.baseRot,
        base: a.basePos ? [a.basePos[0], a.basePos[1]] : null,
        holds: a.holds.map(h => h ? { kind: h.kind, id: h.id } : null) })),
    };
  };
  const N = 150;
  let crashed = null, diverged = null, badMetrics = null, faulted = 0, rejected = 0;
  const kinds = {};
  for (let n = 0; n < N; n++) {
    const m = randMachine();
    let a, b;
    // random machines may legitimately be invalid (e.g. a tip-mounted parent
    // whose tape grabs) — a clean rejection is fine as long as both runs agree
    try { a = GW.createSim(PUZZLE, m).run(60); }
    catch (ea) {
      if (!/^invalid machine:/.test(ea.message)) { if (!crashed) crashed = ea.message + ' on ' + JSON.stringify(m); continue; }
      let eb = null;
      try { GW.createSim(PUZZLE, m); } catch (e2) { eb = e2.message; }
      if (!diverged && eb !== ea.message) diverged = 'reject divergence: ' + ea.message + ' vs ' + eb;
      rejected++;
      continue;
    }
    try { b = GW.createSim(PUZZLE, m).run(60); }
    catch (e) { if (!crashed) crashed = e.message + ' on ' + JSON.stringify(m); continue; }
    const sa = snapshot(a), sb = snapshot(b);
    if (!diverged && !deepEq(sa, sb)) diverged = JSON.stringify(m) + '\n A ' + JSON.stringify(sa) + '\n B ' + JSON.stringify(sb);
    if (sa.fault) { faulted++; kinds[sa.fault.kind] = (kinds[sa.fault.kind] || 0) + 1; }
    const mm = a.metrics();
    if (!badMetrics && !(typeof mm.cost === 'number' && Number.isFinite(mm.cost)
      && typeof mm.area === 'number' && Number.isFinite(mm.area)
      && (mm.cycles === null || (typeof mm.cycles === 'number' && Number.isFinite(mm.cycles)))
      && (mm.sum === null || typeof mm.sum === 'number'))) badMetrics = JSON.stringify(mm);
  }
  check(`sim fuzz: ${N} seeded-random machines run 60 ticks or reject cleanly (${rejected} rejected)`,
    crashed === null, crashed);
  check(`sim fuzz: two independent runs agree bit-for-bit (${faulted} faulted: ${JSON.stringify(kinds)})`,
    diverged === null, diverged);
  check('sim fuzz: metrics are always well-formed (cost/area numbers, cycles null-or-number)',
    badMetrics === null, badMetrics);
}

// ---- conversion glyphs cannot see a GRIPPED atom (the grab lands in the same tick) ----
{
  const at = (sim, c) => sim.state.atoms.find(a => a.cell[0] === c[0] && a.cell[1] === c[1]);
  // a len-1 arm based at [2,0] facing W has its hand on [1,0]; a len-2 one reaches [0,0].
  const run = (puzzle, len, ops) => {
    const machine = { arms: [{ id: 'A', grippers: 1, len, mount: { ground: [2, 0] }, angle: 3, tape: { ops } }] };
    const sim = GW.createSim(puzzle, machine); sim.step(); return sim;
  };
  {
    const p = () => ({ atoms: [{ cell: [0, 0], elem: 'Au' }], disposals: [[0, 0]] });
    const held = run(p(), 2, ['G', 'W']), idle = run(p(), 2, ['W', 'W']);
    check('visibility: a gripped atom is invisible to a disposal (same tick as the grab)',
      !!at(held, [0, 0]) && !held.state.fault, JSON.stringify(held.state.fault));
    check('visibility: control — the same ungripped atom IS disposed', !at(idle, [0, 0]));
  }
  {
    const p = () => ({ atoms: [{ cell: [0, 0], elem: 'Pb' }, { cell: [1, 0], elem: 'Hg' }],
      projectors: [[[0, 0], [1, 0]]] });
    const held = run(p(), 1, ['G', 'W']), idle = run(p(), 1, ['W', 'W']);
    check('visibility: a gripped quicksilver is invisible to projection',
      at(held, [0, 0]).elem === 'Pb' && !!at(held, [1, 0]));
    check('visibility: control — the same ungripped quicksilver promotes Pb to Sn',
      idle.state.atoms.length === 1 && at(idle, [0, 0]).elem === 'Sn');
  }
  {
    const p = () => ({ atoms: [{ cell: [0, 0], elem: 'Cu' }, { cell: [1, 0], elem: 'Cu' }],
      purifiers: [[[0, 0], [1, 0], [0, 1]]] });
    const held = run(p(), 1, ['G', 'W']), idle = run(p(), 1, ['W', 'W']);
    check('visibility: a gripped metal is invisible to purification',
      !!at(held, [0, 0]) && !!at(held, [1, 0]) && !at(held, [0, 1]));
    check('visibility: control — the same ungripped pair purifies to Ag',
      idle.state.atoms.length === 1 && at(idle, [0, 1]).elem === 'Ag');
  }
  {
    const p = () => ({ atoms: [{ cell: [0, 0], elem: 'Sa' }, { cell: [1, 0], elem: 'Sa' }],
      animismus: [[[0, 0], [1, 0], [0, 1], [1, -1]]] });
    const held = run(p(), 1, ['G', 'W']), idle = run(p(), 1, ['W', 'W']);
    check('visibility: a gripped salt is invisible to animismus',
      !at(held, [0, 1]) && !at(held, [1, -1]) && !!at(held, [0, 0]));
    check('visibility: control — the same ungripped salt pair yields vitae + mors',
      at(idle, [0, 1]).elem === 'Vi' && at(idle, [1, -1]).elem === 'Mo');
  }
  {
    // the release in phase 2a precedes the glyph pass, so a 'D' reveals the atom
    // to the disposal in that very same tick
    const machine = { arms: [{ id: 'A', grippers: 1, len: 2, mount: { ground: [2, 0] }, angle: 3,
      tape: { ops: ['G', 'D', 'W'] } }] };
    const sim = GW.createSim({ atoms: [{ cell: [0, 0], elem: 'Au' }], disposals: [[0, 0]] }, machine);
    sim.step(); const survived = !!at(sim, [0, 0]);
    sim.step(); const gone = !at(sim, [0, 0]);
    check('visibility: a release makes the atom visible to the disposal in that same tick',
      survived && gone && !sim.state.fault, JSON.stringify({ survived, gone, fault: sim.state.fault }));
  }
}

// ---- conversion glyphs cannot see a BONDED atom, even once it has been let go ----
{
  // A len-2 arm based at the origin grabs the near end of a pre-bonded reagent at
  // [2,0]-[3,0] and turns once: the transform is the pure lattice rotation rotK(.,1),
  // so the pair lands on [0,2]-[0,3]. Tick 3 releases it, leaving a BONDED, UNGRIPPED
  // molecule sitting on the glyph — which must still be invisible.
  const at = (sim, c) => sim.state.atoms.find(a => a.cell[0] === c[0] && a.cell[1] === c[1]);
  const carry = (extra, elems) => {
    const puzzle = Object.assign({ inputs: [{ cells: [[2, 0], [3, 0]], elems, bonds: [[0, 1]] }] }, extra);
    const machine = { arms: [{ id: 'A', grippers: 1, len: 2, mount: { ground: [0, 0] }, angle: 0,
      tape: { ops: ['G', '+', 'D', 'W'] } }] };
    const sim = GW.createSim(puzzle, machine);
    for (let i = 0; i < 4; i++) sim.step();
    return sim;
  };
  {
    const sim = carry({ disposals: [[0, 2]] }, ['Au', 'Au']);
    const a = at(sim, [0, 2]);
    check('visibility: a bonded, released atom is invisible to a disposal',
      !!a && a.bonds.size === 1 && sim.state.arms[0].holds[0] === null && !sim.state.fault,
      JSON.stringify(sim.state.fault));
  }
  {
    const sim = carry({ purifiers: [[[0, 2], [0, 3], [-1, 3]]] }, ['Cu', 'Cu']);
    check('visibility: a bonded, released metal pair is invisible to purification',
      !!at(sim, [0, 2]) && !!at(sim, [0, 3]) && !at(sim, [-1, 3])
      && sim.state.arms[0].holds[0] === null && !sim.state.fault, JSON.stringify(sim.state.fault));
  }
  {
    const sim = carry({ animismus: [[[0, 2], [0, 3], [-1, 3], [1, 2]]] }, ['Sa', 'Sa']);
    check('visibility: a bonded, released salt pair is invisible to animismus',
      !at(sim, [-1, 3]) && !at(sim, [1, 2]) && !!at(sim, [0, 2]) && !!at(sim, [0, 3])
      && sim.state.arms[0].holds[0] === null && !sim.state.fault, JSON.stringify(sim.state.fault));
  }
  {
    const sim = carry({ projectors: [[[0, 3], [0, 2]]] }, ['Hg', 'Pb']);
    const m = at(sim, [0, 3]);
    check('visibility: a bonded, released quicksilver is invisible to projection',
      !!at(sim, [0, 2]) && m && m.elem === 'Pb' && sim.state.arms[0].holds[0] === null && !sim.state.fault,
      JSON.stringify(sim.state.fault));
  }
  {
    // ...but projection reads its METAL cell without the looseness filter, matching
    // Opus Magnum: a metal already inside a molecule can still be promoted. Same
    // carry, with a loose quicksilver waiting on the glyph's other cell.
    const sim = carry({ atoms: [{ cell: [-1, 2], elem: 'Hg' }], projectors: [[[0, 2], [-1, 2]]] },
      ['Pb', 'Sa']);
    const m = at(sim, [0, 2]);
    check('visibility: projection still promotes a BONDED metal (only the quicksilver must be loose)',
      m && m.elem === 'Sn' && m.bonds.size === 1 && !at(sim, [-1, 2]) && !sim.state.fault,
      JSON.stringify({ elem: m && m.elem, fault: sim.state.fault }));
  }
  {
    // The "bond formed this tick hides the atom from a later glyph in the same pass"
    // case is UNREACHABLE by construction: the bonder must own the cell the atom stands
    // on, and the layout rule forbids two glyphs sharing a cell. Pin that rule instead.
    const arms = [{ id: 'A', grippers: 1, len: 1, mount: { ground: [9, 9] }, angle: 0, tape: { ops: ['W'] } }];
    const rejects = (puzzle) => {
      try { GW.createSim(puzzle, { arms }); return false; } catch (e) { return /glyph overlap/.test(String(e)); }
    };
    check('visibility: a bonder can never share a cell with a conversion glyph (so a same-tick '
      + 'bond can never hide an atom from that pass)',
      rejects({ bonders: [[[0, 0], [1, 0]]], disposals: [[0, 0]] })
      && rejects({ bonders: [[[0, 0], [1, 0]]], projectors: [[[0, 0], [0, -1]]] })
      && rejects({ bonders: [[[0, 0], [1, 0]]], purifiers: [[[0, 0], [0, -1], [1, -1]]] })
      && rejects({ bonders: [[[0, 0], [1, 0]]], animismus: [[[0, 0], [0, -1], [1, -1], [-1, 0]]] }));
  }
}

// ---- repeat markers: symbolic on the wire, expanded before simulation ----
{
  check('repeat: expansion semantics (G + R R - R -> G+G+G+--)',
    GW.expandTape(['G', '+', 'R', 'R', '-', 'R']).ops.join('') === 'G+G+G+--');
  check('repeat: leading marker expands to nothing, all-marker tape to empty',
    GW.expandTape(['R', 'G']).ops.join('') === 'G'
    && GW.expandTape(['R', 'R', 'R']).ops.length === 0);

  const armsR = [{ id: 'A', grippers: 1, len: 1, mount: { ground: [0, 0] }, angle: 0,
    tape: { delay: 0, ops: ['G', '+', 'R', '-', 'R'] } }];
  const bytes = CODEC.encodeMachine({ arms: armsR });
  const dec = CODEC.decodeMachine(bytes);
  check('repeat: codec carries the marker symbolically',
    dec.arms[0].tape.ops.join('') === 'G+R-R');
  check('repeat: codec round-trips byte-for-byte',
    CODEC.encodeMachine(dec).join(',') === bytes.join(','));

  const puz = { inputs: [{ cell: [1, 0], elem: 'Sa' }], caps: { cycles: 10 } };
  const armsX = [{ id: 'A', grippers: 1, len: 1, mount: { ground: [0, 0] }, angle: 0,
    tape: { delay: 0, ops: GW.expandTape(armsR[0].tape.ops).ops } }];
  const a = GW.createSim(puz, { arms: armsR }), b = GW.createSim(puz, { arms: armsX });
  for (let i = 0; i < 10 && !a.state.fault; i++) { a.step(); b.step(); }
  const snap = (S) => JSON.stringify({ f: S.fault, t: S.tick, area: S.area.size,
    at: S.atoms.map(x => [x.id, x.cell, x.elem]) });
  check('repeat: marker tape simulates identically to its pre-expanded form',
    snap(a.state) === snap(b.state));

  const rejects = (m) => { try { GW.createSim({}, m); return false; } catch (e) { return /tape too long/.test(e.message); } };
  // 24 source ops (fits the cap), but 21 ops × 3 consecutive markers expands to 84 > 64
  const runaway = Array(21).fill('+').concat(['R', 'R', 'R']);
  check('repeat: cap binds the EXPANSION, not just the source',
    !rejects({ arms: [{ id: 'A', grippers: 1, len: 1, mount: { ground: [0, 0] }, angle: 0,
      tape: { delay: 0, ops: ['G', 'R'] } }] })
    && rejects({ arms: [{ id: 'A', grippers: 1, len: 1, mount: { ground: [0, 0] }, angle: 0,
      tape: { delay: 0, ops: runaway } }] }));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
