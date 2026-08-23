/* GREAT WORK! — example puzzles & machines (shared by tests and the lab) */
(function (root) {
  'use strict';

  const EXAMPLES = [
    {
      key: 'courier',
      name: 'The Courier',
      blurb: 'One arm, no elbows: grab, bond, deliver, repeat. The floor every builder starts from.',
      expect: { cycles: 142 },
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
      expect: { cycles: 75 },
      puzzle: {
        inputs: [{ cell: [2, -1], elem: 'Pb' }, { cell: [0, 2], elem: 'Hg' }],
        bonders: [[[2, 0], [1, 1]]],
        output: { cells: [[3, 1], [3, 0]], elems: ['Pb', 'Hg'], bonds: [[0, 1]] },
      },
      machine: {
        arms: [
          { id: 'P', grippers: 1, len: 2, mount: { ground: [0, 0] }, angle: 0,
            tape: { ops: ['W', 'W', 'W', '+', 'W', 'W', 'W', '-'] } },
          { id: 'C', grippers: 1, len: 1, mount: { elbow: { parent: 'P', at: 1 } }, angle: 5,
            tape: { ops: ['G', '+', 'D', 'W', 'G', '-', 'D', 'W'] } },
          { id: 'X', grippers: 1, len: 1, mount: { ground: [2, 1] }, angle: 4,
            tape: { delay: 7, ops: ['G', '+', '+', 'D', '-', '-', 'W', 'W'] } },
        ],
      },
    },
    {
      key: 'crane',
      name: 'The Crane',
      blurb: 'A worker arm runs one six-step loop forever. The crane relocates it — mid-loop, tapes still ticking — so the same coordinate-free tape ferries lead in one place and quicksilver in another.',
      expect: { cycles: 147 },
      puzzle: {
        inputs: [{ cell: [3, -1], elem: 'Pb' }, { cell: [3, 2], elem: 'Hg' }],
        bonders: [[[1, 1], [1, 2]]],
        output: { cells: [[0, 4], [1, 4]], elems: ['Hg', 'Pb'], bonds: [[0, 1]] },
      },
      machine: {
        arms: [
          { id: 'W', grippers: 1, len: 1, mount: { ground: [2, 0] }, angle: 5,
            tape: { ops: ['G', '+', '+', '+', 'D', '-', '-', '-'] } },
          { id: 'C', grippers: 1, len: 2, mount: { ground: [0, 2] }, angle: 5,
            tape: { delay: 5, ops: ['G', '+', 'D', 'W', 'W', 'W', 'W', 'W', 'G', '-', 'D', 'W', 'W', 'W', 'W', 'W'] } },
          { id: 'X', grippers: 1, len: 1, mount: { ground: [0, 3] }, angle: 5,
            tape: { delay: 15, ops: ['G', '+', '+', 'D', '-', '-', 'W', 'W', 'W', 'W', 'W', 'W', 'W', 'W', 'W', 'W'] } },
        ],
      },
    },
    {
      key: 'beadwheel',
      name: 'The Bead Wheel',
      blurb: 'Tria Prima: salt, quicksilver, sulfur in one chain. The wheel carries the growing molecule around its ring while the feeder threads beads onto it — passing within a whisker of a fault, legally.',
      expect: { cycles: 125 },
      puzzle: {
        inputs: [{ cell: [-1, 0], elem: 'Sa' }, { cell: [1, -2], elem: 'Hg' }, { cell: [-1, -2], elem: 'Sa' }],
        bonders: [[[0, -1], [1, -1]]],
        output: { cells: [[-1, 1], [0, 1], [1, 0]], elems: ['Sa', 'Hg', 'Sa'], bonds: [[0, 1], [1, 2]] },
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
      expect: { cycles: 277 },
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
      key: 'leachworks',
      name: 'The Leaching Works',
      blurb: 'Water alone becomes a chain of salt, salt, mors, and vitae. Four waters calcify in transit; an animismus glyph — its shape fixed, like every glyph — turns a salt pair into vitae and mors; and a rocking wheel drags the growing chain back and forth across a single bonder before laying the finished compound around its own hub. Six arms, one product every twenty ticks.',
      expect: { cycles: 179 },
      puzzle: {
        inputs: [
          { cell: [-3, 0], elem: 'Wa' }, { cell: [1, -3], elem: 'Wa' },
          { cell: [4, 0], elem: 'Wa' }, { cell: [4, -5], elem: 'Wa' },
        ],
        calcifiers: [[-1, -1], [0, -2], [4, -2], [4, -4]],
        animismus: [[[2, -2], [3, -3], [3, -2], [2, -3]]],
        bonders: [[[0, -1], [1, -1]]],
        output: {
          cells: [[1, 0], [0, 1], [-1, 1], [-1, 0]],
          elems: ['Sa', 'Sa', 'Mo', 'Vi'],
          bonds: [[0, 1], [1, 2], [2, 3]],
        },
      },
      machine: {
        arms: [
          { id: 'W', grippers: 1, len: 1, mount: { ground: [0, 0] }, angle: 3,
            tape: { delay: 5, ops: ['G','+','-','W','W','W','W','W','-','W','W','-','-','D','+','+','+','W','W','W'] } },
          { id: 'H', grippers: 1, len: 1, mount: { ground: [-2, 0] }, angle: 3,
            tape: { ops: ['G','+','+','+','D','-','-','-','W','W','W','W','W','W','W','W','W','W','W','W'] } },
          { id: 'F', grippers: 1, len: 1, mount: { ground: [1, -2] }, angle: 4,
            tape: { delay: 3, ops: ['G','-','-','-','D','-','-','G','+','+','D','-','-','-','W','W','W','W','W','W'] } },
          { id: 'V', grippers: 1, len: 1, mount: { ground: [2, -1] }, angle: 5,
            tape: { delay: 13, ops: ['G','-','-','D','+','+','W','W','W','W','W','W','W','W','W','W','W','W','W','W'] } },
          { id: 'P', grippers: 1, len: 2, mount: { ground: [2, 0] }, angle: 0,
            tape: { delay: 4, ops: ['G','-','-','D','+','+','W','W','W','W','W','W','W','W','W','W','W','W','W','W'] } },
          { id: 'Q', grippers: 1, len: 1, mount: { ground: [3, -4] }, angle: 5,
            tape: { delay: 5, ops: ['G','+','+','D','-','-','W','W','W','W','W','W','W','W','W','W','W','W','W','W'] } },
        ],
      },
    },
    {
      key: 'airshipfuel',
      name: 'Airship Fuel',
      blurb: 'Imported from Opus Magnum (chapter one). Fire alone becomes a zigzag of salt and flame. A dimer factory bonds salt to fire — the salt calcified in transit — and two joiner arms pose the halves over a second bonder: one pivot for the left half, two for the right, because the zigzag bends both ways.',
      expect: { cycles: 162 },
      puzzle: {
        inputs: [
          { cell: [3, 2], elem: 'Fi' }, { cell: [5, 0], elem: 'Fi' }, { cell: [0, -3], elem: 'Fi' },
        ],
        calcifiers: [[3, 1]],
        bonders: [[[2, 1], [3, 0]], [[0, 0], [1, 0]]],
        output: { cells: [[-3, 4], [-3, 3], [-2, 2], [-2, 1]], elems: ['Sa', 'Fi', 'Fi', 'Sa'],
                  bonds: [[0, 1], [1, 2], [2, 3]] },
      },
      machine: {
        arms: [
          { id: 'S', grippers: 1, len: 1, mount: { ground: [2, 2] }, angle: 0,
            tape: { ops: ['G','-','-','D','+','+','W','W','W','G','-','-','D','+','+','W','W','W'] } },
          { id: 'F', grippers: 1, len: 2, mount: { ground: [5, -2] }, angle: 1,
            tape: { delay: 1, ops: ['G','+','D','-','W','W','W','W','W','G','+','D','-','W','W','W','W','W'] } },
          { id: 'J', grippers: 1, len: 3, mount: { ground: [0, 3] }, angle: 5,
            tape: { delay: 3, ops: ['G','-','P','W','W','W','W','W','W','W','W','W','W','-','D','+','+','W'] } },
          { id: 'K', grippers: 1, len: 2, mount: { ground: [1, 2] }, angle: 5,
            tape: { delay: 12, ops: ['G','Q','Q','-','D','+','W','W','W','W','W','W','W','W','W','W','W','W'] } },
        ],
      },
    },
    {
      key: 'surrenderflare',
      name: 'Surrender Flare',
      blurb: 'Imported from Opus Magnum (chapter two). An iron core sealed inside six salt petals must come out copper — but the projection glyph cannot reach a surrounded core. So: sever one petal, walk the open flower around the wheel past the quicksilver, pivot the core onto a bonder, and let the porter hand the petal back. The porter then carries the whole flower to the product glyph.',
      expect: { cycles: 162 },
      puzzle: {
        inputs: [
          { cells: [[2, -2], [3, -2], [2, -1], [1, -1], [1, -2], [2, -3], [3, -3]],
            elems: ['Fe', 'Sa', 'Sa', 'Sa', 'Sa', 'Sa', 'Sa'],
            bonds: [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6]] },
          { cell: [3, 2], elem: 'Hg' },
        ],
        debonders: [[[0, -2], [-1, -2]]],
        projectors: [[[0, 2], [1, 2]]],
        bonders: [[[-1, -1], [-2, -1]]],
        output: { cells: [[-4, -1], [-3, -1], [-4, 0], [-5, 0], [-5, -1], [-4, -2], [-3, -2]],
                  elems: ['Cu', 'Sa', 'Sa', 'Sa', 'Sa', 'Sa', 'Sa'],
                  bonds: [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6]] },
      },
      machine: {
        arms: [
          { id: 'M', grippers: 1, len: 1, mount: { ground: [0, 0] }, angle: 5,
            tape: { ops: ['G','-','W','W','+','+','+','W','W','W','+','P','+','W','D','+','+','W'] } },
          { id: 'P', grippers: 1, len: 1, mount: { ground: [-2, -2] }, angle: 0,
            tape: { delay: 3, ops: ['G','-','W','W','W','W','W','-','-','-','-','W','+','+','D','-','-','-'] } },
          { id: 'Q', grippers: 1, len: 2, mount: { ground: [1, 4] }, angle: 5,
            tape: { delay: 7, ops: ['G','-','D','+','W','W','W','W','W','W','W','W','W','W','W','W','W','W'] } },
        ],
      },
    },
    {
      key: 'ablativecrystal',
      name: 'Ablative Crystal',
      blurb: 'Imported from Opus Magnum (journal III) — and still unsolved here. Two silver-core flowers must become one thirteen-atom crystal: a gold core, a ring of six fire, six salt at the points, twenty-four bonds. The reference machine below is an empty gesture; it idles until the cycle cap rejects it. The first machine to seal this record earns the name Great Work.',
      expect: { fault: 'exhaustion' },
      puzzle: {
        caps: { cycles: 120 },
        inputs: [
          { cells: [[4, 0], [5, 0], [4, 1], [3, 1], [3, 0], [4, -1], [5, -1]],
            elems: ['Ag', 'Sa', 'Fi', 'Sa', 'Fi', 'Sa', 'Fi'],
            bonds: [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6]] },
        ],
        purifiers: [[[0, -3], [1, -3], [0, -2]]],
        bonders: [[[-1, 3], [0, 3]]],
        debonders: [[[2, 2], [3, 2]]],
        output: {
          cells: [[-4, 0], [-3, 0], [-4, 1], [-5, 1], [-5, 0], [-4, -1], [-3, -1],
                  [-3, 1], [-5, 2], [-6, 1], [-5, -1], [-3, -2], [-2, -1]],
          elems: ['Au', 'Fi', 'Fi', 'Fi', 'Fi', 'Fi', 'Fi',
                  'Sa', 'Sa', 'Sa', 'Sa', 'Sa', 'Sa'],
          bonds: [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6],
                  [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 1],
                  [1, 7], [2, 7], [2, 8], [3, 8], [3, 9], [4, 9],
                  [4, 10], [5, 10], [5, 11], [6, 11], [6, 12], [1, 12]],
        },
      },
      machine: {
        arms: [
          { id: 'A', grippers: 1, len: 1, mount: { ground: [0, 5] }, angle: 0, tape: { ops: ['W'] } },
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
