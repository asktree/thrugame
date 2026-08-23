# GREAT WORK! — Game Specification

**Version 0.3 (draft) · game rules only — implementation details live elsewhere**

Great Work! is an open optimization puzzle. (The name is meant to be read as a compliment.) A puzzle asks for a product molecule to be
manufactured from reagents; a solution is a **machine** — parts placed on a hex grid,
each running a short looping instruction tape. The rules engine simulates the machine
deterministically. A submission either produces nine products without faulting — and has
its metrics sealed to the permanent record — or it is rejected. There are no judges and
no partial credit.

---

## 1. The board

An unbounded field of hexagonal cells (pointy-top, six neighbors). There is no wall;
sprawl is punished by the **area** metric, not by geometry. All placement is on cell
centers. All rotation is in steps of 60°.

## 2. Atoms, molecules, bonds

- **Atoms** are discs centered on cells. Atom radius is **0.35 × cell pitch** (so
  atoms resting on adjacent cells do not touch).
- The element roster is adopted from Opus Magnum's campaign: the four **cardinals**
  (air, earth, fire, water), **salt**, **quicksilver**, the six **metals** on the
  promotion ladder **lead → tin → iron → copper → silver → gold**, and **vitae** and
  **mors**. Puzzles state which elements they use.
- A **bond** joins two atoms on adjacent cells. Bonded atoms form a **molecule**, which
  is perfectly rigid: it translates and rotates only as a whole. Bonds are created and
  destroyed by glyphs (§4).

## 3. Parts and prices

| Part | Price | Notes |
|---|---|---|
| Arm, single gripper | 20g | one gripper at the tip |
| Arm, dual gripper | 24g | two grippers, 180° apart |
| Arm, tri gripper | 26g | three grippers, 120° apart |
| Arm, hex gripper | 30g | six grippers, 60° apart |
| Elbow attachment | +5g × order | an arm on an arm costs +5g; an arm on *that* arm +10g; fourth order +15g — articulation compounds (§5) |
| Bond glyph | 10g | two adjacent cells; bonds whatever pair rests on them |
| Debond glyph | 15g | two adjacent cells; removes the bond between the atoms on them |
| Calcification glyph | 10g | one cell; a cardinal atom resting on it becomes salt |
| Duplication glyph | 20g | cardinal cell + salt cell; the salt becomes a copy of the cardinal |
| Projection glyph | 20g | metal cell + quicksilver cell; consumes the quicksilver, promotes the metal one rung |
| Purification glyph | 20g | two metal cells + one out cell; two equal metals become one of the next rung |
| Animismus glyph | 20g | two salt cells + two out cells; two salt become one vitae and one mors |
| Disposal glyph | 0g | a cell plus its whole surrounding ring (seven cells); destroys a lone, unheld atom resting on the center |
| Reagent glyph (input) | free | spawns its molecule whenever its footprint is empty |
| Product glyph (output) | free | consumes a completed product (§7) |

Glyph behavior, prices, and **shapes** mirror Opus Magnum's campaign. Every glyph is a
fixed shape, placed by translation and rotation only — never mirrored. The two-cell
glyphs (bond, debond, duplication, projection) are adjacent pairs; purification is two
adjacent inputs with the output on the flank; animismus is two adjacent salts with the
vitae output flanking one side and the mors output the other. A submission whose glyph
does not match its canonical shape is rejected before simulation. Multi-bonding and
triplex bonding are adopted in principle but deferred (§14) — they are the only glyphs
that introduce new geometry or a new bond type.

- Arm **length** is chosen at build time, 1–3 cells, at no cost.
- Every arm has a **base**. A base either anchors to a board cell (**ground base**) or
  mounts on another arm via an **elbow** (+5g).
- **All bases are grabbable** (§8).

### Layout

At submission time the board layout must be non-overlapping: **no two glyphs may share
a cell** (reagent and product glyphs included), and **no ground base may sit on a glyph
cell**. In particular, nothing may overlap the product glyph — a finished molecule is
always assembled elsewhere and brought to it. Overlapping layouts are rejected before
simulation begins.

### Occupancy and collidability

- Anything that anchors to the board, and anything grabbable, **occupies its cell and
  collides**: ground bases and all arm bases, including while being carried.
- **Elbow joints do not occupy or collide** — that exemption is part of what the
  elbow surcharge buys.
- Arm shafts and grippers never collide. Atoms always collide.
- Glyph cells do not collide (they are floor markings, not objects).

## 4. Glyphs

- **Reagent glyph**: a whole molecule — one atom or many, with bonds. At the start of
  every tick, if every cell of its footprint is empty, a fresh copy spawns.
- **Transmutation glyphs** (bond, debond, calcification, duplication, projection,
  purification, animismus, disposal) act at the end of every tick, whenever the atoms
  resting on their cells satisfy their rule. Bonding, debonding, calcification, and
  duplication work on held atoms; the **converting** glyphs cannot see bonded or held
  atoms — projection's quicksilver, purification's metals, animismus's salts, and
  disposal's victim must all be loose, exactly as in Opus Magnum.
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

- **Elbow** (+5g × order): permanent weld; the joint doesn't collide; no gripper is spent. Depth compounds: each further order of attachment costs 5g more than the last.
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
- **Exhaustion** — the cycle cap (§12) is reached before nine products.

There is no undefined behavior. Anything not permitted is a fault; anything that
faults is rejected; everything else is legal.

## 11. Verification and metrics

A submission is the full machine: parts, placements, tapes. The rules engine runs it
until **nine products** are consumed or a fault occurs. On success, three metrics are
sealed:

- **Cost** — the sum of part prices.
- **Cycles** — the tick on which the ninth product is consumed.
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
- Multi-bonding geometry and triplex bonds (the two deferred Opus glyph mechanics).
- Multi-product puzzles and molecule outputs larger than one glyph pose.
- Exact sample-instant arithmetic (fixed-point trig table) — specified in the engine
  document, not here; the rule is §9, the table is implementation.
- Element roster and visual identity of elements.
- Whether K = 12 is the right sampling density (it is a *rules* choice, not a
  performance choice: it defines what "threading the needle" means).
