/* Differential conformance harness: replays the JS oracle's frozen vectors
 * (contract/test/vectors.h, from engine/gen-vectors.js) against the C engine.
 * Host build only — exercises the exact code that will run on-chain. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include "../gw.h"
#include "vectors.h"

void gw_panic(void) {
  fprintf(stderr, "gw_panic: capacity bound exceeded\n");
  abort();
}

static int failures = 0;
#define CHECK(cond, ...) do { \
    if (!(cond)) { failures++; printf("FAIL "); printf(__VA_ARGS__); printf("\n"); } \
  } while (0)

static void primitives(void) {
  int n;
  n = sizeof(VEC_TRIG) / sizeof(VEC_TRIG[0]);
  for (int i = 0; i < n; i++) {
    int64_t c, s;
    gw_trig(VEC_TRIG[i].u, &c, &s);
    CHECK(c == VEC_TRIG[i].c && s == VEC_TRIG[i].s,
      "trig u=%d: got (%lld,%lld) want (%lld,%lld)", VEC_TRIG[i].u,
      (long long)c, (long long)s, (long long)VEC_TRIG[i].c, (long long)VEC_TRIG[i].s);
  }
  n = sizeof(VEC_ROT) / sizeof(VEC_ROT[0]);
  for (int i = 0; i < n; i++) {
    int64_t x, y;
    gw_rot_q(VEC_ROT[i].dx, VEC_ROT[i].dy, VEC_ROT[i].u, &x, &y);
    CHECK(x == VEC_ROT[i].ex && y == VEC_ROT[i].ey, "rotQ case %d", i);
  }
  n = sizeof(VEC_TOPX) / sizeof(VEC_TOPX[0]);
  for (int i = 0; i < n; i++) {
    int64_t x, y;
    gw_to_px(VEC_TOPX[i].q, VEC_TOPX[i].r, &x, &y);
    CHECK(x == VEC_TOPX[i].x && y == VEC_TOPX[i].y, "toPxQ (%d,%d)", VEC_TOPX[i].q, VEC_TOPX[i].r);
  }
  n = sizeof(VEC_AXIAL) / sizeof(VEC_AXIAL[0]);
  for (int i = 0; i < n; i++) {
    int32_t q, r;
    gw_axial_round(VEC_AXIAL[i].x, VEC_AXIAL[i].y, &q, &r);
    CHECK(q == VEC_AXIAL[i].q && r == VEC_AXIAL[i].r, "axialRoundQ case %d", i);
  }
  n = sizeof(VEC_TOOCLOSE) / sizeof(VEC_TOOCLOSE[0]);
  for (int i = 0; i < n; i++) {
    int got = gw_too_close(VEC_TOOCLOSE[i].ax, VEC_TOOCLOSE[i].ay, VEC_TOOCLOSE[i].bx, VEC_TOOCLOSE[i].by);
    CHECK(got == VEC_TOOCLOSE[i].close, "tooCloseQ case %d", i);
  }
  printf("primitives: trig/rot/px/axial/tooclose vectors checked\n");
}

static gw_sim_t SIM;   /* too big for the stack */

static void run_case(const gw_vector_case_t *vc) {
  gw_machine_t m;
  int err = gw_decode_machine(vc->machine_bytes, vc->machine_len, &m);
  CHECK(err == GW_OK, "%s: decode err %d", vc->name, err);
  if (err != GW_OK) return;

  /* codec round-trip: re-encoded bytes must be identical */
  uint8_t buf[4096];
  int32_t enc = gw_encode_machine(&m, buf, sizeof(buf));
  CHECK(enc == (int32_t)vc->machine_len && memcmp(buf, vc->machine_bytes, vc->machine_len) == 0,
    "%s: codec round-trip", vc->name);

  err = gw_sim_init(&SIM, vc->puzzle, &m);
  CHECK(err == GW_OK, "%s: init err %d", vc->name, err);
  if (err != GW_OK) return;

  const gw_expect_t *E = vc->expect;
  for (int32_t t = 0; t < E->ticks; t++) {
    gw_sim_step(&SIM);
    uint64_t d = gw_sim_digest(&SIM);
    if (d != vc->digests[t]) {
      failures++;
      printf("FAIL %s: digest diverges at tick %d (got %016llx want %016llx)\n",
        vc->name, (int)t + 1, (unsigned long long)d, (unsigned long long)vc->digests[t]);
      return;
    }
  }
  int status = SIM.fault_kind != GW_FAULT_NONE ? 2 : SIM.cycles >= 0 ? 1 : 0;
  CHECK(status == E->status, "%s: final status %d want %d", vc->name, status, E->status);
  CHECK(SIM.fault_kind == E->fault_kind, "%s: fault kind", vc->name);
  if (E->status == 2) CHECK((int32_t)SIM.fault_tick == E->fault_tick, "%s: fault tick", vc->name);
  CHECK(SIM.cost == E->cost, "%s: cost %lld want %lld", vc->name, (long long)SIM.cost, (long long)E->cost);
  CHECK(SIM.cycles == E->cycles, "%s: cycles %d want %d", vc->name, SIM.cycles, E->cycles);
  CHECK((int32_t)SIM.area_count == E->area, "%s: area %u want %d", vc->name, SIM.area_count, E->area);
  if (E->sum >= 0)
    CHECK(SIM.cost + SIM.cycles + (int64_t)SIM.area_count == E->sum, "%s: sum", vc->name);
  printf("ok  %s: %d ticks, status %d, cost %lld cycles %d area %u\n",
    vc->name, E->ticks, status, (long long)SIM.cost, SIM.cycles, SIM.area_count);
}

int main(void) {
  primitives();
  int n = sizeof(VEC_CASES) / sizeof(VEC_CASES[0]);
  for (int i = 0; i < n; i++) run_case(&VEC_CASES[i]);
  if (failures) { printf("%d FAILURES\n", failures); return 1; }
  printf("all conformance vectors pass (%d cases)\n", n);
  return 0;
}
