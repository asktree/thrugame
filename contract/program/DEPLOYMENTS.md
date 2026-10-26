# Deployments

Managed programs created with `thru program create <seed> build/thruvm/bin/gw_verifier_c.bin`,
or with `node client/deploy.js <seed> build/thruvm/bin/gw_verifier_c.bin [--upgrade]`
where the Rust CLI can't reach the RPC (it brings its own CA roots, so it fails
behind a TLS-intercepting proxy; the Node path doesn't).
The program account is what a client targets; the meta account is the manager's
record for upgrades. A managed program's address is fixed by its seed and the
manager program (`deriveManagedProgramAddresses` in `@thru/programs/manager`),
so it is known before the deploy; `client/test.js` checks the client's
addresses against their seeds.

## Current (alphanet after its second reset, ~October 2026; manager `taMGRmPoSTkUtF6UlmCIq58K8OYsnXshOMPdobxxHytqmu`)

Alphanet was reset again after 2026-10-02 and both programs below were gone. On 2026-10-26 they were redeployed
from the same seeds (so the addresses and the client did not change), with a binary byte-identical to the 2026-10-02 build.

| Network | Seed | Program account | Notes |
|---|---|---|---|
| alphanet | `greatwork-v3` | `taWilrUWWu-_nAzyv3koRVoQQOnIepAGVe1tkzbnu3XNdZ` | **live** since 2026-10-26 (version 0, 52,736 bytes, sha256 `868d4293…3d17`). All 7 escrows initialised. The 10 saved pre-reset records were re-sealed on it before the amalgam demo escrow opened (30-day fuse, bar = the record, SUM 101). The solver on these rows is the new deployer key, not the original player. This is the public record. |
| alphanet | `greatwork-test` | `tar_NQqeiWnJEIhya2UBpcEpxV4UKBpbnRGf6cMpay0EiS` | **live** since 2026-10-26, same binary. For automated tests only. Smoke test passed: INIT ×7, seal 179, OPEN (10m), seal 163 + crown. |

### Records re-sealed on 2026-10-26

Only these 10 records were saved from before the resets (source: the leaderboard output of 2026-09-02 and the code in
`engine/examples.js`). Records made after 2026-10-02 on the old v3 were lost with the chain.

| Puzzle | Name | Sum |
|---|---|---|
| amalgam | pre-reset player | 101 |
| amalgam | The Ferris | 163 |
| amalgam | The Courier | 179 |
| amalgam | The Crane | 232 |
| saltedquicksilver | The Bead Wheel | 186 |
| transmutedgold | pre-reset player | 194 |
| transmutedgold | The Gold Ladder | 353 |
| vitalsalts | The Leaching Works | 395 |
| airshipfuel | Airship Fuel | 298 |
| surrenderflare | Surrender Flare | 322 |

Seal them worst first per puzzle, with `node client/submit.js <machine> --name <name>`, and only then run `escrow.js amalgam open`.
`escrow.js init --all` sometimes fails with `error 0` on one puzzle; run it again until every line says `exists`.

### Toolchain (built from source in a cloud container, 2026-10-26)

No devkit release could be downloaded, so the toolchain was built by hand, following `sdks/c/deps.sh` in Unto-Labs/thru:
the system `riscv64-unknown-elf-gcc` 13.2 symlinked into `~/.thru/sdk/toolchain/bin`, picolibc 1.8.9 and blst v0.3.15
installed under `~/.thru/sdk/toolchain`, and the C SDK built at `~/.thru/sdk/c/thru-sdk`. Then run
`RISCV_TOOLCHAIN_ROOT=~/.thru/sdk/toolchain make` here (the toolchain search walks up from the current directory only).

### Previous v3 (2026-10-02 to the second reset, gone from chain)

| Network | Seed | Program account | Notes |
|---|---|---|---|
| alphanet | `greatwork-v3` | `taWilrUWWu-_nAzyv3koRVoQQOnIepAGVe1tkzbnu3XNdZ` | was live from 2026-10-02 (version 0, 52,736 bytes, sha256 `868d4293…3d17`): the escrow build with SUBMIT v3, INIT, OPEN, CLAIM, and events `GW!2` / `GW!E`. All 7 escrows initialised. Lead Amalgam carries the reference Courier (179) and a demo escrow (30-day fuse, sum to beat 179, pot 0: the post-reset faucet vault doesn't exist). Was the public record. |
| alphanet | `greatwork-test` | `tar_NQqeiWnJEIhya2UBpcEpxV4UKBpbnRGf6cMpay0EiS` | was live from 2026-10-02, upgraded the same day to version 1 (same binary as v3). For automated tests only, never the public record. The smoke test passed on it: INIT ×7, seal 179, OPEN (10m), seal 163 + crown, a cross-puzzle machine rejected, CLAIM paid the champion, a second CLAIM refused. |

### Runbook (fresh deploy)

Needs the Thru devkit and a `thru` CLI new enough to know the post-reset
manager (`thru program derive-manager-accounts greatwork-v3` should print the
program account above; if it prints anything else, update the CLI first).
Any funded-or-fresh key works as deployer and upgrade authority — the old
`tawXEVKY…` account was wiped with the chain; `thru keys generate default` makes
a new one (alphanet fees are zero).

```sh
make -C contract check                         # host tests green first
node contract/test/mutate.js                   # every escrow rule guarded (41 mutations caught)
cd contract/program && make                    # -> build/thruvm/bin/gw_verifier_c.bin
thru program create greatwork-test build/thruvm/bin/gw_verifier_c.bin
#   expect "Program account: tar_NQqeiWnJEIhya2UBpcEpxV4UKBpbnRGf6cMpay0EiS"
node client/escrow.js init --all --test        # IMMEDIATELY: every puzzle's escrow account (idle).
#   Until a puzzle's account exists nothing can be sealed on it (SUBMIT reverts
#   0x13), so the escrow's best sees the whole record from the first score.

# smoke test on the test program (from the repo root; GW_PRIVATE_KEY or the CLI default key)
node client/submit.js amalgam.AgEAAAAFABBYJEgKtmwBAAEABQIAAgEAAQIAAAEAAgA --name smoke --test        # courier, sum 179
node client/escrow.js amalgam open --test --fuse 10m --bar none
node client/submit.js amalgam.AgMEAAAAAAi2ZXsQAAEFAAhQjMUABAIEBwiQstkBAAQAAgIABAEAAQAEAAEGAAQ --name smoke-ferris --test   # 163: takes the crown
node client/escrow.js amalgam --test           # champion = your key, SUM 163, best 163, fuse ~10m
#   OBSERVED on greatwork-test, 2026-10-02: the "account" line says COMPRESSIBLE —
#   the runtime does not keep the UNCOMPRESSABLE flag INIT asks for. Escrows can be
#   compressed after inactivity; then `node client/escrow.js <puzzle> decompress`
#   (anyone may) before anything works on that puzzle. Nothing can be stolen that way.
#   INIT, SUBMIT 179, OPEN (10m, no bar), SUBMIT 163 crowning and the client's
#   10,000 memory units all worked; SUBMIT used about 10.3M compute units.
node client/leaderboard.js amalgam --test      # both entries, with watch links
#   …10 minutes later:
node client/escrow.js amalgam claim --test     # pays the champion; then `escrow.js amalgam --test` says "paid out"

# the public program
thru program create greatwork-v3 build/thruvm/bin/gw_verifier_c.bin
#   expect "Program account: taWilrUWWu-_nAzyv3koRVoQQOnIepAGVe1tkzbnu3XNdZ"
node client/escrow.js init --all               # IMMEDIATELY after the deploy, before anyone submits
node client/escrow.js amalgam open             # the demo escrow: 30-day fuse, bar = the record
```

Then merge the client (it already targets these addresses) so GitHub Pages
redeploys https://greatwork.quest, and fill in the date and deployer key here.

Deployer and upgrade authority (alphanet, throwaway dev key): `taoq0IISotd4OcdlCmnLRU9Emu5Ttb-iJx5mgba9A9C1Gl` since 2026-10-26 (before that `ta30eTZPkXvPNkQYtis-B9g5cl8AKx8fRC8220ygSUYeJA`, wiped with the chain).
Observed on the live runtime: 10,000 memory units is enough for SUBMIT and OPEN (SUBMIT ≈ 10.25M compute units).
`block_time` is real. The UNCOMPRESSABLE flag request is **not** kept, so an idle escrow can be compressed (see SPEC §13).

## Before the reset (gone from chain)

| Network | Seed | Program account | Notes |
|---|---|---|---|
| alphanet | `greatwork-v2` | `taaX8rNMcDjdi-V0IlFhC2ScMsN0gWXbejJdoyDOvHi8aS` | 2026-09-01, upgraded in place the same day (`thru program upgrade greatwork-v2 …`): instruction v2 with names, event `GW!2`, 7-product catalog, solver = the authorized account (fee payer or passkey wallet), returns 0. The public record started at slot 6884620. |
| alphanet | `greatwork-test` | `taZq-QfKiEC-7CF-iF8mbqHjC4wSU1brkik8jsgMl2bpVB` | same binary, for automated tests only — never the public record |
| alphanet | `greatwork-v1` | `taIUAGUnezHZnUhv7hzX9PHiGDCGVjWL5hlindkOKOEM3v` | superseded — faulted on read-only statics |
| alphanet | `greatwork-v0` | `takXxBYjhHMBjip1Z-4AqGmX2-si6sgXNSTzZovRDe-F_Z` | superseded — courier smoke build |

Upgrade authority / deployer then (alphanet, throwaway dev key): `tawXEVKYFEgea8k-y-ab3f5ZkD7EHomPDBfrmJvX30wGmQ`.
