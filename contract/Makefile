# GREAT WORK! — C rules engine
#
# `make check` builds the host-side harnesses and runs them:
#   build/host-check    replays the JS oracle's conformance vectors against the
#                       C engine (regenerate with `node engine/gen-vectors.js`
#                       after any engine change);
#   build/escrow-check  the prize escrow: its rules (gw_escrow.c), then the
#                       program shell itself (program/src/gw_verifier.c) on a
#                       simulated ledger, built against the host stand-in SDK
#                       in test/mock.
# The on-chain build lives in program/ and needs the Thru devkit.

CC      ?= cc
CFLAGS  ?= -O2 -std=c11 -Wall -Wextra -Wconversion -Wno-sign-conversion

SRC = gw_q.c gw_codec.c gw_engine.c gw_verify.c
HDR = gw.h puzzles.h

build/host-check: $(SRC) $(HDR) test/host_main.c test/vectors.h
	@mkdir -p build
	$(CC) $(CFLAGS) -o $@ $(SRC) test/host_main.c

build/escrow-check: $(SRC) $(HDR) gw_escrow.c gw_escrow.h test/escrow_main.c test/vectors.h \
                    program/src/gw_verifier.c test/mock/thru-sdk/c/tn_sdk.h test/mock/thru-sdk/c/tn_sdk_syscall.h
	@mkdir -p build
	$(CC) $(CFLAGS) -std=gnu11 -I. -Itest/mock -o $@ $(SRC) gw_escrow.c test/escrow_main.c

.PHONY: check clean
check: build/host-check build/escrow-check
	./build/host-check
	./build/escrow-check

clean:
	rm -rf build
