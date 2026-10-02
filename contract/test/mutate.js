#!/usr/bin/env node
/* Mutation check for the prize escrow (SPEC §13).
 *
 *   node contract/test/mutate.js
 *
 * Each mutation below breaks one escrow rule — in the rules (gw_escrow.c) or
 * in the program shell (program/src/gw_verifier.c) — in a scratch copy of
 * contract/, rebuilds build/escrow-check there and runs it. The harness must
 * FAIL for every one of them: a mutation that survives is a rule no test
 * guards. Exits non-zero if any survives (or does not apply).
 *
 * Not listed: OPEN's early fuse and contested-escrow exits in the shell. They
 * only spare the verifier's compute; gw_escrow_open re-checks both, so
 * removing them changes no outcome (equivalent mutants). */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const SRC = path.resolve(__dirname, '..');
const RULES = 'gw_escrow.c', SHELL = 'program/src/gw_verifier.c';

const MUTANTS = [
  ['ties crown', RULES, 'sum >= (uint64_t)e->to_beat', 'sum > (uint64_t)e->to_beat'],
  ['best forgets sums', RULES, 'if (sum < (uint64_t)e->best) e->best = (uint32_t)sum;', ''],
  ['a settled escrow takes crowns', RULES, 'if (e->flags & GW_ESCROW_SETTLED) return GW_ESC_SETTLED;', ''],
  ['the crown does not freeze', RULES, 'if (gw_escrow_expired(e, now)) return GW_ESC_FROZEN;', ''],
  ['a crown does not relight the fuse', RULES, '  e->fuse_end = light(e, now);\n  e->crowned_slot = slot;\n  return GW_ESC_CROWNED;', '  e->crowned_slot = slot;\n  return GW_ESC_CROWNED;'],
  ['the bar alone is the sum to beat (reopen theft)', RULES, 'e->to_beat = best;', 'e->to_beat = bar;'],
  ['the bar is ignored', RULES, 'if (bar < best) best = bar;', ''],
  ['best is not carried across rounds', RULES, 'uint32_t best = prev ? prev->best : GW_ESCROW_NO_SUM;', 'uint32_t best = GW_ESCROW_NO_SUM;'],
  ['a zero bar is accepted', RULES, '!gw_escrow_fuse_ok(fuse_s) || bar == 0', '!gw_escrow_fuse_ok(fuse_s)'],
  ['a 1 s fuse is accepted', RULES, 'fuse_s >= GW_ESCROW_FUSE_MIN &&', 'fuse_s >= 1 &&'],
  ['a 136-year fuse is accepted', RULES, '&& fuse_s <= GW_ESCROW_FUSE_MAX;', ';'],
  ['a crowned escrow can be reopened', RULES, 'return !(e->flags & GW_ESCROW_HAS_CHAMPION) && now >= e->fuse_end;', 'return now >= e->fuse_end;'],
  ['a contested bar can be reopened', RULES, 'return !(e->flags & GW_ESCROW_HAS_CHAMPION) && now >= e->fuse_end;', 'return !(e->flags & GW_ESCROW_HAS_CHAMPION);'],
  ['it pays twice', RULES, 'if (e->flags & GW_ESCROW_SETTLED) return GW_ESC_ERR_PAID;', ''],
  ['it pays while the fuse burns', RULES, 'if (!gw_escrow_expired(e, now)) return GW_ESC_ERR_BURNING;', ''],
  ['it pays with nobody crowned', RULES, 'if (!(e->flags & GW_ESCROW_HAS_CHAMPION)) return GW_ESC_ERR_NO_CHAMPION;', ''],
  ['load trusts best above the sum to beat', RULES, ' || e->best > e->to_beat', ''],
  ['SUBMIT takes the escrow read-only', SHELL, 'if( !tsdk_txn_is_account_idx_writable( tsdk_get_txn( ), esc_idx ) ) tsdk_revert( RC_ESCROW_BAD );', ''],
  ['SUBMIT does not save a lower best', SHELL, 'if( r == GW_ESC_CROWNED || e.best != best0 ) escrow_save', 'if( r == GW_ESC_CROWNED ) escrow_save'],
  ['SUBMIT skips a compressed escrow', SHELL, 'if( tsdk_get_account_meta( idx )->flags & TSDK_ACCOUNT_FLAG_COMPRESSED ) tsdk_revert( RC_COMPRESSED );', ''],
  ['a foreign account blocks sealing', SHELL, 'if( !tsdk_is_account_owned_by_current_program( idx ) ) return ESC_FOREIGN;', 'if( !tsdk_is_account_owned_by_current_program( idx ) ) tsdk_revert( RC_ESCROW_BAD );'],
  ['OPEN ignores the bar machine', SHELL, 'bar = (uint)v.sum;', 'bar = GW_ESCROW_NO_SUM;'],
  ['CLAIM pays the caller', SHELL, 'long champ = find_account( e.champion );', 'long champ = 0;'],
  ['CLAIM does not record the payout', SHELL, '  escrow_save( idx, &e );\n  if( pay &&', '  if( pay &&'],
];

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gw-mutate-'));
const copy = (from, to) => {
  for (const ent of fs.readdirSync(from, { withFileTypes: true })) {
    if (ent.name === 'build') continue;
    const a = path.join(from, ent.name), b = path.join(to, ent.name);
    if (ent.isDirectory()) { fs.mkdirSync(b, { recursive: true }); copy(a, b); }
    else if (ent.isFile()) fs.copyFileSync(a, b);
  }
};
copy(SRC, tmp);
const run = () => {
  try { execSync('make -s build/escrow-check && ./build/escrow-check', { cwd: tmp, stdio: 'pipe' }); return true; }
  catch (e) { return false; }
};

let bad = 0;
try {
  if (!run()) { console.log('the unmutated harness fails: fix it first'); process.exit(1); }
  for (const [name, file, from, to] of MUTANTS) {
    const f = path.join(tmp, file);
    const orig = fs.readFileSync(f, 'utf8');
    const n = orig.split(from).length - 1;
    if (n !== 1) { bad++; console.log(`?? ${name}: pattern found ${n}x in ${file}`); continue; }
    fs.writeFileSync(f, orig.replace(from, to));
    const survived = run();
    fs.writeFileSync(f, orig);
    if (survived) bad++;
    console.log((survived ? 'SURVIVED ' : 'killed   ') + name);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
if (bad) { console.log(bad + ' mutation(s) not caught'); process.exit(1); }
console.log('all ' + MUTANTS.length + ' escrow mutations caught by build/escrow-check');
