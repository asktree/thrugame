# GREAT WORK! — C rules engine
#
# `make check` builds the host-side differential harness and replays the JS
# oracle's conformance vectors (regenerate with `node engine/gen-vectors.js`
# after any engine change). The Thru on-chain build target lands with the
# program entrypoint.

CC      ?= cc
CFLAGS  ?= -O2 -std=c11 -Wall -Wextra -Wconversion -Wno-sign-conversion

SRC = gw_q.c gw_codec.c gw_engine.c gw_verify.c
HDR = gw.h puzzles.h

build/host-check: $(SRC) $(HDR) test/host_main.c test/vectors.h
	@mkdir -p build
	$(CC) $(CFLAGS) -o $@ $(SRC) test/host_main.c

.PHONY: check clean
check: build/host-check
	./build/host-check

clean:
	rm -rf build
