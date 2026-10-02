/*
 * GREAT WORK! — prize escrow (SPEC.md §13), the on-chain bookkeeping.
 *
 * One escrow per puzzle: a program-owned account whose native balance is the
 * pot and whose data is the crown. The rules, all decided here so the host
 * harness tests the exact code the program runs:
 *
 *   - a verified submission with a STRICTLY lower sum than the reigning best
 *     takes the crown and relights the fuse; an equal sum (a copy of the public
 *     champion included) changes nothing;
 *   - once the fuse has burnt out the crown is frozen: the champion has won,
 *     and no later submission can take the pot from them before it is paid;
 *   - anyone may then trigger the payout, once: the whole balance goes to the
 *     champion and the escrow is settled. The fuse never relights; a settled
 *     escrow takes no crowns, and anything deposited after the payout waits
 *     for whoever opens the puzzle's next escrow.
 *
 * Anyone may open an escrow. The opener picks the fuse length and the bar —
 * the sum a machine must strictly beat to take the first crown (normally the
 * puzzle's public record, so a copy of the leader cannot walk off with the
 * pot; GW_ESCROW_NO_SUM lets any verified machine take it). The opener never
 * names a champion. An escrow whose bar nobody has beaten within one fuse
 * length of opening may be reopened by anyone with a new bar and fuse, its
 * balance carried over, so an unbeatable bar cannot lock a puzzle for good.
 *
 * SDK-free and allocation-free, like gw_verify.c. Times are the chain's block
 * time in nanoseconds.
 */
#ifndef GW_ESCROW_H
#define GW_ESCROW_H

#include <stdint.h>

#define GW_ESCROW_SZ        80u            /* account data bytes */
#define GW_ESCROW_EVENT_SZ  (16u + GW_ESCROW_SZ)
#define GW_ESCROW_NO_SUM    0xFFFFFFFFu    /* best_sum while nobody holds the crown */
#define GW_ESCROW_FUSE_30D  2592000u       /* SPEC §13: a 30-day fuse, in seconds */
#define GW_NS_PER_S         1000000000ull

/* the escrow account's 32-byte derivation seed: "gw-escrow", zero padding,
   puzzle id in the last byte */
#define GW_ESCROW_SEED_TAG  "gw-escrow"

enum { GW_ESCROW_HAS_CHAMPION = 1, GW_ESCROW_SETTLED = 2 };

typedef struct {
  uint8_t  puzzle;
  uint8_t  flags;          /* GW_ESCROW_HAS_CHAMPION, GW_ESCROW_SETTLED */
  uint32_t best_sum;       /* the sum to beat: the champion's, else the opening bar
                              (GW_ESCROW_NO_SUM = any verified sum) */
  uint32_t fuse_s;         /* fuse length, seconds (30 days unless opened otherwise) */
  uint64_t fuse_end;       /* block time (ns): with a champion, when the fuse burns
                              out; before one, when the opening bar lapses and
                              the escrow may be reopened */
  uint64_t crowned_slot;   /* slot of the last change: opening, crown or payout */
  uint32_t round;          /* escrows opened on this puzzle so far (1 = the first) */
  uint64_t total_paid;     /* native tokens paid out over all of them */
  uint8_t  champion[32];
} gw_escrow_t;

/* outcomes; the program maps the failures to revert codes */
enum {
  GW_ESC_OK = 0,
  GW_ESC_CROWNED,          /* offer: the crown moved to the solver */
  GW_ESC_NOT_BETTER,       /* offer: sum >= best — sealed on the record, crown unchanged */
  GW_ESC_FROZEN,           /* offer: the fuse has burnt out, the crown awaits payout */
  GW_ESC_SETTLED,          /* offer: the escrow has paid out — no crown to take */
  GW_ESC_ERR_STATE,        /* account data is not an escrow for this puzzle */
  GW_ESC_ERR_ARGS,         /* open: zero fuse */
  GW_ESC_ERR_LIVE,         /* open: this puzzle's escrow is still contested */
  GW_ESC_ERR_NO_CHAMPION,  /* claim: nobody holds the crown */
  GW_ESC_ERR_PAID,         /* claim: already paid out */
  GW_ESC_ERR_BURNING,      /* claim: the fuse is still burning */
  GW_ESC_ERR_CLOCK,        /* block time unavailable (0) */
};

void gw_escrow_seed(uint8_t puzzle, uint8_t seed[32]);

/* account data <-> struct (little-endian, packed; layout in FORMAT.md) */
void gw_escrow_store(const gw_escrow_t *e, uint8_t out[GW_ESCROW_SZ]);
int  gw_escrow_load(const uint8_t *data, uint32_t len, uint8_t puzzle, gw_escrow_t *e);

/* Open an escrow: the crown is empty, `bar` is the sum to beat for the first
   crown, and the bar lapses one fuse length from now. `prev` is the puzzle's
   existing escrow, or NULL if it has none; opening over one is allowed only
   once it is settled, or crownless with its bar lapsed (the balance stays in
   the account and becomes this escrow's pot). */
int  gw_escrow_open(gw_escrow_t *e, const gw_escrow_t *prev, uint8_t puzzle,
                    uint32_t fuse_s, uint32_t bar, uint64_t now, uint64_t slot);

/* May this escrow be opened over (gw_escrow_open's rule)? */
int  gw_escrow_reopenable(const gw_escrow_t *e, uint64_t now);

/* A verified submission's sum, offered for the crown. */
int  gw_escrow_offer(gw_escrow_t *e, uint64_t sum, const uint8_t solver[32],
                     uint64_t now, uint64_t slot);

/* Has the fuse burnt out (a champion has won the current round)? */
int  gw_escrow_expired(const gw_escrow_t *e, uint64_t now);

/* Settle: *pay = the whole balance, owed to e->champion, once. The escrow is
   then settled for good. GW_ESC_OK or an error. */
int  gw_escrow_claim(gw_escrow_t *e, uint64_t balance, uint64_t now, uint64_t slot,
                     uint64_t *pay);

/* Event payload "GWE1": kind, puzzle, amount, then the escrow as stored. */
enum { GW_ESCROW_EV_OPEN = 1, GW_ESCROW_EV_CROWN = 2, GW_ESCROW_EV_PAYOUT = 3 };
void gw_escrow_event(const gw_escrow_t *e, uint8_t kind, uint64_t amount,
                     uint8_t out[GW_ESCROW_EVENT_SZ]);

#endif
