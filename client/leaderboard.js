#!/usr/bin/env node
/* Print the on-chain leaderboard: the verifier program's GW!2 events, one row
 * per distinct submitted solution, lowest sum first.
 *
 *   node client/leaderboard.js            all puzzles
 *   node client/leaderboard.js amalgam    one puzzle, with each entry's solution code
 *                                         and a link that replays it in the editor
 *   --test                                the test copy of the program */
import { createRequire } from 'node:module';
import { createClient, fetchScores, rankScores, NETWORKS } from './gw-chain.js';

const EDITOR = 'https://greatwork.quest/';

const require = createRequire(import.meta.url);
const CODEC = require('../engine/codec.js');
const PUZ = require('../engine/gen-puzzles.js');

const puzzles = PUZ.puzzles();
const args = process.argv.slice(2).filter(a => a !== '--test');
const program = process.argv.includes('--test') ? NETWORKS.alphanet.testProgram : NETWORKS.alphanet.program;
const only = args[0] ? puzzles.find(p => p.key === args[0]) : null;
if (args[0] && !only) { console.error('unknown puzzle; known: ' + puzzles.map(p => p.key).join(', ')); process.exit(2); }

const client = createClient(NETWORKS.alphanet);
const scores = await fetchScores(client, { program, puzzleId: only ? only.id : undefined });
const ranked = rankScores(scores);
console.log(`${scores.length} submitted solution(s) on ${NETWORKS.alphanet.name}, program ${program}\n`);
let cur = -1, rank = 0;
for (const s of ranked) {
  if (s.puzzle !== cur) { cur = s.puzzle; rank = 0; console.log((puzzles[cur] ? puzzles[cur].name : 'puzzle ' + cur) + ':'); }
  rank++;
  const who = (s.user ? s.user + ' ' : '') + s.solver.slice(0, 8) + '…';
  console.log(`  #${rank}  sum ${String(s.sum).padStart(4)}  = ${String(s.cost).padStart(3)}g + ${String(s.cycles).padStart(3)}c + ${String(s.area).padStart(2)}a   ${(s.name || '(unnamed)').padEnd(22)} ${who}   slot ${s.slot}`);
  if (only) {
    const code = `${only.key}.${CODEC.toString(s.machine)}`;
    console.log(`       ${code}\n       watch: ${EDITOR}#play/${code}`);
  }
}
