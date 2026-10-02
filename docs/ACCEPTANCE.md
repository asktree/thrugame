# Great Work! — deliverables against the proposal

The grant proposal ("for Unto Labs · August 2026", the deleted
`demo/great-work.html`, recover with `git show 62d6cc3^:demo/great-work.html`)
commits to three deliverables. This file maps each sentence of them to
evidence in this repository and on the live services, as of 2026-10-02.

Legend: **✅** done and checked · **⏳** done in code, waiting on a deploy ·
**Δ** deliberately different from the wording, and why.

## Network status (read first)

Thru **reset alphanet around 2026-09-30** (height ≈ 873k on 2026-10-02; the
public record had started at slot 6,884,620). The verifier program
(`greatwork-v2`, `taaX8rNM…`), its test copy, the deployer account and the
passkey manager the old SDK used no longer exist on chain, so the earlier
on-chain records are gone with the chain, and the live editor at
https://greatwork.quest (built from `main`, SDK 0.3.11) cannot sign in,
submit or show a leaderboard until the escrow build is deployed and the
client update ships. Everything below marked ⏳ becomes ✅ with that one
deploy (IGG-29); the code is ready on `claude/igg-29-deploy-prep`.

## D·1 — Game rules engine smart contract

> The hex-grid simulator on Thru: accepts a machine as calldata, runs it
> deterministically, verifies six products, and seals cost, cycles, area, and
> sum on-chain.

| Claim | Evidence | |
|---|---|---|
| hex-grid simulator | `engine/engine.js` (oracle), `contract/gw_engine.c` (line-faithful C port); SPEC §1–§12 | ✅ |
| on Thru | `contract/program` ThruVM program; deployed 2026-09-01 as `greatwork-v2` (DEPLOYMENTS.md) — wiped by the reset | ⏳ redeploy |
| accepts a machine as calldata | SUBMIT instruction: codec v2 machine bytes in instruction data (FORMAT.md "On-chain submission") | ✅ |
| runs it deterministically | integer/fixed-point only (SPEC §11); `make -C contract check` replays the oracle's conformance vectors in C: 13 cases, 24 submissions, 7 puzzles, all equal | ✅ |
| verifies six products | **Δ nine.** The game was tightened after the proposal: a machine must make nine products (SPEC opening, `caps.goal`), which is stricter proof that the loop is a loop | Δ |
| seals cost, cycles, area, sum on-chain | the program emits `GW!2` with all four plus the machine bytes, only for a verified machine; anything else reverts (FORMAT.md) | ✅ code · ⏳ chain |
| tests | `node engine/run-tests.js` 147/147 | ✅ |

## D·2 — Leaderboards & prize escrow

> The permanent record and the prize pot: every sealed solution takes its rank
> on-chain, and any puzzle can lock an escrow the contract itself awards by the
> strictly-better rule — no organizer, no judges.

| Claim | Evidence | |
|---|---|---|
| the permanent record | the program's `GW!2` event log *is* the record; the solver is whoever the chain saw authorize (never instruction data) | ✅ code · ⏳ chain |
| every sealed solution takes its rank | `fetchScores` + `rankScores` (first submitter of a machine owns it; lower sum wins, earlier slot breaks ties). **Gap fixed here:** the client read only the first page of events and the RPC serves 50 a page, so the board silently dropped every sealed solution after the 50th; it now reads the whole log (`listProgramEvents`, tested in `client/test.js`) | ✅ (fixed) |
| any puzzle can lock an escrow | `INIT` (0x12) creates a puzzle's escrow account, `OPEN` (0x10) a round — both open to anyone; one escrow per puzzle at the verifier's derived address; deposits are plain transfers (SPEC §13, FORMAT.md "Prize escrow") | ✅ code · ⏳ chain |
| the contract itself awards it | `CLAIM` (0x11) pays the escrow's whole balance to the recorded champion, once; the caller chooses nothing | ✅ code · ⏳ chain |
| by the strictly-better rule | a verified sum strictly below the escrow's best (the lowest sum it has ever seen, bars included) takes the crown and relights the fuse; ties and copies change nothing; the crown freezes when the fuse burns out; a reopened escrow never lowers the bar (`contract/gw_escrow.c`) | ✅ |
| no organizer, no judges | no authority key: opening is permissionless and grants nothing; payout is permissionless and fixed by the contract | ✅ |
| tests | `make -C contract check` → `escrow-check`: the rules, then the real program shell on a simulated ledger (crown, ties, copies, best, fuse range, freeze, one-time payout, reopen, wrapper path), and all three security reviews' attacks replayed (reopen theft, settled-pot theft, round-1 copy of a pre-escrow record, unpayable or compressed champion, refused payout transfer, foreign and compressed accounts, clockless sealing). `node contract/test/mutate.js` breaks each of 41 escrow rules in turn and checks the harness catches every one | ✅ |
| editor shows it | the §05 bounty poster above the record: pot, champion, best sum, fuse countdown, "resets on SUM ≤ N", Open / Pay the champion | ✅ code · ⏳ chain |

## D·3 — Frontend client

> A web client for the whole loop: browse puzzles and leaderboards, watch any
> sealed solution replay, and build machines in a visual editor that submits
> straight to the chain.

| Claim | Evidence | |
|---|---|---|
| a web client | https://greatwork.quest (GitHub Pages from `main`, `.github/workflows/pages.yml`) — loads, HTTP 200 | ✅ |
| browse puzzles | seven puzzle tabs (Lead Amalgam … Ablative Crystal), each with its own tray, guide and reference machines | ✅ |
| browse leaderboards | the "On-chain record" under every puzzle; `node client/leaderboard.js [puzzle]` for all of them | ✅ code · ⏳ chain |
| watch any sealed solution replay | **Gap fixed here:** a board row's button only *loaded* the machine into edit mode (the visitor had to find ▶ Test), and doing so overwrote the player's own saved draft with no undo. Now **▶ watch** loads and replays it (status names the solution, author and sealed score), Undo brings the player's machine back, and **link** copies `greatwork.quest/#play/<code>`, which opens replaying; the CLI prints the same link. GIFs of any solution: `gif.greatwork.quest` (live, renders on demand) | ✅ (fixed) |
| build machines in a visual editor | drag-and-drop arms and glyphs, tape editing, undo/redo, How to Play tutorial, puzzle guides | ✅ |
| that submits straight to the chain | **Submit** signs with the player's passkey wallet and sends SUBMIT v3 directly; no server in between | ✅ code · ⏳ chain |
| phone width | the record's rows overflowed at 390 px; now trimmed to rank, sum, who and actions | ✅ (fixed) |

## Not checkable from here

- **End-to-end submission through the test program**: impossible until a
  program exists on the reset alphanet (IGG-29).
- Whether the signed grant agreement uses the proposal's wording, or adds
  acceptance criteria, a mainnet requirement or a date (IGG-25).

## Housekeeping

- `claude/puzzle-glyph-filtering-tutorials-x75tla` is fully merged into `main`
  (no commits ahead, empty diff); safe to delete.
