/**
 * Verifier-side evidence for COMMIT fixtures (docs/agent-loop.md).
 *
 * The verifier is a key distinct from the committing principal. It records a
 * real-runtime HANDLER_RESULT/ALLOW bound to the exact commit resource and
 * change-set hash. This is the ONLY thing that can turn a COMMIT claim into PASS.
 */
import { EvidenceLog } from '../packages/evidence/index.js';
import { workspaceCommitResource } from '../tools/celia-workspace-commit-auth.mjs';

export function verifierEvidence({ verifier, subject, input, source = 'real', decision = 'ALLOW', detail = {} }) {
  const log = new EvidenceLog({ actor: verifier });
  const resource = workspaceCommitResource(input);
  log.append({ kind: 'POLICY_DECISION', decision: 'ALLOW', subject, resource, action: 'commit', detail: { stage: 'AUTHORIZE' } });
  log.append({
    kind: decision === 'ALLOW' ? 'HANDLER_RESULT' : 'GATE_BLOCKED', decision, subject, resource, action: 'commit',
    detail: { stage: 'TEST', changeSetHash: input.changeSetHash, expectedBaseHash: input.expectedBaseHash, ...detail },
  });
  return { source, records: log.entries() };
}
