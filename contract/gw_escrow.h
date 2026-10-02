/*
 * GREAT WORK! — prize escrow (SPEC.md §13), the on-chain bookkeeping.
 *
 * One escrow per puzzle: a program-owned account whose native balance is the
 * pot and whose data is the crown. The rules, all decided here so the host
 * harness tests the exact code the program runs:
 *
 *   - the escrow remembers `best`: the lowest verified SUM it has ever seen —
 *     every submission to the puzzle while the escrow account exists, and the
 *     machine an opener names as the bar. It never rises;
 *   - a verified submission with a sum STRICTLY below the round's sum to beat
 *     takes the crown and relights the fuse; an equal sum (a copy of the public
 *     champion included) changes nothing. While a round is live its sum to
 *     beat is `best`, so only a sum nobody has reached before can crown;
 *   - once the fuse has burnt out the crown is frozen: the champion has won,
 *     and no later submission can take the pot from them before it is paid;
 *   - anyone may then trigger the payout, once: the whole balance goes to the
 *     champion and the round is settled. Its fuse never relights; a settled
 *     round takes no crowns.
 *
 * Anyone may open an escrow (or the next round of one). The opener picks the
 * fuse length (GW_ESCROW_FUSE_MIN..MAX) and, optionally, the bar: a machine
 * the program verifies, normally a copy of the puzzle's public record, whose
 * sum the first crown must strictly beat. The bar is never a bare number, so
 * nobody can open with a bar nobody could ever reach; and every opening's sum
 * to beat is min(the bar, best), so neither a fresh round nor a reopened one
 * can be won with a sum someone has already reached — whatever balance it
 * carries over. The opener never names a champion. A round whose bar nobody
 * beat within one fuse length may be reopened by anyone with a new fuse.
 *
 * SDK-free and allocation-free, like gw_verify.c. Times are the chain's block
 * time in nanoseconds.
 */
#ifndef GW_ESCROW_H
#define GW_ESCROW_H

#include <stdint.h>

#define GW_ESCROW_SZ        80u            /* account data bytes */
#define GW_ESCROW_EVENT_SZ  (16u + GW_ESCROW_SZ)
#define GW_ESCROW_NO_SUM    0xFFFFFFFFu    /* no sum yet: no bar / nothing seen */
#define GW_ESCROW_FUSE_30D  2592000u       /* SPEC §13: a 30-day fuse, in seconds */
#define GW_ESCROW_FUSE_MIN  600u           /* 10 minutes: the shortest fuse OPEN takes */
#define GW_ESCROW_FUSE_MAX  2592000u       /* 30 days: the longest (the documented default) */
#define GW_ESCROW_GRACE_S   7776000u       /* 90 days after the fuse: a champion still
                                              missing then is taken to be gone */
#define GW_NS_PER_S         1000000000ull

/* the escrow account's 32-byte derivation seed: "gw-escrow", zero padding,
   puzzle id in the last byte */
#define GW_ESCROW_SEED_TAG  "gw-escrow"

/* flags. UNPAID: the round settled without a transfer because the champion's
   account could not receive (the balance stays for the next round) */
enum { GW_ESCROW_HAS_CHAMPION = 1, GW_ESCROW_SETTLED = 2, GW_ESCROW_UNPAID = 4 };

typedef struct {
  uint8_t  puzzle;
  uint8_t  flags;          /* GW_ESCROW_HAS_CHAMPION, GW_ESCROW_SETTLED, GW_ESCROW_UNPAID */
  uint32_t to_beat;        /* this round's sum to beat: the champion's, else the
                              opening bar (GW_ESCROW_NO_SUM = any verified sum) */
  uint32_t fuse_s;         /* fuse length, seconds, GW_ESCROW_FUSE_MIN..MAX (0: idle) */
  uint64_t fuse_end;       /* block time (ns): with a champion, when the fuse burns
                              out; before one, when the opening bar lapses and
                              the escrow may be reopened */
  uint64_t crowned_slot;   /* slot of the last change: opening, crown or payout */
  uint32_t round;          /* rounds opened on this puzzle so far: 0 = idle (created
                              by INIT, never opened), 1 = the first */
  uint32_t best;           /* lowest verified sum this escrow has ever seen, over all
                              rounds (GW_ESCROW_NO_SUM = none); never rises */
  uint64_t total_paid;     /* native tokens paid out over all of them */
  uint8_t  champion[32];
} gw_escrow_t;

/* outcomes; the program maps the failures to revert codes */
enum {
  GW_ESC_OK = 0,
  GW_ESC_CROWNED,          /* offer: the crown moved to the solver */
  GW_ESC_NOT_BETTER,       /* offer: sum >= to_beat — sealed on the record, crown unchanged */
  GW_ESC_FROZEN,           /* offer: the fuse has burnt out, the crown awaits payout */
  GW_ESC_SETTLED,          /* offer: the escrow has paid out — no crown to take */
  GW_ESC_IDLE,             /* offer: no round has been opened — best noted, no crown */
  GW_ESC_UNCROWNABLE,      /* offer: better, but the solver cannot be paid (ephemeral):
                              best noted, crown unchanged */
  GW_ESC_UNPAID,           /* claim: settled without a transfer, the balance stays */
  GW_ESC_ERR_STATE,        /* account data is not an escrow for this puzzle */
  GW_ESC_ERR_ARGS,         /* open: fuse out of range, or a zero bar */
  GW_ESC_ERR_LIVE,         /* open: this puzzle's escrow is still contested */
  GW_ESC_ERR_NO_CHAMPION,  /* claim: nobody holds the crown */
  GW_ESC_ERR_PAID,         /* claim: already paid out */
  GW_ESC_ERR_BURNING,      /* claim: the fuse is still burning */
  GW_ESC_ERR_CLOCK,        /* block time unavailable (0) */
  GW_ESC_ERR_PAYEE_MISSING,/* claim: the champion's account reads as absent (compressed,
                              most likely) and the grace period has not run out */
};

void gw_escrow_seed(uint8_t puzzle, uint8_t seed[32]);

/* An idle escrow, as INIT creates it: round 0, no crown, best none, nothing to
   beat, reopenable. It exists so that `best` sees every score from the first
   seal on. */
void gw_escrow_init(gw_escrow_t *e, uint8_t puzzle, uint64_t slot);

/* account data <-> struct (little-endian, packed; layout in FORMAT.md). Load
   checks structure only (length, magic, puzzle, flag consistency), never
   policy such as the fuse bounds, so a later upgrade can always read it. */
void gw_escrow_store(const gw_escrow_t *e, uint8_t out[GW_ESCROW_SZ]);
int  gw_escrow_load(const uint8_t *data, uint32_t len, uint8_t puzzle, gw_escrow_t *e);

/* Open an escrow round: the crown is empty and the bar lapses one fuse length
   from now. `bar` is the verified sum of the machine the opener named (the
   shell runs the verifier), or GW_ESCROW_NO_SUM for none; it joins `best`, and
   the round's sum to beat is the new best = min(bar, best so far). `prev` is
   the puzzle's existing escrow, or NULL if it has none (best starts at
   GW_ESCROW_NO_SUM); opening over one is allowed only once it is settled, or
   crownless with its bar lapsed (the balance stays in the account and becomes
   this round's pot, still guarded by best). */
int  gw_escrow_open(gw_escrow_t *e, const gw_escrow_t *prev, uint8_t puzzle,
                    uint32_t fuse_s, uint32_t bar, uint64_t now, uint64_t slot);

/* Is this fuse length one OPEN accepts? */
int  gw_escrow_fuse_ok(uint32_t fuse_s);

/* May this escrow be opened over (gw_escrow_open's rule)? */
int  gw_escrow_reopenable(const gw_escrow_t *e, uint64_t now);

/* A verified submission's sum, offered for the crown. It lowers `best` in
   every state (idle, frozen and settled escrows included, and with no block
   time): the caller saves the escrow whenever best or the crown changed. It
   crowns only a sum strictly below both the round's sum to beat and every sum
   seen before, by a solver that `can_crown` (the shell says no for an
   account that cannot be paid), with a block time, before the fuse is out. */
int  gw_escrow_offer(gw_escrow_t *e, uint64_t sum, const uint8_t solver[32],
                     int can_crown, uint64_t now, uint64_t slot);

/* Has the fuse burnt out (a champion has won the current round)? */
int  gw_escrow_expired(const gw_escrow_t *e, uint64_t now);

/* What the shell sees of the champion's account at payout time. */
enum {
  GW_PAYEE_OK = 0,         /* present and creditable: pay it */
  GW_PAYEE_GONE,           /* present but DELETED (or EPHEMERAL): it can never be paid */
  GW_PAYEE_MISSING,        /* reads as absent: on Thru that is how a compressed account
                              looks, so wait — unless the grace period is over */
};

/* Settle the round, once: GW_ESC_OK with *pay = the whole balance, owed to
   e->champion. GW_ESC_UNPAID with *pay = 0 when the payee is GONE, or MISSING
   at or after fuse end + GW_ESCROW_GRACE_S: the round settles marked UNPAID and
   the balance stays for the next round. MISSING before that:
   GW_ESC_ERR_PAYEE_MISSING (decompress the champion and claim again). Either
   way a settled round's fuse never relights. Anything else is an error. */
int  gw_escrow_claim(gw_escrow_t *e, uint64_t balance, int payee, uint64_t now,
                     uint64_t slot, uint64_t *pay);

/* Event payload "GW!E": kind, puzzle, amount, then the escrow as stored (GWE2). */
enum { GW_ESCROW_EV_OPEN = 1, GW_ESCROW_EV_CROWN = 2, GW_ESCROW_EV_PAYOUT = 3,
       GW_ESCROW_EV_UNPAID = 4,   /* settled without a transfer; amount = the balance kept */
       GW_ESCROW_EV_INIT = 5 };
void gw_escrow_event(const gw_escrow_t *e, uint8_t kind, uint64_t amount,
                     uint8_t out[GW_ESCROW_EVENT_SZ]);

#endif
