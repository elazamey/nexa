/**
 * Celia Tool Registry — Secure Execution Engine (v0.5)
 * 
 * Every tool declares:
 *   - id, capabilities, policy (default deny), inputs, outputs, evidence
 * 
 * Invariants:
 * - No tool can mint capabilities
 * - Every tool requires evidence_ref before execution
 * - Read-only first: fs.read (specific paths), git.diff, http.get (allow-listed)
 * - No ambient authority: tools are injected ports, not direct imports in packages/
 * - REAL_EXECUTION gate stays CLOSED — execution via port, not direct spawn
 * 
 * v0.5 additions: semantic memory & RAG
 * - memory.semantic_store, memory.semantic_recall (Top-12 RAG)
 * - embedding.generate (384d)
 */

import { OmegaError } from '../../../../compiler/index.js';

export const TOOL_CAPABILITIES = Object.freeze([
  'filesystem.read',
  'git.diff',
  'git.log',
  'http.get',
  'supabase.read',
  'memory.recall',
  'memory.semantic_store',
  'memory.semantic_recall',
  'embedding.generate'
]);

export const TOOL_POLICIES = Object.freeze({
  default: 'deny',
  max_uses: 100,
  require_evidence_ref: true,
  require_capability: true
});

export const TOOL_DEFINITIONS = Object.freeze([
  {
    id: 'fs.read',
    capabilities: ['filesystem.read'],
    policy: { default: 'deny', allowed_paths: ['spec/**', 'README.md', 'package.json', 'examples/**'] },
    inputs: ['path'],
    outputs: ['content', 'digest', 'evidence'],
    description: 'Read-only file read with path allow-list, digest returned, evidence recorded'
  },
  {
    id: 'git.diff',
    capabilities: ['git.diff'],
    policy: { default: 'deny', max_diff_bytes: 10240 },
    inputs: ['base', 'head'],
    outputs: ['diff', 'digest', 'evidence'],
    description: 'Git diff between two commits, bounded size, evidence-bound'
  },
  {
    id: 'git.log',
    capabilities: ['git.log'],
    policy: { default: 'deny', max_commits: 20 },
    inputs: ['limit'],
    outputs: ['commits', 'evidence'],
    description: 'Git log with bounded limit'
  },
  {
    id: 'http.get',
    capabilities: ['http.get'],
    policy: { default: 'deny', allowed_hosts: ['api.github.com', 'example.com'] },
    inputs: ['url'],
    outputs: ['body', 'status', 'evidence'],
    description: 'HTTP GET to allow-listed hosts only, via injected fetch port'
  },
  {
    id: 'supabase.read',
    capabilities: ['supabase.read'],
    policy: { default: 'deny' },
    inputs: ['table', 'tier', 'limit'],
    outputs: ['rows', 'evidence'],
    description: 'Read from Supabase via port, digest-only'
  },
  {
    id: 'memory.recall',
    capabilities: ['memory.recall'],
    policy: { default: 'deny' },
    inputs: ['tier', 'limit'],
    outputs: ['digests', 'evidence'],
    description: 'Recall memory digests via memory cell'
  },
  {
    id: 'memory.semantic_store',
    capabilities: ['memory.semantic_store'],
    policy: { default: 'deny', max_content_bytes: 4096 },
    inputs: ['content', 'tier', 'metadata', 'evidence_ref'],
    outputs: ['digest', 'id', 'evidence'],
    description: 'v0.5 RAG: Store fact with 384d embedding, digest-only, evidence-bound'
  },
  {
    id: 'memory.semantic_recall',
    capabilities: ['memory.semantic_recall'],
    policy: { default: 'deny', max_limit: 50 },
    inputs: ['query', 'limit', 'threshold', 'tier'],
    outputs: ['facts', 'count', 'evidence'],
    description: 'v0.5 RAG: Retrieve Top-12 relevant facts via cosine similarity, for planner context'
  },
  {
    id: 'embedding.generate',
    capabilities: ['embedding.generate'],
    policy: { default: 'deny', max_text_bytes: 8192 },
    inputs: ['text'],
    outputs: ['embedding', 'dim', 'digest'],
    description: 'v0.5: Generate 384d deterministic embedding, L2 normalized, for semantic search'
  }
]);

export function createToolRegistry({ ports = {} } = {}) {
  const registry = new Map();
  for (const def of TOOL_DEFINITIONS) {
    registry.set(def.id, def);
  }

  return {
    list() {
      return [...registry.values()];
    },

    get(id) {
      const tool = registry.get(id);
      if (!tool) throw new OmegaError('OMEGA_E_UNKNOWN_INSTRUMENT', `unknown tool: ${id}`);
      return tool;
    },

    async execute({ id, inputs, capability, evidence_ref, ledger }) {
      // 1. Check tool exists
      const tool = this.get(id);

      // 2. Require evidence_ref (NEXA invariant: every action needs evidence_ref)
      if (TOOL_POLICIES.require_evidence_ref && !evidence_ref) {
        throw new OmegaError('OMEGA_E_EVIDENCE_UNTRUSTED', `tool ${id} requires evidence_ref`);
      }

      // 3. Check capability (already verified by membrane, but double-check)
      if (TOOL_POLICIES.require_capability && !capability) {
        throw new OmegaError('OMEGA_E_CAP_MISSING', `tool ${id} requires capability`);
      }

      // 4. Validate inputs against policy
      if (id === 'fs.read') {
        const allowed = tool.policy.allowed_paths;
        const path = inputs.path || '';
        const isAllowed = allowed.some(pattern => {
          if (pattern.endsWith('/**')) {
            return path.startsWith(pattern.slice(0, -3));
          }
          return path === pattern || path.startsWith(pattern.replace('*',''));
        });
        if (!isAllowed) {
          throw new OmegaError('OMEGA_E_POLICY', `path not allowed: ${path}, allowed: ${allowed.join(', ')}`);
        }
      }

      if (id === 'http.get') {
        const url = inputs.url || '';
        try {
          const host = new URL(url).hostname;
          if (!tool.policy.allowed_hosts.includes(host)) {
            throw new OmegaError('OMEGA_E_POLICY', `host not allowed: ${host}`);
          }
        } catch {
          throw new OmegaError('OMEGA_E_SCHEMA', `invalid url: ${url}`);
        }
      }

      if (id === 'memory.semantic_store') {
        const content = inputs.content || '';
        if (content.length > (tool.policy.max_content_bytes || 4096)) {
          throw new OmegaError('OMEGA_E_POLICY', `content too large: ${content.length} > ${tool.policy.max_content_bytes}`);
        }
        if (!content || typeof content !== 'string') {
          throw new OmegaError('OMEGA_E_SCHEMA', 'semantic_store needs { content, tier?, metadata? }');
        }
      }

      if (id === 'memory.semantic_recall') {
        const limit = inputs.limit || 12;
        if (limit > (tool.policy.max_limit || 50)) {
          throw new OmegaError('OMEGA_E_POLICY', `limit too large: ${limit} > ${tool.policy.max_limit}`);
        }
        if (!inputs.query || typeof inputs.query !== 'string') {
          throw new OmegaError('OMEGA_E_SCHEMA', 'semantic_recall needs { query, limit?, threshold? }');
        }
      }

      if (id === 'embedding.generate') {
        const text = inputs.text || '';
        if (text.length > (tool.policy.max_text_bytes || 8192)) {
          throw new OmegaError('OMEGA_E_POLICY', `text too large: ${text.length} > ${tool.policy.max_text_bytes}`);
        }
        if (!text) {
          throw new OmegaError('OMEGA_E_SCHEMA', 'embedding.generate needs { text }');
        }
      }

      // 5. Execute via port (not direct fs/net)
      const port = ports[id] || ports[tool.capabilities[0]];
      if (!port) {
        // Mock execution for demo — returns digest, not raw content
        console.log(`[tool-registry] mock execute ${id} inputs=${JSON.stringify(inputs).slice(0,80)} evidence_ref=${evidence_ref?.slice(0,8)}`);
        return {
          ok: true,
          tool: id,
          digest: `sha256:mock-${id}-${Date.now()}`,
          evidence_ref,
          result: { mock: true, tool: id, inputs_digest: `sha256:${JSON.stringify(inputs).length}` }
        };
      }

      // Real execution via port
      const result = await port.execute(inputs);

      // 6. Record evidence
      if (ledger) {
        ledger.record({
          kind: 'CELL_MESSAGE',
          cell: 'celia.executor',
          receptor: id,
          payload_digest: result.digest || `sha256:${id}`,
          evidence_ref,
          tool: id
        });
      }

      return {
        ok: true,
        tool: id,
        evidence_ref,
        ...result
      };
    }
  };
}
