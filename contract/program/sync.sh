#!/usr/bin/env bash
# Copy the engine sources (the conformance-tested oracle port) into src/ so the
# program links the exact same code the host harness verifies. Run by GNUmakefile
# before the SDK build; keeps this directory to just the program shell in git.
#
# Idempotent: a copy is only written when the content differs. The SDK makefile
# re-executes itself after generating dependency files, which re-runs this
# script; unconditional copies would bump timestamps every pass and make would
# never converge.
set -euo pipefail
d="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
put() { if ! cmp -s "$1" "$2" 2>/dev/null; then cp "$1" "$2"; fi; }
put "$d/../gw.h"        "$d/src/gw.h"
put "$d/../gw_q.c"      "$d/src/gw_q.c"
put "$d/../gw_codec.c"  "$d/src/gw_codec.c"
put "$d/../gw_engine.c" "$d/src/gw_engine.c"
tmp="$(mktemp)"
sed 's#include "../gw.h"#include "gw.h"#' "$d/../test/vectors.h" > "$tmp"
put "$tmp" "$d/src/vectors.h"
rm -f "$tmp"
