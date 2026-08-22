/* GREAT WORK! — example puzzles & machines (shared by tests and the lab) */
(function (root) {
  'use strict';

  const EXAMPLES = [
    {
      key: 'courier',
      name: 'The Courier',
      blurb: 'One arm, no elbows: grab, bond, deliver, repeat. The floor every builder starts from.',
      expect: { cycles: 94 },
      puzzle: {
        inputs: [{ cell: [1, -1], elem: 'Pb' }, { cell: [1, 0], elem: 'Hg' }],
        bonders: [[[-1, 0], [0, -1]]],
        output: { cells: [[0, 1], [-1, 1]], elems: ['Hg', 'Pb'], bonds: [[0, 1]] },
      },
      machine: {
        arms: [
          { id: 'A', grippers: 1, len: 1, mount: { ground: [0, 0] }, angle: 5,
            tape: { ops: ['G', '-', 'D', '+', '+', 'G', '+', '+', '+', 'D', 'G', '-', '-', 'D', '-', '-'] } },
        ],
      },
    },
    {
      key: 'ferris',
      name: 'The Ferris',
      blurb: 'An elbow arm rides its parent between two worlds: Pb-side and Hg-side share one child tape. The bonder doubles as the product glyph, so the compound vanishes the instant it forms.',
      expect: { cycles: 47 },
      puzzle: {
        inputs: [{ cell: [2, -1], elem: 'Pb' }, { cell: [0, 2], elem: 'Hg' }],
        bonders: [[[2, 0], [1, 1]]],
        output: { cells: [[2, 0], [1, 1]], elems: ['Pb', 'Hg'], bonds: [[0, 1]] },
      },
      machine: {
        arms: [
          { id: 'P', grippers: 1, len: 2, mount: { ground: [0, 0] }, angle: 0,
            tape: { ops: ['W', 'W', 'W', '+', 'W', 'W', 'W', '-'] } },
          { id: 'C', grippers: 1, len: 1, mount: { elbow: { parent: 'P', at: 1 } }, angle: 5,
            tape: { ops: ['G', '+', 'D', 'W', 'G', '-', 'D', 'W'] } },
        ],
      },
    },
    {
      key: 'crane',
      name: 'The Crane',
      blurb: 'A worker arm runs one six-step loop forever. The crane relocates it — mid-loop, tapes still ticking — so the same coordinate-free tape ferries lead in one place and quicksilver in another.',
      expect: { cycles: 93 },
      puzzle: {
        inputs: [{ cell: [3, -1], elem: 'Pb' }, { cell: [3, 2], elem: 'Hg' }],
        bonders: [[[1, 1], [1, 2]]],
        output: { cells: [[1, 1], [1, 2]], elems: ['Pb', 'Hg'], bonds: [[0, 1]] },
      },
      machine: {
        arms: [
          { id: 'W', grippers: 1, len: 1, mount: { ground: [2, 0] }, angle: 5,
            tape: { ops: ['G', '+', '+', '+', 'D', '-', '-', '-'] } },
          { id: 'C', grippers: 1, len: 2, mount: { ground: [0, 2] }, angle: 5,
            tape: { delay: 5, ops: ['G', '+', 'D', 'W', 'W', 'W', 'W', 'W', 'G', '-', 'D', 'W', 'W', 'W', 'W', 'W'] } },
        ],
      },
    },
    {
      key: 'tugofwar',
      name: 'The Tug of War',
      blurb: 'Two arms hold one molecule; one of them turns. Every object follows at most one rigid motion — this machine is rejected at tick 3, and that rejection is the whole show.',
      expect: { fault: 'overconstraint' },
      puzzle: {
        atoms: [{ cell: [1, 0], elem: 'Pb' }, { cell: [2, -1], elem: 'Hg' }],
        bonders: [[[1, 0], [2, -1]]],
      },
      machine: {
        arms: [
          { id: 'A', grippers: 1, len: 1, mount: { ground: [0, 0] }, angle: 0,
            tape: { ops: ['W', 'G', '+', 'W'] } },
          { id: 'B', grippers: 1, len: 1, mount: { ground: [3, -1] }, angle: 3,
            tape: { ops: ['W', 'G', 'W', 'W'] } },
        ],
      },
    },
  ];

  if (typeof module !== 'undefined' && module.exports) module.exports = EXAMPLES;
  else root.GW_EXAMPLES = EXAMPLES;
})(typeof self !== 'undefined' ? self : this);
