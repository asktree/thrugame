/* Prize escrow harness (SPEC §13).
 *
 * Part 1 drives gw_escrow.c directly: the crown, fuse and payout rules.
 * Part 2 runs the real program shell (contract/program/src/gw_verifier.c,
 * compiled unchanged against the host stand-in SDK in test/mock) on a
 * simulated ledger: accounts with balances, owners and read-write flags,
 * transaction atomicity (a revert undoes everything), events. The ledger
 * models the runtime rules the program leans on — a program writes and debits
 * only accounts it owns that the transaction lists read-write, and creates an
 * account only at its own derived address — so a shell that skipped a check
 * would fail here. Submissions are real machines from the conformance vectors,
 * verified by the real engine. */
#include <setjmp.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <thru-sdk/c/tn_sdk.h>
#include <thru-sdk/c/tn_sdk_syscall.h>
#include "../gw.h"
#include "../gw_escrow.h"
#include "vectors.h"

static int failures = 0;
#define CHECK(cond, ...) do { \
    if (!(cond)) { failures++; printf("FAIL %s:%d ", __FILE__, __LINE__); printf(__VA_ARGS__); printf("\n"); } \
  } while (0)

#define S (1000000000ull)               /* one second of block time, ns */
#define DAY (86400ull * S)
#define T0 (1790000000ull * S)          /* 2026-ish */

static void key(uint8_t k[32], uint8_t tag) { memset(k, 0, 32); k[0] = tag; k[31] = (uint8_t)~tag; }

/* ======================= part 1: gw_escrow.c ======================= */

static void unit(void) {
  uint8_t alice[32], bob[32], carol[32];
  key(alice, 'a'); key(bob, 'b'); key(carol, 'c');
  gw_escrow_t e, prev;
  uint64_t pay;

  /* argument checks: the fuse is 10 minutes .. 365 days, a bar is a real sum */
  CHECK(gw_escrow_open(&e, 0, 0, 0, GW_ESCROW_NO_SUM, T0, 1) == GW_ESC_ERR_ARGS, "zero fuse accepted");
  CHECK(gw_escrow_open(&e, 0, 0, 1, GW_ESCROW_NO_SUM, T0, 1) == GW_ESC_ERR_ARGS, "1 s fuse accepted");
  CHECK(gw_escrow_open(&e, 0, 0, GW_ESCROW_FUSE_MIN - 1, GW_ESCROW_NO_SUM, T0, 1) == GW_ESC_ERR_ARGS, "599 s fuse accepted");
  CHECK(gw_escrow_open(&e, 0, 0, GW_ESCROW_FUSE_MAX + 1, GW_ESCROW_NO_SUM, T0, 1) == GW_ESC_ERR_ARGS, "fuse over a year accepted");
  CHECK(gw_escrow_open(&e, 0, 0, 0xFFFFFFFFu, GW_ESCROW_NO_SUM, T0, 1) == GW_ESC_ERR_ARGS, "136-year fuse accepted");
  CHECK(gw_escrow_open(&e, 0, 0, GW_ESCROW_FUSE_MIN, 0, T0, 1) == GW_ESC_ERR_ARGS, "bar 0 accepted");
  CHECK(gw_escrow_open(&e, 0, 0, GW_ESCROW_FUSE_MIN, GW_ESCROW_NO_SUM, T0, 1) == GW_ESC_OK, "10-minute fuse");
  CHECK(gw_escrow_open(&e, 0, 0, GW_ESCROW_FUSE_MAX, GW_ESCROW_NO_SUM, T0, 1) == GW_ESC_OK, "365-day fuse");
  CHECK(gw_escrow_open(&e, 0, 0, 600, GW_ESCROW_NO_SUM, 0, 1) == GW_ESC_ERR_CLOCK, "zero clock accepted");

  /* an open crown with no bar: nothing to claim until someone verifies */
  CHECK(gw_escrow_open(&e, 0, 3, GW_ESCROW_FUSE_30D, GW_ESCROW_NO_SUM, T0, 1) == GW_ESC_OK, "open");
  CHECK(!(e.flags & GW_ESCROW_HAS_CHAMPION) && e.to_beat == GW_ESCROW_NO_SUM && e.best == GW_ESCROW_NO_SUM && e.round == 1,
    "fresh escrow state");
  CHECK(e.fuse_end == T0 + 30 * DAY, "the bar lapses one fuse length after opening");
  CHECK(gw_escrow_claim(&e, 500, T0 + 365 * DAY, 2, &pay) == GW_ESC_ERR_NO_CHAMPION && pay == 0, "claim with no champion");
  CHECK(!gw_escrow_expired(&e, T0 + 365 * DAY), "a crownless escrow never expires");
  CHECK(!gw_escrow_reopenable(&e, T0 + 30 * DAY - 1) && gw_escrow_reopenable(&e, T0 + 30 * DAY), "lapsed bar reopenable");

  /* the first verified sum takes the crown and lights the 30-day fuse —
     even after the bar has lapsed, as long as nobody reopened */
  uint64_t t = T0 + 40 * DAY;
  CHECK(gw_escrow_offer(&e, 179, alice, t, 2) == GW_ESC_CROWNED, "first sum crowns");
  CHECK(e.to_beat == 179 && e.best == 179 && !memcmp(e.champion, alice, 32), "alice crowned at 179, best 179");
  CHECK(e.fuse_end == t + 30 * DAY && e.crowned_slot == 2, "fuse lit for 30 days");
  CHECK(!gw_escrow_reopenable(&e, t + 29 * DAY), "a crowned escrow cannot be reopened");
  CHECK(gw_escrow_open(&prev, &e, 3, 600, 1, t + DAY, 3) == GW_ESC_ERR_LIVE, "open over a live crown");

  /* ties — copies of the public champion included — change nothing */
  gw_escrow_t before = e;
  CHECK(gw_escrow_offer(&e, 179, bob, t + 5 * DAY, 3) == GW_ESC_NOT_BETTER, "tie by bob");
  CHECK(gw_escrow_offer(&e, 179, alice, t + 5 * DAY, 3) == GW_ESC_NOT_BETTER, "tie by the champion herself");
  CHECK(gw_escrow_offer(&e, 200, bob, t + 5 * DAY, 3) == GW_ESC_NOT_BETTER, "worse by bob");
  CHECK(gw_escrow_offer(&e, 0, bob, t + 5 * DAY, 3) == GW_ESC_NOT_BETTER, "a zero sum is not a sum");
  CHECK(!memcmp(&before, &e, sizeof e), "ties and worse sums leave the escrow untouched");

  /* strictly better takes the crown and resets the fuse */
  uint64_t t2 = t + 20 * DAY;
  CHECK(gw_escrow_offer(&e, 178, bob, t2, 4) == GW_ESC_CROWNED, "one better crowns");
  CHECK(e.to_beat == 178 && e.best == 178 && !memcmp(e.champion, bob, 32) && e.fuse_end == t2 + 30 * DAY, "bob crowned, fuse reset");
  /* the champion may improve on himself: still strictly better, still a reset */
  CHECK(gw_escrow_offer(&e, 170, bob, t2 + DAY, 5) == GW_ESC_CROWNED && e.fuse_end == t2 + 31 * DAY, "self-improvement resets");

  /* the fuse burns out exactly at fuse_end */
  uint64_t end = e.fuse_end;
  CHECK(!gw_escrow_expired(&e, end - 1), "burning one ns before the end");
  CHECK(gw_escrow_claim(&e, 500, end - 1, 6, &pay) == GW_ESC_ERR_BURNING && pay == 0, "claim while burning");
  CHECK(gw_escrow_expired(&e, end), "out at the end");
  CHECK(!gw_escrow_reopenable(&e, end + 99 * DAY), "an unpaid champion's escrow cannot be reopened");

  /* once out, the crown is frozen: the champion has won. A better sum after
     the fuse takes nothing, but best remembers it */
  before = e;
  CHECK(gw_escrow_offer(&e, 150, carol, end, 7) == GW_ESC_FROZEN, "better sum after the fuse");
  CHECK(!memcmp(e.champion, bob, 32) && e.to_beat == 170 && e.fuse_end == before.fuse_end && e.crowned_slot == before.crowned_slot,
    "frozen crown untouched");
  CHECK(e.best == 150, "best remembers the frozen-out 150");

  /* payout: the whole balance, once; the fuse never relights */
  CHECK(gw_escrow_claim(&e, 25000, end + 3 * DAY, 8, &pay) == GW_ESC_OK && pay == 25000, "claim pays the balance");
  CHECK((e.flags & GW_ESCROW_SETTLED) && e.total_paid == 25000 && !memcmp(e.champion, bob, 32) && e.to_beat == 170,
    "settled, bob on the record");
  CHECK(e.fuse_end == end, "the fuse does not relight");
  CHECK(gw_escrow_claim(&e, 25000, end + 90 * DAY, 9, &pay) == GW_ESC_ERR_PAID && pay == 0, "no second payout, ever");
  before = e;
  CHECK(gw_escrow_offer(&e, 140, carol, end + 4 * DAY, 9) == GW_ESC_SETTLED, "a settled escrow takes no crowns");
  CHECK(!memcmp(e.champion, bob, 32) && e.to_beat == 170 && e.best == 140, "settled crown untouched, best 140");

  /* a settled escrow may be opened again; the next round's sum to beat is
     best — not the old champion's 170, not a looser bar */
  CHECK(gw_escrow_reopenable(&e, end + 3 * DAY), "settled is reopenable");
  CHECK(gw_escrow_open(&prev, &e, 3, 3600, GW_ESCROW_NO_SUM, end + 5 * DAY, 10) == GW_ESC_OK, "second escrow on puzzle 3");
  CHECK(prev.round == 2 && prev.total_paid == 25000 && !(prev.flags & (GW_ESCROW_HAS_CHAMPION | GW_ESCROW_SETTLED)) &&
        prev.to_beat == 140 && prev.best == 140, "fresh crown, no bar asked yet best 140 holds, history kept");
  CHECK(gw_escrow_offer(&prev, 140, carol, end + 5 * DAY, 11) == GW_ESC_NOT_BETTER, "a copy of the best does not crown");
  CHECK(gw_escrow_offer(&prev, 139, carol, end + 5 * DAY, 11) == GW_ESC_CROWNED, "beating best crowns");
  e = prev;

  /* a bar joins best when it is lower, never loosens it when higher */
  gw_escrow_t r1, r2, r3;
  CHECK(gw_escrow_open(&r1, 0, 4, 600, 150, T0, 1) == GW_ESC_OK && r1.to_beat == 150 && r1.best == 150, "bar 150 is the first best");
  CHECK(gw_escrow_open(&r2, &r1, 4, 600, 200, T0 + 600 * S, 2) == GW_ESC_OK && r2.to_beat == 150 && r2.best == 150,
    "a reopen asking for a looser bar still gets best");
  CHECK(gw_escrow_open(&r3, &r2, 4, 600, 120, T0 + 1200 * S, 3) == GW_ESC_OK && r3.to_beat == 120 && r3.best == 120,
    "a stricter verified bar lowers best");

  /* THE REOPEN THEFT (review PoC A): a funded escrow lapses unbeaten; anyone
     reopens it with no bar and the shortest fuse — the carried pot is still
     guarded by best, so a copy (or worse) never takes the crown */
  gw_escrow_t honest, theft;
  CHECK(gw_escrow_open(&honest, 0, 5, 3600, 100, T0, 1) == GW_ESC_OK, "honest open, bar 100 (the record)");
  CHECK(gw_escrow_open(&theft, &honest, 5, 1, GW_ESCROW_NO_SUM, T0 + 3600 * S, 2) == GW_ESC_ERR_ARGS, "no 1 s fuse");
  CHECK(gw_escrow_open(&theft, &honest, 5, GW_ESCROW_FUSE_MIN, GW_ESCROW_NO_SUM, T0 + 3600 * S, 2) == GW_ESC_OK &&
        theft.to_beat == 100 && theft.best == 100, "reopened without a bar: still 100 to beat");
  CHECK(gw_escrow_offer(&theft, 232, carol, T0 + 3601 * S, 3) == GW_ESC_NOT_BETTER, "worse does not crown");
  CHECK(gw_escrow_offer(&theft, 100, carol, T0 + 3601 * S, 3) == GW_ESC_NOT_BETTER, "a copy of the record does not crown");
  CHECK(gw_escrow_claim(&theft, 10000, T0 + 9999 * S, 4, &pay) == GW_ESC_ERR_NO_CHAMPION && pay == 0, "nothing to claim");

  /* an unbeaten bar lapses: anyone may reopen after one fuse length */
  gw_escrow_t lapse, again;
  CHECK(gw_escrow_open(&lapse, 0, 6, 600, 142, T0, 1) == GW_ESC_OK, "opened at 142");
  CHECK(gw_escrow_open(&again, &lapse, 6, 600, GW_ESCROW_NO_SUM, T0 + 599 * S, 2) == GW_ESC_ERR_LIVE, "the bar has not lapsed yet");
  CHECK(gw_escrow_open(&again, &lapse, 6, 3600, GW_ESCROW_NO_SUM, T0 + 600 * S, 2) == GW_ESC_OK && again.to_beat == 142 &&
        again.round == 2 && again.fuse_s == 3600, "reopened with a new fuse, same best");

  /* account bytes round-trip, and are checked on the way in */
  uint8_t buf[GW_ESCROW_SZ];
  gw_escrow_t back;
  gw_escrow_store(&e, buf);
  CHECK(!memcmp(buf, "GWE2", 4) && buf[4] == 3, "stored magic + puzzle");
  CHECK(buf[36] == 139 && buf[37] == 0, "best at byte 36");
  CHECK(gw_escrow_load(buf, GW_ESCROW_SZ, 3, &back) == GW_ESC_OK, "load(store(e))");
  CHECK(back.puzzle == e.puzzle && back.flags == e.flags && back.to_beat == e.to_beat && back.best == e.best &&
        back.fuse_s == e.fuse_s && back.fuse_end == e.fuse_end && back.crowned_slot == e.crowned_slot &&
        back.round == e.round && back.total_paid == e.total_paid && !memcmp(back.champion, e.champion, 32),
        "load(store(e)) == e");
  CHECK(gw_escrow_load(buf, GW_ESCROW_SZ, 5, &back) == GW_ESC_ERR_STATE, "escrow for another puzzle");
  CHECK(gw_escrow_load(buf, GW_ESCROW_SZ - 1, 3, &back) == GW_ESC_ERR_STATE, "short account");
  buf[36] = 140;
  CHECK(gw_escrow_load(buf, GW_ESCROW_SZ, 3, &back) == GW_ESC_ERR_STATE, "best above the sum to beat");
  buf[36] = 0;
  CHECK(gw_escrow_load(buf, GW_ESCROW_SZ, 3, &back) == GW_ESC_ERR_STATE, "best 0");
  buf[36] = 139;
  buf[12] = 1; buf[13] = 0; buf[14] = 0; buf[15] = 0;
  CHECK(gw_escrow_load(buf, GW_ESCROW_SZ, 3, &back) == GW_ESC_ERR_STATE, "fuse out of range");
  gw_escrow_store(&e, buf);
  buf[5] = GW_ESCROW_SETTLED;
  CHECK(gw_escrow_load(buf, GW_ESCROW_SZ, 3, &back) == GW_ESC_ERR_STATE, "settled without a champion");
  buf[5] = 4;
  CHECK(gw_escrow_load(buf, GW_ESCROW_SZ, 3, &back) == GW_ESC_ERR_STATE, "unknown flag");
  buf[5] = GW_ESCROW_HAS_CHAMPION;
  buf[3] = '1';
  CHECK(gw_escrow_load(buf, GW_ESCROW_SZ, 3, &back) == GW_ESC_ERR_STATE, "the old GWE1 layout");
  buf[0] = 'X'; buf[3] = '2';
  CHECK(gw_escrow_load(buf, GW_ESCROW_SZ, 3, &back) == GW_ESC_ERR_STATE, "bad magic");

  uint8_t ev[GW_ESCROW_EVENT_SZ];
  gw_escrow_event(&e, GW_ESCROW_EV_PAYOUT, 0x0102030405060708ull, ev);
  CHECK(!memcmp(ev, "GW!E", 4) && ev[4] == 3 && ev[5] == 3 && ev[8] == 8 && ev[15] == 1 && !memcmp(ev + 16, "GWE2", 4),
    "event layout");

  uint8_t seed[32];
  gw_escrow_seed(6, seed);
  CHECK(!memcmp(seed, "gw-escrow", 9) && seed[9] == 0 && seed[30] == 0 && seed[31] == 6, "seed layout");
  printf("escrow rules: fuse range, bar, best, crown, ties, fuse, freeze, one-time payout, reopen (theft PoC), storage checked\n");
}

/* ======================= part 2: the program on a simulated ledger ======================= */

#define MAXACC 12
typedef struct {
  tn_pubkey_t key;
  int    exists;
  uchar  flags;
  tn_pubkey_t owner;
  ulong  balance;
  uchar  data[256];
  uint   data_sz;
  int    authorized;            /* signed, or vouched for by the calling program */
} acct_t;

/* the ledger: every account the tests know about */
static acct_t LEDGER[MAXACC];
static int    NLEDGER;

/* the transaction being executed: indices into LEDGER, in transaction order
   (0 fee payer, 1 the top-level program, then read-write, then read-only) */
static int    TX[MAXACC], NTX, NRW;
static int    PROG;             /* tx index of the verifier */
static ushort DEPTH;            /* 1 = called directly, 2 = via a wrapper program */
static int    WRITABLE[MAXACC];
static uchar  RO_COPY[MAXACC][256];
static tn_pubkey_t ADDRS[MAXACC];
static tsdk_account_meta_t METAS[MAXACC];
static tsdk_block_ctx_t BLOCK;
static tsdk_txn_t TXN;
static tsdk_shadow_stack_t SS;
static jmp_buf JB;
static ulong EXIT_CODE;

static uchar EVENTS[8][1024];
static ulong EVENT_SZ[8];
static int   NEVENTS;

static void *HEAP[4];
static int   NHEAP;

static acct_t *tx_acct(ulong i) { return &LEDGER[TX[i]]; }
static void __attribute__((noreturn)) exit_with(ulong code, int reverted) { EXIT_CODE = code; longjmp(JB, reverted ? 2 : 1); }

tsdk_txn_t const *tsdk_get_txn(void) { return &TXN; }
tn_pubkey_t const *tsdk_txn_get_acct_addrs(tsdk_txn_t const *t) {
  (void)t;
  for (int i = 0; i < NTX; i++) ADDRS[i] = tx_acct((ulong)i)->key;
  return ADDRS;
}
ushort tsdk_txn_account_cnt(tsdk_txn_t const *t) { (void)t; return (ushort)NTX; }
int tsdk_txn_is_account_idx_writable(tsdk_txn_t const *t, ushort i) { (void)t; return i == 0 || (i >= 2 && i < 2 + NRW); }
tsdk_shadow_stack_t const *tsdk_get_shadow_stack(void) { SS.call_depth = DEPTH; return &SS; }
tsdk_block_ctx_t const *tsdk_get_current_block_ctx(void) { return &BLOCK; }
tsdk_account_meta_t const *tsdk_get_account_meta(ushort i) {
  acct_t *a = tx_acct(i);
  tsdk_account_meta_t *m = &METAS[i];
  memset(m, 0, sizeof *m);
  if (!a->exists) return m;
  m->version = 1; m->flags = a->flags; m->data_sz = a->data_sz; m->owner = a->owner; m->balance = a->balance;
  return m;
}
void *tsdk_get_account_data_ptr(ushort i) {
  if (WRITABLE[i]) return tx_acct(i)->data;
  memcpy(RO_COPY[i], tx_acct(i)->data, 256);     /* writes to a read-only segment go nowhere */
  return RO_COPY[i];
}
int tsdk_account_exists(ushort i) { return tx_acct(i)->exists; }
int tsdk_is_account_authorized_by_idx(ushort i) { return i == 0 || tx_acct(i)->authorized; }
int tsdk_is_account_authorized_by_pubkey(tn_pubkey_t const *k) {
  for (int i = 0; i < NTX; i++)
    if ((i == 0 || tx_acct((ulong)i)->authorized) && !memcmp(tx_acct((ulong)i)->key.uc, k->uc, 32)) return 1;
  return 0;
}
ushort tsdk_get_current_program_acc_idx(void) { return (ushort)PROG; }
tn_pubkey_t const *tsdk_get_current_program_acc_addr(void) { return &tx_acct((ulong)PROG)->key; }
int tsdk_is_account_owned_by_current_program(ushort i) {
  return !memcmp(tx_acct(i)->owner.uc, tsdk_get_current_program_acc_addr()->uc, 32);
}
/* stand-in derivation (the real one is sha256(owner | ephemeral | seed)):
   any injective-enough mix will do, the tests only need it to be the function
   both the program and the test fixtures use */
tn_pubkey_t *tsdk_create_program_defined_account_address(tn_pubkey_t const *owner, uchar eph,
                                                          uchar const seed[32], tn_pubkey_t *out) {
  uint64_t h = 1469598103934665603ull ^ eph;
  for (int r = 0; r < 4; r++) {
    for (int i = 0; i < 32; i++) { h ^= owner->uc[i]; h *= 1099511628211ull; h ^= seed[i]; h *= 1099511628211ull; }
    for (int b = 0; b < 8; b++) out->uc[r * 8 + b] = (uchar)(h >> (8 * b));
  }
  return out;
}
void tsdk_revert(ulong code) { exit_with(code, 1); }
void tsdk_return(ulong code) { exit_with(code, 0); }

ulong tsys_set_account_data_writable(ulong i) {
  if (!tsdk_txn_is_account_idx_writable(&TXN, (ushort)i)) return 1;
  if (!tx_acct(i)->exists || !tsdk_is_account_owned_by_current_program((ushort)i)) return 2;
  WRITABLE[i] = 1;
  return 0;
}
ulong tsys_account_transfer(ulong from, ulong to, ulong amount) {
  if (!tsdk_txn_is_account_idx_writable(&TXN, (ushort)from) || !tsdk_txn_is_account_idx_writable(&TXN, (ushort)to)) return 1;
  if (!tsdk_is_account_owned_by_current_program((ushort)from)) return 2;
  if (!tx_acct(to)->exists) return 3;
  if (tx_acct(from)->balance < amount) return 4;
  tx_acct(from)->balance -= amount;
  tx_acct(to)->balance += amount;
  return 0;
}
ulong tsys_increment_anonymous_segment_sz(void *seg, ulong delta, void **addr) {
  if ((ulong)seg == TSDK_ADDR(TSDK_SEG_TYPE_HEAP, 0UL, 0UL)) {
    if (NHEAP == 4) return 1;
    *addr = HEAP[NHEAP++] = calloc(1, delta);
    return *addr ? 0 : 1;
  }
  return 0;                                         /* stack growth: the host stack is big enough */
}
ulong tsys_account_create(ulong i, uchar const seed[32], void const *proof, ulong proof_sz) {
  if (!tsdk_txn_is_account_idx_writable(&TXN, (ushort)i)) return 1;
  if (tx_acct(i)->exists) return 2;
  if (!proof || !proof_sz) return 3;
  tn_pubkey_t want;
  tsdk_create_program_defined_account_address(tsdk_get_current_program_acc_addr(), 0, seed, &want);
  if (memcmp(want.uc, tx_acct(i)->key.uc, 32)) return 4;
  acct_t *a = tx_acct(i);
  a->exists = 1; a->owner = *tsdk_get_current_program_acc_addr(); a->data_sz = 0; a->flags = 0;
  return 0;
}
ulong tsys_account_resize(ulong i, ulong n) {
  if (!WRITABLE[i] || n > 256) return 1;
  tx_acct(i)->data_sz = (uint)n;
  return 0;
}
ulong tsys_account_set_flags(ushort i, uchar flags) {
  if (!WRITABLE[i]) return 1;                      /* the program's own, writable account */
  tx_acct(i)->flags = flags;
  return 0;
}
ulong tsys_emit_event(void const *data, ulong sz) {
  if (NEVENTS == 8 || sz > 1024) return 1;
  memcpy(EVENTS[NEVENTS], data, sz); EVENT_SZ[NEVENTS++] = sz;
  return 0;
}

/* the program under test, compiled unchanged */
#include "../program/src/gw_verifier.c"

/* ---- fixtures ---- */
enum { PAYER, PROGRAM, DAVE, ALICE, BOB, CAROL, ESC0, ESC1, WRAPPER, WALLET, NACCT };

static void ledger_reset(void) {
  memset(LEDGER, 0, sizeof LEDGER);
  NLEDGER = NACCT;
  for (int i = 0; i < NACCT; i++) { key(LEDGER[i].key.uc, (uint8_t)(0x40 + i)); LEDGER[i].exists = 1; LEDGER[i].balance = 1000; }
  LEDGER[PROGRAM].flags = TSDK_ACCOUNT_FLAG_PROGRAM;
  LEDGER[WRAPPER].flags = TSDK_ACCOUNT_FLAG_PROGRAM;
  uint8_t seed[32];
  for (int p = 0; p < 2; p++) {
    acct_t *e = &LEDGER[ESC0 + p];
    gw_escrow_seed((uint8_t)p, seed);
    tsdk_create_program_defined_account_address(&LEDGER[PROGRAM].key, 0, seed, &e->key);
    e->exists = 0; e->balance = 0;
  }
  BLOCK.slot = 100; BLOCK.block_time = T0;
}

/* one transaction: payer, the program, rw accounts, ro accounts; depth 1
   unless `via` names a wrapper program that vouches for `vouch` */
typedef struct { int reverted; ulong code; } result_t;
static result_t run(int payer, const int *rw, int nrw, const int *ro, int nro,
                    const uint8_t *ix, ulong ix_sz, int via, int vouch) {
  static acct_t snapshot[MAXACC];
  memcpy(snapshot, LEDGER, sizeof LEDGER);
  NTX = 0;
  TX[NTX++] = payer;
  TX[NTX++] = via >= 0 ? via : PROGRAM;
  for (int i = 0; i < nrw; i++) TX[NTX++] = rw[i];
  NRW = nrw;
  for (int i = 0; i < nro; i++) TX[NTX++] = ro[i];
  if (via >= 0) TX[NTX++] = PROGRAM;              /* the verifier, invoked by the wrapper */
  PROG = via >= 0 ? NTX - 1 : 1;
  DEPTH = via >= 0 ? 2 : 1;
  for (int i = 0; i < NACCT; i++) LEDGER[i].authorized = (i == vouch);
  memset(WRITABLE, 0, sizeof WRITABLE);
  NEVENTS = 0; NHEAP = 0;
  result_t r = { 0, 0 };
  int how = setjmp(JB);
  if (!how) start(ix, ix_sz);
  r.reverted = how == 2; r.code = EXIT_CODE;
  for (int i = 0; i < NHEAP; i++) free(HEAP[i]);
  if (r.reverted) { memcpy(LEDGER, snapshot, sizeof LEDGER); NEVENTS = 0; }
  BLOCK.slot++;
  return r;
}

static ulong submit_ix(uint8_t *buf, int vec) {
  const gw_submit_case_t *c = &VEC_SUBMITS[vec];
  buf[0] = 3; buf[1] = c->puzzle; buf[2] = 0; buf[3] = 0;
  memcpy(buf + 4, c->bytes, c->len);
  return 4 + c->len;
}
/* OPEN: fuse, a state proof when `proof`, and the bar machine VEC_SUBMITS[bar_vec] (-1: no bar) */
static ulong open_ix(uint8_t *buf, uint8_t puzzle, uint32_t fuse_s, int bar_vec, int proof) {
  buf[0] = 0x10; buf[1] = puzzle;
  for (int i = 0; i < 4; i++) buf[2 + i] = (uint8_t)(fuse_s >> (8 * i));
  buf[6] = proof ? 5 : 0; buf[7] = 0;
  ulong n = 8;
  if (proof) { memcpy(buf + n, "proof", 5); n += 5; }
  if (bar_vec >= 0) { memcpy(buf + n, VEC_SUBMITS[bar_vec].bytes, VEC_SUBMITS[bar_vec].len); n += VEC_SUBMITS[bar_vec].len; }
  return n;
}

static result_t submit_as(int who, int vec, int esc_rw) {
  uint8_t ix[2048];
  ulong n = submit_ix(ix, vec);
  int esc = ESC0 + VEC_SUBMITS[vec].puzzle;
  return esc_rw ? run(who, &esc, 1, 0, 0, ix, n, -1, -1) : run(who, 0, 0, &esc, 1, ix, n, -1, -1);
}
static result_t open_as(int who, uint8_t puzzle, uint32_t fuse_s, int bar_vec) {
  uint8_t ix[2048];
  ulong n = open_ix(ix, puzzle, fuse_s, bar_vec, !LEDGER[ESC0 + puzzle].exists);
  int esc = ESC0 + puzzle;
  return run(who, &esc, 1, 0, 0, ix, n, -1, -1);
}
static result_t claim_as(int who, uint8_t puzzle, int payee, int payee_rw) {
  uint8_t ix[2] = { 0x11, puzzle };
  int rw[2] = { ESC0 + puzzle, payee }, nrw = payee >= 0 && payee_rw ? 2 : 1;
  int ro[1] = { payee };
  return run(who, rw, nrw, ro, payee >= 0 && !payee_rw ? 1 : 0, ix, 2, -1, -1);
}

static gw_escrow_t escrow(int p) {
  gw_escrow_t e;
  memset(&e, 0, sizeof e);
  int ok = LEDGER[ESC0 + p].exists && gw_escrow_load(LEDGER[ESC0 + p].data, LEDGER[ESC0 + p].data_sz, (uint8_t)p, &e) == GW_ESC_OK;
  CHECK(ok, "escrow %d unreadable", p);
  return e;
}
static int champion_is(int p, int who) { gw_escrow_t e = escrow(p); return !memcmp(e.champion, LEDGER[who].key.uc, 32); }
static int has_event(const char *magic, int kind) {
  for (int i = 0; i < NEVENTS; i++)
    if (!memcmp(EVENTS[i], magic, 4) && (kind < 0 || EVENTS[i][4] == kind)) return 1;
  return 0;
}
#define OK(r)        ((r).reverted == 0 && (r).code == 0)
#define REVERTS(r, c) ((r).reverted && (r).code == (c))

/* VEC_SUBMITS: puzzle 0 courier (sum 179, two layouts), ferris (163), crane (232); puzzle 1 beadwheel (186) */
enum { COURIER = 0, COURIER_R2 = 1, FERRIS = 2, FERRIS_R2 = 3, CRANE = 4, BEAD = 6, BEAD_R2 = 7, BAD_LAYOUT = 18 };
#define NOBAR (-1)
#define HOUR (3600u)

static void program(void) {
  result_t r;
  ledger_reset();

  /* every submission names its puzzle's escrow account, existing or not, read-write */
  { uint8_t ix[2048]; ulong n = submit_ix(ix, COURIER);
    r = run(ALICE, 0, 0, 0, 0, ix, n, -1, -1);
    CHECK(REVERTS(r, 0x06), "submit without the escrow account: %lx", r.code);
    int wrong = ESC1;
    r = run(ALICE, &wrong, 1, 0, 0, ix, n, -1, -1);
    CHECK(REVERTS(r, 0x06), "submit with another puzzle's escrow account: %lx", r.code);
    ix[0] = 2;
    int esc = ESC0;
    r = run(ALICE, &esc, 1, 0, 0, ix, n, -1, -1);
    CHECK(REVERTS(r, 0x01), "instruction v2 is retired: %lx", r.code); }
  r = submit_as(ALICE, COURIER, 0);
  CHECK(REVERTS(r, 0x07), "submit with the (absent) escrow read-only: %lx", r.code);

  /* no escrow yet: the record works as before */
  r = submit_as(ALICE, COURIER, 1);
  CHECK(OK(r) && NEVENTS == 1 && has_event("GW!2", -1), "submit with no escrow seals the record");
  CHECK(!LEDGER[ESC0].exists, "a submission never creates the escrow");
  r = submit_as(ALICE, BAD_LAYOUT, 1);
  CHECK(REVERTS(r, 0x100 + GW_ERR_LAYOUT), "invalid submissions still revert: %lx", r.code);

  /* claim on a puzzle with no escrow */
  r = claim_as(ALICE, 0, ALICE, 1);
  CHECK(REVERTS(r, 0x0B), "claim without an escrow: %lx", r.code);

  /* OPEN: anyone, at the derived address, with a state proof the first time,
     a fuse of 10 minutes to a year, and a bar that is a verified machine */
  r = open_as(ALICE, 0, 0, NOBAR);
  CHECK(REVERTS(r, 0x0A) && !LEDGER[ESC0].exists, "open with a zero fuse: %lx", r.code);
  r = open_as(ALICE, 0, 1, NOBAR);
  CHECK(REVERTS(r, 0x0A) && !LEDGER[ESC0].exists, "open with a 1 s fuse: %lx", r.code);
  r = open_as(ALICE, 0, GW_ESCROW_FUSE_MIN - 1, NOBAR);
  CHECK(REVERTS(r, 0x0A), "open with a 599 s fuse: %lx", r.code);
  r = open_as(ALICE, 0, GW_ESCROW_FUSE_MAX + 1, NOBAR);
  CHECK(REVERTS(r, 0x0A), "open with a fuse over a year: %lx", r.code);
  r = open_as(ALICE, 0, 0xFFFFFFFFu, NOBAR);
  CHECK(REVERTS(r, 0x0A), "open with a 136-year fuse (review PoC B): %lx", r.code);
  r = open_as(ALICE, 0, HOUR, BAD_LAYOUT);
  CHECK(REVERTS(r, 0x100 + GW_ERR_LAYOUT) && !LEDGER[ESC0].exists, "a bar must verify: %lx", r.code);
  r = open_as(ALICE, 0, HOUR, BEAD);
  CHECK(r.reverted && !LEDGER[ESC0].exists, "a bar must verify on this puzzle: %lx", r.code);
  { uint8_t ix[64]; ulong n = open_ix(ix, 0, 600, NOBAR, 0);
    int esc = ESC0;
    r = run(DAVE, &esc, 1, 0, 0, ix, n, -1, -1);
    CHECK(REVERTS(r, 0x01), "first open without a state proof: %lx", r.code);
    n = open_ix(ix, 0, 600, NOBAR, 1);
    r = run(DAVE, 0, 0, &esc, 1, ix, n, -1, -1);
    CHECK(REVERTS(r, 0x07), "open with the escrow read-only: %lx", r.code);
    int wrong = ESC1;
    r = run(DAVE, &wrong, 1, 0, 0, ix, n, -1, -1);
    CHECK(REVERTS(r, 0x06), "open naming another puzzle's escrow: %lx", r.code);
    ix[6] = 99;
    r = run(DAVE, &esc, 1, 0, 0, ix, n, -1, -1);
    CHECK(REVERTS(r, 0x01), "proof length past the end: %lx", r.code); }

  /* dave, nobody special, opens puzzle 0 with the record (alice's courier, 179) as the bar */
  r = open_as(DAVE, 0, GW_ESCROW_FUSE_30D, COURIER_R2);
  CHECK(OK(r) && LEDGER[ESC0].exists && has_event("GW!E", GW_ESCROW_EV_OPEN), "dave opens puzzle 0: %lx", r.code);
  CHECK(has_event("GW!2", -1), "the bar machine is sealed on the record like any submission");
  CHECK(!memcmp(LEDGER[ESC0].owner.uc, LEDGER[PROGRAM].key.uc, 32) && LEDGER[ESC0].data_sz == GW_ESCROW_SZ, "program owns the escrow");
  CHECK(LEDGER[ESC0].flags & TSDK_ACCOUNT_FLAG_UNCOMPRESSABLE, "the escrow asks to stay uncompressed");
  CHECK(escrow(0).to_beat == 179 && escrow(0).best == 179 && escrow(0).round == 1 && !(escrow(0).flags & GW_ESCROW_HAS_CHAMPION),
    "the crown starts empty; 179 to beat");
  r = open_as(DAVE, 0, GW_ESCROW_FUSE_30D, NOBAR);
  CHECK(REVERTS(r, 0x09), "open over an open escrow: %lx", r.code);

  /* deposits: plain native transfers into the (existing) escrow address, from anyone */
  LEDGER[ESC0].balance += 300;      /* carol */
  LEDGER[ESC0].balance += 200;      /* bob */
  r = claim_as(CAROL, 0, CAROL, 1);
  CHECK(REVERTS(r, 0x0C), "claim with nobody crowned: %lx", r.code);

  /* copies and ties of the bar change nothing (but are still sealed on the record) */
  r = submit_as(BOB, COURIER, 1);
  CHECK(OK(r) && has_event("GW!2", -1) && !has_event("GW!E", -1), "bob's byte-for-byte copy of the record: sealed, no crown");
  r = submit_as(BOB, CRANE, 1);
  CHECK(OK(r) && !has_event("GW!E", -1) && !(escrow(0).flags & GW_ESCROW_HAS_CHAMPION), "bob's worse 232: no crown");

  /* the escrow must ride read-write once it exists, whatever the sum */
  r = submit_as(BOB, CRANE, 0);
  CHECK(REVERTS(r, 0x07), "a worse sum with the escrow read-only reverts: %lx", r.code);
  r = submit_as(BOB, FERRIS, 0);
  CHECK(REVERTS(r, 0x07) && escrow(0).best == 179, "a better sum with the escrow read-only reverts: %lx", r.code);

  /* strictly better takes the crown and lights the fuse */
  BLOCK.block_time = T0 + 20 * DAY;
  r = submit_as(BOB, FERRIS, 1);
  CHECK(OK(r) && has_event("GW!E", GW_ESCROW_EV_CROWN), "bob's 163 crowns");
  CHECK(champion_is(0, BOB) && escrow(0).to_beat == 163 && escrow(0).best == 163 && escrow(0).fuse_end == T0 + 50 * DAY,
    "bob holds, fuse lit");
  r = submit_as(ALICE, FERRIS_R2, 1);
  CHECK(OK(r) && champion_is(0, BOB), "alice ties bob: nothing");

  /* the payout waits for the fuse */
  BLOCK.block_time = T0 + 50 * DAY - 1;
  r = claim_as(CAROL, 0, BOB, 1);
  CHECK(REVERTS(r, 0x0D) && LEDGER[ESC0].balance == 500, "claim one ns early: %lx", r.code);

  /* the fuse is out: anyone can trigger it, it pays the champion only */
  BLOCK.block_time = T0 + 50 * DAY;
  r = claim_as(CAROL, 0, CAROL, 1);
  CHECK(REVERTS(r, 0x0E), "claim naming the wrong payee: %lx", r.code);
  r = claim_as(CAROL, 0, BOB, 0);
  CHECK(REVERTS(r, 0x0E), "claim with the champion read-only: %lx", r.code);
  r = claim_as(CAROL, 0, -1, 0);
  CHECK(REVERTS(r, 0x0E), "claim without the champion: %lx", r.code);
  CHECK(LEDGER[ESC0].balance == 500 && LEDGER[BOB].balance == 1000, "nothing moved yet");
  r = claim_as(CAROL, 0, BOB, 1);
  CHECK(OK(r) && has_event("GW!E", GW_ESCROW_EV_PAYOUT), "carol triggers the payout: %lx", r.code);
  CHECK(LEDGER[ESC0].balance == 0 && LEDGER[BOB].balance == 1500 && LEDGER[CAROL].balance == 1000, "bob is paid 500");
  CHECK((escrow(0).flags & GW_ESCROW_SETTLED) && escrow(0).total_paid == 500 && champion_is(0, BOB), "settled, bob on the record");
  LEDGER[ESC0].balance += 50;       /* a late deposit */
  r = claim_as(CAROL, 0, BOB, 1);
  CHECK(REVERTS(r, 0x11) && LEDGER[BOB].balance == 1500 && LEDGER[ESC0].balance == 50, "the payout happens once: %lx", r.code);
  BLOCK.block_time = T0 + 200 * DAY;
  r = claim_as(CAROL, 0, BOB, 1);
  CHECK(REVERTS(r, 0x11), "the fuse never relights, so never again: %lx", r.code);
  r = submit_as(ALICE, FERRIS, 1);
  CHECK(OK(r) && has_event("GW!2", -1) && !has_event("GW!E", -1), "after the payout: sealed on the record, no crown");

  /* a settled escrow may be opened afresh; the late deposit is its pot and
     best (163) is its bar even though carol asks for none */
  r = open_as(CAROL, 0, HOUR, NOBAR);
  CHECK(OK(r) && has_event("GW!E", GW_ESCROW_EV_OPEN), "carol reopens puzzle 0: %lx", r.code);
  CHECK(escrow(0).round == 2 && escrow(0).to_beat == 163 && escrow(0).best == 163 && !(escrow(0).flags & GW_ESCROW_HAS_CHAMPION) &&
        LEDGER[ESC0].balance == 50, "round 2: empty crown, 163 to beat, pot 50");
  { uint8_t ix[2048]; ulong n = open_ix(ix, 0, 600, NOBAR, 0); int esc = ESC0;
    r = run(DAVE, &esc, 1, 0, 0, ix, n, -1, -1);
    CHECK(REVERTS(r, 0x09), "nobody can reopen over a live bar: %lx", r.code); }
  r = submit_as(BOB, FERRIS_R2, 1);
  CHECK(OK(r) && !has_event("GW!E", -1), "a copy of the champion does not take round 2");

  /* via a wrapper (the passkey manager): the vouched wallet is the solver and champion */
  ledger_reset();
  r = open_as(PAYER, 0, 600, NOBAR);
  CHECK(OK(r) && NEVENTS == 1, "open on a fresh ledger, no bar: nothing sealed");
  { uint8_t ix[2048]; ulong n = submit_ix(ix, FERRIS);
    int rw[2] = { WALLET, ESC0 };
    r = run(PAYER, rw, 2, 0, 0, ix, n, WRAPPER, WALLET);
    CHECK(OK(r) && champion_is(0, WALLET), "a passkey wallet takes the crown, not the relayer: %lx", r.code); }
  LEDGER[ESC0].balance = 42;
  BLOCK.block_time += 600 * S;
  r = claim_as(PAYER, 0, WALLET, 1);
  CHECK(OK(r) && LEDGER[WALLET].balance == 1042, "the wallet is paid");

  /* a broken clock never lights or burns a fuse */
  BLOCK.block_time = 0;
  r = claim_as(PAYER, 0, WALLET, 1);
  CHECK(REVERTS(r, 0x10), "claim with no block time: %lx", r.code);
  printf("escrow program: open by anyone, fuse range, verified bar, best, reopen, deposits, crown, copies, fuse, payout, wrapper checked on a simulated ledger\n");
}

/* ---- the review's attacks, replayed against the program ---- */
static void attacks(void) {
  result_t r;

  /* A. reopen theft. The record (ferris, 163) is sealed before any escrow.
     An honest opener names it as the bar; donors fund the pot; nobody beats
     163 within the fuse. Mallory reopens with no bar and the shortest fuse,
     then submits the worst machine and a copy of the record, and claims. */
  ledger_reset();
  r = submit_as(ALICE, FERRIS, 1);
  CHECK(OK(r), "the record, sealed before the escrow");
  r = open_as(DAVE, 0, HOUR, FERRIS_R2);
  CHECK(OK(r) && escrow(0).to_beat == 163 && escrow(0).best == 163, "honest open over the record: %lx", r.code);
  LEDGER[ESC0].balance = 10000;
  BLOCK.block_time += HOUR * S;                      /* the bar lapses unbeaten */
  r = open_as(BOB, 0, 1, NOBAR);
  CHECK(REVERTS(r, 0x0A), "mallory's 1 s fuse: %lx", r.code);
  r = open_as(BOB, 0, GW_ESCROW_FUSE_MIN, NOBAR);
  CHECK(OK(r) && escrow(0).round == 2 && escrow(0).to_beat == 163 && escrow(0).best == 163 && LEDGER[ESC0].balance == 10000,
    "mallory may reopen, but best carries over: 163 to beat: %lx", r.code);
  r = open_as(BOB, 0, GW_ESCROW_FUSE_MIN, CRANE);
  CHECK(REVERTS(r, 0x09), "and cannot reopen again over the live bar: %lx", r.code);
  r = submit_as(BOB, CRANE, 1);
  CHECK(OK(r) && !has_event("GW!E", -1), "the worst machine on the board takes nothing");
  r = submit_as(BOB, FERRIS, 1);
  CHECK(OK(r) && !has_event("GW!E", -1), "a copy of the record takes nothing");
  BLOCK.block_time += GW_ESCROW_FUSE_MIN * S;
  ulong before = LEDGER[BOB].balance;
  r = claim_as(BOB, 0, BOB, 1);
  CHECK(REVERTS(r, 0x0C) && LEDGER[BOB].balance == before && LEDGER[ESC0].balance == 10000, "mallory gains nothing: %lx", r.code);

  /* A'. the same with a settled escrow that received deposits after its
     payout, and a better sum sealed after the fuse burnt out: best (not the
     paid champion's sum, not a looser bar) guards the next round */
  ledger_reset();
  r = open_as(DAVE, 0, HOUR, NOBAR);
  CHECK(OK(r), "open, no bar");
  r = submit_as(ALICE, COURIER, 1);
  CHECK(OK(r) && champion_is(0, ALICE) && escrow(0).to_beat == 179, "alice crowned at 179");
  BLOCK.block_time += HOUR * S;
  r = submit_as(CAROL, FERRIS, 1);
  CHECK(OK(r) && !has_event("GW!E", -1) && champion_is(0, ALICE) && escrow(0).best == 163,
    "carol's 163 after the fuse: no crown, but best remembers it");
  LEDGER[ESC0].balance = 700;
  r = claim_as(DAVE, 0, ALICE, 1);
  CHECK(OK(r) && LEDGER[ALICE].balance == 1700, "alice paid");
  LEDGER[ESC0].balance = 9000;                       /* donations after the payout */
  r = open_as(BOB, 0, GW_ESCROW_FUSE_MIN, COURIER);
  CHECK(OK(r) && escrow(0).to_beat == 163, "reopened with a looser bar (179): best 163 still to beat: %lx", r.code);
  r = submit_as(BOB, FERRIS_R2, 1);
  CHECK(OK(r) && !has_event("GW!E", -1), "a copy of carol's 163 takes nothing");
  BLOCK.block_time += GW_ESCROW_FUSE_MIN * S;
  r = claim_as(BOB, 0, BOB, 1);
  CHECK(REVERTS(r, 0x0C) && LEDGER[ESC0].balance == 9000, "the carried pot stays put: %lx", r.code);

  /* B. a foreign-owned account at the escrow address (cannot happen on Thru:
     only this program creates there, and a transfer creates nothing) never
     blocks sealing, and holds no pot of ours */
  ledger_reset();
  LEDGER[ESC1].exists = 1; LEDGER[ESC1].owner = LEDGER[DAVE].key; LEDGER[ESC1].balance = 1;
  r = submit_as(ALICE, BEAD, 1);
  CHECK(OK(r) && has_event("GW!2", -1) && !has_event("GW!E", -1), "submit past a foreign account: sealed, no crown: %lx", r.code);
  r = open_as(ALICE, 1, HOUR, NOBAR);
  CHECK(REVERTS(r, 0x07), "open over a foreign account: %lx", r.code);
  r = claim_as(ALICE, 1, ALICE, 1);
  CHECK(REVERTS(r, 0x07), "claim on a foreign account: %lx", r.code);

  /* C. a compressed escrow is refused, never silently skipped (its best
     would be stale); anyone may decompress it */
  ledger_reset();
  r = open_as(DAVE, 1, HOUR, BEAD);
  CHECK(OK(r), "open puzzle 1");
  LEDGER[ESC1].flags |= TSDK_ACCOUNT_FLAG_COMPRESSED;
  r = submit_as(ALICE, BEAD_R2, 1);
  CHECK(REVERTS(r, 0x12), "submit over a compressed escrow: %lx", r.code);
  r = open_as(ALICE, 1, HOUR, NOBAR);
  CHECK(REVERTS(r, 0x12), "open over a compressed escrow: %lx", r.code);
  r = claim_as(ALICE, 1, ALICE, 1);
  CHECK(REVERTS(r, 0x12), "claim on a compressed escrow: %lx", r.code);
  LEDGER[ESC1].flags &= (uchar)~TSDK_ACCOUNT_FLAG_COMPRESSED;
  r = submit_as(ALICE, BEAD_R2, 1);
  CHECK(OK(r), "decompressed: sealing resumes");
  printf("escrow attacks: reopen theft, settled-pot theft, foreign account, compressed account all fail\n");
}

int main(void) {
  unit();
  program();
  attacks();
  if (failures) { printf("%d FAILURES\n", failures); return 1; }
  printf("all escrow checks pass\n");
  return 0;
}
