#!/usr/bin/env node
/* The prize escrow from the command line (SPEC §13, FORMAT.md "Prize escrow").
 *
 *   node client/escrow.js <puzzle>                       status: pot, champion, fuse
 *   node client/escrow.js <puzzle> history               opened / crowned / paid events
 *   node client/escrow.js <puzzle> open [--fuse 30d] [--bar record|none|<sum>]
 *   node client/escrow.js <puzzle> deposit --amount <n>  a plain transfer into the pot
 *   node client/escrow.js <puzzle> claim                 after the fuse: pays the champion
 *
 * Add --test to use the test copy of the program (NETWORKS.alphanet.testProgram)
 * instead of the public one. Anyone may open, deposit or claim; the key (as in
 * submit.js: GW_PRIVATE_KEY, else the `default` key in ~/.thru/cli/config.yaml)
 * only signs and pays. --fuse takes seconds or a unit: 90s, 15m, 6h, 30d.
 * --bar is the sum a machine must strictly beat to take the first crown; the
 * default `record` is the puzzle's best sum on the leaderboard, so a copy of
 * the leader cannot take the pot. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import * as G from './gw-chain.js';

const require = createRequire(import.meta.url);
const PUZ = require('../engine/gen-puzzles.js');

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
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && argv[i - 1] !== '--test'));
const [key, cmd = 'status'] = positional;
const puzzles = PUZ.puzzles();
const puzzle = puzzles.find(p => p.key === key);
if (!puzzle || !['status', 'history', 'open', 'deposit', 'claim'].includes(cmd)) {
  console.error('usage: node client/escrow.js <puzzle> [status|history|open|deposit|claim] [--test] …\npuzzles: ' + puzzles.map(p => p.key).join(', '));
  process.exit(2);
}
const program = argv.includes('--test') ? G.NETWORKS.alphanet.testProgram : G.NETWORKS.alphanet.program;
const client = G.createClient(G.NETWORKS.alphanet);
const puzzleId = puzzle.id;

async function status() {
  const s = await G.fetchEscrow(client, { puzzleId, program });
  const e = s.escrow, now = G.nowNs(), phase = G.escrowPhase(e, now);
  console.log(`${puzzle.name} — escrow ${s.address}  (program ${program})`);
  console.log(`pot      ${s.balance}`);
  if (!e) { console.log(s.exists ? 'state    unreadable account data' : 'state    no escrow yet: anyone may open one (deposits made now wait for it)'); return; }
  const left = Number(e.fuseEndNs - now) / 1e9;
  const bar = e.sumToBeat === G.NO_SUM ? 'any verified sum' : 'SUM < ' + e.sumToBeat;
  console.log(`escrow   #${e.round} on this puzzle, ${fmtDuration(e.fuseSeconds)} fuse, ${e.totalPaid} paid out so far`);
  if (phase === 'open')    console.log(`state    open: no champion; ${bar} takes the crown. Bar lapses in ${fmtDuration(left)}`);
  if (phase === 'lapsed')  console.log(`state    open, bar lapsed: ${bar} still takes the crown, and anyone may reopen`);
  if (phase === 'burning') console.log(`state    champion ${e.champion} at SUM ${e.sumToBeat}; fuse burns out in ${fmtDuration(left)}; resets on SUM ≤ ${e.sumToBeat - 1}`);
  if (phase === 'won')     console.log(`state    WON by ${e.champion} at SUM ${e.sumToBeat}; anyone may claim the payout`);
  if (phase === 'settled') console.log(`state    paid out to ${e.champion} (SUM ${e.sumToBeat}); anyone may open the next escrow`);
}

async function main() {
  if (cmd === 'status') return status();
  if (cmd === 'history') {
    const evs = await G.fetchEscrowEvents(client, { program, puzzleId });
    if (!evs.length) console.log('no escrow events for ' + puzzle.name);
    for (const ev of evs) {
      const e = ev.escrow;
      const what = ev.kind === 'opened' ? `opened #${e.round}, bar ${e.sumToBeat === G.NO_SUM ? 'none' : e.sumToBeat}, fuse ${fmtDuration(e.fuseSeconds)}, pot ${ev.amount}`
        : ev.kind === 'crowned' ? `crowned ${e.champion} at SUM ${e.sumToBeat}`
        : `paid ${ev.amount} to ${e.champion}`;
      console.log(`slot ${ev.slot}  ${what}  txn ${ev.signature}`);
    }
    return;
  }
  const wallet = await G.walletFromPrivateKey(loadKey());
  console.log(`signer  ${wallet.address}`);
  const acct = await G.ensureAccount(client, wallet);
  if (acct.created) console.log(`account created (${acct.signature})`);
  if (cmd === 'open') {
    const fuseSeconds = parseDuration(opt('--fuse') || '30d');
    const b = opt('--bar') || 'record';
    const bar = b === 'record' ? undefined : b === 'none' ? G.NO_SUM : Number(b);
    const r = await G.openEscrow(client, { wallet, puzzleId, fuseSeconds, bar, program });
    console.log(`OPENED  ${puzzle.name}: bar ${r.bar === G.NO_SUM ? 'none' : 'SUM < ' + r.bar}, fuse ${fmtDuration(fuseSeconds)}  txn ${r.signature}`);
  } else if (cmd === 'deposit') {
    const amount = BigInt(opt('--amount') || 0);
    if (amount <= 0n) throw new Error('--amount <n> is required');
    const r = await G.depositToEscrow(client, { wallet, puzzleId, amount, program });
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
