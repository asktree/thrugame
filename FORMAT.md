# GREAT WORK! — Machine Serialization Format

The canonical encoding of a submission: the bytes a player submits as calldata,
and the share-string the solution editor emits. One format, both places — a
solution built in the browser is already in its on-chain shape.

The format encodes the **machine only**. The puzzle is identified separately
(by id on chain; by key prefix in editor share-strings, e.g. `leachworks.AQZK…`).
Glyph placements belong to the puzzle, not the submission.

## Why not Opus Magnum's `.solution` format

Ours differs where the games differ:

- **Tapes** are unpadded loops with first-pass-only delay blocks, so a tape is
  `(delay count, op list)` — not OM's global instruction grid with per-arm
  start offsets.
- **Elbows** (arms mounted on arms) need a parent reference; OM has no arm
  mounting. Parents are referenced by index and must precede their children,
  so a valid byte string can never encode a mounting cycle.
- No tracks, no reset instruction, no part names — our part vocabulary fits in
  one flags byte. The repeat marker IS carried (opcode 7): tapes serialize as
  authored so a shared solution reads the way its builder wrote it, and every
  consumer expands the markers before simulating (see below).

## Layout

Integers are unsigned LEB128 varints; coordinates are zigzag-encoded first
(0, −1, 1, −2, … → 0, 1, 2, 3, …).

```
u8       version         (currently 1)
varint   arm count
per arm, in submission order:
  u8     flags           bits 0–1  gripper code: 0,1,2,3 → 1,2,3,6 grippers
                         bits 2–3  length − 1 (0..2)
                         bit  4    mounted on an elbow
  mount  if elbow:       varint parent index (< this arm's index), varint at (1..parent len)
         if ground:      zigzag varint q, zigzag varint r
  u8     initial angle   (0..5)
  varint delay blocks
  varint tape length
  bytes  ops, 3 bits each, packed little-endian within bytes
```

Opcodes: `G`=0 `D`=1 `↻`=2 `↺`=3 `↷`=4 `↶`=5 `·`=6 `⟲`=7.

`⟲` is the repeat marker, stored symbolically for legibility. Before simulation
every consumer applies the **normative expansion**: a marker expands to a copy of
the ops accumulated since the end of the previous repeat block; consecutive
markers each copy that same frozen segment; after a run of markers the segment
origin advances past the copies. (`G ↻ ⟲ ↺ ⟲` runs as `G ↻ G ↻ ↺ ↺`.) The
tape-length cap applies to the authored ops and to the expansion alike.

Arm **order is preserved** — submission order is the tournament tiebreak
identity. Arm ids are labels, not identity, and are not serialized; decoding
regenerates them (`a0`, `a1`, …).

## Version 2: the whole board

The player places everything — arms, glyphs, reagents, and the product. A v2
solution appends three sections after the arms:

```
varint   glyph count
per glyph:   u8 type, zigzag q, zigzag r, u8 rotation (0..5)
varint   reagent count
per reagent: varint shape index, zigzag q, zigzag r, u8 rotation
u8       product present (0 or 1)
if 1:        zigzag q, zigzag r, u8 rotation
```

Glyph types: bond=0, debond=1, calcification=2, duplication=3, projection=4,
purification=5, animismus=6, disposal=7. Because glyph **shapes are canonical**
(SPEC §3), a placement is completely described by its anchor cell and rotation.

Reagent and product placements reference the **puzzle's** molecule shapes (by
index, in puzzle order) — a solution chooses where they sit and how they're
turned, never what they are. Version 1 payloads (arms only) still decode; a
consumer supplies the puzzle's default board for them.

## Share strings

base64url (RFC 4648 §5 alphabet, no padding) of the bytes above. The editor
prefixes the puzzle key and a dot: `surrenderflare.AQMFAtT_…`

## On-chain submission

The verifier program (`contract/program`) takes one instruction whose data is

```
u8   instruction version  (2)
u8   puzzle id            index into the on-chain catalog (contract/puzzles.h,
                          generated from engine/examples.js: one entry per
                          PRODUCT, in PRODUCTS order)
u8   solution name length (<= 32 bytes)
u8   username length      (<= 24 bytes)
     solution name        UTF-8, no control bytes
     username             UTF-8, no control bytes
     machine bytes        a version-2 payload, exactly as above
```

The program rebuilds the puzzle from the catalog entry and the submission's own
placements, runs the rules engine to its verdict, and — only if the machine is
**verified** — emits one event and returns 0. Anything else reverts, so
nothing invalid ever lands on-chain: `0x100 + GW_ERR_*` for a rejected
submission (malformed bytes, no layout, a reagent missing or placed twice, no
product glyph, glyph overlap, …), `0x200 + GW_FAULT_*` when the machine
faulted (collision, overconstraint, grab-cycle, exhaustion), and small codes
for a bad header (`0x01`), an unknown puzzle (`0x02`) or no solver (`0x05`).

### Who is the solver

The solver is the beneficiary of the record, so it is never read from
instruction data — only from an authorization the chain itself checked:

- **called directly**: the fee payer, who signed the transaction;
- **called by another program**: the first non-program account that program
  vouched for (Thru invoke auth). The passkey manager does exactly that after
  validating a WebAuthn signature over the wallet nonce, every account and the
  full verifier instruction, so a passkey wallet becomes the solver and the fee
  payer is merely paying. No authorized account → revert.

A UI cannot credit a stranger: whatever key signed is who gets the record.

### Score event (`GW!2`), little-endian, packed

```
0   "GW!2"        magic + payload version
4   u8   puzzle id
5   u8   reserved (0)
6   u16  machine length
8   32B  solver public key
40  u32  cost      44  u32  cycles      48  u32  area      52  u32  sum
56  u8   solution name length      57  u8  username length
58  machine bytes, then solution name, then username
```

The leaderboard is nothing but this event log filtered by program
(`event.program.value == <program address>`): one row per distinct submitted
solution, lowest sum first, earliest slot breaking ties. `client/gw-chain.js`
implements both directions (direct and via a passkey wallet);
`client/submit.js` and `client/leaderboard.js` are the CLIs, and the same
module bundles into the editor as `demo/gw-chain.js`.
