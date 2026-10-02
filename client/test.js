#!/usr/bin/env node
/* Offline checks of the chain client's wire formats against the program's
 * (FORMAT.md; the escrow vectors are bytes contract/gw_escrow.c produced).
 *
 *   npm test        (in client/) */
import { createHash } from 'node:crypto';
import { Pubkey } from '@thru/sdk';
import * as C from './gw-chain.js';

let failures = 0;
const check = (ok, msg) => { if (!ok) { failures++; console.log('FAIL ' + msg); } };
const hex = (h) => Uint8Array.from(h.match(/../g).map(b => parseInt(b, 16)));
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// SUBMIT is version 3
const ix = C.encodeSubmission(4, Uint8Array.of(9, 9), { name: 'ab', user: 'c' });
check(eq(ix, Uint8Array.of(3, 4, 2, 1, 97, 98, 99, 9, 9)), 'submission v3 layout');

// escrow address: sha256(program | 0 | "gw-escrow"…puzzle id) — the C seed layout
const seed = C.escrowSeed(6);
check(seed.length === 32 && new TextDecoder().decode(seed.slice(0, 9)) === 'gw-escrow' && seed[9] === 0 && seed[30] === 0 && seed[31] === 6, 'seed layout');
const prog = C.NETWORKS.alphanet.testProgram;
const pre = new Uint8Array(65); pre.set(Pubkey.from(prog).toBytes()); pre[32] = 0; pre.set(seed, 33);
const want = Pubkey.from(new Uint8Array(createHash('sha256').update(pre).digest())).toThruFmt();
check(C.escrowAddress(6, prog) === want, 'escrow address derivation');
check(C.escrowAddress(5, prog) !== want && C.escrowAddress(6) !== want, 'address depends on puzzle and program');

// GW!E events, as gw_escrow_event wrote them: opened over bar 180, crowned at 163, then paid 12345
const crown = C.parseEscrowEvent(hex('475721450205000000000000000000004757453105010000a3000000100e00000092b17ecb5ed7184e00000000000000010000000000000000000000000000000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20'));
const champ = Pubkey.from(Uint8Array.from({ length: 32 }, (_, i) => i + 1)).toThruFmt();
check(crown && crown.kind === 'crowned' && crown.puzzle === 5 && crown.amount === 0n, 'crown event header');
const e = crown && crown.escrow;
check(e && e.hasChampion && !e.settled && e.sumToBeat === 163 && e.fuseSeconds === 3600 && e.round === 1 && e.slot === 78n && e.champion === champ, 'crown event escrow');
check(e && e.fuseEndNs === 1790000000000000000n + 5000000000n + 3600n * 1000000000n, 'fuse end');
const paid = C.parseEscrowEvent(hex('475721450305000039300000000000004757453105030000a3000000100e00000092b17ecb5ed7185a00000000000000010000000000000039300000000000000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20'));
check(paid && paid.kind === 'paid' && paid.amount === 12345n && paid.escrow.settled && paid.escrow.totalPaid === 12345n, 'payout event');
check(C.parseEscrowEvent(new Uint8Array(96)) === null && C.parseScoreEvent(hex('4757214502')) === null, 'junk is not an event');
check(C.parseEscrow(crown && hex('4757453105010000a3000000100e00000092b17ecb5ed7184e00000000000000010000000000000000000000000000000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20'), 4) === null, 'escrow for another puzzle');

// phases
const t = e.fuseEndNs;
check(C.escrowPhase(null, t) === 'none', 'phase none');
check(C.escrowPhase(e, t - 1n) === 'burning' && C.escrowPhase(e, t) === 'won', 'phase burning -> won at fuse end');
check(C.escrowPhase(paid.escrow, t) === 'settled', 'phase settled');
const fresh = { ...e, hasChampion: false, champion: null };
check(C.escrowPhase(fresh, t - 1n) === 'open' && C.escrowPhase(fresh, t) === 'lapsed', 'phase open -> lapsed');
check(C.canReopen('none') && C.canReopen('settled') && C.canReopen('lapsed') && !C.canReopen('open') && !C.canReopen('burning') && !C.canReopen('won'), 'reopen rule');

// OPEN / CLAIM / transfer layouts
check(eq(C.encodeOpen(2, { fuseSeconds: 3600, bar: 180 }), Uint8Array.of(0x10, 2, 0x10, 0x0e, 0, 0, 180, 0, 0, 0)), 'open layout');
check(eq(C.encodeOpen(2, { proof: Uint8Array.of(7, 8) }).slice(2), Uint8Array.of(0x00, 0x8d, 0x27, 0, 0xff, 0xff, 0xff, 0xff, 7, 8)), 'open defaults + proof');
let threw = false; try { C.encodeOpen(0, { fuseSeconds: 0 }); } catch (err) { threw = true; }
check(threw, 'zero fuse refused client-side');
check(eq(C.encodeClaim(3), Uint8Array.of(0x11, 3)), 'claim layout');
check(eq(C.encodeEoaTransfer(258n, 0, 2), Uint8Array.of(1, 0, 0, 0, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0)), 'EOA transfer layout');

// every revert code the program can raise has words
for (const code of [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 0x101, 0x201, 0xBADBAD])
  check(!/^error /.test(C.describeRevert(code)), 'revert 0x' + code.toString(16) + ' described');

// the event log is read to its end, page by page (the RPC serves 50 a page by default)
{
  const pages = [[1, 2], [3], [4, 5]];
  const seen = [];
  const fake = { events: { list: async ({ page }) => {
    const i = page && page.pageToken ? Number(page.pageToken) : 0;
    seen.push(page && page.pageSize);
    return { events: pages[i].map(n => ({ n })), page: i + 1 < pages.length ? { nextPageToken: String(i + 1) } : {} };
  } } };
  const evs = await C.listProgramEvents(fake, { program: prog });
  check(evs.map(e => e.n).join() === '1,2,3,4,5', 'all pages read: ' + evs.map(e => e.n).join());
  check(seen.every(n => n === C.EVENT_PAGE), 'asks for big pages');
}

if (failures) { console.log(failures + ' FAILURES'); process.exit(1); }
console.log('client wire formats: submission v3, escrow address, GW!E, phases, OPEN/CLAIM, transfer, reverts checked');
