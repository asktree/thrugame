#!/usr/bin/env node
/* Offline checks of the chain client's wire formats against the program's
 * (FORMAT.md; the escrow vectors are bytes contract/gw_escrow.c produced).
 *
 *   npm test        (in client/) */
import { createHash } from 'node:crypto';
import { Pubkey, EOA_PROGRAM_ID } from '@thru/sdk';
import * as C from './gw-chain.js';
import * as M from '@thru/programs/manager';

let failures = 0;
const check = (ok, msg) => { if (!ok) { failures++; console.log('FAIL ' + msg); } };
const hex = (h) => Uint8Array.from(h.match(/../g).map(b => parseInt(b, 16)));
const eq = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// the program addresses are the manager's derivation of their seeds: a
// `thru program create <seed>` lands exactly there (checked against the old
// greatwork-v2 deploy, which this derivation reproduces with the old manager)
{
  const net = C.NETWORKS.alphanet;
  check(M.deriveManagedProgramAddresses(net.programSeed).programAccountAddress === net.program, 'program = derive(' + net.programSeed + ')');
  check(M.deriveManagedProgramAddresses(net.testProgramSeed).programAccountAddress === net.testProgram, 'testProgram = derive(' + net.testProgramSeed + ')');
}

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

// GW!E events, as gw_escrow_event wrote them: opened over bar 180, crowned at 163,
// a frozen-out 150 (best), then paid 12345
const CROWN_HEX = '475721450205000000000000000000004757453205010000a3000000100e00000092b17ecb5ed7184e0000000000000001000000a300000000000000000000000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20';
const ACCT_HEX = CROWN_HEX.slice(32);
const crown = C.parseEscrowEvent(hex(CROWN_HEX));
const champ = Pubkey.from(Uint8Array.from({ length: 32 }, (_, i) => i + 1)).toThruFmt();
check(crown && crown.kind === 'crowned' && crown.puzzle === 5 && crown.amount === 0n, 'crown event header');
const e = crown && crown.escrow;
check(e && e.hasChampion && !e.settled && e.sumToBeat === 163 && e.best === 163 && e.fuseSeconds === 3600 && e.round === 1 && e.slot === 78n && e.champion === champ, 'crown event escrow');
check(e && e.fuseEndNs === 1790000000000000000n + 5000000000n + 3600n * 1000000000n, 'fuse end');
const paid = C.parseEscrowEvent(hex('475721450305000039300000000000004757453205030000a3000000100e00000092b17ecb5ed7185a00000000000000010000009600000039300000000000000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20'));
check(paid && paid.kind === 'paid' && paid.amount === 12345n && paid.escrow.settled && paid.escrow.totalPaid === 12345n, 'payout event');
check(paid && paid.escrow.best === 150 && paid.escrow.sumToBeat === 163, 'best remembers the frozen-out 150');
check(C.parseEscrowEvent(new Uint8Array(96)) === null && C.parseScoreEvent(hex('4757214502')) === null, 'junk is not an event');
check(C.parseEscrow(hex(ACCT_HEX), 4) === null, 'escrow for another puzzle');
{ const d = hex(ACCT_HEX); d[5] = 7; const u = C.parseEscrow(d, 5); check(u && u.settled && u.unpaid, 'settled-unpaid flag'); }
check(C.parseEscrow(hex('4757453105' + ACCT_HEX.slice(10)), 5) === null, 'the old GWE1 layout is not read');

// phases
const t = e.fuseEndNs;
check(C.escrowPhase(null, t) === 'none', 'phase none');
check(C.escrowPhase(e, t - 1n) === 'burning' && C.escrowPhase(e, t) === 'won', 'phase burning -> won at fuse end');
check(C.escrowPhase(paid.escrow, t) === 'settled', 'phase settled');
const fresh = { ...e, hasChampion: false, champion: null };
check(C.escrowPhase(fresh, t - 1n) === 'open' && C.escrowPhase(fresh, t) === 'lapsed', 'phase open -> lapsed');
check(C.escrowPhase({ ...fresh, round: 0 }, t) === 'idle' && C.canReopen('idle') && !C.canDeposit('idle'), 'phase idle (INIT, no round)');
check(C.canReopen('none') && C.canReopen('settled') && C.canReopen('lapsed') && !C.canReopen('open') && !C.canReopen('burning') && !C.canReopen('won'), 'reopen rule');
check(C.canDeposit('open') && C.canDeposit('burning') && !['none', 'lapsed', 'won', 'settled'].some(C.canDeposit), 'deposit only into a contested round');

// OPEN / CLAIM / transfer layouts
check(eq(C.encodeOpen(2, { fuseSeconds: 3600 }), Uint8Array.of(0x10, 2, 0x10, 0x0e, 0, 0, 0, 0)), 'open layout, no bar');
check(eq(C.encodeOpen(2, { proof: Uint8Array.of(7, 8), barMachine: Uint8Array.of(9) }), Uint8Array.of(0x10, 2, 0x00, 0x8d, 0x27, 0, 2, 0, 7, 8, 9)), 'open: 30-day default, proof, bar machine');
const refused = (f) => { try { f(); return false; } catch (err) { return true; } };
check(refused(() => C.encodeOpen(0, { fuseSeconds: 0 })), 'zero fuse refused client-side');
check(refused(() => C.encodeOpen(0, { fuseSeconds: 599 })) && !refused(() => C.encodeOpen(0, { fuseSeconds: 600 })), '10-minute minimum');
check(refused(() => C.encodeOpen(0, { fuseSeconds: 2592001 })) && !refused(() => C.encodeOpen(0, { fuseSeconds: 2592000 })), '30-day maximum');
check(C.FUSE_MIN === 600 && C.FUSE_MAX === 30 * 86400, 'fuse bounds mirror gw_escrow.h');
check(eq(C.encodeInit(4, Uint8Array.of(7, 8)), Uint8Array.of(0x12, 4, 7, 8)) && refused(() => C.encodeInit(4, new Uint8Array())), 'INIT layout, proof required');
check(eq(C.encodeClaim(3), Uint8Array.of(0x11, 3)), 'claim layout');
check(eq(C.encodeEoaTransfer(258n, 0, 2), Uint8Array.of(1, 0, 0, 0, 2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 2, 0)), 'EOA transfer layout');

// deposits go to the real EOA program, not the all-zero key
check(C.EOA_PROGRAM === EOA_PROGRAM_ID && EOA_PROGRAM_ID === 'taEOAD2uLK1SLzPgtabFLUAx22yDlBs9DE9nZFTOESIGRr', 'EOA program id');
check(!Pubkey.from(C.EOA_PROGRAM).toBytes().every(b => b === 0), 'EOA program is not the zero key');

// every revert code the program can raise has words
for (const code of [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 0x101, 0x201, 0xBADBAD])
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

// every transaction asks for explicit resources (SDK 0.4.1 defaults them all to
// 0): memory 10,000 like the Thru CLI, and state units only where an account is
// created — the first OPEN, a fresh key, a passkey wallet and its lookup
{
  const prog = C.NETWORKS.alphanet.testProgram;
  const kp = await C.generateWallet();
  const escAddr = C.escrowAddress(2, prog);
  const machine = Uint8Array.of(2, 9, 9, 9);
  const score = new Uint8Array(58 + machine.length);
  score.set([0x47, 0x57, 0x21, 0x32, 2, 0, machine.length, 0]); new DataView(score.buffer).setUint32(52, 150, true); score.set(machine, 58);
  const escrowData = (fuseEndNs) => { const d = hex(ACCT_HEX); d[4] = 2; new DataView(d.buffer).setBigUint64(16, fuseEndNs, true); return d; };
  const fake = (accounts) => {
    const calls = [];
    const exec = async function* () { yield { executionResult: { vmError: 0, consumedComputeUnits: 1 }, signature: new Uint8Array(64) }; };
    const txn = (kind, opts) => { calls.push({ kind, opts }); return { sign: async () => {}, toWire: () => new Uint8Array(200) }; };
    return { calls, client: {
      accounts: {
        get: async (a) => { const x = accounts[typeof a === 'string' ? a : Pubkey.from(a).toThruFmt()]; if (!x) throw new Error('not found'); return x; },
        create: async (opts) => txn('create', opts),
      },
      proofs: { generate: async () => ({ proof: PROOF }) },
      events: { list: async () => ({ events: [{ payload: score, slot: 5n }], page: {} }) },
      transactions: {
        buildAndSign: async (opts) => { calls.push({ kind: 'buildAndSign', opts }); return { signature: new Uint8Array(64), rawTransaction: new Uint8Array(200) }; },
        build: async (opts) => txn('build', opts),
        sendAndTrack: () => exec(),
        get: async () => ({ executionResult: { events: [{ payload: score }] } }),
      },
    } };
  };
  const units = (h) => h && h.stateUnits + '/' + h.memoryUnits;
  // a well-formed creation proof: type 2 in the top bits of the slot word, no
  // path bits, then the proof's two hashes
  const PROOF = new Uint8Array(40 + 64); new DataView(PROOF.buffer).setBigUint64(0, 2n << 62n, true);
  const ours = { meta: { owner: Pubkey.from(prog), flags: {} }, balance: 5n };

  // first OPEN creates the escrow: 1 state unit; its bar is the record's machine
  let f = fake({ [kp.address]: {} });
  await C.openEscrow(f.client, { wallet: kp, puzzleId: 2, fuseSeconds: 600, program: prog });
  let h = f.calls[0].opts.header, ix = f.calls[0].opts.instructionData;
  check(units(h) === '1/10000', 'first OPEN: 1 state unit, 10000 memory: ' + units(h));
  check(ix[6] === PROOF.length && eq(ix.slice(8 + PROOF.length), machine), 'first OPEN carries the proof and the record machine as its bar');
  // a reopen grows nothing
  f = fake({ [kp.address]: {}, [escAddr]: { ...ours, data: { data: escrowData(1n) } } });
  await C.openEscrow(f.client, { wallet: kp, puzzleId: 2, fuseSeconds: 600, bar: 'none', program: prog });
  check(units(f.calls[0].opts.header) === '0/10000' && f.calls[0].opts.instructionData.length === 8, 'reopen: 0 state units, no proof, no bar');
  check(await C.openEscrow(f.client, { wallet: kp, puzzleId: 2, fuseSeconds: 60, program: prog }).then(() => false, () => true), 'a 60 s fuse never leaves the client');

  // SUBMIT, CLAIM, deposits
  const live = { ...ours, data: { data: escrowData(C.nowNs() + 10n ** 15n) } };
  f = fake({ [escAddr]: live });
  await C.submitSolution(f.client, { wallet: kp, puzzleId: 2, machineBytes: machine, program: prog });
  check(f.calls.length === 1 && units(f.calls[0].opts.header) === '0/10000', 'SUBMIT (local key): ' + units(f.calls[0].opts.header));
  // a puzzle whose escrow account does not exist yet: INIT first (1 state unit), then SUBMIT
  f = fake({});
  await C.submitSolution(f.client, { wallet: kp, puzzleId: 2, machineBytes: machine, program: prog });
  check(f.calls.length === 2 && f.calls[0].opts.instructionData[0] === 0x12 && units(f.calls[0].opts.header) === '1/10000' &&
        f.calls[1].opts.instructionData[0] === 3 && units(f.calls[1].opts.header) === '0/10000', 'SUBMIT with no escrow: INIT first, then SUBMIT');
  // a compressed escrow: refused before anything is broadcast
  f = fake({ [escAddr]: { ...live, meta: { owner: Pubkey.from(prog), flags: { isCompressed: true } } } });
  check(await C.submitSolution(f.client, { wallet: kp, puzzleId: 2, machineBytes: machine, program: prog }).then(() => false, (err) => err.code === 0x12 && /decompress/.test(err.message)) &&
        f.calls.length === 0, 'compressed escrow: told to decompress, nothing sent');
  f = fake({ [escAddr]: live });
  check((await C.initEscrow(f.client, { wallet: kp, puzzleId: 2, program: prog })).created === false && f.calls.length === 0, 'INIT on an existing escrow sends nothing');
  f = fake({ [escAddr]: live });
  await C.claimEscrow(f.client, { wallet: kp, puzzleId: 2, program: prog });
  check(units(f.calls[0].opts.header) === '0/10000', 'CLAIM: ' + units(f.calls[0].opts.header));
  await C.depositToEscrow(f.client, { wallet: kp, puzzleId: 2, amount: 7n, program: prog });
  check(units(f.calls[1].opts.header) === '0/10000' && f.calls[1].opts.program === EOA_PROGRAM_ID, 'deposit: EOA program, 0 state units');
  check(await C.depositToEscrow(fake({}).client, { wallet: kp, puzzleId: 2, amount: 7n, program: prog }).then(() => false, (err) => /no escrow/.test(err.message)),
    'no deposit to a puzzle with no escrow');
  check(await C.depositToEscrow(fake({ [escAddr]: { ...ours, data: { data: escrowData(1n) } } }).client, { wallet: kp, puzzleId: 2, amount: 7n, program: prog })
    .then(() => false, (err) => /won/.test(err.message)), 'no deposit to a round already won');
  check((await C.fetchEscrow(fake({ [escAddr]: { ...live, meta: { owner: Pubkey.from(kp.address), flags: {} } } }).client, { puzzleId: 2, program: prog })).escrow === null,
    'an account the program does not own is no escrow');

  // a fresh key's own account
  f = fake({});
  await C.ensureAccount(f.client, kp);
  check(f.calls[0].kind === 'create' && units(f.calls[0].opts.header) === '1/10000', 'fresh account: 1 state unit');

  // passkey wallet: creating it and its lookup, then a passkey-approved SUBMIT
  const meta = { credentialId: 'AQIDBA', publicKeyX: '11'.repeat(32), publicKeyY: '22'.repeat(32), rpId: 'localhost' };
  f = fake({ [kp.address]: {} });
  await C.ensurePasskeyWallet(f.client, { meta, payer: kp });
  check(f.calls.length === 2 && f.calls.every(c => c.kind === 'build' && units(c.opts.header) === '1/10000'), 'passkey wallet + lookup: 1 state unit each');
  const walletAddress = await C.passkeyWalletAddress(meta);
  f = fake({ [walletAddress]: {} });            // no escrow yet: the payer INITs it first
  const assertion = { signatureR: new Uint8Array(32).fill(1), signatureS: new Uint8Array(32).fill(1), authenticatorData: new Uint8Array(37), clientDataJSON: new Uint8Array(8) };
  await C.submitViaPasskey(f.client, { walletAddress, payer: kp, puzzleId: 2, machineBytes: machine, sign: async () => assertion, program: prog });
  check(f.calls.length === 2 && f.calls[0].opts.instructionData[0] === 0x12 && units(f.calls[0].opts.header) === '1/10000', 'passkey SUBMIT, no escrow: the payer INITs it');
  check(units(f.calls[1].opts.header) === '0/10000', 'SUBMIT via passkey: ' + units(f.calls[1].opts.header));

  // hosted wallet: the wallet owns the header, the intent says SUBMIT grows nothing
  const intents = [];
  await C.submitViaWallet(fake({}).client, { signIntent: async (x) => { intents.push(x); return new Uint8Array(200); }, walletAddress, puzzleId: 2, machineBytes: machine, program: prog });
  const b64 = (x) => Uint8Array.from(Buffer.from(x, 'base64'));
  check(intents.length === 2 && b64(intents[0].instructionData)[0] === 0x12 && intents[0].stateUnits === 1, 'hosted wallet, no escrow: an INIT intent first, 1 state unit');
  const intent = intents[1];
  check(intent && intent.stateUnits === 0 && intent.readWriteAddresses[0] === escAddr, 'hosted wallet intent: 0 state units, escrow read-write');
}

if (failures) { console.log(failures + ' FAILURES'); process.exit(1); }
console.log('client wire formats: submission v3, escrow address, GW!E (GWE2, best), phases, OPEN (fuse range, bar machine)/CLAIM/INIT, auto-INIT before SUBMIT, compressed refusal, EOA transfer, resource units, reverts checked');
