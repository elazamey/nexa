/**
 * The authority — the only thing in Ω that can create permission.
 *
 * A compiled module contains *grants*: templates describing what the authority is
 * willing to mint, for whom, for how long and how often. When a mission reaches a call
 * site it asks here, and here either mints the smallest token the kernel will accept or
 * refuses. The runtime holds no keys and no ability to mint: it can ask, and be told no.
 */
import { formatInstant } from '../../ast/index.js';
import { KeyPair } from '../../crypto/index.js';
import { mintCapability } from '../../capability/index.js';
import { OmegaError, coversResource } from '../../compiler/index.js';

/** The largest token this authority will ever mint, whatever a grant says. */
export const MAX_TOKEN_TTL_MS = 300_000;
export const DEFAULT_MAX_ARGS_BYTES = 4096;

export class Authority {
  #usage = new Map();

  /**
   * @param {object} input
   * @param {{keys: KeyPair, kid: string}} input.operator the identity allowed to mint
   * @param {object[]} input.grants compiled grant templates (`ir.grants`)
   * @param {() => Date} [input.clock]
   * @param {Record<string, boolean>|((grant: object) => boolean)} [input.approvals]
   * @param {number} [input.maxArgsBytes]
   */
  constructor({ operator, grants, clock = () => new Date(), approvals = {}, maxArgsBytes = DEFAULT_MAX_ARGS_BYTES }) {
    if (!(operator?.keys instanceof KeyPair)) {
      throw new OmegaError('OMEGA_E_GRANT_MISSING', 'the authority needs an operator identity with a KeyPair');
    }
    if (!Array.isArray(grants)) throw new OmegaError('OMEGA_E_SCHEMA', 'grants must be an array');
    this.operator = operator;
    // Grants arrive either as compiled IR (`ttl_ms`, `max_calls`) or as hand-written
    // host configuration (`ttlMs`, `maxCalls`); both are normalised here, once.
    this.grants = grants.map((grant) => {
      const ttlMs = grant.ttlMs ?? grant.ttl_ms ?? 0;
      const maxCalls = grant.maxCalls ?? grant.max_calls ?? 1;
      if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) {
        throw new OmegaError('OMEGA_E_SCHEMA', `grant ${grant.name} needs a positive ttl`);
      }
      if (!Number.isSafeInteger(maxCalls) || maxCalls <= 0) {
        throw new OmegaError('OMEGA_E_SCHEMA', `grant ${grant.name} needs a positive max_calls`);
      }
      return {
        ...grant,
        actions: [...grant.actions],
        ttlMs,
        maxCalls,
        requiresApproval: grant.requiresApproval === true || (grant.approval !== undefined && grant.approval !== null),
      };
    });
    this.clock = clock;
    this.approvals = approvals;
    this.maxArgsBytes = maxArgsBytes;
  }

  /** @param {object} grant @returns {boolean} */
  #approved(grant) {
    if (typeof this.approvals === 'function') return this.approvals(grant) === true;
    return this.approvals?.[grant.name] === true || this.approvals?.[grant.id] === true;
  }

  /**
   * Would the authority mint for this call? Pure: no budget is spent, no token is made.
   * @param {{agent: string, resource: string, action: string, spend?: boolean}} input
   * @returns {{ok: true, grant: object} | {ok: false, code: string, reason: string}}
   */
  canIssue({ agent, resource, action, spend = false }) {
    const candidates = this.grants.filter((grant) => (
      (grant.subject === 'any' || grant.subject === agent)
      && grant.actions.includes(action)
      && coversResource(grant.resource, resource).ok
    ));
    if (candidates.length === 0) {
      return {
        ok: false,
        code: 'OMEGA_E_GRANT_MISSING',
        reason: `no grant lets ${agent} ${action} ${resource}`,
      };
    }
    const grant = candidates.find((candidate) => this.#approved(candidate)) ?? candidates[0];
    if (grant.requiresApproval && !this.#approved(grant)) {
      return {
        ok: false,
        code: 'OMEGA_E_APPROVAL_REQUIRED',
        reason: `grant ${grant.name} requires approval(${grant.approval}), which has not been supplied`,
      };
    }
    const used = this.#usage.get(grant.id) ?? 0;
    if (used >= grant.maxCalls) {
      return {
        ok: false,
        code: 'OMEGA_E_BUDGET',
        reason: `grant ${grant.name} has minted its budget of ${grant.maxCalls} token(s)`,
      };
    }
    if (spend) this.#usage.set(grant.id, used + 1);
    return { ok: true, grant };
  }

  /**
   * Mints one token for exactly this call.
   * @param {{agent: string, agentKid: string, resource: string, action: string, args?: object}} input
   * @returns {{token: object, grant: object, expires: string}}
   */
  issue({ agent, agentKid, resource, action, args = {} }) {
    const verdict = this.canIssue({ agent, resource, action, spend: true });
    if (!verdict.ok) throw new OmegaError(verdict.code, verdict.reason, { agent, resource, action });
    const grant = verdict.grant;
    const now = this.clock();
    const ttl = Math.min(grant.ttlMs, MAX_TOKEN_TTL_MS);
    const token = mintCapability({
      issuer: this.operator,
      subject: agentKid,
      resource,
      actions: [action],
      caveats: {
        nbf: formatInstant(now),
        exp: formatInstant(new Date(now.getTime() + ttl)),
        max_uses: 1,
        max_depth: 0,
      },
      constraints: { max_args_bytes: this.maxArgsBytes },
      now,
      note: `omega:${grant.name}`,
    });
    return { token, grant, expires: formatInstant(new Date(now.getTime() + ttl)), args_bytes: JSON.stringify(args).length };
  }

  /** @returns {object[]} per-grant usage, for a report */
  usage() {
    return this.grants.map((grant) => ({
      id: grant.id,
      name: grant.name,
      resource: grant.resource,
      actions: grant.actions.join(','),
      subject: grant.subject,
      minted: this.#usage.get(grant.id) ?? 0,
      max_calls: grant.maxCalls,
      approval: grant.approval,
    }));
  }
}
