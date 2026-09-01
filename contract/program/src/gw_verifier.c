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
 *   8  u8[32] solver (fee payer pubkey)
 *   40 u32 cost, 44 u32 cycles, 48 u32 area, 52 u32 sum
 *   56 machine bytes
 *
 * Revert codes: 0x01 bad instruction data, 0x02 unknown puzzle, 0x03 out of
 * memory, 0x04 event rejected, 0x100 + GW_ERR_* (invalid submission),
 * 0x200 + GW_FAULT_* (the machine faulted), 0xBADBAD engine capacity panic. */

#include <thru-sdk/c/tn_sdk.h>
#include <thru-sdk/c/tn_sdk_syscall.h>
#include "gw.h"
#include "puzzles.h"

#define GW_IX_VERSION   1U
#define GW_EVENT_HDR    56UL

#define RC_BAD_IX       0x01UL
#define RC_BAD_PUZZLE   0x02UL
#define RC_NOMEM        0x03UL
#define RC_EVENT        0x04UL
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

static void
put_u32( uchar * p, ulong v ) {
  p[ 0 ] = (uchar)( v       ); p[ 1 ] = (uchar)( v >> 8  );
  p[ 2 ] = (uchar)( v >> 16 ); p[ 3 ] = (uchar)( v >> 24 );
}

TSDK_ENTRYPOINT_FN void
start( void const * instruction_data, ulong instruction_data_sz ) {
  uchar const * d = (uchar const *)instruction_data;
  if( instruction_data_sz < 3UL || d[ 0 ] != GW_IX_VERSION ) tsdk_revert( RC_BAD_IX );
  ulong puzzle = d[ 1 ];
  if( puzzle >= GW_NPUZZLES ) tsdk_revert( RC_BAD_PUZZLE );
  uchar const * machine     = d + 2;
  ulong         machine_len = instruction_data_sz - 2UL;

  grow_stack( 65536UL );
  uchar *          mem = (uchar *)heap_alloc( sizeof( gw_workspace_t ) + GW_EVENT_HDR + machine_len );
  gw_workspace_t * ws  = (gw_workspace_t *)mem;
  uchar *          ev  = mem + sizeof( gw_workspace_t );

  gw_verdict_t v;
  gw_verify( &GW_PUZZLES[ puzzle ], machine, (uint32_t)machine_len, ws, &v );
  if( v.err != GW_OK )                tsdk_revert( RC_INVALID + (ulong)v.err );
  if( v.status != GW_STATUS_VERIFIED ) tsdk_revert( RC_FAULT + (ulong)v.fault_kind );

  tn_pubkey_t const * solver = &tsdk_get_txn( )->hdr.v1.fee_payer_pubkey;
  ev[ 0 ] = 'G'; ev[ 1 ] = 'W'; ev[ 2 ] = '!'; ev[ 3 ] = '1';
  ev[ 4 ] = (uchar)puzzle;
  ev[ 5 ] = 0;
  ev[ 6 ] = (uchar)( machine_len ); ev[ 7 ] = (uchar)( machine_len >> 8 );
  for( ulong i = 0; i < 32UL; i++ ) ev[ 8 + i ] = solver->uc[ i ];
  put_u32( ev + 40, (ulong)v.cost   );
  put_u32( ev + 44, (ulong)v.cycles );
  put_u32( ev + 48, (ulong)v.area   );
  put_u32( ev + 52, (ulong)v.sum    );
  for( ulong i = 0; i < machine_len; i++ ) ev[ GW_EVENT_HDR + i ] = machine[ i ];
  if( tsys_emit_event( ev, GW_EVENT_HDR + machine_len ) ) tsdk_revert( RC_EVENT );

  tsdk_return( (ulong)v.sum );
}
