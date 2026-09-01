/*
 * GREAT WORK! — chain client (shared by the Node CLIs and the browser bundle)
 *
 * The verifier program (contract/program) takes one instruction:
 *   u8 version (2) | u8 puzzle id | u8 name len | u8 username len | name |
 *   username | codec v2 machine bytes
 * and, only when the machine is VERIFIED, emits one GW!2 event naming the
 * SOLVER — the account the chain saw authorize the call: the fee payer when it
 * signed directly, or the passkey wallet the passkey manager just validated —
 * with cost/cycles/area/sum, the machine bytes and the names, so the
 * leaderboard is nothing but the program's event log and every submitted
 * solution can be replayed by anyone. Rejections and faults revert with a
 * code this module decodes (mirrors contract/program/src/gw_verifier.c and
 * the GW_ERR_* / GW_FAULT_* tables in contract/gw.h — keep them in sync).
 *
 * Two identities:
 *   - a "payer": a raw Ed25519 key kept locally. It signs and pays (fees are
 *     zero on alphanet). Submitting directly with it makes it the solver too.
 *   - a "passkey wallet": a passkey-manager account whose authority is a
 *     WebAuthn P-256 credential. Submitting through it means the passkey signs
 *     the exact instruction (puzzle, names, machine) and the manager vouches
 *     for the wallet to the verifier — the solver is the wallet, the payer is
 *     only paying, and no UI bug can credit anyone but the key that signed.
 */
import { createThruClient, keys, Pubkey, Signature, Filter, FilterParamValue } from '@thru/sdk';
import * as PM from '@thru/programs/passkey-manager';

export const NETWORKS = {
  alphanet: {
    name: 'alphanet',
    rpc: 'https://rpc.alphanet.thru.org',
    program: 'taaX8rNMcDjdi-V0IlFhC2ScMsN0gWXbejJdoyDOvHi8aS',   // contract/program/DEPLOYMENTS.md
  },
};
export const IX_VERSION = 2;
export const EVENT_MAGIC = 'GW!2';
export const EVENT_HDR = 58;
export const NAME_MAX = 32, USER_MAX = 24;
export const PASSKEY_MANAGER = PM.PASSKEY_MANAGER_PROGRAM_ADDRESS;
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
  if (code === 0x05) return 'no authorized solver (the caller vouched for nobody)';
  if (code === 0xBADBAD) return 'engine capacity panic';
  if (code >= 0x100 && code < 0x200) return 'rejected: ' + (ERRORS[code - 0x100] || 'error ' + (code - 0x100));
  if (code >= 0x200 && code < 0x300) return 'faulted: ' + (FAULTS[code - 0x200] || 'fault ' + (code - 0x200));
  return 'error ' + code;
}

const utf8 = (str) => new TextEncoder().encode(str || '');
const text = (bytes) => new TextDecoder().decode(bytes);
export function cleanName(str, max) {
  return String(str || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

// name: what the solver called this solution (<= 32 bytes); user: who they are (<= 24 bytes)
export function encodeSubmission(puzzleId, machineBytes, { name = '', user = '' } = {}) {
  const n = utf8(cleanName(name, NAME_MAX)), u = utf8(cleanName(user, USER_MAX));
  if (n.length > NAME_MAX) throw new Error('solution name too long');
  if (u.length > USER_MAX) throw new Error('username too long');
  const out = new Uint8Array(4 + n.length + u.length + machineBytes.length);
  out[0] = IX_VERSION; out[1] = puzzleId; out[2] = n.length; out[3] = u.length;
  out.set(n, 4); out.set(u, 4 + n.length); out.set(machineBytes, 4 + n.length + u.length);
  return out;
}

export function parseScoreEvent(payload) {
  if (!payload || payload.length < EVENT_HDR) return null;
  if (String.fromCharCode(payload[0], payload[1], payload[2], payload[3]) !== EVENT_MAGIC) return null;
  const dv = new DataView(payload.buffer, payload.byteOffset, payload.byteLength);
  const mlen = dv.getUint16(6, true), nlen = payload[56], ulen = payload[57];
  if (payload.length !== EVENT_HDR + mlen + nlen + ulen) return null;
  const solverBytes = payload.slice(8, 40);
  const m0 = EVENT_HDR, n0 = m0 + mlen, u0 = n0 + nlen;
  return {
    puzzle: payload[4],
    solver: Pubkey.from(solverBytes).toThruFmt(),
    cost: dv.getUint32(40, true), cycles: dv.getUint32(44, true),
    area: dv.getUint32(48, true), sum: dv.getUint32(52, true),
    machine: payload.slice(m0, n0),
    name: text(payload.slice(n0, u0)),
    user: text(payload.slice(u0)),
  };
}

export function createClient(network = NETWORKS.alphanet) {
  return createThruClient({ baseUrl: network.rpc });
}

// ---- payer: a raw Ed25519 keypair. Submitting with it directly makes it the solver. ----
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

// The program returns 0 (a wrapper such as the passkey manager treats any
// other exit code as failure); the score lives in the event. When the
// transaction is queryable, read it back so callers get the record.
async function settle(client, last, signature) {
  const r = last && last.executionResult;
  if (!r) throw new Error('timed out waiting for execution');
  if (r.vmError !== 0) {
    const code = Number(r.userErrorCode);
    const err = new Error(describeRevert(code));
    err.code = code; err.vmError = r.vmError; err.signature = signature; err.computeUnits = r.consumedComputeUnits;
    throw err;
  }
  let record = null;
  for (let i = 0; i < 6 && !record; i++) {          // the query side lags the tracker a little
    try { record = await getSubmission(client, signature); } catch (e) { record = null; }
    if (!record) await new Promise(res => setTimeout(res, 500));
  }
  return { signature, computeUnits: r.consumedComputeUnits, record, sum: record ? record.sum : null };
}

// the GW!2 record a submitted transaction produced (null if none / not yet visible)
export async function getSubmission(client, signature) {
  const txn = await client.transactions.get(signature);
  const events = (txn && txn.executionResult && txn.executionResult.events) || [];
  for (const ev of events) {
    const s = parseScoreEvent(ev.payload);
    if (s) { s.signature = signature; return s; }
  }
  return null;
}

// submit directly: the payer signs, pays, and is the solver
export async function submitSolution(client, { wallet, puzzleId, machineBytes, name, user, program = NETWORKS.alphanet.program, onUpdate }) {
  const built = await client.transactions.buildAndSign({
    feePayer: { publicKey: wallet.publicKey, privateKey: wallet.privateKey },
    program,
    instructionData: encodeSubmission(puzzleId, machineBytes, { name, user }),
    header: { fee: 0n, computeUnits: COMPUTE_UNITS, expiryAfter: 100 },
  });
  const signature = fmtSignature(built.signature);
  const last = await track(client, built.rawTransaction, onUpdate);
  return settle(client, last, signature);
}

// ---- passkey wallet: a passkey-manager account whose authority is a WebAuthn credential ----
export const WALLET_NAME = 'great-work';     // part of the wallet seed: one wallet per passkey per app

// meta: { credentialId, publicKeyX, publicKeyY, rpId } as @thru/passkey/web returns it
export async function passkeyWalletAddress(meta) {
  const seed = await PM.createWalletSeed(WALLET_NAME, hexToBytes(meta.publicKeyX), hexToBytes(meta.publicKeyY));
  return PM.encodeAddress(await PM.deriveWalletAddress(seed, PASSKEY_MANAGER));
}

// Create the wallet if it does not exist (the payer pays; the passkey is its
// only authority) and register the credential -> wallet lookup so the same
// passkey can find its wallet from another device.
export async function ensurePasskeyWallet(client, { meta, payer, onUpdate }) {
  const x = hexToBytes(meta.publicKeyX), y = hexToBytes(meta.publicKeyY);
  const seed = await PM.createWalletSeed(WALLET_NAME, x, y);
  const walletBytes = await PM.deriveWalletAddress(seed, PASSKEY_MANAGER);
  const walletAddress = PM.encodeAddress(walletBytes);
  await ensureAccount(client, payer, onUpdate);
  let created = false;
  if (!(await accountExists(client, walletAddress))) {
    const proof = await client.proofs.generate({ address: walletAddress, proofType: 1 });
    if (!proof.proof || !proof.proof.length) throw new Error('no state proof for the new wallet');
    const ctx = PM.buildAccountContext({ walletAddress, readWriteAccounts: [], readOnlyAccounts: [], feePayerAddress: payer.address, programAddress: PASSKEY_MANAGER });
    const ix = PM.encodeCreateInstruction({
      walletAccountIdx: ctx.walletAccountIdx,
      authorityRecord: PM.createAuthorityRecord({ tag: 1, pubkeyX: x, pubkeyY: y }),
      seed, stateProof: proof.proof,
    });
    const txn = await client.transactions.build({
      feePayer: { publicKey: payer.publicKey }, program: PASSKEY_MANAGER, instructionData: ix,
      accounts: { readWrite: ctx.readWriteAddresses, readOnly: ctx.readOnlyAddresses }, header: { fee: 0n },
    });
    await txn.sign(payer.privateKey);
    const last = await track(client, txn.toWire(), onUpdate);
    const r = last && last.executionResult;
    if (!r) throw new Error('wallet creation timed out');
    if (r.vmError !== 0) throw new Error('wallet creation failed (vm ' + r.vmError + ', code ' + r.userErrorCode + ')');
    created = true;
  }
  // credential lookup (best effort): lets a passkey find its wallet later
  let lookup = null;
  try {
    const credId = base64UrlToBytes(meta.credentialId);
    const lookupBytes = await PM.deriveCredentialLookupAddress(credId, PASSKEY_MANAGER);
    const lookupAddress = PM.encodeAddress(lookupBytes);
    if (!(await accountExists(client, lookupAddress))) {
      const proof = await client.proofs.generate({ address: lookupAddress, proofType: 1 });
      const ctx = PM.buildAccountContext({ walletAddress, readWriteAccounts: [lookupBytes], readOnlyAccounts: [], feePayerAddress: payer.address, programAddress: PASSKEY_MANAGER });
      const ix = PM.encodeRegisterCredentialInstruction({
        walletAccountIdx: ctx.walletAccountIdx, lookupAccountIdx: ctx.getAccountIndex(lookupBytes),
        seed: await PM.createCredentialLookupSeed(credId), stateProof: proof.proof,
      });
      const txn = await client.transactions.build({
        feePayer: { publicKey: payer.publicKey }, program: PASSKEY_MANAGER, instructionData: ix,
        accounts: { readWrite: ctx.readWriteAddresses, readOnly: ctx.readOnlyAddresses }, header: { fee: 0n },
      });
      await txn.sign(payer.privateKey);
      const last = await track(client, txn.toWire(), onUpdate);
      lookup = last && last.executionResult && last.executionResult.vmError === 0 ? lookupAddress : null;
    } else lookup = lookupAddress;
  } catch (e) { lookup = null; }
  return { walletAddress, created, lookup };
}

// A passkey that signed a discoverable assertion knows only its credential id:
// the on-chain lookup maps it to the wallet, whose authority list holds the
// public key. Returns meta + walletAddress, or null if this passkey has none.
export async function findPasskeyWallet(client, { credentialId, rpId }) {
  const credId = base64UrlToBytes(credentialId);
  const lookupAddress = PM.encodeAddress(await PM.deriveCredentialLookupAddress(credId, PASSKEY_MANAGER));
  let acct;
  try { acct = await client.accounts.get(lookupAddress); } catch (e) { return null; }
  const walletBytes = PM.parseCredentialLookupWallet(accountData(acct));
  if (!walletBytes) return null;
  const walletAddress = PM.encodeAddress(walletBytes);
  const w = await client.accounts.get(walletAddress);
  const auths = PM.parseWalletAuthorities(accountData(w));
  const pk = auths.authorities.find(a => a.kind === 'passkey');
  if (!pk) return null;
  return { walletAddress, authIdx: pk.idx, meta: { credentialId, rpId, publicKeyX: bytesToHex(pk.x), publicKeyY: bytesToHex(pk.y) } };
}
const accountData = (acct) => (acct && acct.data && acct.data.data) || (acct && acct.data) || new Uint8Array();

// Submit through the passkey wallet. `sign(challenge)` must return the WebAuthn
// assertion over exactly these bytes: { signatureR, signatureS,
// authenticatorData, clientDataJSON } (what @thru/passkey/web's signWithPasskey
// returns). The challenge commits to the wallet nonce, every account, and the
// full verifier instruction — puzzle, names, machine — so what the passkey
// approves is what gets recorded, credited to the wallet and nothing else.
export async function submitViaPasskey(client, { meta, walletAddress, authIdx = 0, payer, puzzleId, machineBytes, name, user, sign, program = NETWORKS.alphanet.program, onUpdate }) {
  if (!walletAddress) walletAddress = await passkeyWalletAddress(meta);
  const ix = encodeSubmission(puzzleId, machineBytes, { name, user });
  const verifier = Pubkey.from(program).toBytes();
  const ctx = PM.buildAccountContext({ walletAddress, readWriteAccounts: [], readOnlyAccounts: [verifier], feePayerAddress: payer.address, programAddress: PASSKEY_MANAGER });
  const target = { programIdx: ctx.getAccountIndex(verifier), instructionData: ix };
  const nonce = await PM.fetchWalletNonce(client, walletAddress);
  const challenge = await PM.createValidateChallenge(nonce, ctx.accountAddresses, ctx.walletAccountIdx, authIdx, target);
  const a = await sign(challenge);
  const validateIx = PM.encodeValidateInstruction({
    walletAccountIdx: ctx.walletAccountIdx, authIdx, targetInstruction: target,
    signatureR: a.signatureR, signatureS: PM.normalizeLowS(a.signatureS),
    authenticatorData: a.authenticatorData, clientDataJSON: a.clientDataJSON,
  });
  const txn = await client.transactions.build({
    feePayer: { publicKey: payer.publicKey }, program: PASSKEY_MANAGER, instructionData: validateIx,
    accounts: { readWrite: ctx.readWriteAddresses, readOnly: ctx.readOnlyAddresses },
    header: { fee: 0n, computeUnits: COMPUTE_UNITS, expiryAfter: 100 },
  });
  await txn.sign(payer.privateKey);
  const raw = txn.toWire();
  const last = await track(client, raw, onUpdate);
  return settle(client, last, fmtSignature(raw.slice(raw.length - 64)));
}
export const passkeySeal = submitViaPasskey;   // older name
export const base64UrlToBytes = (s) => PM.base64UrlToBytes(s);
export const bytesToBase64Url = (b) => PM.bytesToBase64Url(b);

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

// one row per distinct submitted solution (solver + machine bytes); lower sum
// wins, earlier slot breaks ties. A solver who submits three different machines
// for one product holds three rows — the record is of solutions, not people.
export function rankScores(scores) {
  const seen = new Map();
  for (const s of scores) {
    const k = s.puzzle + ':' + s.solver + ':' + bytesToHex(s.machine);
    const b = seen.get(k);
    if (!b || (s.slot !== null && b.slot !== null && s.slot < b.slot)) seen.set(k, s);
  }
  const cmpSlot = (a, b) => (a.slot === null || b.slot === null) ? 0 : (a.slot < b.slot ? -1 : a.slot > b.slot ? 1 : 0);
  return [...seen.values()].sort((a, b) => a.puzzle - b.puzzle || a.sum - b.sum || cmpSlot(a, b));
}
