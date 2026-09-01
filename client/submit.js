#!/usr/bin/env node
/* Submit a solution to the chain.
 *
 *   node client/submit.js <puzzle>.<code> [--name "The Courier"] [--user asktree]
 *
 * The code is what the editor's "copy code" button produces (puzzle = product
 * key, e.g. amalgam.AgEAAAAFABBYJEgK…; old example keys still resolve). The
 * signing key — the solver — comes from GW_PRIVATE_KEY (64 hex chars) or,
 * failing that, the `default` key in ~/.thru/cli/config.yaml. A key that has
 * never been used bootstraps its own account first. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createClient, walletFromPrivateKey, hexToBytes, ensureAccount, submitSolution, NETWORKS } from './gw-chain.js';

const require = createRequire(import.meta.url);
const CODEC = require('../engine/codec.js');
const PUZ = require('../engine/gen-puzzles.js');

function loadKey() {
  if (process.env.GW_PRIVATE_KEY) return hexToBytes(process.env.GW_PRIVATE_KEY.trim());
  const cfg = path.join(os.homedir(), '.thru', 'cli', 'config.yaml');
  if (fs.existsSync(cfg)) {
    const m = fs.readFileSync(cfg, 'utf8').match(/^\s*default:\s*([0-9a-fA-F]{64})/m);
    if (m) return hexToBytes(m[1]);
  }
  throw new Error('no key: set GW_PRIVATE_KEY (64 hex) or add a default key with `thru keys generate default`');
}

const argv = process.argv.slice(2);
const opt = (flag) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : ''; };
const arg = argv.find(a => a.indexOf('.') > 0 && !a.startsWith('--'));
if (!arg) { console.error('usage: node client/submit.js <puzzle>.<code> [--name "…"] [--user "…"]'); process.exit(2); }
const dot = arg.indexOf('.');
const key = arg.slice(0, dot), data = arg.slice(dot + 1).trim();
const puzzles = PUZ.puzzles();
const puzzle = puzzles.find(p => p.key === key) || puzzles.find(p => p.examples.some(e => e.key === key));
if (!puzzle) { console.error('unknown puzzle "' + key + '"; known: ' + puzzles.map(p => p.key).join(', ')); process.exit(2); }
const name = opt('--name'), user = opt('--user');
const machineBytes = CODEC.fromString(data);
CODEC.decodeMachine(machineBytes);   // fail fast on a bad code, before touching the chain

const wallet = await walletFromPrivateKey(loadKey());
const client = createClient(NETWORKS.alphanet);
console.log(`solver  ${wallet.address}`);
console.log(`puzzle  ${puzzle.name} (id ${puzzle.id}), ${machineBytes.length} bytes of calldata`);
const acct = await ensureAccount(client, wallet);
if (acct.created) console.log(`account created (${acct.signature})`);
try {
  const r = await submitSolution(client, { wallet, puzzleId: puzzle.id, machineBytes, name, user });
  console.log(`SUBMITTED  sum ${r.sum === null ? '(see leaderboard)' : r.sum}  (${r.computeUnits} compute units)  txn ${r.signature}`);
} catch (e) {
  console.error('not submitted: ' + e.message + (e.signature ? '  txn ' + e.signature : ''));
  process.exit(1);
}
