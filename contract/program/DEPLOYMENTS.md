# Deployments

Managed programs created with `thru program create <seed> build/thruvm/bin/gw_verifier_c.bin`.
The program account is what a client targets; the meta account is the manager's
record for upgrades. A managed program's address is fixed by its seed and the
manager program (`deriveManagedProgramAddresses` in `@thru/programs/manager`),
so it is known before the deploy; `client/test.js` checks the client's
addresses against their seeds.

## Current (alphanet after its ~2026-09-30 reset; manager `taMGRmPoSTkUtF6UlmCIq58K8OYsnXshOMPdobxxHytqmu`)

| Network | Seed | Program account | Notes |
|---|---|---|---|
| alphanet | `greatwork-v3` | `taWilrUWWu-_nAzyv3koRVoQQOnIepAGVe1tkzbnu3XNdZ` | **to deploy** — the escrow build: SUBMIT v3, OPEN, CLAIM, events `GW!2` / `GW!E`. The public record. |
| alphanet | `greatwork-test` | `tar_NQqeiWnJEIhya2UBpcEpxV4UKBpbnRGf6cMpay0EiS` | **to deploy** — same binary, for automated tests only — never the public record |

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

## Before the reset (gone from chain)

| Network | Seed | Program account | Notes |
|---|---|---|---|
| alphanet | `greatwork-v2` | `taaX8rNMcDjdi-V0IlFhC2ScMsN0gWXbejJdoyDOvHi8aS` | 2026-09-01, upgraded in place the same day (`thru program upgrade greatwork-v2 …`): instruction v2 with names, event `GW!2`, 7-product catalog, solver = the authorized account (fee payer or passkey wallet), returns 0. The public record started at slot 6884620. |
| alphanet | `greatwork-test` | `taZq-QfKiEC-7CF-iF8mbqHjC4wSU1brkik8jsgMl2bpVB` | same binary, for automated tests only — never the public record |
| alphanet | `greatwork-v1` | `taIUAGUnezHZnUhv7hzX9PHiGDCGVjWL5hlindkOKOEM3v` | superseded — faulted on read-only statics |
| alphanet | `greatwork-v0` | `takXxBYjhHMBjip1Z-4AqGmX2-si6sgXNSTzZovRDe-F_Z` | superseded — courier smoke build |

Upgrade authority / deployer then (alphanet, throwaway dev key): `tawXEVKYFEgea8k-y-ab3f5ZkD7EHomPDBfrmJvX30wGmQ`.
