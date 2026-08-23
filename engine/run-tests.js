/* GREAT WORK! — golden tests for the reference engine */
'use strict';
const GW = require('./engine.js');
const EXAMPLES = require('./examples.js');

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

// ---- elbow pricing compounds with order ----
{
  const machine = { arms: [
    { id: 'A', grippers: 1, len: 1, mount: { ground: [0, 0] }, angle: 0, tape: { ops: ['W'] } },
    { id: 'B', grippers: 1, len: 1, mount: { elbow: { parent: 'A', at: 1 } }, angle: 0, tape: { ops: ['W'] } },
    { id: 'C', grippers: 1, len: 1, mount: { elbow: { parent: 'B', at: 1 } }, angle: 0, tape: { ops: ['W'] } },
  ] };
  const sim = GW.createSim({}, machine);
  check('pricing: 20 + (20+5) + (20+10) = 75', sim.metrics().cost === 75, 'got ' + sim.metrics().cost);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
