/* GREAT WORK! — example puzzles & machines (shared by tests and the lab) */
(function (root) {
  'use strict';

  const EXAMPLES = [
    {
      key: 'courier',
      name: 'The Courier',
      blurb: 'One arm, no elbows: grab, bond, deliver, repeat. The floor every builder starts from.',
      expect: { cycles: 158 },
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
      expect: { cycles: 79 },
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
      expect: { cycles: 157 },
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
      key: 'beadwheel',
      name: 'The Bead Wheel',
      blurb: 'Tria Prima: salt, quicksilver, sulfur in one chain. The wheel carries the growing molecule around its ring while the feeder threads beads onto it — passing within a whisker of a fault, legally.',
      expect: { cycles: 139 },
      puzzle: {
        inputs: [{ cell: [-1, 0], elem: 'Sa' }, { cell: [1, -2], elem: 'Hg' }, { cell: [-1, -2], elem: 'S' }],
        bonders: [[[0, -1], [1, -1]]],
        output: { cells: [[-1, 1], [0, 1], [1, 0]], elems: ['Sa', 'Hg', 'S'], bonds: [[0, 1], [1, 2]] },
      },
      machine: {
        arms: [
          { id: 'W', grippers: 1, len: 1, mount: { ground: [0, 0] }, angle: 3,
            tape: { ops: ['G', '+', '+', 'W', '+', 'W', 'W', 'W', 'W', 'W', '+', '+', 'D', '+'] } },
          { id: 'F', grippers: 1, len: 1, mount: { ground: [0, -2] }, angle: 0,
            tape: { delay: 1, ops: ['G', 'W', '+', 'D', '+', '+', 'G', '-', '-', 'D', '-', 'W', 'W', 'W'] } },
        ],
      },
    },
    {
      key: 'goldladder',
      name: 'The Gold Ladder',
      blurb: 'Lead to tin to iron to copper to silver to gold: a dual-gripper shuttle feeds quicksilver to the projection glyph — one hand delivering while the other reloads — and the courier extracts the finished gold.',
      expect: { cycles: 308 },
      puzzle: {
        inputs: [{ cell: [-1, 0], elem: 'Pb' }, { cell: [3, -3], elem: 'Hg' }],
        projectors: [[[1, 0], [1, -1]]],
        output: { cells: [[0, 1]], elems: ['Au'], bonds: [] },
      },
      machine: {
        arms: [
          { id: 'A', grippers: 1, len: 1, mount: { ground: [0, 0] }, angle: 3,
            tape: { ops: ['G', '-', '-', '-', 'D',
                          'W', 'W', 'W', 'W', 'W', 'W', 'W', 'W', 'W', 'W', 'W', 'W', 'W', 'W', 'W', 'W', 'W', 'W', 'W', 'W', 'W',
                          'G', '+', 'D', '+', '+'] } },
          { id: 'S', grippers: 2, len: 1, mount: { ground: [2, -2] }, angle: 5,
            tape: { delay: 1,
                    ops: ['G', '+', '+', '+', 'D', 'G', '+', '+', '+', 'D', 'G', '+', '+', '+', 'D',
                          'G', '+', '+', '+', 'D', 'G', '+', '+', '+', 'D', 'W', 'W', 'W', 'W', 'W', 'W'] } },
        ],
      },
    },
    {
      key: 'ouroboros',
      name: 'The Ouroboros',
      blurb: 'Two arms grab each other\'s bases in the same instant. The grab graph must remain a forest — the serpent that eats its own tail is rejected on the spot.',
      expect: { fault: 'grab-cycle' },
      puzzle: {},
      machine: {
        arms: [
          { id: 'A', grippers: 1, len: 1, mount: { ground: [0, 0] }, angle: 0, tape: { ops: ['G', 'W', 'W'] } },
          { id: 'B', grippers: 1, len: 1, mount: { ground: [1, 0] }, angle: 3, tape: { ops: ['G', 'W', 'W'] } },
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
