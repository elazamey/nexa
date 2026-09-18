/**
 * The secret scan — the test of "nothing leaked" that runs over real evidence.
 *
 * The G0 contract says that a specific list of things never appears in the ledger, the
 * transcripts or the exports: raw `sub`, raw email, access and refresh tokens, API keys, file
 * contents, message bodies, prompts, response bodies. That claim is worth exactly as much as
 * the search that checks it, so the search is code and it is run in the suites and in the demo
 * over the produced records.
 *
 * Two kinds of finding:
 *
 *   · **provider prefixes** — `ya29.` (Google access token), `AIza…` (API key), `1//` (refresh
 *     token), `eyJ…` + a dot (a JWT segment). Structural shapes, so they catch material the
 *     caller never knew was there.
 *   · **known literals** — the exact strings this run handled (the token it verified, the
 *     subject and email it saw). A review cannot enumerate every secret, but a run can.
 */
import { canonicalBytes } from '../../../../ast/index.js';
import { sha256Multihash } from '../../../../crypto/index.js';

/** The provider's own prefixes. A digest never matches these, which is the point. */
export const SECRET_PATTERNS = Object.freeze([
  Object.freeze({ kind: 'google-access-token', pattern: /ya29\.[A-Za-z0-9_-]{10,}/ }),
  Object.freeze({ kind: 'google-api-key', pattern: /AIza[0-9A-Za-z_-]{10,}/ }),
  Object.freeze({ kind: 'google-refresh-token', pattern: /1\/\/[0-9A-Za-z_-]{20,}/ }),
  Object.freeze({ kind: 'jwt', pattern: /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/ }),
]);

/**
 * @param {unknown} value anything: a record, a transcript, an export
 * @param {{secrets?: string[], patterns?: ReadonlyArray<{kind: string, pattern: RegExp}>}} [input]
 * @returns {{clean: boolean, findings: Array<{path: string, kind: string}>}}
 */
export function scanForSecretMaterial(value, { secrets = [], patterns = SECRET_PATTERNS } = {}) {
  const findings = [];
  const literals = secrets.filter((secret) => typeof secret === 'string' && secret.length >= 8);

  const walk = (node, path) => {
    if (typeof node === 'string') {
      for (const pattern of patterns) {
        if (pattern.pattern.test(node)) findings.push({ path, kind: pattern.kind });
      }
      for (const secret of literals) {
        if (node.includes(secret)) findings.push({ path, kind: 'known-literal' });
      }
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((entry, index) => walk(entry, `${path}[${index}]`));
      return;
    }
    if (typeof node === 'object' && node !== null) {
      for (const [key, entry] of Object.entries(node)) walk(entry, `${path}.${key}`);
    }
  };

  walk(value, '$');
  return { clean: findings.length === 0, findings };
}

/**
 * The shape that goes into evidence instead of a payload. Exported so every writer uses the
 * same one: if two places disagree about how to digest a payload, one of them is leaking.
 * @param {unknown} payload @returns {string}
 */
export function payloadDigest(payload) {
  return sha256Multihash(canonicalBytes(payload));
}
