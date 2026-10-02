/* Host stand-in for thru-sdk/c/tn_sdk_syscall.h (see tn_sdk.h here). */
#ifndef MOCK_TN_SDK_SYSCALL_H
#define MOCK_TN_SDK_SYSCALL_H

#include "tn_sdk.h"

ulong tsys_set_account_data_writable( ulong account_idx );
ulong tsys_account_transfer( ulong from_account_idx, ulong to_account_idx, ulong amount );
ulong tsys_increment_anonymous_segment_sz( void * segment_addr, ulong delta, void ** addr );
ulong tsys_account_create( ulong account_idx, uchar const seed[ TN_SEED_SIZE ], void const * proof, ulong proof_sz );
ulong tsys_account_resize( ulong account_idx, ulong new_size );
ulong tsys_emit_event( void const * data, ulong data_sz );

#endif
