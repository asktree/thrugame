/* Browser entry: `npm run bundle` → demo/gw-chain.js exposes window.GWChain.
 * The chain module is shared with the Node CLIs; the WebAuthn side is
 * browser-only and lives here, under GWChain.passkey. */
import * as GWChain from './gw-chain.js';
import {
  registerPasskey, signWithPasskey, signWithDiscoverablePasskey, isWebAuthnSupported,
} from '@thru/passkey/web';

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

window.GWChain = Object.assign({}, GWChain, { passkey });
