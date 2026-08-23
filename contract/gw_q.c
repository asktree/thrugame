/* Deterministic Q16.16 geometry core — transliterated from engine/engine.js
 * (the conformance oracle). Constants are normative: copied verbatim from the
 * oracle, never recomputed. */
#include "gw.h"

/* COS5[k] = round(cos(k*5°)*65536), SIN5 likewise, k = 0..12 */
static const int64_t COS5[13] = { 65536, 65287, 64540, 63303, 61584, 59396, 56756,
  53684, 50203, 46341, 42126, 37590, 32768 };
static const int64_t SIN5[13] = { 0, 5712, 11380, 16962, 22415, 27697, 32768,
  37590, 42126, 46341, 50203, 53684, 56756 };

const int32_t GW_DIRS[6][2] = { {1,0}, {0,1}, {-1,1}, {-1,0}, {0,-1}, {1,-1} };

static int32_t mod_a(int32_t u) { return ((u % GW_ANG_TURN) + GW_ANG_TURN) % GW_ANG_TURN; }

void gw_trig(int32_t u, int64_t *co, int64_t *si) {
  u = mod_a(u);
  int32_t s = u / GW_ANG_DIR, k = u - s * GW_ANG_DIR;   /* s in 0..5, k in 0..11 */
  int64_t c = COS5[k], n = SIN5[k];
  switch (s) {
    case 0:  *co = c;                                       *si = n; break;
    case 1:  *co =  gw_fdiv(c, 2) - gw_fmul(GW_HALF_SQRT3, n);
             *si =  gw_fmul(GW_HALF_SQRT3, c) + gw_fdiv(n, 2); break;
    case 2:  *co = -gw_fdiv(c, 2) - gw_fmul(GW_HALF_SQRT3, n);
             *si =  gw_fmul(GW_HALF_SQRT3, c) - gw_fdiv(n, 2); break;
    case 3:  *co = -c;                                      *si = -n; break;
    case 4:  *co = -gw_fdiv(c, 2) + gw_fmul(GW_HALF_SQRT3, n);
             *si = -gw_fmul(GW_HALF_SQRT3, c) - gw_fdiv(n, 2); break;
    default: *co =  gw_fdiv(c, 2) + gw_fmul(GW_HALF_SQRT3, n);
             *si = -gw_fmul(GW_HALF_SQRT3, c) + gw_fdiv(n, 2); break;
  }
}

void gw_to_px(int32_t q, int32_t r, int64_t *x, int64_t *y) {
  *x = gw_fdiv((int64_t)GW_SQRT3 * (2 * (int64_t)q + r), 2);
  *y = (int64_t)r * 98304;                                  /* 1.5*r, exact */
}

void gw_step_q(int32_t n, int32_t u, int64_t *x, int64_t *y) {
  int64_t c, s;
  gw_trig(u, &c, &s);
  *x = gw_fmul((int64_t)GW_SQRT3 * n, c);
  *y = gw_fmul((int64_t)GW_SQRT3 * n, s);
}

void gw_rot_q(int64_t dx, int64_t dy, int32_t u, int64_t *ox, int64_t *oy) {
  int64_t c, s;
  gw_trig(u, &c, &s);
  *ox = gw_fmul(c, dx) - gw_fmul(s, dy);
  *oy = gw_fmul(s, dx) + gw_fmul(c, dy);
}

int gw_too_close(int64_t ax, int64_t ay, int64_t bx, int64_t by) {
  int64_t dx = ax - bx, dy = ay - by;
  return gw_fmul(dx, dx) + gw_fmul(dy, dy) < GW_THRESH2;
}

static int64_t iabs64(int64_t a) { return a < 0 ? -a : a; }
static int64_t qround(int64_t a) { return gw_fdiv(a + 32768, GW_ONE); }

void gw_axial_round(int64_t x, int64_t y, int32_t *q, int32_t *r) {
  int64_t rQ = gw_fdiv(y * 2, 3);
  int64_t qQ = gw_fdiv(x * GW_ONE, GW_SQRT3) - gw_fdiv(rQ, 2);
  int64_t sQ = -qQ - rQ;
  int64_t rq = qround(qQ), rr = qround(rQ), rs = qround(sQ);
  int64_t dq = iabs64(rq * GW_ONE - qQ), dr = iabs64(rr * GW_ONE - rQ), ds = iabs64(rs * GW_ONE - sQ);
  if (dq > dr && dq > ds) rq = -rr - rs; else if (dr > ds) rr = -rq - rs;
  *q = (int32_t)rq; *r = (int32_t)rr;
}

/* exact axial rotation, k steps clockwise */
void gw_rot_cell(int32_t q, int32_t r, int32_t k, int32_t *oq, int32_t *orr) {
  k = ((k % 6) + 6) % 6;
  for (int i = 0; i < k; i++) { int32_t t = q; q = -r; r = t + r; }
  *oq = q; *orr = r;
}
