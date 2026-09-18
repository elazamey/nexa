/**
 * The NEXA endpoint: the state machine that turns an envelope into a decision.
 *
 * Decision order (fixed, and each step can only DENY):
 *   1. envelope signature + freshness   (crypto)
 *   2. recipient binding                (is this envelope for me?)
 *   3. replay guard                     (only after step 1 succeeds)
 *   4. sender trust                     (trust store, pin-or-reject)
 *   5. hard gates                       (the six closed gates, checked pre-policy)
 *   6. capability verification          (signatures, chain, budget, presenter)
 *   7. policy evaluation                (default-deny)
 *   8. handler dispatch                 (in-memory only)
 *
 * Every step appends one or more evidence records. ALLOW and DENY both produce
 * a signed receipt. A DENY never reveals handler internals, only the reason code.
 */
import {
  NexaError,
  asNexaError,
  assertAction,
  assertKid,
  assertResource,
  canonicalBytes,
  formatInstant,
} from '../../ast/index.js';
import { KeyPair } from '../../crypto/index.js';
import { Policy } from '../../policy/index.js';
import { checkGates } from '../../policy/src/gates.js';
import { EvidenceLog } from '../../evidence/src/chain.js';
import { createReceipt } from '../../evidence/src/receipt.js';
import { TrustStore } from '../../identity/src/trust.js';
import { verifyCapability } from '../../capability/src/attenuation.js';
import { ReplayGuard } from './replay.js';
import { UsageLedger } from './ledger.js';
import { DEFAULT_SKEW_SECONDS, MAX_BODY_BYTES, MAX_TTL_SECONDS, buildEnvelope, verifyEnvelope } from './envelope.js';

const NO_HANDLER = Symbol('no-handler');

export class Endpoint {
  #handlers = new Map();

  /**
   * @param {object} input
   * @param {{identity: object, keys: KeyPair, kid: string}} input.identity
   * @param {Policy} [input.policy]
   * @param {TrustStore} [input.trust]
   * @param {() => Date} [input.clock]
   * @param {number} [input.skewSeconds]
   * @param {ReplayGuard} [input.replay]
   * @param {UsageLedger} [input.ledger]
   * @param {object|string[]|Set<string>} [input.revoked] revocation view (a `RevocationSet`
   *   gives attributed revocation; a plain set of ids is accepted but unattributed)
   * @param {string[]} [input.capabilityIssuers] key ids allowed to be the ROOT issuer of a
   *   capability this endpoint obeys. Defaults to **empty**: an endpoint with no named
   *   authority denies every capability, rather than trusting whoever signs one.
   */
  constructor({
    identity,
    policy = Policy.denyAll(),
    trust = new TrustStore(),
    clock = () => new Date(),
    skewSeconds = DEFAULT_SKEW_SECONDS,
    replay = new ReplayGuard({ windowSeconds: MAX_TTL_SECONDS }),
    ledger = new UsageLedger(),
    revoked = [],
    capabilityIssuers = [],
  }) {
    if (!(identity?.keys instanceof KeyPair)) {
      throw new NexaError('NEXA_E_KEY', 'an endpoint needs an identity carrying a KeyPair');
    }
    this.identity = identity;
    this.policy = policy;
    this.trust = trust;
    this.clock = clock;
    this.skewSeconds = skewSeconds;
    this.replay = replay;
    this.ledger = ledger;
    this.revoked = revoked;
    if (!Array.isArray(capabilityIssuers)) {
      throw new NexaError('NEXA_E_CAP_INVALID', 'capabilityIssuers must be an array of key ids');
    }
    for (const kid of capabilityIssuers) assertKid(kid);
    /** @type {string[]} who may grant this endpoint authority. Empty means nobody. */
    this.capabilityIssuers = [...new Set(capabilityIssuers)].sort();
    this.evidence = new EvidenceLog({ actor: identity, clock });
    this.now = () => this.clock();
  }

  /** @returns {string} this endpoint's key id */
  get kid() {
    return this.identity.kid;
  }

  /**
   * Registers an in-memory handler. Handlers MUST stay pure with respect to the
   * outside world in v0.1 — no filesystem, no network, no processes.
   * @param {string} resource
   * @param {(request: {args: object, context: object}) => unknown} handler
   * @returns {Endpoint} this
   */
  registerHandler(resource, handler) {
    if (typeof handler !== 'function') {
      throw new NexaError('NEXA_E_HANDLER', `handler for ${resource} must be a function`);
    }
    this.#handlers.set(resource, handler);
    return this;
  }

  /** @param {string} resource @returns {boolean} */
  hasHandler(resource) {
    return this.#handlers.has(resource);
  }

  /** @returns {string[]} */
  resources() {
    return [...this.#handlers.keys()].sort();
  }

  /**
   * Builds an outbound CALL envelope. Note that this does not perform the call:
   * a CALL only becomes an effect when the peer decides to ALLOW it.
   * @param {object} input
   * @param {string} input.to
   * @param {string} input.resource
   * @param {string} [input.action]
   * @param {object} [input.args]
   * @param {object} [input.capability] token to present
   * @param {number} [input.ttlSeconds]
   * @returns {object} signed envelope
   */
  call({ to, resource, action = 'call', args = {}, capability, ttlSeconds }) {
    const body = {
      resource,
      action,
      args,
      ...(capability === undefined ? {} : { capability }),
    };
    const size = canonicalBytes(body).length;
    if (size > MAX_BODY_BYTES) {
      throw new NexaError('NEXA_E_SCHEMA', `request body of ${size} bytes exceeds the ${MAX_BODY_BYTES}-byte limit`);
    }
    return buildEnvelope({
      sender: this.identity,
      to,
      type: 'CALL',
      body,
      // `cap` is only the id: it binds the envelope to the token in the body, and
      // the receiver rejects any mismatch between the two.
      ...(capability === undefined ? {} : { capability: capability.id }),
      ...(ttlSeconds === undefined ? {} : { ttlSeconds }),
      now: this.now(),
    });
  }

  /**
   * Inbound path. Verifies, decides, records evidence, and returns a reply envelope.
   * @param {object} envelope
   * @param {object} [options]
   * @param {boolean} [options.execute] set false to evaluate without dispatch (dry run)
   * @returns {{decision: 'ALLOW'|'DENY'|'REJECTED', reply: object|null, record: object|null,
   *            receipt: object|null, code: string|null, value: unknown}}
   */
  receive(envelope, { execute = true } = {}) {
    const now = this.now();
    // --- 1. envelope crypto + freshness -------------------------------------
    try {
      verifyEnvelope(envelope, { now, skewSeconds: this.skewSeconds });
    } catch (cause) {
      const error = cause instanceof NexaError ? cause : new NexaError('NEXA_E_SCHEMA', String(cause));
      // Unauthenticated input never consumes replay slots and never gets a reply.
      return {
        decision: 'REJECTED',
        reply: null,
        record: null,
        receipt: null,
        code: error.code,
        value: null,
      };
    }

    // --- 2. recipient binding ----------------------------------------------
    if (envelope.to !== this.kid) {
      const record = this.evidence.append({
        kind: 'ENVELOPE_REJECTED',
        decision: 'DENY',
        subject: envelope.from,
        detail: { code: 'NEXA_E_UNTRUSTED', reason: 'envelope addressed to another endpoint', to: envelope.to },
      });
      return {
        decision: 'REJECTED',
        reply: null,
        record,
        receipt: null,
        code: 'NEXA_E_UNTRUSTED',
        value: null,
      };
    }

    // --- 3. replay ----------------------------------------------------------
    try {
      this.replay.commit(envelope, now);
    } catch (cause) {
      const error = cause;
      const record = this.evidence.append({
        kind: 'ENVELOPE_REJECTED',
        decision: 'DENY',
        subject: envelope.from,
        detail: { code: error.code, reason: error.message },
      });
      return this.#deny(envelope, error, { record, reply: false, now });
    }

    // --- 4. sender trust ----------------------------------------------------
    try {
      this.trust.require(envelope.from);
    } catch (cause) {
      const error = cause;
      const record = this.evidence.append({
        kind: 'PEER_REVOKED',
        decision: 'DENY',
        subject: envelope.from,
        detail: { code: error.code, reason: error.message },
      });
      return this.#deny(envelope, error, { record, now });
    }

    this.evidence.append({
      kind: 'ENVELOPE_ACCEPTED',
      decision: 'INFO',
      subject: envelope.from,
      detail: { id: envelope.id, type: envelope.type, nonce: envelope.nonce },
    });

    if (envelope.type === 'HELLO') {
      const record = this.evidence.append({
        kind: 'PEER_PINNED',
        decision: 'INFO',
        subject: envelope.from,
        detail: { note: 'identity presented; pinning still requires an explicit trust.pin() out of band' },
      });
      const reply = buildEnvelope({
        sender: this.identity,
        to: envelope.from,
        type: 'RESULT',
        body: {
          hello: this.identity.document === undefined
            ? { kid: this.kid, label: this.identity.label }
            : this.identity.document,
        },
        inReplyTo: envelope.id,
        now,
      });
      return { decision: 'ALLOW', reply, record, receipt: null, code: null, value: null };
    }

    if (envelope.type !== 'CALL') {
      const record = this.evidence.append({
        kind: 'ENVELOPE_REJECTED',
        decision: 'DENY',
        subject: envelope.from,
        detail: { code: 'NEXA_E_SCHEMA', reason: `inbound ${envelope.type} is not accepted in v0.1` },
      });
      return this.#deny(
        envelope,
        new NexaError('NEXA_E_SCHEMA', `inbound ${envelope.type} is not accepted in v0.1`),
        { record, now },
      );
    }

    const { resource, action, args } = envelope.body;

    // --- 4b. request shape ---------------------------------------------------
    // An envelope can be signed and still name a resource or action that the data
    // model does not allow. That is an authenticated fault, so it is a recorded
    // DENY with a receipt — never an exception escaping into the transport.
    let requestShape;
    try {
      requestShape = { resource: assertResource(resource), action: assertAction(action) };
    } catch (cause) {
      const error = cause instanceof NexaError ? cause : asNexaError(cause);
      const record = this.evidence.append({
        kind: 'ENVELOPE_REJECTED',
        decision: 'DENY',
        subject: envelope.from,
        detail: { code: error.code, reason: error.message },
      });
      return this.#deny(envelope, error, { record, now });
    }

    // --- 5. hard gates (before any policy rule) -----------------------------
    const gateVerdict = checkGates(requestShape);
    if (!gateVerdict.allowed) {
      const record = this.evidence.append({
        kind: 'GATE_BLOCKED',
        decision: 'DENY',
        subject: envelope.from,
        resource,
        action,
        ...(envelope.cap === undefined ? {} : { capability: envelope.cap }),
        detail: { gate: gateVerdict.gate, state: 'CLOSED', reason: gateVerdict.reason },
      });
      return this.#deny(
        envelope,
        new NexaError('NEXA_E_GATE', gateVerdict.reason, { gate: gateVerdict.gate }),
        { record, resource, action, now },
      );
    }

    // --- 6. capability ------------------------------------------------------
    let grant = null;
    // A capability is "carried" when either the envelope names one or the body
    // contains the token. Both are verified: the envelope field is a binding, not a
    // switch that can be omitted to skip verification.
    const carriedCapability = envelope.cap !== undefined || envelope.body?.capability !== undefined;
    if (carriedCapability) {
      try {
        // Resolving the token is part of verification: an envelope that references
        // a capability it does not carry is authenticated input, so it must produce
        // a recorded DENY, not an exception thrown at the transport layer.
        const token = this.#resolveCapability(envelope);
        const verified = verifyCapability(token, {
          // The capability must name the *presenter* as its holder, and its root must
          // come from an issuer this endpoint was told to obey. Both checks are
          // fail-closed: an endpoint with no named issuer obeys no capability.
          presenter: envelope.from,
          now,
          revoked: this.revoked,
          uses: (id) => this.ledger.used(id),
          action,
          resource,
          trustedIssuers: this.capabilityIssuers,
        });
        grant = verified.grant;
        this.evidence.append({
          kind: 'CAPABILITY_VERIFIED',
          decision: 'INFO',
          subject: envelope.from,
          resource,
          action,
          capability: token.id,
          detail: {
            depth: grant.depth,
            chain: grant.chain,
            remaining_uses: grant.remaining_uses,
            exp: grant.exp,
          },
        });
      } catch (cause) {
        const error = cause instanceof NexaError ? cause : new NexaError('NEXA_E_CAP_INVALID', String(cause));
        const record = this.evidence.append({
          kind: 'CAPABILITY_REJECTED',
          decision: 'DENY',
          subject: envelope.from,
          resource,
          action,
          capability: envelope.cap,
          detail: { code: error.code, reason: error.message },
        });
        return this.#deny(envelope, error, { record, resource, action, now });
      }
    } else {
      this.evidence.append({
        kind: 'CAPABILITY_REJECTED',
        decision: 'INFO',
        subject: envelope.from,
        resource,
        action,
        detail: { code: 'NEXA_E_CAP_MISSING', reason: 'no capability presented' },
      });
    }

    // --- 7. policy ----------------------------------------------------------
    let verdict;
    try {
      verdict = this.policy.evaluate({
        resource,
        action,
        subject: envelope.from,
        capability: grant ?? undefined,
        signals: { signed: true, type: envelope.type },
      });
    } catch (cause) {
      const error = cause instanceof NexaError ? cause : asNexaError(cause, 'NEXA_E_POLICY');
      const record = this.evidence.append({
        kind: 'POLICY_DECISION',
        decision: 'DENY',
        subject: envelope.from,
        resource,
        action,
        detail: { code: error.code, reason: error.message },
      });
      return this.#deny(envelope, error, { record, resource, action, now });
    }
    const policyRecord = this.evidence.append({
      kind: 'POLICY_DECISION',
      decision: verdict.effect,
      subject: envelope.from,
      resource,
      action,
      ...(envelope.cap === undefined ? {} : { capability: envelope.cap }),
      detail: { rule: verdict.rule, policy: verdict.policy, reason: verdict.reason },
    });
    if (verdict.effect !== 'ALLOW') {
      return this.#deny(
        envelope,
        new NexaError('NEXA_E_POLICY', verdict.reason, { rule: verdict.rule, policy: verdict.policy }),
        { record: policyRecord, resource, action, now },
      );
    }

    // --- 8. handler ---------------------------------------------------------
    const handler = this.#handlers.get(resource) ?? NO_HANDLER;
    if (handler === NO_HANDLER) {
      const record = this.evidence.append({
        kind: 'HANDLER_RESULT',
        decision: 'DENY',
        subject: envelope.from,
        resource,
        action,
        detail: { code: 'NEXA_E_NO_HANDLER', reason: 'no handler is registered for this resource' },
      });
      return this.#deny(
        envelope,
        new NexaError('NEXA_E_NO_HANDLER', `no handler registered for ${resource}`),
        { record, resource, action, now },
      );
    }

    if (!this.#withinConstraints(grant, args)) {
      const record = this.evidence.append({
        kind: 'HANDLER_RESULT',
        decision: 'DENY',
        subject: envelope.from,
        resource,
        action,
        detail: { code: 'NEXA_E_POLICY', reason: 'arguments exceed the capability constraints' },
      });
      return this.#deny(
        envelope,
        new NexaError('NEXA_E_POLICY', 'arguments exceed the constraints granted by the capability'),
        { record, resource, action, now },
      );
    }

    let value;
    try {
      value = execute
        ? handler({ args, context: { sender: envelope.from, capability: grant, envelope } })
        : { dry_run: true };
      canonicalBytes(value ?? {});
    } catch (cause) {
      const record = this.evidence.append({
        kind: 'HANDLER_RESULT',
        decision: 'DENY',
        subject: envelope.from,
        resource,
        action,
        detail: { code: 'NEXA_E_HANDLER', reason: String(cause?.message ?? cause) },
      });
      return this.#deny(
        envelope,
        new NexaError('NEXA_E_HANDLER', 'handler failed', { reason: String(cause?.message ?? cause) }),
        { record, resource, action, now },
      );
    }

    // Spend the budget only after the handler produced a value, and only for
    // executed calls: a dry run must not consume authority.
    if (execute && carriedCapability) {
      const token = envelope.body.capability;
      const links = chainLinks(token); // child-first
      this.ledger.spend(
        links.map((link) => link.id),
        links.map((link) => link.caveats),
      );
    }

    const record = this.evidence.append({
      kind: 'HANDLER_RESULT',
      decision: 'ALLOW',
      subject: envelope.from,
      resource,
      action,
      ...(envelope.cap === undefined ? {} : { capability: envelope.cap }),
      detail: { status: 'ok', dry_run: !execute },
    });
    const receipt = createReceipt({ record, actor: this.identity, chainHead: this.evidence.head.hash, ts: formatInstant(now) });
    const reply = buildEnvelope({
      sender: this.identity,
      to: envelope.from,
      type: 'RESULT',
      body: { ok: true, value: value ?? null, ref: record.hash, receipt },
      inReplyTo: envelope.id,
      now,
    });
    return { decision: 'ALLOW', reply, record, receipt, code: null, value: value ?? null };
  }

  /**
   * Signs this endpoint's identity document, ready for a peer to pin.
   * @param {object} document
   * @returns {object} signed HELLO envelope
   */
  hello(to) {
    return buildEnvelope({
      sender: this.identity,
      to,
      type: 'HELLO',
      body: { identity: this.identity.document },
      now: this.now(),
    });
  }

  /** @returns {object} machine-readable posture of this endpoint */
  describe() {
    return {
      kid: this.kid,
      label: this.identity.identity?.label ?? this.identity.label ?? 'endpoint',
      policy: this.policy.toJSON(),
      resources: this.resources(),
      trusted_peers: this.trust.list(),
      capability_issuers: [...this.capabilityIssuers],
      evidence_length: this.evidence.length,
      evidence_head: this.evidence.head?.hash ?? null,
      ledger: this.ledger.snapshot(),
      replay_window: this.replay.size,
    };
  }

  /**
   * Asserts that a capability is present and returns it. v0.1 transports the
   * token inside the CALL body under `capability`; the envelope `cap` field is
   * the *id* only, so a mismatch between the two is a hard error.
   * @param {object} envelope
   * @returns {object} token
   */
  #resolveCapability(envelope) {
    const token = envelope.body?.capability;
    if (token === undefined || typeof token !== 'object') {
      throw new NexaError('NEXA_E_CAP_MISSING', 'envelope references a capability but carries no token', {
        cap: envelope.cap,
      });
    }
    if (envelope.cap !== undefined && token.id !== envelope.cap) {
      throw new NexaError('NEXA_E_CAP_INVALID', 'envelope capability id does not match the attached token', {
        envelope_cap: envelope.cap,
        token_id: token.id,
      });
    }
    return token;
  }

  /** @param {object|null} grant @param {object} args */
  #withinConstraints(grant, args) {
    const bytes = canonicalBytes(args ?? {}).length;
    if (bytes > MAX_BODY_BYTES) return false;
    if (grant === null) return true;
    const limit = grant.constraints?.max_args_bytes;
    if (typeof limit === 'number' && bytes > limit) return false;
    return true;
  }

  /**
   * Builds a DENY reply, records the receipt, and returns the decision object.
   * @param {object} envelope
   * @param {NexaError} error
   * @param {{record?: object, resource?: string, action?: string, reply?: boolean}} [options]
   */
  #deny(envelope, error, { record, resource, action, reply = true, now } = {}) {
    const at = now ?? this.now();
    const receipt = record === undefined
      ? null
      : createReceipt({ record, actor: this.identity, chainHead: this.evidence.head.hash, ts: formatInstant(at) });
    let outbound = null;
    if (reply) {
      outbound = buildEnvelope({
        sender: this.identity,
        to: envelope.from,
        type: 'DENY',
        body: {
          code: error.code,
          message: error.message,
          ...(error.details === undefined ? {} : { details: error.details }),
          ...(receipt === null ? {} : { receipt }),
        },
        inReplyTo: envelope.id,
        now: at,
      });
    }
    return {
      decision: reply ? 'DENY' : 'REJECTED',
      reply: outbound,
      record: record ?? null,
      receipt,
      code: error.code,
      value: null,
      resource,
      action,
    };
  }
}

/**
 * @param {object} token
 * @returns {object[]} chain links, child first
 */
function chainLinks(token) {
  const links = [];
  let cursor = token;
  for (;;) {
    links.push(cursor);
    if (cursor.proof.kind !== 'chain') return links;
    cursor = cursor.proof.parent;
  }
}

export { chainLinks };
