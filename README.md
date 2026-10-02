# GREAT WORK!

An on-chain optimization puzzle game in the spirit of Opus Magnum, built for the
Thru blockchain. Players build alchemical machines in the browser; a solution is
a few dozen bytes of calldata; the chain itself runs the rules engine and keeps
the record.

| Where | What |
|---|---|
| `SPEC.md` | The rules: parts, glyphs, tapes, faults, scoring, and the normative Q16.16 integer arithmetic every implementation must reproduce bit for bit. |
| `FORMAT.md` | The machine serialization (codec v1/v2), the on-chain instruction, and the score event. |
| `engine/` | The JavaScript rules engine — the conformance **oracle** — plus the codec, the example puzzles, the test suite and the vector/catalog generators. |
| `contract/` | The C rules engine (a line-faithful port of the oracle), the submission verifier, the prize escrow (`gw_escrow.c`, SPEC §13), the host harnesses, and under `program/` the ThruVM program shell. |
| `client/` | `@thru/sdk` client: seal a solution on-chain, read the leaderboard, open / fund / claim a puzzle's prize escrow; bundles into the editor. |
| `lab/` | Source of the game client (`lab/editor-template.html`, effects in `fx.js`); `node lab/build.js` inlines the engine into `demo/editor.html`. |
| `demo/` | Built pages. `editor.html` is the game client (deployed as https://greatwork.quest); `gw-chain.js` is the chain bundle it loads. (The grant proposal page, `demo/great-work.html`, was removed in 62d6cc3; `git show 62d6cc3^:demo/great-work.html` recovers it.) |

## Run the tests

```
node engine/run-tests.js          # oracle: rules, codec, repeat expansion, examples
node engine/gen-vectors.js        # freeze the oracle's behavior into contract/test/vectors.h
                                  # and the puzzle catalog into contract/puzzles.h
make -C contract check            # C engine + verifier vs. the frozen vectors, then the
                                  # prize escrow: its rules and the program shell on a
                                  # simulated ledger
node contract/test/mutate.js      # every escrow rule must be caught when broken
```

Regenerate the vectors after any engine or example change; the C harness must
stay green — every tick's digest is compared, so a divergence is pinned to the
first tick it appears.

## Build and deploy the program

Needs the Thru devkit (`thru dev toolchain install`, `thru dev sdk install`, or
`RISCV_TOOLCHAIN_ROOT` / `THRU_C_SDK_DIR` pointing at them).

```
cd contract/program && make       # -> build/thruvm/bin/gw_verifier_c.bin
thru program create <seed> build/thruvm/bin/gw_verifier_c.bin
```

Deployed addresses live in `contract/program/DEPLOYMENTS.md`; the client reads
the current one from `client/gw-chain.js` (`NETWORKS.alphanet.program`). A second
copy of the program, `NETWORKS.alphanet.testProgram`, exists for automated tests:
point a test at it so test runs never land on the public record.

## Submit a solution, read the record

```
cd client && npm install
node submit.js amalgam.AgEAAAAFABBYJEgKtmwBAAEABQIAAgEAAQIAAAEAAgA --name "Courier" --user you
node leaderboard.js [amalgam]
node escrow.js amalgam            # the puzzle's prize escrow: pot, champion, best, fuse
node escrow.js amalgam open --fuse 30d --bar record    # anyone may; the bar is the record's machine
node escrow.js amalgam deposit --amount 1000           # into an open round only
node escrow.js amalgam claim      # after the fuse: pays the champion
npm test                          # offline checks of the client's wire formats
npm run bundle                    # refresh demo/gw-chain.js after changing gw-chain.js
```

Every CLI takes `--test` to use `NETWORKS.alphanet.testProgram` instead of
the public program.

Puzzles are named for their product (`amalgam`, `saltedquicksilver`,
`transmutedgold`, `vitalsalts`, `airshipfuel`, `surrenderflare`,
`ablativecrystal`); a solution names itself and its author on the way in.

The CLI's signing key comes from `GW_PRIVATE_KEY` (64 hex chars) or the
`default` key in `~/.thru/cli/config.yaml`; a key that has never been used
bootstraps its own account, and alphanet fees are zero, so no faucet is
involved. In the editor, **Create passkey** makes the player an app-specific
passkey wallet (Thru's passkey manager); **Submit** then routes the
submission through it, so the record is credited to the passkey wallet —
whatever signed is who gets the record. **Claim to Thru wallet** connects
the hosted Thru wallet (`@thru/wallet`) and moves the passkey wallet's balance
to that account, where it can be spent or off-ramped; the line appears once
the wallet holds something, e.g. an escrow payout. Above the record, the
puzzle's **prize escrow** shows its pot, champion, best sum, fuse countdown
and the sum that resets it, with **Open an escrow** (anyone) and, once the
fuse is out, **Pay the champion** (anyone; the contract pays the champion).
