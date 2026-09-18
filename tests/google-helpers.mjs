/**
 * Google-phase test scaffolding.
 *
 * One fixture, rebuilt per test, so a refusal in one test cannot silence another. The clock is
 * pinned at `T0` like every other Ω suite; the challenges are deterministic (a counter) so a
 * pinned vector is reproducible; the keys are the offline throwaway pair in
 * `tools/google-fixtures.mjs`, never anything from Google.
 *
 * `fixture()` returns the whole organ: the identity tissue, the operator identity that may bind,
 * the ledger the evidence lands in, and the signer for whatever token a test wants to forge.
 */
import { createIdentity } from '../packages/identity/index.js';
import { OmegaLedger } from '../packages/runtime/index.js';
import { createJwksSource } from '../packages/cells/google/gateway/index.js';
import { buildGoogleIdentityTissue } from '../packages/cells/google/identity/index.js';
import { OFFLINE_CLIENT_ID, OFFLINE_ISSUER, OFFLINE_T0, offlineClaims, offlineJwks, signOfflineToken } from '../tools/google-fixtures.mjs';

export { OFFLINE_CLIENT_ID, OFFLINE_ISSUER, OFFLINE_T0, offlineClaims, offlineJwks, signOfflineToken };
export const T0 = OFFLINE_T0;
export const clock = () => T0;

/** The subjects the suites speak as. The owner's is the one a binding is keyed on. */
export const SUBJECTS = Object.freeze({
  owner: '110169484474386276334',
  attacker: '107691523809123456789',
  other: '100000000000000000001',
});

/**
 * @param {{keys?: string[], clock?: () => Date, ledger?: boolean}} [input]
 * @returns {object} a fresh Google organ
 */
export function fixture({ keys = ['offline-key-1', 'offline-key-2'], clock: testClock = clock, ledger = true, vault = null } = {}) {
  const operator = createIdentity({ label: 'nexa.operator', kind: 'agent', seed: '11'.repeat(32) });
  const owner = createIdentity({ label: 'nexa.owner', kind: 'agent', seed: '22'.repeat(32) });
  const book = ledger ? new OmegaLedger({ actor: operator, clock: testClock }) : null;
  let issued = 0;
  const google = buildGoogleIdentityTissue({
    clock: testClock,
    ledger: book,
    operator,
    clientId: OFFLINE_CLIENT_ID,
    jwks: createJwksSource({ seed: offlineJwks(keys), clock: testClock }),
    vault,
    generate: () => `challenge-${String((issued += 1)).padStart(12, '0')}`,
  });

  /** Mint a token the way the provider would, for the challenge a session just received. */
  const tokenFor = (overrides = {}, options = {}) => signOfflineToken(offlineClaims(overrides), options);

  return { google, operator, owner, ledger: book, tokenFor };
}

/** @returns {object} the first record of a kind, or undefined */
export function recordOf(records, kind) {
  return records.find((record) => record.kind === kind);
}

/** @returns {string} the JSON of everything the organ wrote, for "the token is not in here" checks */
export function everythingWritten(google, ledger) {
  const parts = [JSON.stringify(google.evidence()), JSON.stringify(google.crossings()), JSON.stringify(google.describe())];
  if (ledger !== null && ledger !== undefined) {
    parts.push(JSON.stringify(ledger.entries().map((entry) => entry.record ?? entry)));
  }
  return parts.join('\n');
}
