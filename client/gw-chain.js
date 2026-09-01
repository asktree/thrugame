/*
 * GREAT WORK! — chain client (shared by the Node CLIs and the browser bundle)
 *
 * The verifier program (contract/program) takes one instruction:
 *   u8 version (1) | u8 puzzle id | codec v2 machine bytes
 * and, only when the machine is VERIFIED, emits one GW!1 event — the fee payer
 * is the solver; the payload carries cost/cycles/area/sum and the machine
 * bytes, so the leaderboard is nothing but the program's event log and every
 * sealed solution can be replayed by anyone. Rejections and faults revert with
 * a code this module decodes (mirrors contract/program/src/gw_verifier.c and
 * the GW_ERR_* / GW_FAULT_* tables in contract/gw.h — keep them in sync).
 */
import { createThruClient, keys, Pubkey, Signature, Filter, FilterParamValue } from '@thru/sdk';

export const NETWORKS = {
  alphanet: {
    name: 'alphanet',
    rpc: 'https://rpc.alphanet.thru.org',
    program: 'taaX8rNMcDjdi-V0IlFhC2ScMsN0gWXbejJdoyDOvHi8aS',   // contract/program/DEPLOYMENTS.md
  },
};
export const IX_VERSION = 1;
export const EVENT_MAGIC = 'GW!1';
export const EVENT_HDR = 56;
const COMPUTE_UNITS = 300_000_000;   // fees are subsidized on alphanet; the sim needs ~15-60M
const TRACK_TIMEOUT_MS = 90_000;

// contract/gw.h enum order
export const ERRORS = [
  'ok', 'malformed solution bytes', 'too many parts', 'bad gripper count', 'bad arm length',
  'tape longer than the cap', 'bad op', 'elbow parent must precede its child', 'elbow mount off the parent',
  'elbow chain too deep', 'two bases on one cell', 'a tip-mounted child replaces the grabber: parent cannot grab or pivot',
  'glyph shape is fixed', 'glyph overlap', 'base on a glyph cell', 'exceeds engine capacity',
  'no board layout (v1 code)', 'placements are not exactly the puzzle\'s reagents', 'no product glyph',
];
export const FAULTS = ['none', 'collision', 'overconstraint', 'grab-cycle', 'exhaustion'];

export function describeRevert(code) {
  code = Number(code);
  if (code === 0x01) return 'bad instruction data';
  if (code === 0x02) return 'unknown puzzle';
  if (code === 0x03) return 'program out of memory';
  if (code === 0x04) return 'event rejected';
  if (code === 0xBADBAD) return 'engine capacity panic';
  if (code >= 0x100 && code < 0x200) return 'rejected: ' + (ERRORS[code - 0x100] || 'error ' + (code - 0x100));
  if (code >= 0x200 && code < 0x300) return 'faulted: ' + (FAULTS[code - 0x200] || 'fault ' + (code - 0x200));
  return 'error ' + code;
}

export function encodeSubmission(puzzleId, machineBytes) {
  const out = new Uint8Array(2 + machineBytes.length);
  out[0] = IX_VERSION; out[1] = puzzleId; out.set(machineBytes, 2);
  return out;
}

export function parseScoreEvent(payload) {
  if (!payload || payload.length < EVENT_HDR) return null;
  if (String.fromCharCode(payload[0], payload[1], payload[2], payload[3]) !== EVENT_MAGIC) return null;
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const mlen = dv.getUint16(6, true);
  if (payload.length !== EVENT_HDR + mlen) return null;
  const solverBytes = payload.slice(8, 40);
  return {
    puzzle: payload[4],
    solver: Pubkey.from(solverBytes).toThruFmt(),
    cost: dv.getUint32(40, true), cycles: dv.getUint32(44, true),
    area: dv.getUint32(48, true), sum: dv.getUint32(52, true),
    machine: payload.slice(EVENT_HDR),
  };
}

export function createClient(network = NETWORKS.alphanet) {
  return createThruClient({ baseUrl: network.rpc });
}

// ---- wallet: a raw Ed25519 keypair; the fee payer IS the solver identity ----
export async function generateWallet() {
  const kp = await keys.generateKeyPair();
  return { address: kp.address, publicKey: kp.publicKey, privateKey: kp.privateKey };
}
export async function walletFromPrivateKey(privateKey) {
  const publicKey = await keys.fromPrivateKey(privateKey);
  return { address: Pubkey.from(publicKey).toThruFmt(), publicKey, privateKey };
}
export const hexToBytes = (hex) => Uint8Array.from(hex.replace(/^0x/, '').match(/../g).map(h => parseInt(h, 16)));
export const bytesToHex = (b) => [...b].map(x => x.toString(16).padStart(2, '0')).join('');

const fmtSignature = (s) => {
  if (!s) return null;
  if (typeof s === 'string') return s;
  if (s instanceof Uint8Array) { try { return Signature.from(s).toThruFmt(); } catch (e) { return bytesToHex(s); } }
  if (s.value instanceof Uint8Array) return fmtSignature(s.value);
  return typeof s.toThruFmt === 'function' ? s.toThruFmt() : String(s);
};

async function track(client, raw, onUpdate) {
  let last = null;
  for await (const u of client.transactions.sendAndTrack(raw, { timeoutMs: TRACK_TIMEOUT_MS })) {
    last = u;
    if (onUpdate) onUpdate(u);
    if (u.executionResult) break;
  }
  return last;
}

export async function accountExists(client, publicKey) {
  try { return !!(await client.accounts.get(publicKey)); }
  catch (e) {
    if (/not found|NotFound|does not exist/i.test(String(e && e.message || e))) return false;
    throw e;
  }
}

// A fresh key bootstraps itself: the create-account transaction carries a
// state proof of the account's absence and needs no funds (alphanet fees are 0).
export async function ensureAccount(client, wallet, onUpdate) {
  if (await accountExists(client, wallet.publicKey)) return { created: false };
  const txn = await client.accounts.create({ publicKey: wallet.publicKey });
  await txn.sign(wallet.privateKey);
  const last = await track(client, txn.toWire(), onUpdate);
  const r = last && last.executionResult;
  if (!r) throw new Error('account creation timed out');
  if (r.vmError !== 0) throw new Error('account creation failed (vm ' + r.vmError + ', code ' + r.userErrorCode + ')');
  return { created: true, signature: fmtSignature(last.signature) };
}

export async function submitSolution(client, { wallet, puzzleId, machineBytes, program = NETWORKS.alphanet.program, onUpdate }) {
  const built = await client.transactions.buildAndSign({
    feePayer: { publicKey: wallet.publicKey, privateKey: wallet.privateKey },
    program,
    instructionData: encodeSubmission(puzzleId, machineBytes),
    header: { fee: 0n, computeUnits: COMPUTE_UNITS, expiryAfter: 100 },
  });
  const signature = fmtSignature(built.signature);
  const last = await track(client, built.rawTransaction, onUpdate);
  const r = last && last.executionResult;
  if (!r) throw new Error('timed out waiting for execution');
  if (r.vmError !== 0) {
    const code = Number(r.userErrorCode);
    const err = new Error(describeRevert(code));
    err.code = code; err.vmError = r.vmError; err.signature = signature;
    throw err;
  }
  return { signature, sum: Number(r.userErrorCode), computeUnits: r.consumedComputeUnits };
}

// ---- leaderboard: the program's event log ----
export async function fetchScores(client, { program = NETWORKS.alphanet.program, puzzleId } = {}) {
  const filter = new Filter({
    expression: 'event.program.value == params.address',
    params: { address: FilterParamValue.taPubkey(program) },
  });
  const res = await client.events.list({ filter });
  const out = [];
  for (const ev of res.events || []) {
    const s = parseScoreEvent(ev.payload);
    if (!s) continue;
    if (puzzleId !== undefined && s.puzzle !== puzzleId) continue;
    s.slot = ev.slot === undefined ? null : BigInt(ev.slot);
    s.eventId = ev.id;
    s.signature = fmtSignature(ev.transactionSignature);
    out.push(s);
  }
  return out;
}

// best entry per solver per puzzle; lower sum wins, earlier slot breaks ties
export function rankScores(scores) {
  const best = new Map();
  for (const s of scores) {
    const k = s.puzzle + ':' + s.solver;
    const b = best.get(k);
    if (!b || s.sum < b.sum || (s.sum === b.sum && s.slot !== null && b.slot !== null && s.slot < b.slot)) best.set(k, s);
  }
  const cmpSlot = (a, b) => (a.slot === null || b.slot === null) ? 0 : (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0);
  return [...best.values()].sort((a, b) => a.puzzle - b.puzzle || a.sum - b.sum || cmpSlot(a, b));
}
