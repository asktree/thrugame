#!/usr/bin/env node
/* Print the on-chain leaderboard: the verifier program's GW!2 events, one row
 * per distinct submitted solution, lowest sum first.
 *
 *   node client/leaderboard.js            all puzzles
 *   node client/leaderboard.js amalgam    one puzzle, with each entry's solution code */
import { createRequire } from 'node:module';
import { createClient, fetchScores, rankScores, NETWORKS } from './gw-chain.js';

const require = createRequire(import.meta.url);
const CODEC = require('../engine/codec.js');
const PUZ = require('../engine/gen-puzzles.js');

const puzzles = PUZ.puzzles();
const only = process.argv[2] ? puzzles.find(p => p.key === process.argv[2]) : null;
if (process.argv[2] && !only) { console.error('unknown puzzle; known: ' + puzzles.map(p => p.key).join(', ')); process.exit(2); }

const client = createClient(NETWORKS.alphanet);
const scores = await fetchScores(client, { puzzleId: only ? only.id : undefined });
const ranked = rankScores(scores);
console.log(`${scores.length} submitted solution(s) on ${NETWORKS.alphanet.name}, program ${NETWORKS.alphanet.program}\n`);
let cur = -1, rank = 0;
for (const s of ranked) {
  if (s.puzzle !== cur) { cur = s.puzzle; rank = 0; console.log((puzzles[cur] ? puzzles[cur].name : 'puzzle ' + cur) + ':'); }
  rank++;
  const who = (s.user ? s.user + ' ' : '') + s.solver.slice(0, 8) + '…';
  console.log(`  #${rank}  sum ${String(s.sum).padStart(4)}  = ${String(s.cost).padStart(3)}g + ${String(s.cycles).padStart(3)}c + ${String(s.area).padStart(2)}a   ${(s.name || '(unnamed)').padEnd(22)} ${who}   slot ${s.slot}`);
  if (only) console.log(`       ${only.key}.${CODEC.toString(s.machine)}`);
}
