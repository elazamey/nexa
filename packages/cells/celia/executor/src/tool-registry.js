/**
 * Celia Tool Registry — Secure Execution Engine (v0.4)
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
 */

import { OmegaError } from '../../../../compiler/index.js';

export const TOOL_CAPABILITIES = Object.freeze([
  'filesystem.read',
  'git.diff',
  'git.log',
  'http.get',
  'supabase.read',
  'memory.recall'
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
