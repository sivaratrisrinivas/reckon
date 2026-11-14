import {createHash, createPrivateKey, createPublicKey} from 'node:crypto';
import {KeyPairEd25519} from 'near-workspaces';
import {base_encode} from 'near-api-js/lib/utils/serialize.js';

// Fixed, public, play-money-only seeds for the credential-free local simulation.
// Anyone can derive these keys, so they must never hold real funds or any live account.
const LOCAL_SIGNER_DOMAIN = 'reckon-local-simulation-signer-v1';
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

export type LocalSignerLabel = 'agent-full-access' | 'prediction' | 'challenger' | 'late-taker';

/** Derive a stable ed25519 sandbox key from a public label, so every run uses the same signers. */
export function localSigner(label: LocalSignerLabel): KeyPairEd25519 {
  const seed = createHash('sha256').update(`${LOCAL_SIGNER_DOMAIN}/${label}`).digest();
  const privateKey = createPrivateKey({key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: 'der', type: 'pkcs8'});
  const publicKey = createPublicKey(privateKey).export({format: 'der', type: 'spki'}).subarray(-32);
  return new KeyPairEd25519(base_encode(Buffer.concat([seed, publicKey])));
}
