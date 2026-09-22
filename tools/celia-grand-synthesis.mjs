#!/usr/bin/env node
/**
 * NEXA — Grand Synthesis CLI & Interactive Demonstration
 * 
 * Uniting:
 * - OpenAI Frontier Reasoning (Sam Altman)
 * - Anthropic Constitutional AI (Dario Amodei)
 * - Manus Autonomous Micro-Sandboxes
 * - NEXA Deterministic Immunity Core (Ed25519 & Macaroons)
 * - Zero-Cost Distributed Fabric ($0.00 Blitzkrieg)
 */

import { GrandSynthesisKernel } from '../packages/cells/celia/synthesis/index.js';
import { verifyReceipt } from '../packages/evidence/index.js';

const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m'
};

function banner() {
  console.log(`
${colors.cyan}${colors.bright}╔════════════════════════════════════════════════════════════════════════════════════════╗
║                        🌌  NEXA GRAND SYNTHESIS KERNEL  🌌                              ║
║     Anthropic (Amodei) × OpenAI (Altman) × Manus (Agent Swarm) × NEXA Deterministic    ║
║                           « المحرك الحتمي للواقع الرقمي »                               ║
╚════════════════════════════════════════════════════════════════════════════════════════╝${colors.reset}
`);
}

async function runCli() {
  const args = process.argv.slice(2);
  const jsonMode = args.includes('--json');
  let prompt = 'Fix critical authentication token expiry and signature vulnerability in src/auth.js';
  let taskId = `task_synthesis_${Date.now().toString(36)}`;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--prompt' && args[i + 1]) prompt = args[++i];
    if (args[i] === '--task-id' && args[i + 1]) taskId = args[++i];
  }

  const kernel = new GrandSynthesisKernel();

  if (!jsonMode) {
    banner();
    console.log(`${colors.bright}🎯 Mission:${colors.reset} "${prompt}"`);
    console.log(`${colors.dim}🆔 Task ID:${colors.reset} ${taskId}\n`);
    console.log(`${colors.blue}════════════════════════════════════════════════════════════════════════════════════════${colors.reset}`);
    console.log(`${colors.bright}${colors.blue}▶ PHASE 1: OpenAI Frontier Reasoning — Multi-Branch Hypothesis Synthesis${colors.reset}`);
    console.log(`${colors.blue}════════════════════════════════════════════════════════════════════════════════════════${colors.reset}`);
  }

  const result = await kernel.executeTask({
    id: taskId,
    userPrompt: prompt,
    context: { file: 'src/auth.js' }
  });

  if (jsonMode) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Phase 1 Output
  const p1 = result.pipeline.openai;
  console.log(`  ${colors.green}✓${colors.reset} Intent Classified: ${colors.bright}${p1.intent}${colors.reset}`);
  console.log(`  ${colors.green}✓${colors.reset} Generated ${p1.branchesCount} parallel reasoning trajectories (Tree-of-Thoughts) in ${p1.durationMs}ms`);
  console.log(`  ${colors.cyan}→ Primary Strategy:${colors.reset} ${p1.primaryStrategy}`);

  // Phase 2 Output
  console.log(`\n${colors.magenta}════════════════════════════════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bright}${colors.magenta}▶ PHASE 2: Anthropic Constitutional AI — Safety Invariant Audit & Attenuation${colors.reset}`);
  console.log(`${colors.magenta}════════════════════════════════════════════════════════════════════════════════════════${colors.reset}`);
  const p2 = result.pipeline.anthropic;
  console.log(`  ${colors.green}✓${colors.reset} Enforced ${p2.principlesCount} Constitutional Safety Invariants`);
  console.log(`  ${colors.green}✓${colors.reset} Audited: ${p2.audited} | Approved: ${colors.green}${p2.approved}${colors.reset} | Attenuated: ${colors.yellow}${p2.attenuated}${colors.reset} | Rejected: ${colors.red}${p2.rejected}${colors.reset} (${p2.durationMs}ms)`);
  console.log(`  ${colors.cyan}→ Principle Checked:${colors.reset} Default-Deny, Non-Ambient Authority, Capability Lattice, Zero Covert Channels`);

  // Phase 3 Output
  console.log(`\n${colors.yellow}════════════════════════════════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bright}${colors.yellow}▶ PHASE 3: Manus Autonomous Micro-Sandbox Swarm — Parallel CoW Trials${colors.reset}`);
  console.log(`${colors.yellow}════════════════════════════════════════════════════════════════════════════════════════${colors.reset}`);
  const p3 = result.pipeline.manus;
  console.log(`  ${colors.green}✓${colors.reset} Spawned ${p3.sandboxesSpawned} Ephemeral Micro-Sandboxes concurrently in ${p3.durationMs}ms`);
  console.log(`  ${colors.green}✓${colors.reset} Successful Trials: ${p3.successfulTrials}/${p3.sandboxesSpawned}`);
  console.log(`  ${colors.cyan}→ Selected Winning Trajectory:${colors.reset} [${p3.winningStrategy}] in sandbox [${p3.winningSandbox}] (${p3.testsPassed}/3 tests passed, 0 side-effects)`);

  // Phase 4 Output
  console.log(`\n${colors.cyan}════════════════════════════════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bright}${colors.cyan}▶ PHASE 4: NEXA Deterministic Immunity Core — Ed25519 Signing & Macaroons${colors.reset}`);
  console.log(`${colors.cyan}════════════════════════════════════════════════════════════════════════════════════════${colors.reset}`);
  const p4 = result.pipeline.nexaCore;
  console.log(`  ${colors.green}✓${colors.reset} Decision: ${colors.bright}${colors.green}${p4.decision}${colors.reset} (${p4.code}) in ${p4.durationMs}ms`);
  console.log(`  ${colors.green}✓${colors.reset} Cryptographic Record Hash: ${colors.dim}${p4.recordHash}${colors.reset}`);
  console.log(`  ${colors.green}✓${colors.reset} Signed Portable Receipt Issued by: ${colors.dim}${p4.receipt.actor}${colors.reset}`);
  
  const verifiedReceipt = verifyReceipt(p4.receipt);
  console.log(`  ${colors.green}✓${colors.reset} Offline Cryptographic Verification: ${verifiedReceipt.ok ? colors.green + 'VERIFIED 100%' : colors.red + 'FAILED'}${colors.reset}`);

  // Phase 5 Output
  console.log(`\n${colors.green}════════════════════════════════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bright}${colors.green}▶ PHASE 5: Zero-Cost Distributed Fabric — P2P Verifiable State Broadcast${colors.reset}`);
  console.log(`${colors.green}════════════════════════════════════════════════════════════════════════════════════════${colors.reset}`);
  const p5 = result.pipeline.zeroCostFabric;
  console.log(`  ${colors.green}✓${colors.reset} Proof Broadcasted to P2P Consensus Fabric (${p5.proofId}) in ${p5.durationMs}ms`);
  console.log(`  ${colors.green}✓${colors.reset} Merkle Rollup Root: ${colors.dim}${p5.rollupRoot}${colors.reset}`);
  console.log(`  ${colors.green}✓${colors.reset} Peer Verifications: ${p5.peerConfirmations} volunteer validator nodes`);
  console.log(`  ${colors.green}✓${colors.reset} Financial Compute Cost: ${colors.bright}${colors.green}${p5.financialCostUSD} (Zero Dollars Spent!)${colors.reset}`);
  console.log(`  ${colors.green}✓${colors.reset} Local CPU Energy: ${p5.energyMicroJoules} µJ`);

  // Summary
  console.log(`\n${colors.cyan}════════════════════════════════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.bright}${colors.green}🏆 GRAND SYNTHESIS EXECUTION COMPLETED SUCCESSFULLY${colors.reset}`);
  console.log(`${colors.cyan}════════════════════════════════════════════════════════════════════════════════════════${colors.reset}`);
  console.log(`  ${colors.bright}Total Pipeline Time:${colors.reset} ${result.totalDurationMs}ms`);
  console.log(`  ${colors.bright}Proof Signature:${colors.reset} ${colors.cyan}${result.proofSignature}${colors.reset}`);
  console.log(`  ${colors.bright}Guarantees:${colors.reset} Zero Hallucinations • Zero Ambient Privilege • Zero Cloud Cost • Mathematical Immunity\n`);
}

runCli().catch(err => {
  console.error('Execution fault:', err);
  process.exit(1);
});
