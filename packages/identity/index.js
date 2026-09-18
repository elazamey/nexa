/**
 * @nexa/identity — self-signed identity documents + local trust store.
 */
export { KeyPair } from '../crypto/index.js';
export {
  IDENTITY_DOMAIN,
  IDENTITY_FIELDS,
  IDENTITY_KINDS,
  identityPayload,
  createIdentityDocument,
  verifyIdentityDocument,
} from './src/document.js';
export { TrustStore, identityFingerprint } from './src/trust.js';

import { KeyPair as KP } from '../crypto/index.js';
import { createIdentityDocument } from './src/document.js';

/**
 * Convenience: create a key pair, an identity document, and the pair together.
 * @param {{label: string, kind?: string, scope?: string, seed?: string|Buffer, created?: string}} input
 * @returns {{identity: object, document: object, keys: KP, kid: string}}
 */
export function createIdentity({ label, kind = 'operator', scope = 'nexa:local', seed, created }) {
  const keys = seed === undefined ? KP.generate() : KP.fromSeed(seed);
  const identity = { kid: keys.kid, label };
  const document = createIdentityDocument({
    identity,
    label,
    kind,
    scope,
    keys,
    ...(created === undefined ? {} : { created }),
  });
  return { identity, document, keys, kid: keys.kid };
}
