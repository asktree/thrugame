#!/usr/bin/env node
/* Deploy or upgrade the verifier as a managed program.
 *
 *   node client/deploy.js <seed> <program.bin>             # create (fails if the seed is taken)
 *   node client/deploy.js <seed> <program.bin> --upgrade   # upgrade in place (same authority key)
 *   node client/deploy.js <seed> --inspect [program.bin]   # what's on chain; compares bytes if given
 *
 * The same thing `thru program create|upgrade` does, through @thru/programs'
 * deploy helpers, so it runs anywhere Node reaches the RPC (the Rust CLI talks
 * gRPC with its own CA roots and can't pass through a TLS-intercepting proxy).
 * The deployer — the program's upgrade authority — is GW_PRIVATE_KEY (64 hex)
 * or the `default` key in ~/.thru/cli/config.yaml, exactly as in submit.js.
 * A fresh key bootstraps its own account first (alphanet fees are zero). */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deployProgram, upgradeProgram, inspectProgramDeployment } from '@thru/programs/deploy';
import { deriveManagedProgramAddresses } from '@thru/programs/manager';
import { createClient, walletFromPrivateKey, hexToBytes, ensureAccount, NETWORKS } from './gw-chain.js';

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
const pos = argv.filter(a => !a.startsWith('--'));
const [seed, binPath] = pos;
if (!seed) { console.error('usage: node client/deploy.js <seed> <program.bin> [--upgrade] | <seed> --inspect [program.bin]'); process.exit(2); }

const client = createClient(NETWORKS.alphanet);
const bytes = binPath ? new Uint8Array(fs.readFileSync(binPath)) : undefined;
const addrs = await deriveManagedProgramAddresses(seed, false);
console.log(`seed     ${seed}`);
console.log(`program  ${addrs.programAccountAddress ?? addrs.program ?? JSON.stringify(addrs)}`);

const bigintSafe = (_, v) => (typeof v === 'bigint' ? v.toString() : v);

if (argv.includes('--inspect')) {
  const r = await inspectProgramDeployment({ client, seed, expectedProgramBytes: bytes });
  console.log(JSON.stringify(r, bigintSafe, 2));
  process.exit(0);
}
if (!bytes) { console.error('missing <program.bin>'); process.exit(2); }

const wallet = await walletFromPrivateKey(loadKey());
console.log(`deployer ${wallet.address}`);
const acct = await ensureAccount(client, wallet);
if (acct.created) console.log(`account created (${acct.signature})`);

const onProgress = (e) => {
  if (e.status === 'progress' && e.totalChunks) process.stdout.write(`\r  ${e.phase} ${e.uploadStep ?? ''} ${e.completedChunks}/${e.totalChunks}   `);
  else console.log(`  ${e.phase} ${e.status}${e.message ? ' — ' + e.message : ''}${e.signature ? '  txn ' + e.signature : ''}`);
};
const req = { client, seed, program: bytes, signer: { address: wallet.address, privateKey: wallet.privateKey }, onProgress };
try {
  const r = argv.includes('--upgrade') ? await upgradeProgram(req) : await deployProgram(req);
  console.log(`\nDEPLOYED  program ${r.programAccountAddress}  version ${r.programVersion}  ${r.programSize} bytes  txn ${r.transactionSignature}`);
  for (const w of r.warnings || []) console.log('warning: ' + w);
} catch (e) {
  console.error(`\nnot deployed: ${e.code ? e.code + ': ' : ''}${e.message}`);
  process.exit(1);
}
