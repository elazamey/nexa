/**
 * The Google identity tissue — the identity path, as a cell crossing a membrane.
 *
 * Nothing here is a function call standing in for a cell. The host starts a challenge, the token
 * travels to `google.identity` as **payload**, and the crossing is the membrane's: identity →
 * capability → type → policy → budget → execution → evidence. The capability is minted by the
 * tissue's guarantor for the **session cell**, verified by the identity cell's membrane, and
 * spent exactly once. The record of the crossing is a `CELL_MESSAGE`; the record of the
 * verification is an `IDENTITY_VERIFIED`, written by the host because evidence belongs to the
 * instance, not to the cell.
 *
 * The owner binding is deliberately *not* reachable from a login. `login()` produces a
 * `Principal` and nothing else; `bindOwner()` is an operator-key operation, and there is no path
 * in which a successful login creates its own binding — a fact the suites assert rather than
 * assume.
 */
import { OmegaError } from '../../../../compiler/index.js';
import { createIdentity } from '../../../../identity/index.js';
import { createCell } from '../../../../cell/src/cell.js';
import { createGuarantor } from '../../../../cell/src/guarantor.js';
import { createTissue, seedFor } from '../../../../cell/src/tissue.js';
import { createJwksSource } from '../../gateway/index.js';
import { createNonceStore } from './nonces.js';
import { createRecorder } from './recorder.js';
import { createBindingRegistry } from './bindings.js';
import { verifyIdToken } from './verify.js';

/** The verification order, as names. A refusal names the step that decided it. */
export const VERIFICATION_STEPS = Object.freeze(['shape', 'signature', 'issuer', 'audience', 'audience+azp', 'window', 'nonce', 'subject', 'email']);

/**
 * The membrane reports the step at which the message failed (`execution`); the *identity* step
 * is the one worth recording, and the receptor carries it back as a prefix of the reason. This
 * maps it, and falls back to the membrane's own step rather than inventing one.
 * @param {string|null} reason @param {string|null} fallback @returns {string|null}
 */
export function verificationStep(reason, fallback = null) {
  if (typeof reason !== 'string') return fallback;
  const head = reason.slice(0, reason.indexOf(':'));
  return VERIFICATION_STEPS.includes(head) ? head : fallback;
}

/** The identity cell's nucleus: what it may not change about itself. */
export const IDENTITY_NUCLEUS = Object.freeze({
  module: 'google.identity@1',
  invariants: Object.freeze([
    'sub is the identity key; email is display metadata',
    'verification is fail-closed and has one order',
    'a login never creates a binding',
    'the cell holds no authority and no token',
  ]),
});

/**
 * @param {object} [input]
 * @param {() => Date} [input.clock]
 * @param {object|null} [input.ledger] an `OmegaLedger`; without one, evidence stays in a journal
 * @param {object} [input.operator] the identity that may mint for this tissue
 * @param {string} input.clientId the configured web client id for this environment
 * @param {object} [input.jwks] a validated key source (`createJwksSource`)
 * @param {object} [input.nonces] the session's challenge store
 * @param {object|null} [input.vault] the token vault, so revocation can destroy material first
 * @param {() => string} [input.generate] the challenge generator (deterministic when injected)
 */
export function buildGoogleIdentityTissue({
  clock = () => new Date(),
  ledger = null,
  operator = null,
  clientId,
  jwks = null,
  nonces = null,
  vault = null,
  generate,
}) {
  if (typeof clientId !== 'string' || clientId.length === 0) {
    throw new OmegaError('OMEGA_E_SCHEMA', 'the identity path needs the configured client id; a missing value is a refusal, never a default');
  }
  const actor = operator ?? createIdentity({ label: 'nexa.operator', kind: 'agent', seed: seedFor('nexa.operator@demo') });
  const keySource = jwks ?? createJwksSource({ clock });
  const challenges = nonces ?? createNonceStore({ clock, ...(generate === undefined ? {} : { generate }) });
  const recorder = createRecorder({ ledger, actor: actor.kid, clock, module: 'google.identity' });
  const bindings = createBindingRegistry({ operator: actor, clock, record: (fields) => recorder.record(fields), vault });
  const guarantor = createGuarantor({ operator: actor, clock, ledger });

  const identity = createCell({
    name: 'google.identity',
    kind: 'identity',
    identity: createIdentity({ label: 'google.identity', kind: 'service', seed: seedFor('google.identity@tissue') }),
    nucleus: IDENTITY_NUCLEUS,
    receptors: {
      verify: {
        description: 'verify an ID token for the session that asked for the challenge',
        accepts: ['token', 'nonce'],
        requires: [],
        handler: ({ payload }) => {
          const verdict = verifyIdToken({
            token: payload.token,
            nonce: payload.nonce, // the session's own challenge: the token must carry it back
            jwks: keySource,
            clientId,
            clock,
            nonces: challenges,
          });
          if (verdict.ok !== true) {
            // A refusal crosses the membrane as a refusal, with its own code: the evidence the
            // membrane writes then says *which* check failed, not merely that something did.
            throw new OmegaError(verdict.code, `${verdict.step}: ${verdict.reason}`, { step: verdict.step });
          }
          return verdict.principal;
        },
      },
    },
    port: { verify: (token, input) => guarantor.verify(token, input), record: (entry) => guarantor.record(entry) },
    clock,
  });

  /** The session speaks for no one: it holds no capability of its own and no receptor. */
  const session = createCell({
    name: 'google.session',
    kind: 'service',
    identity: createIdentity({ label: 'google.session', kind: 'service', seed: seedFor('google.session@tissue') }),
    nucleus: { module: 'google.session@1', invariants: ['a session carries a principal, never an authority'] },
    receptors: {},
    port: { verify: (token, input) => guarantor.verify(token, input), record: (entry) => guarantor.record(entry) },
    clock,
  });

  const tissue = createTissue({
    name: 'google',
    operator: actor,
    guarantor,
    cells: [identity, session],
    routes: [{ from: 'google.session', to: 'google.identity', receptor: 'verify' }],
    entryPoints: [{ to: 'google.identity', receptor: 'verify', as: 'verify' }],
    clock,
  });

  identity.activate();
  session.activate();

  return {
    operator: actor,
    clientId,
    guarantor,
    recorder,
    bindings,
    nonces: challenges,
    jwks: keySource,
    cells: { identity, session },
    tissue,
    tissues: { google: tissue },

    /** @returns {string} a fresh single-use challenge for one session */
    begin() {
      return challenges.issue();
    },

    /**
     * Run one login across the membrane.
     * @param {{token: string, nonce: string, from?: string}} input
     * @returns {{ok: boolean, code: string|null, step: string|null, principal: object|null, record: string|null}}
     */
    login({ token, nonce, from = 'google.session' }) {
      const verdict = tissue.send({ from, to: 'google.identity', receptor: 'verify', payload: { token, nonce } });
      const principal = verdict.ok === true ? verdict.value ?? null : null;
      const step = verdict.ok === true ? null : verificationStep(verdict.reason ?? null, verdict.step ?? null);
      const entry = recorder.record({
        kind: 'IDENTITY_VERIFIED',
        decision: verdict.ok === true ? 'ALLOW' : 'DENY',
        ...(principal === null ? {} : { subject: principal.sub_hash }),
        resource: 'cell:google.identity',
        action: 'verify',
        detail: {
          method: 'gsi',
          issuer: principal?.claims?.issuer ?? null,
          aud_hash: principal?.aud_hash ?? null,
          nonce_id: principal?.nonce_id ?? null,
          code: verdict.code ?? null,
          step,
          reason: verdict.ok === true ? null : (verdict.reason ?? null),
        },
      });
      return {
        ok: verdict.ok === true,
        code: verdict.code ?? null,
        step,
        principal,
        record: entry.hash,
      };
    },

    /** Operator-key operations. A login can never reach these. */
    bindOwner({ sub_hash, nexa_kid, expires_at = null }) {
      return bindings.create({ created_by: actor.kid, sub_hash, nexa_kid, method: 'invitation', expires_at });
    },
    breakGlass: ({ sub_hash, nexa_kid, reason, hours = 24, changes = [], role = 'recovery' }) => bindings.breakGlass({ sub_hash, nexa_kid, reason, hours, changes, role, created_by: actor.kid }),
    revokeOwner: ({ sub_hash, reason }) => bindings.revoke({ sub_hash, reason, by: actor.kid }),

    /** @returns {object[]} the cells and their contracts, as data */
    describe() {
      return {
        tissue: tissue.name,
        cells: tissue.describe().map((cell) => ({ name: cell.name, kind: cell.kind, state: cell.state, nucleus: cell.nucleus, receptors: cell.receptors })),
        contract: tissue.contract().map((route) => `${route.from}->${route.to}.${route.receptor}`),
        jwks: keySource.describe(),
      };
    },

    /** @returns {object[]} the Google layer's own evidence (the kinds it writes) */
    evidence() {
      return recorder.entries();
    },

    /** @returns {object[]} the membrane's evidence: one entry per crossing, allowed or refused */
    crossings() {
      return tissue.evidence();
    },
  };
}
