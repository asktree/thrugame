/* Prize escrow bookkeeping (gw_escrow.h). SDK-free: the program shell supplies
 * block time, slot, balance and the account bytes, and performs the transfer
 * this module decides on. */
#include "gw_escrow.h"

static void put16(uint8_t *p, uint32_t v) { p[0] = (uint8_t)v; p[1] = (uint8_t)(v >> 8); }
static void put32(uint8_t *p, uint32_t v) { for (int i = 0; i < 4; i++) p[i] = (uint8_t)(v >> (8 * i)); }
static void put64(uint8_t *p, uint64_t v) { for (int i = 0; i < 8; i++) p[i] = (uint8_t)(v >> (8 * i)); }
static uint32_t get32(const uint8_t *p) { uint32_t v = 0; for (int i = 3; i >= 0; i--) v = (v << 8) | p[i]; return v; }
static uint64_t get64(const uint8_t *p) { uint64_t v = 0; for (int i = 7; i >= 0; i--) v = (v << 8) | p[i]; return v; }

static const uint8_t MAGIC[4] = { 'G', 'W', 'E', '2' };
#define GW_ESCROW_LAYOUT_MINOR 0
static const uint8_t EV_MAGIC[4] = { 'G', 'W', '!', 'E' };

void gw_escrow_seed(uint8_t puzzle, uint8_t seed[32]) {
  const char *tag = GW_ESCROW_SEED_TAG;
  for (int i = 0; i < 32; i++) seed[i] = 0;
  for (int i = 0; tag[i]; i++) seed[i] = (uint8_t)tag[i];
  seed[31] = puzzle;
}

void gw_escrow_store(const gw_escrow_t *e, uint8_t out[GW_ESCROW_SZ]) {
  for (uint32_t i = 0; i < GW_ESCROW_SZ; i++) out[i] = 0;
  for (int i = 0; i < 4; i++) out[i] = MAGIC[i];
  out[4] = e->puzzle;
  out[5] = e->flags;
  out[6] = GW_ESCROW_LAYOUT_MINOR;   /* for a future in-place migration */
  out[7] = 0;
  put32(out + 8, e->to_beat);
  put32(out + 12, e->fuse_s);
  put64(out + 16, e->fuse_end);
  put64(out + 24, e->crowned_slot);
  put32(out + 32, e->round);
  put32(out + 36, e->best);
  put64(out + 40, e->total_paid);
  for (int i = 0; i < 32; i++) out[48 + i] = e->champion[i];
}

int gw_escrow_load(const uint8_t *d, uint32_t len, uint8_t puzzle, gw_escrow_t *e) {
  if (len < GW_ESCROW_SZ) return GW_ESC_ERR_STATE;
  for (int i = 0; i < 4; i++) if (d[i] != MAGIC[i]) return GW_ESC_ERR_STATE;
  if (d[4] != puzzle) return GW_ESC_ERR_STATE;
  e->puzzle = d[4];
  e->flags = d[5];
  e->to_beat = get32(d + 8);
  e->fuse_s = get32(d + 12);
  e->fuse_end = get64(d + 16);
  e->crowned_slot = get64(d + 24);
  e->round = get32(d + 32);
  e->best = get32(d + 36);
  e->total_paid = get64(d + 40);
  for (int i = 0; i < 32; i++) e->champion[i] = d[48 + i];
  /* structure only — never policy (fuse bounds and the like), which an upgrade
     may change while old escrows must stay readable */
  if (e->flags & ~(GW_ESCROW_HAS_CHAMPION | GW_ESCROW_SETTLED | GW_ESCROW_UNPAID)) return GW_ESC_ERR_STATE;
  if ((e->flags & GW_ESCROW_SETTLED) && !(e->flags & GW_ESCROW_HAS_CHAMPION)) return GW_ESC_ERR_STATE;
  if ((e->flags & GW_ESCROW_UNPAID) && !(e->flags & GW_ESCROW_SETTLED)) return GW_ESC_ERR_STATE;
  if ((e->flags & GW_ESCROW_HAS_CHAMPION) && (e->to_beat == GW_ESCROW_NO_SUM || e->round == 0)) return GW_ESC_ERR_STATE;
  return GW_ESC_OK;
}

/* now + the fuse, saturating: a fuse never wraps around to the past */
static uint64_t light(const gw_escrow_t *e, uint64_t now) {
  uint64_t len = (uint64_t)e->fuse_s * GW_NS_PER_S;   /* < 2^32 * 1e9 < 2^62 */
  return now > UINT64_MAX - len ? UINT64_MAX : now + len;
}

void gw_escrow_init(gw_escrow_t *e, uint8_t puzzle, uint64_t slot) {
  e->puzzle = puzzle;
  e->flags = 0;
  e->to_beat = GW_ESCROW_NO_SUM;
  e->fuse_s = 0;
  e->fuse_end = 0;
  e->crowned_slot = slot;
  e->round = 0;
  e->best = GW_ESCROW_NO_SUM;
  e->total_paid = 0;
  for (int i = 0; i < 32; i++) e->champion[i] = 0;
}

int gw_escrow_fuse_ok(uint32_t fuse_s) {
  return fuse_s >= GW_ESCROW_FUSE_MIN && fuse_s <= GW_ESCROW_FUSE_MAX;
}

int gw_escrow_reopenable(const gw_escrow_t *e, uint64_t now) {
  if (e->round == 0) return 1;                      /* idle: never opened */
  if (e->flags & GW_ESCROW_SETTLED) return 1;
  return !(e->flags & GW_ESCROW_HAS_CHAMPION) && now >= e->fuse_end;
}

int gw_escrow_open(gw_escrow_t *e, const gw_escrow_t *prev, uint8_t puzzle,
                   uint32_t fuse_s, uint32_t bar, uint64_t now, uint64_t slot) {
  if (now == 0) return GW_ESC_ERR_CLOCK;
  if (!gw_escrow_fuse_ok(fuse_s) || bar == 0) return GW_ESC_ERR_ARGS;
  if (prev && !gw_escrow_reopenable(prev, now)) return GW_ESC_ERR_LIVE;
  uint32_t round = prev ? prev->round : 0;
  uint64_t paid = prev ? prev->total_paid : 0;
  uint32_t best = prev ? prev->best : GW_ESCROW_NO_SUM;
  if (bar < best) best = bar;      /* the bar is a verified sum: it joins best */
  e->puzzle = puzzle;
  e->flags = 0;
  e->best = best;
  e->to_beat = best;               /* min(bar, best): never a sum already reached */
  e->fuse_s = fuse_s;
  e->fuse_end = 0;
  e->crowned_slot = slot;
  e->round = round + 1;
  e->total_paid = paid;
  for (int i = 0; i < 32; i++) e->champion[i] = 0;
  e->fuse_end = light(e, now);     /* the bar lapses one fuse length from now */
  return GW_ESC_OK;
}

int gw_escrow_expired(const gw_escrow_t *e, uint64_t now) {
  return (e->flags & GW_ESCROW_HAS_CHAMPION) && now >= e->fuse_end;
}

int gw_escrow_offer(gw_escrow_t *e, uint64_t sum, const uint8_t solver[32],
                    int can_crown, uint64_t now, uint64_t slot) {
  if (sum == 0 || sum >= GW_ESCROW_NO_SUM) return GW_ESC_NOT_BETTER;   /* not a sum (never verified) */
  uint32_t seen = e->best;
  if (sum < (uint64_t)e->best) e->best = (uint32_t)sum;  /* remembered in every state, clock or not */
  if (e->round == 0) return GW_ESC_IDLE;
  if (e->flags & GW_ESCROW_SETTLED) return GW_ESC_SETTLED;
  if (now == 0) return GW_ESC_ERR_CLOCK;            /* no fuse logic without a clock */
  if (gw_escrow_expired(e, now)) return GW_ESC_FROZEN;
  /* strictly below the round's sum to beat AND every sum seen before: ties
     (copies included) and anything already reached change nothing */
  if (sum >= (uint64_t)e->to_beat || sum >= (uint64_t)seen) return GW_ESC_NOT_BETTER;
  if (!can_crown) return GW_ESC_UNCROWNABLE;
  e->flags |= GW_ESCROW_HAS_CHAMPION;
  e->to_beat = (uint32_t)sum;
  for (int i = 0; i < 32; i++) e->champion[i] = solver[i];
  e->fuse_end = light(e, now);
  e->crowned_slot = slot;
  return GW_ESC_CROWNED;
}

int gw_escrow_claim(gw_escrow_t *e, uint64_t balance, int payable, uint64_t now,
                    uint64_t slot, uint64_t *pay) {
  *pay = 0;
  if (now == 0) return GW_ESC_ERR_CLOCK;
  if (e->flags & GW_ESCROW_SETTLED) return GW_ESC_ERR_PAID;
  if (!(e->flags & GW_ESCROW_HAS_CHAMPION)) return GW_ESC_ERR_NO_CHAMPION;
  if (!gw_escrow_expired(e, now)) return GW_ESC_ERR_BURNING;
  e->flags |= GW_ESCROW_SETTLED;   /* one time: the fuse never relights */
  e->crowned_slot = slot;
  if (!payable) {                  /* nowhere to send it: it stays for the next round */
    e->flags |= GW_ESCROW_UNPAID;
    return GW_ESC_UNPAID;
  }
  *pay = balance;
  e->total_paid += balance;
  return GW_ESC_OK;
}

void gw_escrow_event(const gw_escrow_t *e, uint8_t kind, uint64_t amount,
                     uint8_t out[GW_ESCROW_EVENT_SZ]) {
  for (int i = 0; i < 4; i++) out[i] = EV_MAGIC[i];
  out[4] = kind;
  out[5] = e->puzzle;
  put16(out + 6, 0);
  put64(out + 8, amount);
  gw_escrow_store(e, out + 16);
}
