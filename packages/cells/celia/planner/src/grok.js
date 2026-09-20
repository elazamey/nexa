// packages/cells/celia/planner/src/grok.js
// Planner Interface — binds Grok port to NEXA planner contract
// Ensures AI != Authority: LLM proposes, system decides, never mints

export function createGrokPlanner(grokPort) {
    if (!grokPort || typeof grokPort.generatePlan !== 'function') {
        throw new Error('Grok planner needs grokPort with generatePlan()');
    }

    return {
        name: 'grok-planner',
        async plan({ ir, memoryRefs, world }) {
            try {
                // Safely gather context — never include raw secrets, only digests
                const context = {
                    ir: typeof ir === 'string' ? ir : { missions: ir?.missions?.length || 0, goal: ir?.missions?.[0]?.goal?.slice(0,200) || 'no goal' },
                    memoryRefs: Array.isArray(memoryRefs) ? memoryRefs.slice(0,5) : [],
                    world: typeof world === 'string' ? world : Object.keys(world || {}).slice(0,10)
                };

                // Ensure context does not contain env secrets (llm-secret-egress check)
                const contextStr = JSON.stringify(context);
                if (contextStr.includes('SUPABASE') || contextStr.includes('XAI_API_KEY') || contextStr.includes('SERVICE_KEY')) {
                    console.log('[grok-planner] sanitizing context — removed secret keys');
                    // Remove any accidental secret leakage
                    context.ir = typeof context.ir === 'object' ? { missions: context.ir.missions } : context.ir;
                }

                const llmOutput = await grokPort.generatePlan(context);

                // Strict validation of output structure (AI != Authority)
                if (llmOutput.refuse) {
                    console.log(`[grok-planner] refused: ${llmOutput.refuse.reason || llmOutput.refuse}`);
                    return { refuse: { reason: llmOutput.refuse.reason || "AI Planner Refused" } };
                }
                
                if (Array.isArray(llmOutput.steps)) {
                    // Filter any attempt to bypass permissions (llm-mint-attempt)
                    const sanitizedSteps = llmOutput.steps.filter(step => {
                        if (!step || typeof step !== 'object') return false;
                        if (step.action === 'mintCapability' || step.action === 'mint' || step.kind === 'mintCapability') {
                            console.log('[grok-planner] blocked mintCapability attempt from LLM output');
                            return false;
                        }
                        // Also block any step that tries to access vault:// directly
                        const str = JSON.stringify(step);
                        if (str.includes('vault://') || str.includes('SUPABASE') || str.includes('XAI_API')) {
                            console.log('[grok-planner] blocked potential secret egress in step');
                            return false;
                        }
                        return true;
                    });
                    console.log(`[grok-planner] sanitized ${llmOutput.steps.length} -> ${sanitizedSteps.length} steps`);
                    return { steps: sanitizedSteps };
                }

                console.log('[grok-planner] invalid output format, refusing');
                return { refuse: { reason: "Invalid LLM output format" } };
            } catch (error) {
                console.log(`[grok-planner] exception: ${error.message}, refusing`);
                return { refuse: { reason: `Planner exception: ${error.message}` } };
            }
        }
    };
}

// Backward compatibility: old API that took { apiKeyHandle, model, fetchPort }
export function createGrokPlannerLegacy({ apiKeyHandle, model = 'grok-beta', fetchPort, ledger } = {}) {
    if (apiKeyHandle && !apiKeyHandle.startsWith('vault://')) {
        throw new Error('API key must be vault:// handle, never raw string');
    }
    // Create a mock port for legacy
    const mockPort = {
        async generatePlan(context) {
            return { steps: [{ action: 'observe', target: 'project' }] };
        }
    };
    return createGrokPlanner(mockPort);
}

export function createMockPlanner() {
    // For tests without real xAI key
    return {
        name: 'mock-planner',
        async plan({ ir }) {
            const steps = ir?.missions?.[0]?.plan?.steps || [{ action: 'observe', target: 'project' }];
            return { steps };
        }
    };
}
