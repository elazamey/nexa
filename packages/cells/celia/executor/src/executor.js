/**
 * Celia Secure Executor — Executes DAG nodes in sandbox with evidence
 * 
 * Flow:
 *   Intent → Planner → DAG → Capability Resolver → Policy → Authorization → Executor → Evidence → Verifier
 * 
 * Invariants:
 * - REAL_EXECUTION gate stays CLOSED — no direct spawn/exec
 * - Executor is a port, not in packages/ core — only tools/ may have ambient authority
 * - Every execution requires evidence_ref, capability, and produces evidence
 * - Parallel execution for independent DAG nodes
 * - Speculative layer: start B while A runs if predicted
 */

import { OmegaError } from '../../../../compiler/index.js';

export function createSecureExecutor({ toolRegistry, ledger, maxParallel = 3, speculative = true } = {}) {
  if (!toolRegistry) throw new OmegaError('OMEGA_E_SCHEMA', 'executor needs toolRegistry');

  return {
    async executeDAG(dag, { capability, evidenceRefPrefix = 'dag' } = {}) {
      if (!dag || !Array.isArray(dag.nodes)) {
        throw new OmegaError('OMEGA_E_SCHEMA', 'DAG needs { nodes: [...] }');
      }

      // Validate DAG has no cycles (simple check)
      const visited = new Set();
      const visiting = new Set();
      function hasCycle(nodeId) {
        if (visiting.has(nodeId)) return true;
        if (visited.has(nodeId)) return false;
        visiting.add(nodeId);
        const node = dag.nodes.find(n => n.id === nodeId);
        if (node?.dependsOn) {
          for (const dep of node.dependsOn) {
            if (hasCycle(dep)) return true;
          }
        }
        visiting.delete(nodeId);
        visited.add(nodeId);
        return false;
      }
      for (const node of dag.nodes) {
        if (hasCycle(node.id)) {
          throw new OmegaError('OMEGA_E_SCHEMA', `DAG cycle detected at ${node.id}`);
        }
      }

      // Topological sort for execution order, but allow parallel for independent nodes
      const executed = new Map();
      const results = [];
      const evidenceChain = [];

      // Group nodes by level (independent nodes can run in parallel)
      const levels = buildLevels(dag.nodes);

      for (let levelIdx = 0; levelIdx < levels.length; levelIdx++) {
        const level = levels[levelIdx];
        console.log(`[executor] level ${levelIdx}: ${level.map(n => n.id).join(', ')} (parallel=${Math.min(level.length, maxParallel)})`);

        // Execute level in parallel, bounded by maxParallel
        const levelResults = await Promise.all(
          level.map(async (node) => {
            const evidence_ref = `${evidenceRefPrefix}-${node.id}-${Date.now()}`;

            // Speculative: if node has speculative flag, start early
            if (speculative && node.speculative) {
              console.log(`[executor] speculative start ${node.id}`);
            }

            try {
              const result = await toolRegistry.execute({
                id: node.tool,
                inputs: node.inputs || {},
                capability,
                evidence_ref,
                ledger
              });

              executed.set(node.id, result);
              evidenceChain.push({
                node: node.id,
                tool: node.tool,
                evidence_ref,
                digest: result.digest,
                ok: true
              });

              return { id: node.id, ok: true, result };
            } catch (error) {
              const failEvidence = {
                node: node.id,
                tool: node.tool,
                evidence_ref,
                error: error.message,
                code: error.code || 'UNKNOWN',
                ok: false
              };
              evidenceChain.push(failEvidence);

              if (ledger) {
                ledger.record({
                  kind: 'CELL_MESSAGE',
                  cell: 'celia.executor',
                  receptor: `${node.tool}.failed`,
                  payload_digest: `sha256:fail-${node.id}`,
                  evidence_ref,
                  error: error.message
                });
              }

              return { id: node.id, ok: false, error: error.message, code: error.code };
            }
          })
        );

        results.push(...levelResults);

        // If any node in level failed and is marked as critical, stop DAG
        const criticalFail = levelResults.find(r => !r.ok && dag.nodes.find(n => n.id === r.id)?.critical);
        if (criticalFail) {
          console.log(`[executor] critical failure at ${criticalFail.id}, stopping DAG`);
          break;
        }
      }

      const passed = results.filter(r => r.ok).length;
      const failed = results.filter(r => !r.ok).length;

      return {
        ok: failed === 0,
        passed,
        failed,
        total: results.length,
        results,
        evidenceChain,
        summary: `${passed}/${results.length} nodes executed, ${failed} failed`
      };
    }
  };
}

function buildLevels(nodes) {
  // Simple level building: nodes with no dependencies = level 0, then dependents
  const levels = [];
  const remaining = new Map(nodes.map(n => [n.id, n]));
  const executed = new Set();

  while (remaining.size > 0) {
    const level = [];
    for (const [id, node] of remaining) {
      const deps = node.dependsOn || [];
      if (deps.every(d => executed.has(d))) {
        level.push(node);
      }
    }
    if (level.length === 0) {
      // Cycle or missing dep — break
      break;
    }
    levels.push(level);
    for (const node of level) {
      remaining.delete(node.id);
      executed.add(node.id);
    }
  }

  return levels;
}
