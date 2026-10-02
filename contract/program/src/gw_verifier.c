/* GREAT WORK! — on-chain verifier program (ThruVM).
 *
 * Three instructions, told apart by the first byte (FORMAT.md):
 *
 *   SUBMIT (3)    u8 3 | u8 puzzle id | u8 name len | u8 username len |
 *                 name | username | codec v2 machine bytes
 *   OPEN   (0x10) u8 0x10 | u8 puzzle id | u32 fuse seconds | u32 seed sum |
 *                 u8[32] seed champion | state proof (the escrow's absence)
 *   CLAIM  (0x11) u8 0x11 | u8 puzzle id
 *
 * SUBMIT decodes the machine, rebuilds the puzzle from the embedded catalog
 * and the submission's board layout, runs the rules engine to its verdict,
 * and — only if the machine is VERIFIED — emits one GW!2 score event naming
 * the solver with its cost / cycles / area / sum and the machine bytes
 * themselves, so the leaderboard is the program's event log and any sealed
 * solution can be replayed by anyone. Rejections and faults revert, so
 * nothing invalid ever lands on-chain.
 *
 * Prize escrow (SPEC §13, rules in ../gw_escrow.c): each puzzle has one
 * escrow account at a program-derived address (seed "gw-escrow" + puzzle id)
 * whose native balance is the pot. Every SUBMIT must carry that account,
 * read-write, whether or not the escrow exists — otherwise a better machine
 * could be sealed past the escrow and then copied into the crown. A verified
 * sum strictly below the reigning best takes the crown and relights the fuse
 * (event GW!E). OPEN creates the escrow (the escrow authority only, seeding
 * the crown from the public record); deposits are plain native transfers to
 * the escrow address; CLAIM, open to anyone once the fuse has burnt out, pays
 * the whole balance to the champion and starts the next round.
 *
 * Score event GW!2 (little-endian, packed):
 *   0  "GW!2"           magic + payload version
 *   4  u8  puzzle id
 *   5  u8  reserved (0)
 *   6  u16 machine length
 *   8  u8[32] solver (see solver_of)
 *   40 u32 cost, 44 u32 cycles, 48 u32 area, 52 u32 sum
 *   56 u8 name length, 57 u8 username length
 *   58 machine bytes, then name, then username
 *
 * Revert codes: 0x01 bad instruction data, 0x02 unknown puzzle, 0x03 out of
 * memory, 0x04 event rejected, 0x05 no authorized solver, 0x06 the puzzle's
 * escrow account is not in the transaction, 0x07 escrow account unusable
 * (not read-write, wrong owner or bad data), 0x08 OPEN not signed by the
 * escrow authority, 0x09 escrow already open, 0x0A bad OPEN arguments, 0x0B
 * no escrow for this puzzle, 0x0C nobody holds the crown, 0x0D the fuse is
 * still burning, 0x0E the champion's account is not in the transaction
 * read-write, 0x0F transfer failed, 0x10 block time unavailable,
 * 0x100 + GW_ERR_* (invalid submission),
 * 0x200 + GW_FAULT_* (the machine faulted), 0xBADBAD engine capacity panic. */

#include <thru-sdk/c/tn_sdk.h>
#include <thru-sdk/c/tn_sdk_syscall.h>
#include "gw.h"
#include "gw_escrow.h"
#include "puzzles.h"

#define GW_IX_SUBMIT    3U
#define GW_IX_OPEN      0x10U
#define GW_IX_CLAIM     0x11U
#define GW_EVENT_HDR    58UL
#define GW_NAME_MAX     32UL
#define GW_USER_MAX     24UL
#define GW_OPEN_HDR     42UL

#define RC_BAD_IX         0x01UL
#define RC_BAD_PUZZLE     0x02UL
#define RC_NOMEM          0x03UL
#define RC_EVENT          0x04UL
#define RC_NO_SOLVER      0x05UL
#define RC_NO_ESCROW_ACCT 0x06UL
#define RC_ESCROW_BAD     0x07UL
#define RC_NOT_AUTHORITY  0x08UL
#define RC_ESCROW_EXISTS  0x09UL
#define RC_OPEN_ARGS      0x0AUL
#define RC_NO_ESCROW      0x0BUL
#define RC_NO_CHAMPION    0x0CUL
#define RC_BURNING        0x0DUL
#define RC_NO_CHAMP_ACCT  0x0EUL
#define RC_TRANSFER       0x0FUL
#define RC_CLOCK          0x10UL
#define RC_INVALID        0x100UL
#define RC_FAULT          0x200UL

/* Who may OPEN an escrow: the deployer / upgrade authority of the alphanet
   programs (contract/program/DEPLOYMENTS.md), tawXEVKYFEgea8k-y-ab3f5ZkD7EHomPDBfrmJvX30wGmQ.
   Override at build time with -DGW_ESCROW_AUTHORITY_BYTES='{ ... }'. */
#ifndef GW_ESCROW_AUTHORITY_BYTES
#define GW_ESCROW_AUTHORITY_BYTES { \
  0xc1,0x71,0x15,0x29,0x81,0x44,0x81,0xe6,0xbc,0x93,0xec,0xbe,0x69,0xbd,0xdf,0xe5, \
  0x99,0x03,0xec,0x41,0xe8,0x98,0xf0,0xc1,0x7e,0xb9,0x89,0xbd,0x7d,0xf4,0xc0,0x69 }
#endif
static uchar const GW_ESCROW_AUTHORITY[ 32 ] = GW_ESCROW_AUTHORITY_BYTES;

void gw_panic( void ) { tsdk_revert( 0xBADBADUL ); }

/* The program image is read-only and the entry stack is one page, so all
   working state lives in the heap segment: one bump allocation for the
   verifier workspace (~34 KB) and the event buffer. */
static void *
heap_alloc( ulong sz ) {
  void * p  = 0;
  ulong  rc = tsys_increment_anonymous_segment_sz(
    (void *)TSDK_ADDR( TSDK_SEG_TYPE_HEAP, 0UL, 0UL ), ( sz + 4095UL ) & ~4095UL, &p );
  if( rc ) tsdk_revert( RC_NOMEM );
  return p;
}

/* The entry stack is one page; the engine's step frames need a few KB more. */
static void
grow_stack( ulong bytes ) {
  ulong sp;
#ifdef __riscv
  __asm__( "mv %0, sp" : "=r"( sp ) );
#else
  sp = (ulong)__builtin_frame_address( 0 );   /* host harness (contract/test) */
#endif
  void * unused = 0;
  if( tsys_increment_anonymous_segment_sz( (void *)sp, bytes, &unused ) ) tsdk_revert( RC_NOMEM );
}

/* The beneficiary: fee payer when called directly, else the first account the
   calling program authorized (never the fee payer, who is then a relayer, and
   never a program account). */
static tn_pubkey_t const *
solver_of( void ) {
  tsdk_txn_t const *          txn  = tsdk_get_txn( );
  tn_pubkey_t const *         accs = tsdk_txn_get_acct_addrs( txn );
  tsdk_shadow_stack_t const * ss   = tsdk_get_shadow_stack( );
  if( ss->call_depth <= 1 ) return &accs[ 0 ];
  ushort cnt  = tsdk_txn_account_cnt( txn );
  ushort self = tsdk_get_current_program_acc_idx( );
  for( ushort i = 1; i < cnt; i++ ) {
    if( i == self ) continue;
    if( !tsdk_is_account_authorized_by_idx( i ) ) continue;
    tsdk_account_meta_t const * meta = tsdk_get_account_meta( i );
    if( meta && ( meta->flags & TSDK_ACCOUNT_FLAG_PROGRAM ) ) continue;
    return &accs[ i ];
  }
  tsdk_revert( RC_NO_SOLVER );
}

static void
put_u32( uchar * p, ulong v ) {
  p[ 0 ] = (uchar)( v       ); p[ 1 ] = (uchar)( v >> 8  );
  p[ 2 ] = (uchar)( v >> 16 ); p[ 3 ] = (uchar)( v >> 24 );
}
static uint
get_u32( uchar const * p ) {
  return (uint)p[ 0 ] | (uint)p[ 1 ] << 8 | (uint)p[ 2 ] << 16 | (uint)p[ 3 ] << 24;
}

static int
same_key( uchar const * a, uchar const * b ) {
  for( ulong i = 0; i < 32UL; i++ ) if( a[ i ] != b[ i ] ) return 0;
  return 1;
}

/* index of the account with this address in the transaction, or -1 */
static long
find_account( uchar const * key ) {
  tsdk_txn_t const *  txn  = tsdk_get_txn( );
  tn_pubkey_t const * accs = tsdk_txn_get_acct_addrs( txn );
  ushort              cnt  = tsdk_txn_account_cnt( txn );
  for( ushort i = 0; i < cnt; i++ ) if( same_key( accs[ i ].uc, key ) ) return (long)i;
  return -1L;
}

/* the puzzle's escrow account: its seed, and its index in the transaction
   (which must carry it — see the header) */
static ushort
escrow_account( ulong puzzle, uchar seed[ 32 ] ) {
  gw_escrow_seed( (uint8_t)puzzle, seed );
  tn_pubkey_t addr;
  tsdk_create_program_defined_account_address( tsdk_get_current_program_acc_addr( ), 0, seed, &addr );
  long idx = find_account( addr.uc );
  if( idx < 0 ) tsdk_revert( RC_NO_ESCROW_ACCT );
  return (ushort)idx;
}

/* load an existing escrow; 0 if the puzzle has none */
static int
escrow_load( ushort idx, ulong puzzle, gw_escrow_t * e ) {
  if( !tsdk_account_exists( idx ) ) return 0;
  if( !tsdk_is_account_owned_by_current_program( idx ) ) tsdk_revert( RC_ESCROW_BAD );
  tsdk_account_meta_t const * meta = tsdk_get_account_meta( idx );
  if( gw_escrow_load( (uint8_t const *)tsdk_get_account_data_ptr( idx ), meta->data_sz, (uint8_t)puzzle, e ) != GW_ESC_OK )
    tsdk_revert( RC_ESCROW_BAD );
  return 1;
}

static void
escrow_save( ushort idx, gw_escrow_t const * e ) {
  if( tsys_set_account_data_writable( idx ) ) tsdk_revert( RC_ESCROW_BAD );
  gw_escrow_store( e, (uint8_t *)tsdk_get_account_data_ptr( idx ) );
}

static void
escrow_emit( gw_escrow_t const * e, uchar kind, ulong amount ) {
  uchar ev[ GW_ESCROW_EVENT_SZ ];
  gw_escrow_event( e, kind, amount, ev );
  if( tsys_emit_event( ev, GW_ESCROW_EVENT_SZ ) ) tsdk_revert( RC_EVENT );
}

static ulong
block_time( void ) {
  ulong now = tsdk_get_current_block_ctx( )->block_time;
  if( !now ) tsdk_revert( RC_CLOCK );
  return now;
}

static void __attribute__(( noreturn ))
submit( uchar const * d, ulong sz ) {
  if( sz < 5UL ) tsdk_revert( RC_BAD_IX );
  ulong puzzle = d[ 1 ];
  if( puzzle >= GW_NPUZZLES ) tsdk_revert( RC_BAD_PUZZLE );
  ulong name_len = d[ 2 ], user_len = d[ 3 ];
  if( name_len > GW_NAME_MAX || user_len > GW_USER_MAX ) tsdk_revert( RC_BAD_IX );
  if( sz < 5UL + name_len + user_len ) tsdk_revert( RC_BAD_IX );
  uchar const * name = d + 4;
  uchar const * user = name + name_len;
  for( ulong i = 0; i < name_len + user_len; i++ ) if( name[ i ] < 0x20 || name[ i ] == 0x7f ) tsdk_revert( RC_BAD_IX );
  uchar const * machine     = user + user_len;
  ulong         machine_len = sz - 4UL - name_len - user_len;

  uchar  seed[ 32 ];
  ushort esc_idx = escrow_account( puzzle, seed );

  grow_stack( 65536UL );
  uchar *          mem = (uchar *)heap_alloc( sizeof( gw_workspace_t ) + GW_EVENT_HDR + machine_len + name_len + user_len );
  gw_workspace_t * ws  = (gw_workspace_t *)mem;
  uchar *          ev  = mem + sizeof( gw_workspace_t );

  gw_verdict_t v;
  gw_verify( &GW_PUZZLES[ puzzle ], machine, (uint32_t)machine_len, ws, &v );
  if( v.err != GW_OK )                tsdk_revert( RC_INVALID + (ulong)v.err );
  if( v.status != GW_STATUS_VERIFIED ) tsdk_revert( RC_FAULT + (ulong)v.fault_kind );

  tn_pubkey_t const * solver = solver_of( );
  ev[ 0 ] = 'G'; ev[ 1 ] = 'W'; ev[ 2 ] = '!'; ev[ 3 ] = '2';
  ev[ 4 ] = (uchar)puzzle;
  ev[ 5 ] = 0;
  ev[ 6 ] = (uchar)( machine_len ); ev[ 7 ] = (uchar)( machine_len >> 8 );
  for( ulong i = 0; i < 32UL; i++ ) ev[ 8 + i ] = solver->uc[ i ];
  put_u32( ev + 40, (ulong)v.cost   );
  put_u32( ev + 44, (ulong)v.cycles );
  put_u32( ev + 48, (ulong)v.area   );
  put_u32( ev + 52, (ulong)v.sum    );
  ev[ 56 ] = (uchar)name_len; ev[ 57 ] = (uchar)user_len;
  uchar * w = ev + GW_EVENT_HDR;
  for( ulong i = 0; i < machine_len; i++ ) *w++ = machine[ i ];
  for( ulong i = 0; i < name_len;    i++ ) *w++ = name[ i ];
  for( ulong i = 0; i < user_len;    i++ ) *w++ = user[ i ];
  if( tsys_emit_event( ev, (ulong)( w - ev ) ) ) tsdk_revert( RC_EVENT );

  /* the crown: only a strictly better sum moves it, never after the fuse */
  gw_escrow_t e;
  if( escrow_load( esc_idx, puzzle, &e ) ) {
    tsdk_block_ctx_t const * blk = tsdk_get_current_block_ctx( );
    int r = gw_escrow_offer( &e, (uint64_t)v.sum, solver->uc, block_time( ), blk->slot );
    if( r == GW_ESC_CROWNED ) {
      escrow_save( esc_idx, &e );
      escrow_emit( &e, GW_ESCROW_EV_CROWN, 0UL );
    }
  }

  /* return 0: a wrapper such as the passkey manager treats any other exit
     code as failure. The sum travels in the event. */
  tsdk_return( 0UL );
}

static void __attribute__(( noreturn ))
open_escrow( uchar const * d, ulong sz ) {
  if( sz < GW_OPEN_HDR + 1UL ) tsdk_revert( RC_BAD_IX );
  ulong puzzle = d[ 1 ];
  if( puzzle >= GW_NPUZZLES ) tsdk_revert( RC_BAD_PUZZLE );
  tn_pubkey_t auth;
  for( ulong i = 0; i < 32UL; i++ ) auth.uc[ i ] = GW_ESCROW_AUTHORITY[ i ];
  if( !tsdk_is_account_authorized_by_pubkey( &auth ) ) tsdk_revert( RC_NOT_AUTHORITY );

  uint          fuse_s   = get_u32( d + 2 );
  uint          seed_sum = get_u32( d + 6 );
  uchar const * champion = d + 10;
  uchar const * proof    = d + GW_OPEN_HDR;

  uchar  seed[ 32 ];
  ushort idx = escrow_account( puzzle, seed );
  if( tsdk_account_exists( idx ) ) tsdk_revert( RC_ESCROW_EXISTS );

  tsdk_block_ctx_t const * blk = tsdk_get_current_block_ctx( );
  gw_escrow_t e;
  int r = gw_escrow_open( &e, (uint8_t)puzzle, fuse_s, seed_sum,
                          seed_sum == GW_ESCROW_NO_SUM ? 0 : champion, block_time( ), blk->slot );
  if( r != GW_ESC_OK ) tsdk_revert( RC_OPEN_ARGS );

  if( tsys_account_create( idx, seed, proof, sz - GW_OPEN_HDR ) ) tsdk_revert( RC_ESCROW_BAD );
  if( tsys_set_account_data_writable( idx ) )                    tsdk_revert( RC_ESCROW_BAD );
  if( tsys_account_resize( idx, GW_ESCROW_SZ ) )                  tsdk_revert( RC_ESCROW_BAD );
  gw_escrow_store( &e, (uint8_t *)tsdk_get_account_data_ptr( idx ) );
  escrow_emit( &e, GW_ESCROW_EV_OPEN, 0UL );
  tsdk_return( 0UL );
}

static void __attribute__(( noreturn ))
claim( uchar const * d, ulong sz ) {
  if( sz != 2UL ) tsdk_revert( RC_BAD_IX );
  ulong puzzle = d[ 1 ];
  if( puzzle >= GW_NPUZZLES ) tsdk_revert( RC_BAD_PUZZLE );

  uchar  seed[ 32 ];
  ushort idx = escrow_account( puzzle, seed );
  gw_escrow_t e;
  if( !escrow_load( idx, puzzle, &e ) ) tsdk_revert( RC_NO_ESCROW );

  tsdk_block_ctx_t const * blk = tsdk_get_current_block_ctx( );
  ulong pay = 0UL;
  int   r   = gw_escrow_claim( &e, tsdk_get_account_meta( idx )->balance, block_time( ), blk->slot, &pay );
  if( r == GW_ESC_ERR_NO_CHAMPION ) tsdk_revert( RC_NO_CHAMPION );
  if( r == GW_ESC_ERR_BURNING )     tsdk_revert( RC_BURNING );
  if( r != GW_ESC_OK )              tsdk_revert( RC_ESCROW_BAD );

  /* the payee is fixed by the escrow, never by the caller: the champion's own
     account must simply be present, read-write, for the transfer to land */
  long champ = find_account( e.champion );
  if( champ < 0 || !tsdk_txn_is_account_idx_writable( tsdk_get_txn( ), (ushort)champ ) ) tsdk_revert( RC_NO_CHAMP_ACCT );

  escrow_save( idx, &e );
  if( pay && tsys_account_transfer( idx, (ulong)champ, pay ) ) tsdk_revert( RC_TRANSFER );
  escrow_emit( &e, GW_ESCROW_EV_PAYOUT, pay );
  tsdk_return( 0UL );
}

TSDK_ENTRYPOINT_FN void
start( void const * instruction_data, ulong instruction_data_sz ) {
  uchar const * d = (uchar const *)instruction_data;
  if( instruction_data_sz < 2UL ) tsdk_revert( RC_BAD_IX );
  switch( d[ 0 ] ) {
    case GW_IX_SUBMIT: submit( d, instruction_data_sz );
    case GW_IX_OPEN:   open_escrow( d, instruction_data_sz );
    case GW_IX_CLAIM:  claim( d, instruction_data_sz );
    default:           tsdk_revert( RC_BAD_IX );
  }
}
