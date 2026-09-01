/* Browser entry: `npm run bundle` → demo/gw-chain.js exposes window.GWChain.
 * The chain module is shared with the Node CLIs; the WebAuthn side is
 * browser-only and lives here, under GWChain.passkey. */
import * as GWChain from './gw-chain.js';
import {
  registerPasskey, signWithPasskey, signWithDiscoverablePasskey, isWebAuthnSupported,
} from '@thru/passkey/web';
import { BrowserSDK, ThruNetwork } from '@thru/wallet';

const rpId = () => (typeof location !== 'undefined' ? location.hostname : 'localhost');

const passkey = {
  supported: () => { try { return isWebAuthnSupported(); } catch (e) { return false; } },
  rpId,
  // Create a passkey on this device/account. `alias` is the label the
  // platform shows (e.g. "Great Work! · asktree"). Returns the meta the rest of
  // the API takes: { credentialId, publicKeyX, publicKeyY, rpId }.
  async register(alias) {
    const userId = 'gw-' + Math.random().toString(36).slice(2, 10);
    const r = await registerPasskey(alias || 'Great Work!', userId, rpId());
    return { credentialId: r.credentialId, publicKeyX: r.publicKeyX, publicKeyY: r.publicKeyY, rpId: r.rpId || rpId() };
  },
  // The signer submitViaPasskey wants: an assertion over exactly the challenge.
  signer(meta) {
    return (challenge) => signWithPasskey(meta.credentialId, challenge, meta.rpId || rpId());
  },
  // Sign in from a device that has the passkey but no local meta: the browser
  // picks the credential, the chain's credential lookup names the wallet.
  async signIn(client) {
    const probe = crypto.getRandomValues(new Uint8Array(32));
    const r = await signWithDiscoverablePasskey(probe, rpId());
    const found = await GWChain.findPasskeyWallet(client, { credentialId: r.credentialId, rpId: r.rpId || rpId() });
    return found;   // { walletAddress, authIdx, meta } or null (a passkey with no wallet yet)
  },
};

// The hosted Thru wallet (app.tid.sh) in an iframe: passkeys, accounts and fee
// payer are the wallet's business; we connect, hand it intents, send what it
// signs. One SDK per page; create lazily so a visitor who never connects never
// loads the iframe.
const WALLET_IFRAME = 'https://app.tid.sh/embedded';
let sdk = null, sdkReady = null;
const wallet = {
  iframeUrl: WALLET_IFRAME,
  async sdk() {
    if (!sdk) {
      sdk = new BrowserSDK({ iframeUrl: WALLET_IFRAME, rpcUrl: GWChain.NETWORKS.alphanet.rpc, network: ThruNetwork.Alphanet });
      sdkReady = sdk.initialize().catch((e) => { sdk = null; sdkReady = null; throw e; });
    }
    await sdkReady;
    return sdk;
  },
  // Connect (the wallet shows its own UI: sign in with a passkey, pick an
  // account). Resolves to { address, label } of the selected account.
  async connect() {
    const s = await wallet.sdk();
    const r = await s.connect({ metadata: {
      appId: 'great-work', appName: 'Great Work!',
      appUrl: typeof location !== 'undefined' ? location.origin + location.pathname : 'https://asktree.github.io/thrugame/editor.html',
    } });
    const acct = r.selectedAccount || (r.accounts && r.accounts[0]) || null;
    if (!acct) throw new Error('the wallet connected no account');
    return { address: acct.address, label: acct.label || '' };
  },
  isConnected() { return !!sdk && sdk.isConnected(); },
  selected() { const a = sdk && sdk.getSelectedAccount(); return a ? { address: a.address, label: a.label || '' } : null; },
  async disconnect() { if (sdk) await sdk.disconnect(); },
  on(event, fn) { if (sdk) sdk.on(event, fn); },
  // the signer submitViaWallet wants
  signer() { return async (intent) => (await wallet.sdk()).signTransaction(intent); },
};

window.GWChain = Object.assign({}, GWChain, { passkey, wallet });
