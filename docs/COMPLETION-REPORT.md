<!--
DRAFT — not sent. For Iggy to review and send to Will Yoo (Unto Labs) once
the escrow build is deployed (IGG-29) and merged, so every link below is live.
Before sending: run the smoke test in contract/program/DEPLOYMENTS.md, fill
the two [after deploy] slots, open the demo escrow, delete this comment.
Tracked in Linear IGG-30.
-->

# Great Work! — completion report

**For:** Unto Labs (Will Yoo) · **From:** Agrippa Kellum · **Date:** [send date]

Hi Will,

All three committed deliverables of the Great Work! grant are built, tested
and running on Thru alphanet. Here they are against the proposal's own
wording, each with evidence you can open.

## D·1 — Game rules engine smart contract

*"The hex-grid simulator on Thru: accepts a machine as calldata, runs it
deterministically, verifies six products, and seals cost, cycles, area, and
sum on-chain."*

- **On chain:** the verifier program `greatwork-v3`,
  `taWilrUWWu-_nAzyv3koRVoQQOnIepAGVe1tkzbnu3XNdZ` on alphanet, deployed
  [after deploy: date]. A submission is one transaction: the machine's bytes
  are the instruction data.
- **Deterministic:** integer and fixed-point arithmetic only. The C engine
  in the program is a line-for-line port of the JavaScript reference engine,
  and the two are held equal by shared conformance vectors (13 cases, 24
  submissions, all 7 puzzles), plus 147 engine tests.
- **Verifies, then seals:** the program runs the machine to its verdict. A
  verified machine emits one event carrying cost, cycles, area, sum, the
  solver and the machine itself; anything else reverts, so nothing invalid
  reaches the chain.
- **One change from the proposal:** a machine must make **nine** products,
  not six, which is a stricter test that the loop really loops.

## D·2 — Leaderboards & prize escrow

*"Every sealed solution takes its rank on-chain, and any puzzle can lock an
escrow the contract itself awards by the strictly-better rule — no
organizer, no judges."*

- **The record** is the program's event log. Every sealed solution is ranked
  by SUM. The first wallet to seal a given machine owns that machine, so a
  copy earns nothing. Rankings show in the editor under each puzzle and from
  `node client/leaderboard.js`.
- **The prize escrow is in the contract.** Each puzzle has one escrow
  account owned by the program, and its balance is the pot.
  - Anyone may open one. Opening grants the opener nothing, and the escrow
    has no admin key: no one can withdraw, redirect or override a payout.
    (The program itself remains upgradeable by its deployer, as every
    managed Thru program is until it is finalized. We can finalize it once
    you're happy with it.)
  - A verified sum strictly below the reigning best takes the crown and
    relights a 30-day fuse. Ties and copies change nothing.
  - When the fuse burns out, the crown freezes. Anyone may then trigger the
    payout, and the contract sends the whole pot to the champion, once.
- **Demo:** an escrow is open on *Lead Amalgam* [after deploy: pot]. The
  bar is the current record, so only a better machine can take it.

## D·3 — Frontend client

*"Browse puzzles and leaderboards, watch any sealed solution replay, and
build machines in a visual editor that submits straight to the chain."*

- **https://greatwork.quest** offers seven puzzles, each with its own parts
  tray, guide and reference machines. It also has a How to Play tutorial
  and a drag-and-drop editor with tape editing and undo.
- **Submits straight to the chain.** The player signs with a passkey wallet
  (Thru's passkey manager), and the record is credited to that wallet.
- **Watch any sealed solution.** Every leaderboard row has **▶ watch**,
  which replays the machine in the editor, and **link**, which gives a URL
  that opens it replaying. https://gif.greatwork.quest renders any solution
  as an animated GIF on demand.
- **The prize escrow is shown above each puzzle's record:**
  - pot
  - champion
  - best sum
  - a live fuse countdown
  - the sum that resets it

  When the fuse has burnt out, it also shows **Pay the champion**.

## Notes

- **Alphanet reset.** Alphanet was reset around September 30. That wiped the
  first deployment (`greatwork-v2`, live since September 1) and its record.
  The current program is a fresh deploy of the escrow build, and the client
  moved to `@thru/sdk` 0.4.
- **Source.** Everything is in the repository: the spec (`SPEC.md`), the
  wire formats (`FORMAT.md`), the engine, the contract, the client and the
  tests. `docs/ACCEPTANCE.md` maps each deliverable sentence to its
  evidence.

Thanks for backing this. I'd be glad to walk you through it live, or to talk
through your wallet question from September 6 if that's still open.

Agrippa
