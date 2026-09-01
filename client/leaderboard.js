#!/usr/bin/env node
/* Print the on-chain leaderboard: the verifier program's GW!1 events, best
 * entry per solver, lowest sum first.
 *
 *   node client/leaderboard.js            all puzzles
 *   node client/leaderboard.js courier    one puzzle, with each entry's solution code */
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
console.log(`${scores.length} sealed solution(s) on ${NETWORKS.alphanet.name}, program ${NETWORKS.alphanet.program}\n`);
let cur = -1, rank = 0;
for (const s of ranked) {
  if (s.puzzle !== cur) { cur = s.puzzle; rank = 0; console.log((puzzles[cur] ? puzzles[cur].name : 'puzzle ' + cur) + ':'); }
  rank++;
  console.log(`  #${rank}  sum ${String(s.sum).padStart(4)}  = ${s.cost}g + ${s.cycles}c + ${s.area}a   ${s.solver}   slot ${s.slot}`);
  if (only) console.log(`       ${only.key}.${CODEC.toString(s.machine)}`);
}
