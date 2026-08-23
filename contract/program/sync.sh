#!/usr/bin/env bash
# Copy the engine sources (the conformance-tested oracle port) into src/ so the
# program links the exact same code the host harness verifies. Run by GNUmakefile
# before the SDK build; keeps this directory to just the program shell in git.
set -euo pipefail
d="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp "$d/../gw.h" "$d/src/gw.h"
cp "$d/../gw_q.c" "$d/src/gw_q.c"
cp "$d/../gw_codec.c" "$d/src/gw_codec.c"
cp "$d/../gw_engine.c" "$d/src/gw_engine.c"
sed 's#include "../gw.h"#include "gw.h"#' "$d/../test/vectors.h" > "$d/src/vectors.h"
