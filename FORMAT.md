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
- No tracks, no instruction letters for repeat/reset, no part names — our part
  vocabulary fits in one flags byte. (The editor's repeat marker is authoring
  sugar: it expands to concrete ops before encoding, so the wire never carries it.)

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

Opcodes: `G`=0 `D`=1 `↻`=2 `↺`=3 `↷`=4 `↶`=5 `·`=6.

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

## Reference implementation

`engine/codec.js` — `encodeMachine`/`decodeMachine` (bytes) and
`encodeString`/`decodeString` (share strings), dependency-free, Node and
browser. The golden test suite round-trips every example machine byte-for-byte
and re-verifies identical simulation results.
