#!/usr/bin/env node
/* The prize escrow from the command line (SPEC §13, FORMAT.md "Prize escrow").
 *
 *   node client/escrow.js <puzzle>                       status: pot, champion, fuse
 *   node client/escrow.js <puzzle> init                  create the puzzle's escrow account (idle)
 *   node client/escrow.js init --all                     ...for every puzzle (right after a deploy)
 *   node client/escrow.js <puzzle> decompress            restore the escrow (and its champion's
 *                                                        account) after the runtime compressed it
 *   node client/escrow.js <puzzle> history               opened / crowned / paid events
 *   node client/escrow.js <puzzle> open [--fuse 30d] [--bar record|none|<code>]
 *   node client/escrow.js <puzzle> deposit --amount <n>  a plain transfer into an open round's pot
 *   node client/escrow.js <puzzle> claim                 after the fuse: pays the champion
 *
 * Add --test to use the test copy of the program (NETWORKS.alphanet.testProgram)
 * instead of the public one. Anyone may open, deposit or claim; the key (as in
 * submit.js: GW_PRIVATE_KEY, else the `default` key in ~/.thru/cli/config.yaml)
 * only signs and pays. Nothing can be sealed on a puzzle until its escrow
 * account exists (so the escrow's best sees the whole record); `init` creates
 * it, as the client's submit does on demand. --fuse takes seconds or a unit,
 * 10m to 30d: 600s,
 * 15m, 6h, 30d. --bar is a machine whose sum the first crown must strictly
 * beat: the default `record` sends the puzzle's best sealed machine, so a copy
 * of the leader cannot take the pot; `none` sends none; a solution code
 * (<puzzle>.<code>, as submit.js takes) sends that machine. The program
 * verifies it, and never lets a round be won with a sum the escrow has
 * already seen, whatever bar is asked for. Deposits are refused unless a
 * round is open or burning (--force sends anyway). */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as G from './gw-chain.js';

const require = createRequire(import.meta.url);
const PUZ = require('../engine/gen-puzzles.js');
const CODEC = require('../engine/codec.js');

function loadKey() {
  if (process.env.GW_PRIVATE_KEY) return G.hexToBytes(process.env.GW_PRIVATE_KEY.trim());
  const cfg = path.join(os.homedir(), '.thru', 'cli', 'config.yaml');
  if (fs.existsSync(cfg)) {
    const m = fs.readFileSync(cfg, 'utf8').match(/^\s*default:\s*([0-9a-fA-F]{64})/m);
    if (m) return G.hexToBytes(m[1]);
  }
  throw new Error('no key: set GW_PRIVATE_KEY (64 hex) or add a default key with `thru keys generate default`');
}
export function parseDuration(s) {
  const m = String(s).trim().match(/^(\d+)\s*([smhd]?)$/);
  if (!m) throw new Error('bad duration "' + s + '" (try 90s, 15m, 6h, 30d)');
  return Number(m[1]) * { '': 1, s: 1, m: 60, h: 3600, d: 86400 }[m[2]];
}
export function fmtDuration(sec) {
  sec = Math.max(0, Math.floor(sec));
  const d = Math.floor(sec / 86400), h = Math.floor(sec % 86400 / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : m ? `${m}m ${s}s` : `${s}s`;
}

const argv = process.argv.slice(2);
const opt = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && argv[i - 1] !== '--test' && argv[i - 1] !== '--force' && argv[i - 1] !== '--all'));
const all = argv.includes('--all');
const [key, cmd = 'status'] = all && positional[0] === 'init' ? [null, 'init'] : positional;
const puzzles = PUZ.puzzles();
const puzzle = all ? null : puzzles.find(p => p.key === key);
if ((!puzzle && !(all && cmd === 'init')) || !['status', 'history', 'open', 'deposit', 'claim', 'init', 'decompress'].includes(cmd)) {
  console.error('usage: node client/escrow.js <puzzle> [status|history|init|decompress|open|deposit|claim] [--test] …\n       node client/escrow.js init --all [--test]\npuzzles: ' + puzzles.map(p => p.key).join(', '));
  process.exit(2);
}
const program = argv.includes('--test') ? G.NETWORKS.alphanet.testProgram : G.NETWORKS.alphanet.program;
const client = G.createClient(G.NETWORKS.alphanet);
const puzzleId = puzzle ? puzzle.id : null;

async function status() {
  const s = await G.fetchEscrow(client, { puzzleId, program });
  const e = s.escrow, now = G.nowNs(), phase = G.escrowPhase(e, now);
  console.log(`${puzzle.name} — escrow ${s.address}  (program ${program})`);
  console.log(`pot      ${s.balance}`);
  if (s.compressed) { console.log('account  COMPRESSED after a quiet spell: nothing on this puzzle (submissions included) works until someone decompresses it — `decompress` (anyone may; nothing is lost)'); return; }
  if (!e) { console.log(s.exists ? 'state    not a readable escrow of this program (owner ' + s.owner + ')' : 'state    no escrow account yet: nothing can be sealed or deposited; `init` (or a first submission, or open) creates it'); return; }
  if (phase === 'idle') {
    console.log(`state    idle: the account exists (best ${e.best === G.NO_SUM ? 'none yet' : 'SUM ' + e.best}), no round open; anyone may open one`);
    console.log(`account  ${s.uncompressable ? 'uncompressable' : 'COMPRESSIBLE (the runtime did not keep the flag)'}`);
    return;
  }
  const left = Number(e.fuseEndNs - now) / 1e9;
  const bar = e.sumToBeat === G.NO_SUM ? 'any verified sum' : 'SUM < ' + e.sumToBeat;
  console.log(`escrow   round ${e.round} on this puzzle, ${fmtDuration(e.fuseSeconds)} fuse; ${e.totalPaid} paid out over all rounds`);
  console.log(`best     ${e.best === G.NO_SUM ? 'none yet' : 'SUM ' + e.best + ' — no round can be won with this sum or worse'}`);
  console.log(`account  ${s.uncompressable ? 'uncompressable' : 'COMPRESSIBLE (the runtime did not keep the flag)'}${s.compressed ? ', COMPRESSED: decompress it before anything else' : ''}`);
  if (phase === 'open')    console.log(`state    open: no champion; ${bar} takes the crown. Bar lapses in ${fmtDuration(left)}`);
  if (phase === 'lapsed')  console.log(`state    open, bar lapsed: ${bar} still takes the crown, and anyone may reopen`);
  if (phase === 'burning') console.log(`state    champion ${e.champion} at SUM ${e.sumToBeat}; fuse burns out in ${fmtDuration(left)}; resets on SUM ≤ ${e.sumToBeat - 1}`);
  if (phase === 'won')     console.log(`state    WON by ${e.champion} at SUM ${e.sumToBeat}; anyone may claim the payout`);
  if (phase === 'settled') console.log(e.unpaid
    ? `state    settled UNPAID: the champion ${e.champion}'s account could not receive; the pot stays for the next round`
    : `state    paid out to ${e.champion} (SUM ${e.sumToBeat}); anyone may open the next escrow`);
}

async function main() {
  if (cmd === 'status') return status();
  if (cmd === 'history') {
    const evs = await G.fetchEscrowEvents(client, { program, puzzleId });
    if (!evs.length) console.log('no escrow events for ' + puzzle.name);
    for (const ev of evs) {
      const e = ev.escrow;
      const what = ev.kind === 'opened' ? `opened round ${e.round}, to beat ${e.sumToBeat === G.NO_SUM ? 'none' : e.sumToBeat}, fuse ${fmtDuration(e.fuseSeconds)}, pot ${ev.amount}`
        : ev.kind === 'crowned' ? `crowned ${e.champion} at SUM ${e.sumToBeat}`
        : ev.kind === 'initialized' ? 'account created (idle)'
        : ev.kind === 'unpaid' ? `settled unpaid: ${e.champion} could not receive; ${ev.amount} kept for the next round`
        : `paid ${ev.amount} to ${e.champion}`;
      console.log(`slot ${ev.slot}  ${what}  txn ${ev.signature}`);
    }
    return;
  }
  const wallet = await G.walletFromPrivateKey(loadKey());
  console.log(`signer  ${wallet.address}`);
  const acct = await G.ensureAccount(client, wallet);
  if (acct.created) console.log(`account created (${acct.signature})`);
  if (cmd === 'decompress') {
    const address = G.escrowAddress(puzzleId, program);
    const todo = [];
    if (await G.isCompressed(client, address)) todo.push(address);
    else {
      const s = await G.fetchEscrow(client, { puzzleId, program });
      const champ = s.escrow && s.escrow.champion;
      if (champ && !(await G.accountExists(client, champ)) && await G.isCompressed(client, champ)) todo.push(champ);
    }
    if (!todo.length) console.log('nothing to decompress (run it again after the escrow is restored, for its champion)');
    for (const o of todo.length ? await G.decompressAccounts(client, { wallet, accounts: todo }) : [])
      console.log(`${o.status.toUpperCase().padEnd(8)} ${o.address}${o.signatures.length ? '  txn ' + o.signatures.join(', ') : ''}`);
  } else if (cmd === 'init') {
    for (const p of all ? puzzles : [puzzle]) {
      const r = await G.initEscrow(client, { wallet, puzzleId: p.id, program });
      console.log(`${r.created ? 'INIT    ' : 'exists  '}${p.name}: ${r.address}${r.signature ? '  txn ' + r.signature : ''}`);
    }
    if (all) return;
  } else if (cmd === 'open') {
    const fuseSeconds = G.checkFuse(parseDuration(opt('--fuse') || '30d'));
    const b = opt('--bar') || 'record';
    let bar = b;
    if (b !== 'record' && b !== 'none') {
      const dot = b.indexOf('.');
      if (dot <= 0 || b.slice(0, dot) !== puzzle.key) throw new Error('--bar takes record, none, or a ' + puzzle.key + '.<code> solution');
      bar = CODEC.fromString(b.slice(dot + 1).trim());
      CODEC.decodeMachine(bar);
    }
    const r = await G.openEscrow(client, { wallet, puzzleId, fuseSeconds, bar, program });
    console.log(`OPENED  ${puzzle.name}: ${b === 'record' ? (r.bar === G.NO_SUM ? 'no record yet, no bar' : 'bar = the record, SUM ' + r.bar) : b === 'none' ? 'no bar of its own' : 'bar = that machine'}, fuse ${fmtDuration(fuseSeconds)}  txn ${r.signature}`);
  } else if (cmd === 'deposit') {
    const amount = BigInt(opt('--amount') || 0);
    if (amount <= 0n) throw new Error('--amount <n> is required');
    const r = await G.depositToEscrow(client, { wallet, puzzleId, amount, program, force: argv.includes('--force') });
    console.log(`DEPOSITED  ${amount} into ${G.escrowAddress(puzzleId, program)}  txn ${r.signature}`);
  } else if (cmd === 'claim') {
    const r = await G.claimEscrow(client, { wallet, puzzleId, program });
    console.log(`CLAIMED  the pot went to ${r.champion}  txn ${r.signature}`);
  }
  await status();
}

if (import.meta.url === 'file://' + process.argv[1] || process.argv[1].endsWith('escrow.js')) {
  main().catch(e => { console.error('failed: ' + e.message + (e.signature ? '  txn ' + e.signature : '')); process.exit(1); });
}
