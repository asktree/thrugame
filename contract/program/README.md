# GREAT WORK! — Thru program

The on-chain packaging of the rules engine: a ThruVM program that runs the
verifier (`../gw_q.c`, `../gw_codec.c`, `../gw_engine.c` — the same
conformance-tested code the host harness in `../test` checks) and seals a
result. `src/gw_verifier.c` is the program shell; the engine sources are copied
in by `sync.sh` at build time and are git-ignored here so this directory holds
only the shell.

The shell handles three instructions (FORMAT.md): SUBMIT seals a verified
machine as a `GW!2` score event and offers its sum to the puzzle's prize
escrow; OPEN and CLAIM open an escrow and pay it out (SPEC §13, rules in
`../gw_escrow.c`). `make -C .. check` runs this exact file on the host against a
stand-in SDK (`../test/mock`) and a simulated ledger.

**Client compatibility.** The escrow build takes SUBMIT version 3 and needs the
puzzle's escrow account in every submission; version 2 reverts. `client/gw-chain.js`
sends version 3 with the escrow address read-write (all three paths: the local
key, the passkey wallet, the hosted Thru wallet). Deploy to `greatwork-test`
first.

## Building

Needs the Thru devkit (https://docs.thru.org/program-development): the `thru`
CLI installs the prebuilt toolchain and C SDK (`thru dev toolchain install`,
`thru dev sdk install`), or unpack the release archives by hand:

```sh
# one-time: install the toolchain (~1 GB) and C SDK to ~/.thru/sdk
#   thru-toolchain-Linux-x86_64-*.tar.gz  -> ~/.thru/sdk/toolchain
#   thru-program-sdk-c-*.tar.gz           -> built & installed to ~/.thru/sdk/c
# (the SDK's setup.sh does this; or unpack the toolchain and run the SDK's
#  `make ... all lib include` against it — no build-from-source needed)

make          # -> build/thruvm/bin/gw_verifier_c.bin  (deployable calldata)
```

Override `RISCV_TOOLCHAIN_ROOT` / `THRU_C_SDK_DIR` if the devkit lives elsewhere.

## Deploying

```sh
thru uploader upload <seed> build/thruvm/bin/gw_verifier_c.bin
```
