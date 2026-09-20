/**
 * NEXA v0.7 — Multi-Agent Consensus & Voting DSL (ConsensusDSL)
 * Protocol for debate, voting, consensus among agents.
 * 
 * PROTOCOL SecurityApproval {
 *   PARTICIPANTS [CoderAgent, SecurityAuditor, PerformanceTester];
 *   STRATEGY MajorityVote(THRESHOLD: 0.75);
 *   MAX_ROUNDS 3;
 *   ON DISAGREEMENT { INJECT "Audit failures: {SecurityAuditor.rejections}. Resolve."; }
 *   FALLBACK EscalatedToHuman;
 * }
 */

export function parseConsensusDSL(input) {
  const protoMatch = input.match(/PROTOCOL\s+(\w+)\s*\{([\s\S]*)\}\s*$/i);
  if (!protoMatch) throw new Error('ConsensusDSL: PROTOCOL Name { ... } required');

  const name = protoMatch[1];
  const body = protoMatch[2];

  const participantsMatch = body.match(/PARTICIPANTS\s*\[([^\]]+)\]/i);
  const participants = participantsMatch ? participantsMatch[1].split(',').map(s => s.trim()) : [];

  const strategyMatch = body.match(/STRATEGY\s+(\w+)\s*\(\s*THRESHOLD\s*:\s*([\d\.]+)\s*\)/i);
  const strategy = strategyMatch ? { type: strategyMatch[1], threshold: parseFloat(strategyMatch[2]) } : { type: 'MajorityVote', threshold: 0.5 };

  const roundsMatch = body.match(/MAX_ROUNDS\s+(\d+)/i);
  const maxRounds = roundsMatch ? parseInt(roundsMatch[1]) : 3;

  const disagreementMatch = body.match(/ON DISAGREEMENT\s*\{([\s\S]*?)\}/i);
  const onDisagreement = disagreementMatch ? disagreementMatch[1].trim() : null;

  const fallbackMatch = body.match(/FALLBACK\s+(\w+)/i);
  const fallback = fallbackMatch ? fallbackMatch[1] : null;

  return {
    type: 'ConsensusProtocol',
    name,
    participants,
    strategy,
    maxRounds,
    onDisagreement,
    fallback,
    raw: input
  };
}

export function compileConsensusDSL(input) {
  const parsed = parseConsensusDSL(input);

  const plan = {
    operation: 'consensus_protocol',
    protocol: parsed.name,
    participants: parsed.participants,
    strategy: parsed.strategy,
    maxRounds: parsed.maxRounds,
    execution: {
      steps: [
        `Protocol ${parsed.name}: ${parsed.participants.length} participants`,
        `Participants: ${parsed.participants.join(', ')}`,
        `Strategy: ${parsed.strategy.type} threshold ${parsed.strategy.threshold}`,
        `Max rounds: ${parsed.maxRounds}`,
        parsed.onDisagreement ? `On disagreement: ${parsed.onDisagreement.slice(0,60)}` : 'No disagreement handler',
        parsed.fallback ? `Fallback: ${parsed.fallback}` : 'No fallback'
      ],
      voting: true,
      noCentralOrchestrator: false
    }
  };

  return {
    ok: true,
    dsl: input,
    parsed,
    plan,
    metrics: {
      protocol: parsed.name,
      participants: parsed.participants.length,
      threshold: parsed.strategy.threshold,
      maxRounds: parsed.maxRounds,
      claim: 'Automated decision among multiple models without Python logic'
    }
  };
}

export function validateConsensusDSL(input) {
  try {
    parseConsensusDSL(input);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Simulate consensus execution
export function simulateConsensus(parsed, votes) {
  // votes: { agent: boolean } true=approve, false=reject
  const total = parsed.participants.length;
  const approvals = Object.values(votes).filter(v => v).length;
  const ratio = total > 0 ? approvals / total : 0;
  const passed = ratio >= parsed.strategy.threshold;

  return {
    passed,
    ratio,
    threshold: parsed.strategy.threshold,
    approvals,
    total,
    rounds: 1,
    fallback: !passed ? parsed.fallback : null,
    disagreement: !passed ? parsed.onDisagreement : null
  };
}
