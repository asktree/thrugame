/* Deterministic Q16.16 geometry core — transliterated from engine/engine.js
 * (the conformance oracle). Constants are normative: copied verbatim from the
 * oracle, never recomputed. */
#include "gw.h"

/* COS[k] = round(cos(k*0.9375°)*65536), SIN likewise, k = 0..64 (one sextant) */
static const int64_t COS[65] = { 65536, 65527, 65501, 65457, 65396, 65317, 65220, 65107, 64975, 64827, 64661, 64477, 64277, 64059, 63824, 63572, 63303, 63017, 62714, 62394, 62058, 61705, 61336, 60950, 60547, 60129, 59694, 59244, 58777, 58295, 57798, 57284, 56756, 56212, 55653, 55080, 54491, 53888, 53271, 52639, 51993, 51333, 50660, 49973, 49273, 48559, 47832, 47093, 46341, 45577, 44800, 44011, 43211, 42399, 41576, 40741, 39896, 39040, 38173, 37297, 36410, 35513, 34607, 33692, 32768 };
static const int64_t SIN[65] = { 0, 1072, 2144, 3216, 4286, 5356, 6424, 7490, 8554, 9616, 10676, 11732, 12785, 13835, 14882, 15924, 16962, 17995, 19024, 20048, 21066, 22078, 23085, 24086, 25080, 26067, 27047, 28020, 28986, 29944, 30893, 31835, 32768, 33692, 34607, 35513, 36410, 37297, 38173, 39040, 39896, 40741, 41576, 42399, 43211, 44011, 44800, 45577, 46341, 47093, 47832, 48559, 49273, 49973, 50660, 51333, 51993, 52639, 53271, 53888, 54491, 55080, 55653, 56212, 56756 };

const int32_t GW_DIRS[6][2] = { {1,0}, {0,1}, {-1,1}, {-1,0}, {0,-1}, {1,-1} };

static int32_t mod_a(int32_t u) { return ((u % GW_ANG_TURN) + GW_ANG_TURN) % GW_ANG_TURN; }

void gw_trig(int32_t u, int64_t *co, int64_t *si) {
  u = mod_a(u);
  int32_t s = u / GW_ANG_DIR, k = u - s * GW_ANG_DIR;   /* s in 0..5, k in 0..63 */
  int64_t c = COS[k], n = SIN[k];
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

int gw_too_close(int64_t ax, int64_t ay, int64_t bx, int64_t by, int64_t t2) {
  int64_t dx = ax - bx, dy = ay - by;
  return gw_fmul(dx, dx) + gw_fmul(dy, dy) < t2;
}

/* Opus Magnum's sweep resolution: increment 0.25 / 2^round(log2 d), at most
   0.125, i.e. N = 4 * 2^round(log2 d) instants, at least 8; capped at 64. */
int32_t gw_round_log2(int32_t d) {
  int32_t f = 0;
  while ((2 << f) <= d) f++;                              /* floor(log2 d) */
  return ((int64_t)d * d >= (int64_t)(2 << (2 * f))) ? f + 1 : f;
}
int32_t gw_samples_for(int32_t max_dist) {
  if (max_dist < 1) max_dist = 1;
  int32_t n = 4 * (1 << gw_round_log2(max_dist));
  if (n < 8) n = 8;
  if (n > GW_K_MAX) n = GW_K_MAX;
  return n;
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
