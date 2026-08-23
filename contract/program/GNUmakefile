# GREAT WORK! — Thru program build
#
# Needs the Thru devkit (https://docs.thru.org/program-development):
#   toolchain at ~/.thru/sdk/toolchain  (or RISCV_TOOLCHAIN_ROOT=...)
#   C SDK     at ~/.thru/sdk/c/thru-sdk (or THRU_C_SDK_DIR=...)
#
#   make        -> build/thruvm/bin/gw_verifier_c.bin (deployable calldata)
#
# The engine sources (the conformance-tested oracle port) live one directory up;
# `sync.sh` copies them into src/ first — run `make` (not `make -j` cold, the
# sync must precede the SDK's dependency scan). Only the program shell
# (gw_verifier.c, Local.mk) is tracked here; the synced copies are gitignored.

$(shell ./sync.sh)

BASEDIR:=$(CURDIR)/build
THRU_C_SDK_DIR?=$(HOME)/.thru/sdk/c/thru-sdk
include $(THRU_C_SDK_DIR)/thru_c_program.mk
