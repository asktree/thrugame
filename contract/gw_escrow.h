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
 *   - anyone may then trigger the payout: the whole balance goes to the
 *     champion, the round counter advances, and the fuse relights with the
 *     champion defending — the next round's pot (later deposits) goes to
 *     whoever holds the crown when it burns out again.
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

enum { GW_ESCROW_HAS_CHAMPION = 1 };

typedef struct {
  uint8_t  puzzle;
  uint8_t  flags;          /* GW_ESCROW_HAS_CHAMPION */
  uint32_t best_sum;       /* GW_ESCROW_NO_SUM until someone holds the crown */
  uint32_t fuse_s;         /* fuse length, seconds (30 days unless opened otherwise) */
  uint64_t fuse_end;       /* block time (ns) at which the fuse burns out; 0 = unlit */
  uint64_t crowned_slot;   /* slot of the last crown change (or round start) */
  uint32_t round;          /* payouts made so far */
  uint64_t total_paid;     /* native tokens paid out over all rounds */
  uint8_t  champion[32];
} gw_escrow_t;

/* outcomes; the program maps the failures to revert codes */
enum {
  GW_ESC_OK = 0,
  GW_ESC_CROWNED,          /* offer: the crown moved to the solver */
  GW_ESC_NOT_BETTER,       /* offer: sum >= best — sealed on the record, crown unchanged */
  GW_ESC_FROZEN,           /* offer: the fuse has burnt out, the crown awaits payout */
  GW_ESC_ERR_STATE,        /* account data is not an escrow for this puzzle */
  GW_ESC_ERR_ARGS,         /* open: zero fuse, or a champion without a sum (or vice versa) */
  GW_ESC_ERR_NO_CHAMPION,  /* claim: nobody holds the crown */
  GW_ESC_ERR_BURNING,      /* claim: the fuse is still burning */
  GW_ESC_ERR_CLOCK,        /* block time unavailable (0) */
};

void gw_escrow_seed(uint8_t puzzle, uint8_t seed[32]);

/* account data <-> struct (little-endian, packed; layout in FORMAT.md) */
void gw_escrow_store(const gw_escrow_t *e, uint8_t out[GW_ESCROW_SZ]);
int  gw_escrow_load(const uint8_t *data, uint32_t len, uint8_t puzzle, gw_escrow_t *e);

/* A new escrow. seed_sum/champion seed the crown from the public record (the
   puzzle's current leader), lighting the fuse now; seed_sum = GW_ESCROW_NO_SUM
   with champion = NULL leaves the crown open and the fuse unlit until the
   first verified submission. */
int  gw_escrow_open(gw_escrow_t *e, uint8_t puzzle, uint32_t fuse_s,
                    uint32_t seed_sum, const uint8_t *champion,
                    uint64_t now, uint64_t slot);

/* A verified submission's sum, offered for the crown. */
int  gw_escrow_offer(gw_escrow_t *e, uint64_t sum, const uint8_t solver[32],
                     uint64_t now, uint64_t slot);

/* Has the fuse burnt out (a champion has won the current round)? */
int  gw_escrow_expired(const gw_escrow_t *e, uint64_t now);

/* Settle the round: *pay = the whole balance, owed to e->champion; the next
   round starts with the champion defending. GW_ESC_OK or an error. */
int  gw_escrow_claim(gw_escrow_t *e, uint64_t balance, uint64_t now, uint64_t slot,
                     uint64_t *pay);

/* Event payload "GWE1": kind, puzzle, amount, then the escrow as stored. */
enum { GW_ESCROW_EV_OPEN = 1, GW_ESCROW_EV_CROWN = 2, GW_ESCROW_EV_PAYOUT = 3 };
void gw_escrow_event(const gw_escrow_t *e, uint8_t kind, uint64_t amount,
                     uint8_t out[GW_ESCROW_EVENT_SZ]);

#endif
