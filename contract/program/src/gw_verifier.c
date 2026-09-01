/* GREAT WORK! — on-chain verifier program (ThruVM).
 *
 * Instruction data:  u8 version (1) | u8 puzzle id | codec v2 machine bytes
 *
 * The program decodes the machine, rebuilds the puzzle from the embedded
 * catalog and the submission's board layout, runs the rules engine to its
 * verdict, and — only if the machine is VERIFIED — emits one event naming the
 * fee payer as the solver with its cost / cycles / area / sum and the machine
 * bytes themselves, so the leaderboard is the program's event log and any
 * sealed solution can be replayed by anyone. Rejections and faults revert, so
 * nothing invalid ever lands on-chain.
 *
 * Event payload (little-endian, packed):
 *   0  "GW!1"           magic + payload version
 *   4  u8  puzzle id
 *   5  u8  reserved (0)
 *   6  u16 machine length
 *   8  u8[32] solver (see above)
 *   40 u32 cost, 44 u32 cycles, 48 u32 area, 52 u32 sum
 *   56 u8 name length, 57 u8 username length
 *   58 machine bytes, then name, then username
 *
 * Revert codes: 0x01 bad instruction data, 0x02 unknown puzzle, 0x03 out of
 * memory, 0x04 event rejected, 0x05 no authorized solver,
 * 0x100 + GW_ERR_* (invalid submission),
 * 0x200 + GW_FAULT_* (the machine faulted), 0xBADBAD engine capacity panic. */

#include <thru-sdk/c/tn_sdk.h>
#include <thru-sdk/c/tn_sdk_syscall.h>
#include "gw.h"
#include "puzzles.h"

#define GW_IX_VERSION   2U
#define GW_EVENT_HDR    58UL
#define GW_NAME_MAX     32UL
#define GW_USER_MAX     24UL

#define RC_BAD_IX       0x01UL
#define RC_BAD_PUZZLE   0x02UL
#define RC_NOMEM        0x03UL
#define RC_EVENT        0x04UL
#define RC_NO_SOLVER    0x05UL
#define RC_INVALID      0x100UL
#define RC_FAULT        0x200UL

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
  __asm__( "mv %0, sp" : "=r"( sp ) );
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

TSDK_ENTRYPOINT_FN void
start( void const * instruction_data, ulong instruction_data_sz ) {
  uchar const * d = (uchar const *)instruction_data;
  if( instruction_data_sz < 5UL || d[ 0 ] != GW_IX_VERSION ) tsdk_revert( RC_BAD_IX );
  ulong puzzle = d[ 1 ];
  if( puzzle >= GW_NPUZZLES ) tsdk_revert( RC_BAD_PUZZLE );
  ulong name_len = d[ 2 ], user_len = d[ 3 ];
  if( name_len > GW_NAME_MAX || user_len > GW_USER_MAX ) tsdk_revert( RC_BAD_IX );
  if( instruction_data_sz < 5UL + name_len + user_len ) tsdk_revert( RC_BAD_IX );
  uchar const * name = d + 4;
  uchar const * user = name + name_len;
  for( ulong i = 0; i < name_len + user_len; i++ ) if( name[ i ] < 0x20 || name[ i ] == 0x7f ) tsdk_revert( RC_BAD_IX );
  uchar const * machine     = user + user_len;
  ulong         machine_len = instruction_data_sz - 4UL - name_len - user_len;

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

  /* return 0: a wrapper such as the passkey manager treats any other exit
     code as failure. The sum travels in the event. */
  tsdk_return( 0UL );
}
