# GREAT WORK! — Game Specification

**Version 0.2 (draft) · game rules only — implementation details live elsewhere**

Great Work! is an open optimization puzzle. (The name is meant to be read as a compliment.) A puzzle asks for a product molecule to be
manufactured from reagents; a solution is a **machine** — parts placed on a hex grid,
each running a short looping instruction tape. The rules engine simulates the machine
deterministically. A submission either produces six products without faulting — and has
its metrics sealed to the permanent record — or it is rejected. There are no judges and
no partial credit.

---

## 1. The board

An unbounded field of hexagonal cells (pointy-top, six neighbors). There is no wall;
sprawl is punished by the **area** metric, not by geometry. All placement is on cell
centers. All rotation is in steps of 60°.

## 2. Atoms, molecules, bonds

- **Atoms** are discs centered on cells. Each has an element (the element roster is
  defined per puzzle). Atom radius is **0.35 × cell pitch** (so atoms resting on
  adjacent cells do not touch).
- A **bond** joins two atoms on adjacent cells. Bonded atoms form a **molecule**, which
  is perfectly rigid: it translates and rotates only as a whole.
- Bonds are created by glyphs (§4). Bonds are permanent (no debonding in v0.1).

## 3. Parts and prices

| Part | Price | Notes |
|---|---|---|
| Arm, single gripper | 20g | one gripper at the tip |
| Arm, dual gripper | 24g | two grippers, 180° apart |
| Arm, tri gripper | 26g | three grippers, 120° apart |
| Arm, hex gripper | 30g | six grippers, 60° apart |
| Elbow attachment | +5g | mounts an arm on another arm (§5) |
| Bond glyph | 10g | two fixed adjacent cells; bonds whatever pair rests on them |
| Reagent glyph (input) | free | spawns its element whenever its cell is empty |
| Product glyph (output) | free | consumes a completed product (§7) |

- Arm **length** is chosen at build time, 1–3 cells, at no cost.
- Every arm has a **base**. A base either anchors to a board cell (**ground base**) or
  mounts on another arm via an **elbow** (+5g).
- **All bases are grabbable** (§8).

### Occupancy and collidability

- Anything that anchors to the board, and anything grabbable, **occupies its cell and
  collides**: ground bases and all arm bases, including while being carried.
- **Elbow joints do not occupy or collide** — that exemption is part of what the +5g
  buys.
- Arm shafts and grippers never collide. Atoms always collide.
- Glyph cells do not collide (they are floor markings, not objects).

## 4. Glyphs

- **Reagent glyph**: at the start of every tick, if its cell is empty, a fresh atom of
  its element appears there.
- **Bond glyph**: at the end of every tick, if both of its cells hold atoms and those
  atoms are not already bonded to each other, they bond.
- **Product glyph**: a set of cells with a required element in each and required bonds
  between them — the target molecule, fully specified, in a fixed pose. At the end of a
  tick, if a molecule exactly matches (right elements on the right cells, right bonds,
  no extra atoms in the molecule) and no gripper is holding it, it is consumed and the
  product count increases by one.

## 5. Machines and articulation

A machine is a set of parts. Arms form **kinematic trees**: an arm's base sits either
on the board or — via an elbow — at an integer position (1..len) along a parent arm.
When any joint turns, everything downstream — child arms, grippers, held cargo — moves
rigidly with it.

Tracks are deliberately omitted: base-grabbing covers relocation.

Two roads to articulation, deliberately priced apart:

- **Elbow** (+5g): permanent weld; the joint doesn't collide; no gripper is spent.
- **Grab a base** (no surcharge): any gripper may grab any arm's base (§8); the carried
  base still collides, the gripper is occupied while carrying, and the arrangement can
  be changed mid-run.

## 6. Instructions

One tape per arm. Tapes loop forever; different arms may have different tape lengths,
and **tapes are never padded to a common period** — synchronization is the builder's
problem (a UI may offer affordances, but the rules don't help). A tape may begin with
**delay blocks**: they run only on the tape's first pass, holding the arm for one tick
each, and are excluded from the loop thereafter — so delays phase-shift an arm without
changing its period.
Every instruction is **coordinate-free** — its meaning is unchanged if the arm has been
carried, turned, or re-planted.

| Glyph | Instruction | Effect |
|---|---|---|
| `G` | GRAB | all of the arm's grippers close; each takes hold of whatever rests at its cell (an atom takes its whole molecule; a base takes its whole tower) |
| `D` | RELEASE | all grippers open; cargo stays where it is |
| `↻` `↺` | TURN | the arm rotates 60° about its base, sweeping everything downstream |
| `↷` `↶` | PIVOT | each held cargo rotates 60° about the gripper holding it; the arm itself does not move |
| `·` | WAIT | hold for one tick |
| `»` | DELAY | start-of-tape only; holds one tick on the first pass, then vanishes from the loop |

## 7. The tick

Each tick, in order:

1. **Spawn** — reagent glyphs refill empty cells.
2. **Grab / release** — all `G` and `D` instructions take effect instantaneously.
3. **Motion** — all turning and pivoting parts move **simultaneously** along ideal
   circular arcs from their old pose to their new pose, subject to the sweep rule (§9).
4. **Bond** — bond glyphs act.
5. **Output** — product glyphs act.

Simultaneity is real: there is no arm execution order, and no rule may depend on one.

## 8. Grabbing machines

- A gripper resting on a base cell that executes `G` grabs that arm's whole tower. The
  tower becomes cargo: it translates and rotates rigidly with the gripper, **while its
  own tapes keep running** — turn is turn and grab is grab in any frame.
- On `D`, the tower re-anchors wherever it stands, at whatever orientation it has
  accumulated.
- Several grippers may hold the same object — molecule or tower — so long as every
  motion they impose on it is **identical** (§10). This is the only double-grab rule.
- The grab graph must remain a forest. A tower grabbing itself, or two towers holding
  each other's bases, is a fault.

## 9. Motion and the sweep rule

Motion within a tick follows ideal geometry: a turning arm sweeps its downstream
through a 60° arc; nested joints compose; carried cargo follows its carrier exactly.

**Collision is checked at K = 12 uniformly spaced sample instants within each tick.**
At each sample instant, if any two collidable discs (atoms, occupying bases) overlap,
the machine faults. This sampled check **is** the collision rule — it is exact and
complete, not an approximation of some finer rule. Motion that threads between sample
instants is legal, by definition.

## 10. Faults

A machine that faults at any tick fails verification, and the submission is rejected
with the fault and tick number. Faults:

- **Collision** — two collidable discs overlap at a sample instant.
- **Overconstraint** — an object is required to follow two rigid motions in the same
  tick that are not identical. (Covers double-grab conflicts, torn molecules, and every
  tug-of-war.)
- **Grab cycle** — the grab graph ceases to be a forest.
- **Exhaustion** — the cycle cap (§12) is reached before six products.

There is no undefined behavior. Anything not permitted is a fault; anything that
faults is rejected; everything else is legal.

## 11. Verification and metrics

A submission is the full machine: parts, placements, tapes. The rules engine runs it
until **six products** are consumed or a fault occurs. On success, three metrics are
sealed:

- **Cost** — the sum of part prices.
- **Cycles** — the tick on which the sixth product is consumed.
- **Area** — the number of distinct cells visited (center-wise, at any sample instant)
  by any atom, base, or gripper, plus all glyph cells.
- **SUM = cost + cycles + area.** Lower is better. Ranking is by SUM; ties stand in
  submission (block) order — an equal SUM changes nothing.

## 12. Caps

Defaults, overridable per puzzle: max 24 parts · max elbow depth 4 · max tape length
64 · max 64 live atoms · max 4,000 cycles.

## 13. Puzzles and tournaments

A puzzle fixes: the element roster, reagent and product definitions, the **arsenal**
(which parts are permitted — e.g., a launch puzzle may forbid elbows or base-grabbing),
any cap overrides, and optionally a **prize escrow**:

- The escrow holds tokens in the rules contract itself.
- A **30-day fuse** counts down. A submission with a **strictly better SUM** than the
  reigning best takes the crown and resets the fuse. Ties — including byte-for-byte
  copies of the public champion machine — change nothing.
- If the fuse reaches zero, the contract pays the reigning champion. No organizer, no
  ceremony.

## 14. Open questions

- **Pistons** (runtime-variable arm length) — likely 40g if adopted; interacts with the
  sweep rule but not with the tree model.
- Additional glyph types: debonding, multi-bond/triplex, transmutation.
- Multi-product puzzles and molecule outputs larger than one glyph pose.
- Exact sample-instant arithmetic (fixed-point trig table) — specified in the engine
  document, not here; the rule is §9, the table is implementation.
- Element roster and visual identity of elements.
- Whether K = 12 is the right sampling density (it is a *rules* choice, not a
  performance choice: it defines what "threading the needle" means).
