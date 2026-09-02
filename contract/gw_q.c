/* Deterministic Q16.16 geometry core — transliterated from engine/engine.js
 * (the conformance oracle). Constants are normative: copied verbatim from the
 * oracle, never recomputed. */
#include "gw.h"

/* COS[k] = round(cos(k*0.46875°)*65536), SIN likewise, k = 0..128 (one sextant) */
static const int64_t COS[129] = { 65536, 65534, 65527, 65516, 65501, 65481, 65457, 65429, 65396, 65358, 65317, 65271, 65220, 65166, 65107, 65043, 64975, 64903, 64827, 64746, 64661, 64571, 64477, 64379, 64277, 64170, 64059, 63944, 63824, 63700, 63572, 63440, 63303, 63162, 63017, 62868, 62714, 62556, 62394, 62228, 62058, 61884, 61705, 61522, 61336, 61145, 60950, 60751, 60547, 60340, 60129, 59914, 59694, 59471, 59244, 59013, 58777, 58538, 58295, 58048, 57798, 57543, 57284, 57022, 56756, 56486, 56212, 55935, 55653, 55368, 55080, 54787, 54491, 54191, 53888, 53581, 53271, 52957, 52639, 52318, 51993, 51665, 51333, 50998, 50660, 50318, 49973, 49624, 49273, 48917, 48559, 48197, 47832, 47464, 47093, 46719, 46341, 45960, 45577, 45190, 44800, 44407, 44011, 43613, 43211, 42806, 42399, 41989, 41576, 41160, 40741, 40320, 39896, 39469, 39040, 38608, 38173, 37736, 37297, 36854, 36410, 35963, 35513, 35062, 34607, 34151, 33692, 33231, 32768 };
static const int64_t SIN[129] = { 0, 536, 1072, 1608, 2144, 2680, 3216, 3751, 4286, 4821, 5356, 5890, 6424, 6957, 7490, 8022, 8554, 9085, 9616, 10146, 10676, 11204, 11732, 12259, 12785, 13311, 13835, 14359, 14882, 15403, 15924, 16444, 16962, 17479, 17995, 18510, 19024, 19537, 20048, 20557, 21066, 21573, 22078, 22582, 23085, 23586, 24086, 24583, 25080, 25574, 26067, 26558, 27047, 27535, 28020, 28504, 28986, 29466, 29944, 30420, 30893, 31365, 31835, 32303, 32768, 33231, 33692, 34151, 34607, 35062, 35513, 35963, 36410, 36854, 37297, 37736, 38173, 38608, 39040, 39469, 39896, 40320, 40741, 41160, 41576, 41989, 42399, 42806, 43211, 43613, 44011, 44407, 44800, 45190, 45577, 45960, 46341, 46719, 47093, 47464, 47832, 48197, 48559, 48917, 49273, 49624, 49973, 50318, 50660, 50998, 51333, 51665, 51993, 52318, 52639, 52957, 53271, 53581, 53888, 54191, 54491, 54787, 55080, 55368, 55653, 55935, 56212, 56486, 56756 };

const int32_t GW_DIRS[6][2] = { {1,0}, {0,1}, {-1,1}, {-1,0}, {0,-1}, {1,-1} };

static int32_t mod_a(int32_t u) { return ((u % GW_ANG_TURN) + GW_ANG_TURN) % GW_ANG_TURN; }

void gw_trig(int32_t u, int64_t *co, int64_t *si) {
  u = mod_a(u);
  int32_t s = u / GW_ANG_DIR, k = u - s * GW_ANG_DIR;   /* s in 0..5, k in 0..127 */
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
   0.125, i.e. N = 4 * 2^round(log2 d) instants, at least 8; capped at 128. */
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
