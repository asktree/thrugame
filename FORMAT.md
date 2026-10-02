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

Opcodes: `G`=0 `D`=1 `↻`=2 `↺`=3 `↷`=4 `↶`=5 `·`=6 `↪`=7.

`↪` is the repeat marker, stored symbolically for legibility. Before simulation
every consumer applies the **normative expansion**: a marker expands to a copy of
the ops accumulated since the end of the previous repeat block; consecutive
markers each copy that same frozen segment; after a run of markers the segment
origin advances past the copies. (`G ↻ ↪ ↺ ↪` runs as `G ↻ G ↻ ↺ ↺`.) The
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

The verifier program (`contract/program`) takes three instructions, told apart
by the first byte: SUBMIT (3), and the prize escrow's OPEN (0x10) and CLAIM
(0x11), below. A submission's data is

```
u8   instruction version  (3)
u8   puzzle id            index into the on-chain catalog (contract/puzzles.h,
                          generated from engine/examples.js: one entry per
                          PRODUCT, in PRODUCTS order)
u8   solution name length (<= 32 bytes)
u8   username length      (<= 24 bytes)
     solution name        UTF-8, no control bytes
     username             UTF-8, no control bytes
     machine bytes        a version-2 payload, exactly as above
```

Version 3 has version 2's layout; what changed is that the transaction must
list the puzzle's **escrow account** (see *Prize escrow*), read-write, whether or
not a round has been opened there — a missing account reverts `0x06`, a
read-only one `0x07` — and that account must **exist** (INIT, below): while it
does not, SUBMIT reverts `0x13`, so the escrow's `best` sees every score ever
sealed on the puzzle. Version 2
instructions are no longer accepted (`0x01`): a submission that could bypass
the escrow could seal a better machine without taking the crown, and anyone
could then copy it into the crown.

The program rebuilds the puzzle from the catalog entry and the submission's own
placements, runs the rules engine to its verdict, and — only if the machine is
**verified** — emits one event and returns 0. Anything else reverts, so
nothing invalid ever lands on-chain: `0x100 + GW_ERR_*` for a rejected
submission (malformed bytes, no layout, a reagent missing or placed twice, no
product glyph, glyph overlap, …), `0x200 + GW_FAULT_*` when the machine
faulted (collision, overconstraint, grab-cycle, exhaustion), and small codes
for a bad header (`0x01`), an unknown puzzle (`0x02`) or no solver (`0x05`);
the escrow's codes are listed below.

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

## Prize escrow

SPEC §13; the rules live in `contract/gw_escrow.c`, the instruction handling in
`contract/program/src/gw_verifier.c`.

### The escrow account

Each puzzle has one escrow account, at the verifier program's derived address
for the 32-byte seed

```
"gw-escrow" (9 ASCII bytes), zero bytes up to byte 30, u8 puzzle id at byte 31
```

i.e. `sha256(program address ‖ 0x00 ‖ seed)` — `deriveProgramAddress({ programAddress,
seed })` in `@thru/sdk`. Only the program can create an account there. The
program owns it; its **native balance is the pot**, and its data
(little-endian, packed, 80 bytes) is the crown:

```
0   "GWE2"        magic + layout version (GWE1, without best, is not read)
4   u8   puzzle id
5   u8   flags          bit 0: someone holds the crown; bit 1: settled;
                        bit 2: settled UNPAID (the champion's account could not
                        receive; the balance stayed for the next round)
6   u8   layout minor version (0), for a future in-place migration
7   u8   reserved (0)
8   u32  sum to beat    this round's: the champion's sum, else its opening bar
                        (0xFFFFFFFF: nothing to beat, any verified sum crowns)
12  u32  fuse length    seconds, 600 .. 2592000 (10 minutes .. 30 days) when
                        opened; 0 while idle
16  u64  fuse end       block time, ns. With a champion: when the fuse burns out.
                        Before one: when the opening bar lapses (opening + fuse)
24  u64  slot of the last change (opening, crown, payout)
32  u32  round          rounds opened on this puzzle so far: 0 = idle (created by
                        INIT, never opened), 1 = the first
36  u32  best           the lowest verified sum the escrow has ever seen, over
                        every round (0xFFFFFFFF: none yet). Never rises
40  u64  total paid     over every round, this one included
48  32B  champion       the solver key the pot is owed to (zero before a crown)
```

`best` takes every sum the escrow sees: every SUBMIT (which needs the account
to exist), in every state (idle, open, burning, frozen, settled; with or
without a block time), and every bar machine an OPEN names. A crown needs a
sum strictly below both the round's sum to beat and `best` as it stood before
that sum. Reads check structure only — magic, puzzle, flag consistency
(settled ⇒ crowned, unpaid ⇒ settled, crowned ⇒ a round and a sum) — never
policy such as the fuse bounds, so a later build can always read an escrow.

The fuse has burnt out when someone holds the crown and block time ≥ fuse end.
A settled round (bit 1) has paid out and takes no more crowns.

**Compression.** At creation INIT / OPEN ask the runtime to mark the account
`UNCOMPRESSABLE` (account flag 0x04), best effort — and on alphanet the
runtime does not keep it (observed on `greatwork-test`, 2026-10-02). So an
escrow is compressible: after a period of inactivity any third party may
compress it. A compressed account reads, to a program, exactly like one that
never existed (version 0, no flags), and it cannot be recreated (its creation
proof fails). So while it is compressed SUBMIT reverts `0x13`, and INIT, OPEN
and CLAIM cannot act on it; anyone may decompress it (`node client/escrow.js
<puzzle> decompress`; the clients detect it and say so before sending
anything). Nothing can be taken by compressing an escrow — its balance and
`best` come back with it — it only pauses the puzzle. Were the runtime ever
to show the compressed flag, every instruction refuses it with `0x12`.

### INIT (0x12)

```
u8   0x12
u8   puzzle id
     state proof         the escrow account's absence (proof type CREATING)
```

Accounts: the escrow account, read-write. Anyone may send it. It creates the
puzzle's escrow account **idle**: round 0, no crown, nothing to beat, `best`
none, no fuse, reopenable at once, flagged `UNCOMPRESSABLE` (best effort), and
emits `GW!E` kind 5. On an existing escrow it does nothing and succeeds. An
idle escrow notes every sum in `best` and crowns none. Run it for every puzzle
right after a deploy (`node client/escrow.js init --all`); the clients also
send it before a first submission on a puzzle that has none.

### Deposits

There is no deposit instruction: a deposit is an ordinary native transfer to
the escrow address (the EOA program's TRANSFER, `taEOAD2uLK1SLzPgtabFLUAx22yDlBs9DE9nZFTOESIGRr`,
or the passkey manager's), from anyone, at any time. A transfer cannot
create an account (creating one takes a state proof and is the owner
program's, for a derived address), so **before INIT there is nothing to
deposit into**: a transfer to that address fails. Deposit into a
round that is open or burning. Money sent to a lapsed round goes to whoever
wins it or a later round; to a won round, to its champion; to a settled one,
to the winner of the next round — the program cannot tell a deposit from any
other transfer, so the clients refuse anything but an open or burning round.

### OPEN (0x10)

```
u8   0x10
u8   puzzle id
u32  fuse length, seconds: 600 .. 2592000 (10 minutes .. 30 days)
u16  state proof length (0 when the account exists)
     state proof         the escrow account's absence (proof type CREATING);
                         required when the account does not exist yet
     bar machine         codec v2 machine bytes, optional (the rest of the data)
```

Accounts: the escrow account, read-write. Anyone may send it. The **bar** is a
machine, not a number: the program verifies it like a submission and seals it
on the record (a `GW!2` event naming the opener as solver, no names); a bar
that does not verify reverts as a submission would (`0x1xx` / `0x2xx`). No
machine means no bar of the opener's own. The bar's sum joins `best`, and the
round's **sum to beat is the new `best` = min(bar, best so far)** — so a round
can never be won with a sum the escrow has already seen, however it was
opened, and an opener cannot set a bar nobody could ever reach. Normally the
bar is a copy of the puzzle's public record, which also covers a record sealed
before the escrow existed.

The crown starts empty and the fuse unlit; the bar lapses one fuse length after
opening. OPEN succeeds when the puzzle has no escrow account (creating it), or
it is idle, or its round is settled, or its round is crownless with the bar
lapsed —
otherwise `0x09`. Reopening keeps the account's balance as the new pot, and
its best, round and total paid. Emits `GW!E` kind 1 with the opening pot as
the amount.

### SUBMIT and the crown

Before anything else SUBMIT checks the escrow account: flagged compressed →
`0x12`, absent → `0x13` (never created — INIT it — or compressed —
decompress it), not read-write → `0x07`. After sealing the `GW!2` score event it offers the
sum. It lowers `best` if lower, in every state and even with no block time.
Strictly below the round's sum to beat and every sum seen before, in an open
round that is neither settled nor burnt out, with a block time, it crowns the
solver, relights the fuse to its full length and emits `GW!E` kind 2 — unless
the solver's account is flagged `EPHEMERAL` or `DELETED` (it could never be
paid): then it is sealed and lowers `best`, and the crown stays where it was.
An account at the escrow address that the program does not own (which the
chain does not allow to arise) is ignored: the submission is sealed, no crown.
A verified sum outside 1 .. 0xFFFFFFFE reverts `0x14`.

### CLAIM (0x11)

```
u8   0x11
u8   puzzle id
```

Accounts: the escrow account and the champion's account, both read-write. Anyone
may send it once the fuse has burnt out. The program pays the escrow's whole
balance to the champion recorded in the escrow — the caller chooses nothing —
and marks the round settled; `GW!E` kind 3 with the amount paid. A transfer
the runtime refuses reverts (`0x0F`): the caller sets the transaction's
compute and memory units, so a refusal says nothing about the champion.
The champion's account, as the program sees it:

- present and flagged `DELETED` (or `EPHEMERAL`, which a crown already
  refuses): it can never be paid, so the round settles **unpaid** — flag
  bit 2, `GW!E` kind 4 with the balance kept, which carries into the next
  round;
- absent: on Thru that is how a compressed account looks, and any third
  party may compress an idle account, so the claim waits — `0x12`,
  decompress it and claim again — until **90 days after the fuse burnt
  out**; after that the round settles unpaid as above, so an account that is
  really gone cannot lock the pot forever;
- missing from the transaction or read-only: `0x0E`.

Either way a round settles once; the fuse never relights (`0x11` after).

### Escrow event (`GW!E`), little-endian, packed

```
0   "GW!E"
4   u8   kind           1 opened, 2 crown taken, 3 paid out, 4 settled unpaid,
                        5 initialized (INIT)
5   u8   puzzle id
6   u16  reserved (0)
8   u64  amount         kind 1: the pot at opening; 3: paid out; 4: the balance
                        kept; 5: the balance at creation; else 0
16  80B  the escrow account's data after the change (GWE2 layout)
```

### Revert codes

| Code | Meaning |
|---|---|
| `0x06` | the puzzle's escrow account is not in the transaction |
| `0x07` | escrow account unusable: not read-write (SUBMIT, OPEN, CLAIM all need it so), not the program's (OPEN, CLAIM), or bad data |
| `0x08` | reserved (unused) |
| `0x09` | OPEN while the puzzle's escrow is still contested (crowned and unpaid, or its bar not yet lapsed) |
| `0x0A` | bad OPEN arguments: fuse outside 600 s .. 30 days |
| `0x0B` | CLAIM on a puzzle with no escrow |
| `0x0C` | CLAIM with nobody holding the crown |
| `0x0D` | CLAIM while the fuse is still burning |
| `0x0E` | the champion's account is not in the transaction read-write |
| `0x0F` | CLAIM's payout transfer was refused (retry, e.g. with more compute / memory units); nothing settled |
| `0x10` | block time unavailable |
| `0x11` | CLAIM on an escrow that has already paid out |
| `0x12` | the escrow account is flagged compressed, or (CLAIM) the champion's account is missing or compressed, within 90 days of the fuse: decompress it, then retry |
| `0x13` | SUBMIT while the puzzle's escrow account reads as absent: never created (send INIT) or compressed (decompress it) |
| `0x14` | a verified sum outside 1 .. 0xFFFFFFFE |
