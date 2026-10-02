/* Host stand-in for the Thru C SDK (thru-sdk/c/tn_sdk.h): only what the
 * program shell uses, with the same names and shapes, so
 * contract/program/src/gw_verifier.c compiles unchanged on the host and
 * contract/test/escrow_main.c can drive it against a simulated ledger.
 * Not the SDK — semantics are modelled in escrow_main.c. */
#ifndef MOCK_TN_SDK_H
#define MOCK_TN_SDK_H

#include <stdint.h>
#include <string.h>

typedef unsigned char  uchar;
typedef unsigned short ushort;
typedef unsigned int   uint;
typedef unsigned long  ulong;

typedef union { uchar uc[32]; ulong ul[4]; } tn_pubkey_t;

typedef struct { int unused; } tsdk_txn_t;

typedef struct __attribute__(( packed )) {
  uchar       version;
  uchar       flags;
  uint        data_sz;
  ulong       seq;
  tn_pubkey_t owner;
  ulong       balance;
  ulong       nonce;
} tsdk_account_meta_t;

typedef struct { ushort call_depth; } tsdk_shadow_stack_t;

typedef struct { ulong slot; ulong block_time; } tsdk_block_ctx_t;

#define TSDK_ENTRYPOINT_FN __attribute__(( noreturn ))
#define TSDK_SEG_TYPE_HEAP (0x07UL)
#define TSDK_ADDR( seg_type, seg_idx, offset ) ( (seg_type) << 40UL | (seg_idx) << 24UL | (offset) )
#define TSDK_ACCOUNT_FLAG_PROGRAM ((uchar)0x01U)
#define TN_SEED_SIZE (32UL)

tsdk_txn_t const *          tsdk_get_txn( void );
tn_pubkey_t const *         tsdk_txn_get_acct_addrs( tsdk_txn_t const * txn );
ushort                      tsdk_txn_account_cnt( tsdk_txn_t const * txn );
int                         tsdk_txn_is_account_idx_writable( tsdk_txn_t const * txn, ushort acc_idx );
tsdk_shadow_stack_t const * tsdk_get_shadow_stack( void );
tsdk_block_ctx_t const *    tsdk_get_current_block_ctx( void );
tsdk_account_meta_t const * tsdk_get_account_meta( ushort account_idx );
void *                      tsdk_get_account_data_ptr( ushort account_idx );
int                         tsdk_account_exists( ushort account_idx );
int                         tsdk_is_account_authorized_by_idx( ushort account_idx );
int                         tsdk_is_account_authorized_by_pubkey( tn_pubkey_t const * pubkey );
ushort                      tsdk_get_current_program_acc_idx( void );
tn_pubkey_t const *         tsdk_get_current_program_acc_addr( void );
int                         tsdk_is_account_owned_by_current_program( ushort account_idx );
tn_pubkey_t *               tsdk_create_program_defined_account_address(
  tn_pubkey_t const * owner, uchar is_ephemeral, uchar const seed[ TN_SEED_SIZE ], tn_pubkey_t * out );
void __attribute__(( noreturn )) tsdk_revert( ulong error_code );
void __attribute__(( noreturn )) tsdk_return( ulong return_code );

#endif
