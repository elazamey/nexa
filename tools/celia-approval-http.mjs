/**
 * tools/celia-approval-http.mjs — D1.10 / P0-B layer 4: the approval *decision*
 * contract on the HTTP boundary.
 *
 * What was wrong (O02, and the reason a green 597-test suite did not prove
 * anything): the route treated a `POST …/approve` as a human decision because it
 * could fill the blanks itself —
 *
 *   const approverKid = args.approverKid ?? dashboardOperator.kid;   // default identity
 *   approvalLedger.approve({ approvalId, scope: args.scope ?? 'once' }) // default scope
 *
 * so an empty JSON body became "the trusted operator approved this once". That is
 * the inversion this module forbids: *absence of a decision must not decode into
 * a decision*. Two more defects lived in the same lines: the path segment was
 * never percent-decoded (the SPA always encodes; the ledger keys on the raw id ⇒
 * every dashboard approve was a 400), and nothing signed the decision, so the
 * ledger could not tell an operator's yes from a stranger's yes.
 *
 * The contract now, in one place:
 *
 *   approve / deny  →  decode the id  →  explicit approverKid  →  explicit scope
 *                     →  signature over the canonical decision bytes  →  ledger
 *   consume         →  decode the id only (spending a granted approval is not the
 *                     grant; the ledger already enforces tuple/target/mission/TTL)
 *   sign            →  sign a proposal the caller named, mutate nothing
 *
 * The signature domain mirrors the protocol's own convention (a versioned prefix
 * + NEXA-C14N canonical bytes), so a signature cannot be replayed across verbs,
 * approvals, scopes or reasons: every field is inside what was signed.
 *
 * Layering: the perimeter (layers 1-2) says *who is calling*; this module says
 * *what they decided*. Both are needed and neither substitutes for the other —
 * an authenticated caller still cannot approve without a signed decision, and a
 * perfectly signed decision from an untrusted kid is still refused by the ledger.
 * Only packages/ast (canonicalization) and packages/crypto (verification) are
 * imported: no kernel file is modified, and no policy rule is invented here.
 */
import { canonicalBytes } from '../packages/ast/index.js';
import { verifyWithKeyId } from '../packages/crypto/index.js';

/** Domain separation: never sign bare JSON, never reuse another version's bytes. */
export const APPROVAL_DECISION_DOMAIN = 'nexa:approval-decision:v1\n';

export const APPROVAL_ROUTE_RE = /^\/api\/v1\/authorizations\/([^/]+)\/(approve|deny|consume|sign)$/;
/** Same charset hygiene as every other id on this boundary: no traversal, no controls. */
const SAFE_ID_RE = /^[^/\\\u0000-\u001F\u007F\u202A-\u202E]{1,256}$/;
export const MAX_REASON_LENGTH = 512;
export const VERBS = Object.freeze(['approve', 'deny', 'consume', 'sign']);
/** Decision verbs require a signature; transport verbs never do. */
const SIGNED_VERBS = new Set(['approve', 'deny']);
const SCOPES = new Set(['once', 'mission']);

/** 4xx with a machine-readable NEXA code — the route maps it straight to a DENY. */
export class ApprovalContractError extends Error {
  /** @param {string} code a code from packages/ast ERROR_CODES (nothing invented) */
  constructor(code, message, { status = 400 } = {}) {
    super(message);
    this.name = 'ApprovalContractError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Path segment → approval id. Percent-encoded and raw forms resolve to the SAME
 * id (that is what makes the SPA's `encodeURIComponent` legal), and a malformed
 * escape is refused instead of being smuggled into a ledger lookup.
 * @returns {{approvalId: string, verb: string}}
 */
export function parseApprovalRoute(pathname) {
  const match = APPROVAL_ROUTE_RE.exec(String(pathname ?? ''));
  if (!match) {
    throw new ApprovalContractError('NEXA_E_SCHEMA', 'unknown authorization route', { status: 404 });
  }
  let approvalId;
  try {
    approvalId = decodeURIComponent(match[1]);
  } catch {
    throw new ApprovalContractError('NEXA_E_SCHEMA', 'malformed percent-encoding in approval id');
  }
  if (!SAFE_ID_RE.test(approvalId)) {
    throw new ApprovalContractError('NEXA_E_SCHEMA', 'approval id must be a single safe path segment');
  }
  return { approvalId, verb: match[2] };
}

/** The exact bytes a decision commits to. Exported so clients sign the same thing. */
export function decisionBytes({ approvalId, verb, scope = null, approverKid, reason = null }) {
  const body = canonicalBytes({
    approvalId,
    verb,
    // A deny has no scope; normalising it here keeps one canonical byte string
    // per *decision* rather than per spelling of the request body.
    scope: verb === 'approve' ? scope : null,
    approverKid,
    reason,
  });
  return Buffer.concat([Buffer.from(APPROVAL_DECISION_DOMAIN, 'utf8'), body]);
}

/**
 * @param {{keys: {sign(data: Buffer): string}, kid: string}} operator
 * @returns {{payload: object, bytes: Buffer, signature: string, approverKid: string}}
 */
export function signApprovalDecision({ operator, approvalId, verb, scope = null, reason = null }) {
  if (!operator?.keys || typeof operator.keys.sign !== 'function' || typeof operator.kid !== 'string') {
    throw new ApprovalContractError('NEXA_E_KEY', 'no operator key available to sign this decision');
  }
  const payload = { approvalId, verb, scope, approverKid: operator.kid, reason };
  const bytes = decisionBytes(payload);
  return { payload, bytes, signature: operator.keys.sign(bytes), approverKid: operator.kid };
}

/** Signature is verified against the *presented* kid; ledger trust is a separate step. */
export function verifyApprovalDecision(payload, signature) {
  if (typeof signature !== 'string' || signature.length === 0) return false;
  try {
    return verifyWithKeyId(decisionBytes(payload), signature, payload.approverKid) === true;
  } catch {
    return false;
  }
}

function requireKid(value) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApprovalContractError(
      'NEXA_E_SCHEMA',
      'approverKid is required: a decision never inherits an identity by default',
    );
  }
  return value.trim();
}

function readReason(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') {
    throw new ApprovalContractError('NEXA_E_SCHEMA', 'reason must be a string or null');
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_REASON_LENGTH) {
    throw new ApprovalContractError('NEXA_E_SCHEMA', `reason must be at most ${MAX_REASON_LENGTH} chars`);
  }
  return trimmed;
}

function readScope(value, verb) {
  if (verb === 'deny') {
    if (value !== undefined && value !== null) {
      throw new ApprovalContractError('NEXA_E_SCHEMA', 'deny carries no scope');
    }
    return null;
  }
  if (typeof value !== 'string' || !SCOPES.has(value)) {
    throw new ApprovalContractError(
      'NEXA_E_SCHEMA',
      "scope is required for approve and must be 'once' or 'mission' — an omitted scope is not a grant",
    );
  }
  return value;
}

/**
 * Full decision resolution for approve/deny: decode → explicit identity →
 * explicit scope → signature over the canonical bytes. Throws
 * ApprovalContractError (400 DENY) on any deviation; returns the arguments the
 * ledger is called with and nothing else.
 *
 * @param {{approvalId: string, verb: string}} route
 * @param {unknown} body parsed JSON body
 */
export function resolveApprovalDecision({ approvalId, verb }, body) {
  if (!SIGNED_VERBS.has(verb)) {
    throw new ApprovalContractError('NEXA_E_SCHEMA', `${verb} is not a signed decision verb`);
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApprovalContractError('NEXA_E_SCHEMA', 'a JSON object body is required');
  }
  const approverKid = requireKid(body.approverKid);
  const scope = readScope(body.scope, verb);
  const reason = readReason(body.reason);
  const payload = { approvalId, verb, scope, approverKid, reason };
  if (typeof body.signature !== 'string' || body.signature.length === 0) {
    throw new ApprovalContractError(
      'NEXA_E_SIG',
      'an approval decision must be signed by the approver it claims — an unsigned body is not a yes',
    );
  }
  if (!verifyApprovalDecision(payload, body.signature)) {
    throw new ApprovalContractError(
      'NEXA_E_SIG',
      `signature does not commit to this exact ${verb} decision (id/verb/scope/approver/reason)`,
    );
  }
  return { approvalId, verb, approverKid, scope, reason };
}

/** Body shape for the signing oracle: what the human says they decided. */
export function readSignProposal(body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApprovalContractError('NEXA_E_SCHEMA', 'a JSON object body is required');
  }
  const decision = body.decision ?? 'approve';
  if (decision !== 'approve' && decision !== 'deny') {
    throw new ApprovalContractError('NEXA_E_SCHEMA', "decision must be 'approve' or 'deny'");
  }
  return { verb: decision, scope: readScope(body.scope, decision), reason: readReason(body.reason) };
}

/** Ledger-side consumption: decode only, all bindings enforced in packages/policy. */
export function resolveApprovalConsumption({ approvalId }, body) {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApprovalContractError('NEXA_E_SCHEMA', 'a JSON object body is required');
  }
  return {
    approvalId,
    resource: body.resource,
    action: body.action,
    target: body.target,
    missionId: body.missionId ?? null,
  };
}
