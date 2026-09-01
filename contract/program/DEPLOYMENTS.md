# Deployments

Managed programs created with `thru program create <seed> build/thruvm/bin/gw_verifier_c.bin`.
The program account is what a client targets; the meta account is the manager's
record for upgrades.

| Network | Seed | Program account | Notes |
|---|---|---|---|
| alphanet | `greatwork-v2` | `taaX8rNMcDjdi-V0IlFhC2ScMsN0gWXbejJdoyDOvHi8aS` | 2026-09-01. Instruction v1, event `GW!1`. All 9 catalog puzzles verified against the oracle sums on-chain. |
| alphanet | `greatwork-v1` | `taIUAGUnezHZnUhv7hzX9PHiGDCGVjWL5hlindkOKOEM3v` | superseded — faulted on read-only statics |
| alphanet | `greatwork-v0` | `takXxBYjhHMBjip1Z-4AqGmX2-si6sgXNSTzZovRDe-F_Z` | superseded — courier smoke build |

Deployer (alphanet, throwaway dev key): `tawXEVKYFEgea8k-y-ab3f5ZkD7EHomPDBfrmJvX30wGmQ`.
