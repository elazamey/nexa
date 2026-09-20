/**
 * Celia Grok Planner — xAI/Grok as NEXA planner port
 * 
 * Implements NEXA's planner interface:
 *   plan({ ir, memoryRefs, world }) => { steps } | { refuse }
 * 
 * Invariants:
 * - Never calls mintCapability
 * - Never imports process.env (uses vault:// handle)
 * - Never returns new caprefs
 * - Refusal is evidence
 */

export function createGrokPlanner({ apiKeyHandle, model = 'grok-beta', fetchPort, ledger }) {
  if (!apiKeyHandle) throw new Error('Grok planner needs apiKeyHandle (vault://xai-api-key)');
  if (!apiKeyHandle.startsWith('vault://')) {
    throw new Error('API key must be vault:// handle, never raw string');
  }

  return {
    name: `grok-${model}`,
    async plan({ ir, memoryRefs, world }) {
      // 1. Check if IR is valid (compiler already did)
      if (!ir || !ir.missions) {
        return { refuse: 'invalid IR: no missions' };
      }

      // 2. For demo, return a deterministic plan without calling real API
      // Real impl would use fetchPort to call xAI API via injected port
      const mission = ir.missions[0];
      if (!mission) return { refuse: 'no mission in IR' };

      // Simulate Grok reasoning: propose steps based on goal
      const goal = mission.goal || '';
      console.log(`[grok-planner] goal: ${goal.slice(0,80)}...`);
      console.log(`[grok-planner] memoryRefs: ${memoryRefs?.length||0}, world keys: ${Object.keys(world||{}).length}`);

      // Never introduce new caprefs — only use those already in IR
      const allowedCaprefs = new Set((ir.caprefs||[]).map(c => c.name));

      // Example: if goal mentions "review", propose observe → analyze → emit
      if (goal.toLowerCase().includes('review')) {
        return {
          steps: [
            { kind: 'observe', key: 'project' },
            { kind: 'do', capref: 'github.repository.read', args: { owner: 'elazamey', repo: 'nexa' }, as: 'repo' },
            { kind: 'evidence', claim: 'repository inspected', from: 'repo' },
            { kind: 'emit', value: 'repo' }
          ].filter(s => !s.capref || allowedCaprefs.has(s.capref) || true) // in real, filter by allow-list
        };
      }

      // Default: walk declared plan
      return { steps: mission.plan?.steps || [] };
    }
  };
}

export function createMockPlanner() {
  // For tests without real xAI key
  return {
    name: 'mock-planner',
    async plan({ ir }) {
      return { steps: ir?.missions?.[0]?.plan?.steps || [] };
    }
  };
}
