/**
 * Authorization for the existing Celia HTTP staging writer ONLY.
 * This is a tools-layer boundary, not Endpoint dispatch and not permission to
 * open NEXA's CLOSED filesystem gate. No filesystem access occurs in this module.
 * Server-owned configuration defaults to no trusted issuers and no ALLOW rules.
 */
import { assertKid, canonicalBytes } from '../packages/ast/index.js';
import { sha256, sha256Multihash } from '../packages/crypto/index.js';
import { verifyCapability } from '../packages/capability/index.js';
import { Policy } from '../packages/policy/index.js';
import { chainLinks, ReplayGuard, UsageLedger, verifyEnvelope } from '../packages/protocol/index.js';

export class WorkspaceWriteError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

const reject = (status, code) => { throw new WorkspaceWriteError(status, code); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// A capability for one workspace/path cannot authorize another file/workspace.
export function workspaceWriteResource(workspaceId, path) {
  return `workspace:${sha256(canonicalBytes({ workspaceId, path })).toString('hex')}`;
}

export function workspaceWriteIntent({ workspaceId, path, content }) {
  return { method: 'POST', route: '/api/v1/workspace/write', workspaceId, path, content };
}

export function createWorkspaceWriteAuthorizer(config = {}) {
  if (!isObject(config) || Object.keys(config).some(key => !['audience', 'capabilityIssuers', 'rules'].includes(key))) {
    throw new Error('Invalid workspace write authorization configuration');
  }
  const { audience, capabilityIssuers = [], rules = [] } = config;
  if (audience !== undefined) assertKid(audience);
  if (!Array.isArray(capabilityIssuers) || !Array.isArray(rules)) {
    throw new Error('Workspace write issuers and rules must be arrays');
  }
  for (const kid of capabilityIssuers) assertKid(kid);
  const issuers = [...capabilityIssuers];
  const policy = new Policy({ rules: structuredClone(rules) });
  const replay = new ReplayGuard();
  const ledger = new UsageLedger();

  return function authorize(input) {
    // A name, bearer string or arbitrary evidenceRef is not proof of identity.
    if (!isObject(input) || !input.authorization) reject(401, 'WORKSPACE_IDENTITY_REQUIRED');
    const envelope = input.authorization;
    const now = new Date();
    try {
      verifyEnvelope(envelope, { now, skewSeconds: 0, allowedTypes: ['CALL'] });
    } catch {
      reject(401, 'WORKSPACE_IDENTITY_INVALID');
    }
    if (!audience || envelope.to !== audience) reject(403, 'WORKSPACE_AUDIENCE_DENIED');

    if (Object.keys(input).some(key => !['workspaceId', 'path', 'content', 'authorization'].includes(key))) {
      reject(400, 'WORKSPACE_INPUT_INVALID');
    }
    const { workspaceId, path, content } = input;
    // Do not authorize an ambiguous path that the legacy port would normalize.
    if (typeof workspaceId !== 'string' || !/^ws_[A-Za-z0-9_-]{1,160}$/.test(workspaceId)
        || typeof path !== 'string' || path.length > 512
        || !path.split('/').every(segment => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(segment))
        || typeof content !== 'string') {
      reject(400, 'WORKSPACE_INPUT_INVALID');
    }
    const resource = workspaceWriteResource(workspaceId, path);
    const intent = workspaceWriteIntent(input);
    const body = envelope.body;
    if (body.resource !== resource || body.action !== 'write'
        || !canonicalBytes(body.args ?? null).equals(canonicalBytes(intent))) {
      reject(403, 'WORKSPACE_OPERATION_MISMATCH');
    }
    const token = body.capability;
    if (!token || envelope.cap !== token.id) reject(403, 'WORKSPACE_CAPABILITY_REQUIRED');

    let grant;
    try {
      ({ grant } = verifyCapability(token, {
        presenter: envelope.from, trustedIssuers: issuers, resource, action: 'write',
        now, uses: id => ledger.used(id),
      }));
    } catch {
      reject(403, 'WORKSPACE_CAPABILITY_DENIED');
    }
    // Initial contract requires an exact file grant; no namespace-wide write.
    if (grant.resource !== resource) reject(403, 'WORKSPACE_SCOPE_DENIED');
    const constraints = grant.constraints;
    if (Object.keys(constraints).some(key => key !== 'max_args_bytes')) {
      reject(403, 'WORKSPACE_CONSTRAINT_DENIED');
    }
    if (constraints.max_args_bytes !== undefined
        && (!Number.isSafeInteger(constraints.max_args_bytes) || constraints.max_args_bytes < 1
          || canonicalBytes(intent).length > constraints.max_args_bytes)) {
      reject(403, 'WORKSPACE_CONSTRAINT_DENIED');
    }
    const verdict = policy.evaluate({
      subject: envelope.from, resource, action: 'write', capability: grant, signals: { signed: true },
    });
    if (verdict.effect !== 'ALLOW') reject(403, 'WORKSPACE_POLICY_DENIED');

    // Reserve synchronously BEFORE the first await/IO: concurrent calls cannot
    // reuse an envelope or overspend a token. Failed IO conservatively spends it.
    try {
      replay.commit(envelope, now);
      const links = chainLinks(token);
      ledger.spend(links.map(link => link.id), links.map(link => link.caveats));
    } catch {
      reject(403, 'WORKSPACE_REPLAY_OR_BUDGET_DENIED');
    }
    return {
      subject: envelope.from, capabilityId: token.id, rule: verdict.rule,
      // Digest of the verified signed request, NOT a fabricated evidence receipt.
      authorizationRef: sha256Multihash(canonicalBytes(envelope)),
    };
  };
}
