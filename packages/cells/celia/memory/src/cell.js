/**
 * Celia Memory Cell — NEXA-compliant memory with digest-only storage
 * 
 * This cell does NOT import Supabase directly. It receives a `store` port
 * that is injected by the host. The port itself may talk to Supabase,
 * but the cell only proposes.
 * 
 * Receptors: remember, recall, forget, health, recover
 * Nucleus: memory@1, invariants: ["digest-only", "evidence-bound", "capability-gated"]
 */

import { OmegaError } from '../../../../compiler/index.js';

export const MEMORY_TIERS = Object.freeze(['episodic', 'semantic', 'working', 'longterm']);
export const MEMORY_KINDS = Object.freeze(['remember', 'recall', 'forget']);

export function createMemoryCell({ identity, nucleus, storePort, ledger }) {
  if (!identity) throw new OmegaError('OMEGA_E_IDENTITY', 'memory cell needs identity');
  if (!storePort || typeof storePort.write !== 'function') {
    throw new OmegaError('OMEGA_E_MEMBRANE', 'memory cell needs storePort { write, read, delete }');
  }

  const state = {
    writes: 0,
    reads: 0,
    digests: new Set(),
  };

  return {
    id: identity.kid,
    nucleus,
    receptors: {
      async remember({ payload, capability, evidenceRef }) {
        // Membrane: identity → capability → type → policy → budget → execution → evidence
        // 1. Capability already verified by membrane
        // 2. Type check: payload must have tier, digest
        if (!payload || typeof payload.digest !== 'string') {
          throw new OmegaError('OMEGA_E_SCHEMA', 'remember needs { tier, digest, owner_kid }');
        }
        if (!MEMORY_TIERS.includes(payload.tier)) {
          throw new OmegaError('OMEGA_E_SCHEMA', `unknown tier: ${payload.tier}`);
        }
        // 3. Store only digest, never raw secret
        if (payload.content && !payload.digest) {
          throw new OmegaError('OMEGA_E_SECRET_EGRESS', 'raw content without digest refused');
        }
        const record = {
          id: crypto.randomUUID(),
          tier: payload.tier,
          digest: payload.digest,
          owner_kid: identity.kid,
          evidence_ref: evidenceRef || null,
          created_at: new Date().toISOString(),
        };
        // Execution via port (not direct DB)
        const result = await storePort.write(record);
        state.writes++;
        state.digests.add(record.digest);
        
        if (ledger) {
          ledger.record({
            kind: 'CELL_MESSAGE',
            cell: identity.kid,
            receptor: 'remember',
            payload_digest: await digestPayload(record),
            evidence_ref: record.evidence_ref,
          });
        }
        return { ok: true, id: record.id, digest: record.digest };
      },

      async recall({ tier, limit = 10 }) {
        state.reads++;
        const results = await storePort.read({ tier, limit, owner_kid: identity.kid });
        return { ok: true, results: results.map(r => ({ ...r, content: undefined })) }; // never return raw content
      },

      async forget({ id }) {
        const result = await storePort.delete({ id, owner_kid: identity.kid });
        return { ok: true, deleted: result.deleted };
      }
    },
    health() {
      return { writes: state.writes, reads: state.reads, digests: state.digests.size };
    }
  };
}

async function digestPayload(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2,'0')).join('');
}
