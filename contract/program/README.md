# GREAT WORK! — Thru program

The on-chain packaging of the rules engine: a ThruVM program that runs the
verifier (`../gw_q.c`, `../gw_codec.c`, `../gw_engine.c` — the same
conformance-tested code the host harness in `../test` checks) and seals a
result. `src/gw_verifier.c` is the program shell; the engine sources are copied
in by `sync.sh` at build time and are git-ignored here so this directory holds
only the shell.

The current shell is a **smoke build**: it runs the embedded `courier`
conformance case end to end inside the VM and returns its SUM (179) via
`tsdk_return`, proving the full engine compiles and runs under the SDK. The next
step reads the machine from instruction data and the puzzle from an account.

## Building

Needs the Thru devkit (https://docs.thru.org/program-development). The prebuilt
toolchain and C SDK ship as GitHub release assets on `Unto-Labs/thru`:

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
