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
| `contract/` | The C rules engine (a line-faithful port of the oracle), the submission verifier, the host conformance harness, and under `program/` the ThruVM program shell. |
| `client/` | `@thru/sdk` client: seal a solution on-chain, read the leaderboard; bundles into the editor. |
| `lab/` | Sources for the two demo pages (`demo/lab.html`, `demo/editor.html`); `node lab/build.js` inlines the engine into them. |
| `demo/` | Built pages. `editor.html` is the game client; `gw-chain.js` is the chain bundle it loads. |

## Run the tests

```
node engine/run-tests.js          # oracle: rules, codec, repeat expansion, examples
node engine/gen-vectors.js        # freeze the oracle's behavior into contract/test/vectors.h
                                  # and the puzzle catalog into contract/puzzles.h
make -C contract check            # C engine + verifier vs. the frozen vectors
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
the current one from `client/gw-chain.js` (`NETWORKS.alphanet.program`).

## Seal a solution, read the record

```
cd client && npm install
node submit.js courier.AgEAAAAFABBYJEgKtmwBAAEABQIAAgEAAQIAAAEAAgA   # a code from the editor
node leaderboard.js [courier]
npm run bundle                    # refresh demo/gw-chain.js after changing gw-chain.js
```

The signing key comes from `GW_PRIVATE_KEY` (64 hex chars) or the `default`
key in `~/.thru/cli/config.yaml`. A key that has never been used bootstraps its
own account; alphanet fees are zero, so no faucet is involved. In the editor
the same flow runs behind the **Seal on-chain** button with a wallet kept in
the browser.
