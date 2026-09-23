/** Tools-layer COMMIT authorization; requires durable reservation, no core gate changes. */
import { assertKid, canonicalBytes } from '../packages/ast/index.js';
import { sha256, sha256Multihash } from '../packages/crypto/index.js';
import { verifyCapability } from '../packages/capability/index.js';
import { Policy } from '../packages/policy/index.js';
import { chainLinks, ReplayGuard, UsageLedger, verifyEnvelope } from '../packages/protocol/index.js';

export class WorkspaceCommitError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}
export const denyCommit = code => { throw new WorkspaceCommitError(403, code); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const HASH = /^sha256:[A-Za-z0-9_-]{43}$/;

export function workspaceCommitResource({ workspaceId, targetRoot }) {
  return `workspace_commit:${sha256(canonicalBytes({ workspaceId, targetRoot })).toString('hex')}`;
}
export function workspaceCommitIntent({ workspaceId, targetRoot, changeSetHash, expectedBaseHash }) {
  return { method: 'POST', route: '/api/v1/workspace/commit', workspaceId, targetRoot, changeSetHash, expectedBaseHash };
}
export function workspaceCommitConstraints({ workspaceId, targetRoot, changeSetHash, expectedBaseHash }) {
  return { workspace_id: workspaceId, target_root: targetRoot, change_set_hash: changeSetHash, expected_base_hash: expectedBaseHash };
}

export function createWorkspaceCommitAuthorizer(config = {}, { consumeDurably } = {}) {
  if (!object(config) || Object.keys(config).some(key => !['audience', 'capabilityIssuers', 'rules', 'verification'].includes(key))) {
    throw new Error('Invalid COMMIT authorization configuration');
  }
  const { audience, capabilityIssuers = [], rules = [] } = config;
  if (audience !== undefined) assertKid(audience);
  if (!Array.isArray(capabilityIssuers) || !Array.isArray(rules)) throw new Error('COMMIT issuers/rules must be arrays');
  for (const kid of capabilityIssuers) assertKid(kid);
  const issuers = [...capabilityIssuers];
  const policy = new Policy({ rules: structuredClone(rules) });
  const replay = new ReplayGuard();
  const ledger = new UsageLedger();

  return function authorize(input) {
    if (!object(input) || !input.authorization) throw new WorkspaceCommitError(401, 'COMMIT_IDENTITY_REQUIRED');
    const envelope = input.authorization;
    const now = new Date();
    try {
      verifyEnvelope(envelope, { now, skewSeconds: 0, allowedTypes: ['CALL'] });
    } catch { throw new WorkspaceCommitError(401, 'COMMIT_IDENTITY_INVALID'); }
    if (!audience || envelope.to !== audience) denyCommit('COMMIT_AUDIENCE_DENIED');
    if (envelope.body.action !== 'commit') denyCommit('COMMIT_OPERATION_DENIED');
    // `evidence` is carried, not signed into the intent: it is judged separately
    // by the verification gate against trusted verifier keys (see commit port).
    if (Object.keys(input).some(key => !['workspaceId', 'targetRoot', 'changeSetHash', 'expectedBaseHash', 'authorization', 'evidence'].includes(key))
        || typeof input.workspaceId !== 'string' || !/^ws_[A-Za-z0-9_-]{1,160}$/.test(input.workspaceId)
        || ![input.targetRoot, input.changeSetHash, input.expectedBaseHash].every(value => typeof value === 'string' && HASH.test(value))) {
      throw new WorkspaceCommitError(400, 'COMMIT_INPUT_INVALID');
    }
    const intent = workspaceCommitIntent(input);
    const resource = workspaceCommitResource(input);
    if (envelope.body.resource !== resource || !canonicalBytes(envelope.body.args ?? null).equals(canonicalBytes(intent))) {
      denyCommit('COMMIT_INTENT_MISMATCH');
    }
    const token = envelope.body.capability;
    if (!token || token.id !== envelope.cap) denyCommit('COMMIT_CAPABILITY_REQUIRED');
    let grant;
    try {
      ({ grant } = verifyCapability(token, {
        now, presenter: envelope.from, trustedIssuers: issuers,
        resource, action: 'commit', uses: id => ledger.used(id),
      }));
    } catch { denyCommit('COMMIT_CAPABILITY_DENIED'); }
    if (grant.resource !== resource || token.caveats.max_uses !== 1 || token.caveats.max_depth !== 0
        || !canonicalBytes(grant.constraints).equals(canonicalBytes(workspaceCommitConstraints(input)))) {
      denyCommit('COMMIT_SCOPE_OR_STATE_DENIED');
    }
    const verdict = policy.evaluate({ subject: envelope.from, resource, action: 'commit', capability: grant, signals: { signed: true } });
    if (verdict.effect !== 'ALLOW') denyCommit('COMMIT_POLICY_DENIED');
    if (replay.hasSeen(envelope)) denyCommit('COMMIT_REPLAY_DENIED');

    return {
      subject: envelope.from, capabilityId: token.id, rule: verdict.rule,
      authorizationRef: sha256Multihash(canonicalBytes(envelope)),
      // Called only after all files/base hashes pass, immediately before writing.
      // Disk reservation is authoritative across restarts; memory is only a cache.
      consume() {
        try {
          const at = new Date();
          verifyEnvelope(envelope, { now: at, skewSeconds: 0, allowedTypes: ['CALL'] });
          verifyCapability(token, {
            now: at, presenter: envelope.from, trustedIssuers: issuers,
            resource, action: 'commit', uses: id => ledger.used(id),
          });
          if (typeof consumeDurably !== 'function') throw new WorkspaceCommitError(503, 'COMMIT_DURABLE_STATE_REQUIRED');
          consumeDurably(envelope);
          replay.commit(envelope, at);
          const links = chainLinks(token);
          ledger.spend(links.map(link => link.id), links.map(link => link.caveats));
        } catch (error) {
          if (error instanceof WorkspaceCommitError) throw error;
          denyCommit('COMMIT_REPLAY_OR_BUDGET_DENIED');
        }
      },
    };
  };
}
