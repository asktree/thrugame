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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
