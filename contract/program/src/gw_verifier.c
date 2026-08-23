/* GREAT WORK! rules-engine verifier — on-chain smoke build.
 * Runs the embedded courier conformance case end to end inside ThruVM's
 * program environment and returns its SUM. The real verifier will read the
 * machine from instruction data and the puzzle from an account; this build
 * proves the full engine runs under the SDK. */

#include <thru-sdk/c/tn_sdk.h>
#include "gw.h"
#include "vectors.h"

void gw_panic( void ) { tsdk_revert( 0xBADBADUL ); }

static gw_sim_t SIM; /* .bss — far too big for the VM stack */

TSDK_ENTRYPOINT_FN void
start( void const * instruction_data    TSDK_PARAM_UNUSED,
       ulong        instruction_data_sz TSDK_PARAM_UNUSED ) {
  gw_machine_t m;
  if( gw_decode_machine( MACHINE_courier, sizeof( MACHINE_courier ), &m ) != GW_OK )
    tsdk_revert( 1UL );
  if( gw_sim_init( &SIM, &PUZZLE_courier, &m ) != GW_OK )
    tsdk_revert( 2UL );
  while( SIM.fault_kind == GW_FAULT_NONE && SIM.cycles < 0 )
    gw_sim_step( &SIM );
  if( SIM.fault_kind != GW_FAULT_NONE )
    tsdk_revert( 100UL + SIM.fault_kind );
  ulong sum = (ulong)( SIM.cost + SIM.cycles + (int64_t)SIM.area_count );
  tsdk_return( sum );   /* courier: 30 + 142 + 7 = 179 */
}
