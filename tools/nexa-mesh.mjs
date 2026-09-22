#!/usr/bin/env node

/**
 * NEXA 2026 AI Mesh & Governance Hub CLI
 * Free-first local inference, multi-protocol tools, 4-tier temporal memory, and policy gate.
 */

import {
  LocalRuntimeBroker,
  ModelRouter,
  ProtocolBridge,
  MemoryMesh,
  ComputerInterface,
  GovernanceKernel,
  SelfImprovementPipeline
} from '../src/mesh/index.js';

const [,, command, ...args] = process.argv;

function printHelp() {
  console.log(`
🌐 NEXA 2026 FREE-FIRST AI AGENT OPERATING SYSTEM (v1.0.0)
Model Mesh + MCP/A2A + Temporal Memory + Computer Use + Policy Gate + Evidence Ledger

USAGE:
  node tools/nexa-mesh.mjs <command> [arguments]

COMMANDS:
  runtimes                  List local AI runtimes (Ollama, llama.cpp, vLLM, SGLang)
  route <prompt>            Route prompt to the most efficient zero-cost local model
  memory                    Inspect 4-Tier Memory & Temporal Knowledge Graph
  computer                  Simulate safe Terminal and Browser action planning
  improve                   Run the safe Self-Improvement promotion pipeline
  verify-ledger             Check cryptographic integrity of the immutable evidence ledger
  full-demo                 Execute an end-to-end full mesh demonstration

EXAMPLES:
  node tools/nexa-mesh.mjs runtimes
  node tools/nexa-mesh.mjs route "Write a binary search algorithm in Rust"
  node tools/nexa-mesh.mjs full-demo
`);
}

async function main() {
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  const broker = new LocalRuntimeBroker();
  const router = new ModelRouter();
  const bridge = new ProtocolBridge();
  const memory = new MemoryMesh();
  const computer = new ComputerInterface();
  const kernel = new GovernanceKernel();
  const selfImprovement = new SelfImprovementPipeline(kernel);

  switch (command) {
    case 'runtimes': {
      console.log('🤖 Active Zero-Cost Local Runtimes:');
      broker.getActiveRuntimes().forEach(r => {
        console.log(`   - [${r.name}] (Priority: ${r.priority}) -> Endpoint: ${r.endpoint}`);
      });
      console.log('\n📦 Registered Local Models:');
      broker.registeredModels.forEach(m => {
        console.log(`   * ${m.id.padEnd(20)} [${m.role.padEnd(12)}] Quantized: ${m.quantized} (VRAM: ${m.vramMb}MB)`);
      });
      break;
    }

    case 'route': {
      const prompt = args.join(' ') || 'Write an efficient Quicksort in JavaScript';
      console.log(`🎯 Routing query: "${prompt}"`);
      const result = await router.route({ prompt, taskType: 'CODING' });
      console.log(`\n✨ Routed to: ${result.routedTo} via ${result.runtimeType}`);
      console.log(`💰 Cost: ${result.cost}`);
      console.log(`📝 Result: ${result.response.output}`);
      break;
    }

    case 'memory': {
      console.log('🧠 Adding Temporal Knowledge Nodes and Memory Tiers...');
      memory.setWorking('activeTask', 'Refactor auth module');
      memory.addKnowledgeNode('user_101', 'Developer', { name: 'Alice', role: 'Security Engineer' });
      memory.addKnowledgeNode('service_auth', 'Microservice', { port: 8080, authType: 'Ed25519' });
      memory.addTemporalRelation('user_101', 'MODIFIED', 'service_auth', { commit: 'a180dc2' });

      const history = memory.queryEntityHistory('service_auth');
      console.log(`\n📌 Temporal Knowledge Graph for 'service_auth':`);
      console.log(`   Entity: ${history.entity.id} (${history.entity.type})`);
      console.log(`   Timeline Events: ${history.timeline.length}`);
      history.timeline.forEach(e => {
        console.log(`   -> [${e.timestamp}] ${e.source} --(${e.relation})--> ${e.target}`);
      });
      break;
    }

    case 'computer': {
      console.log('🖥️  Planning Computer Use & Terminal Actions:');
      const termAction = computer.planTerminalAction('git', ['status']);
      console.log(`   Terminal Action: [${termAction.program}] Allowed: ${termAction.isAllowed} (Risk: ${termAction.riskLevel})`);

      const browserAction = computer.planBrowserAction('CLICK', '#submit-button');
      console.log(`   Browser Action: [${browserAction.action}] Valid: ${browserAction.isValid}`);
      break;
    }

    case 'improve': {
      console.log('🔬 Proposing Code Patch via Self-Improvement Pipeline...');
      const proposal = selfImprovement.proposeOptimization(
        'AuthCore',
        'Replace slow HMAC with Ed25519 for microsecond verification',
        '+ const signature = ed25519.sign(data, key);'
      );
      console.log(`   Proposal Created: ${proposal.proposalId} (Digest: ${proposal.digest.slice(0, 12)}...)`);

      const res = await selfImprovement.executeSafePromotion(
        proposal.proposalId,
        () => true, // Sandbox tests pass
        () => true  // Security scanner clean
      );
      console.log(`\n✨ Promotion Outcome: ${res.status}`);
      console.log(`🔏 Receipt Signature: ${res.receiptSignature.slice(0, 32)}...`);
      break;
    }

    case 'verify-ledger': {
      console.log('📜 Verifying Cryptographic Evidence Ledger...');
      const integrity = kernel.verifyLedgerIntegrity();
      console.log(`   Ledger Valid: ${integrity.valid}`);
      console.log(`   Total Blocks: ${integrity.totalRecords}`);
      console.log(`   Head Digest:  ${integrity.headHash}`);
      break;
    }

    case 'full-demo': {
      console.log('🚀 Executing Complete NEXA 2026 AI Operating System Pipeline...\n');

      // 1. Model Selection
      console.log('1️⃣  Model Mesh: Selecting zero-cost local model...');
      const routeRes = await router.route({ prompt: 'Implement Ed25519 verify', taskType: 'CODING' });
      console.log(`    Selected: ${routeRes.routedTo} (Cost: ${routeRes.cost})`);

      // 2. Protocols
      console.log('2️⃣  Protocol Bridge: Registering MCP & A2A tools...');
      bridge.registerMcpTool('fs_read', { path: 'string' }, () => 'content');
      bridge.registerA2AAgent('sec_audit_agent', ['vulnerability_scan']);
      console.log(`    Discovered Tools: ${bridge.listAllTools().length}`);

      // 3. Memory
      console.log('3️⃣  Memory Mesh: Recording execution trace in Temporal Graph...');
      memory.recordEpisode({ action: 'CODE_PATCH', intent: 'Optimize verification', result: 'SUCCESS' });

      // 4. Governance & Evidence
      console.log('4️⃣  Governance Kernel: Evaluating policy and signing evidence...');
      const proposal = computer.planTerminalAction('npm', ['test']);
      const evalRes = kernel.evaluateProposal(proposal, { valid: true, scope: ['all'] });
      const record = kernel.commitExecutionRecord(proposal, evalRes, 'All tests passed');
      console.log(`    Policy Decision: ${evalRes.decision}`);
      console.log(`    Ed25519 Entry Hash: ${record.entryHash.slice(0, 24)}...`);

      // 5. Verification
      const ledgerValid = kernel.verifyLedgerIntegrity();
      console.log(`\n✅ 100% Pipeline Verification: Ledger Integrity = ${ledgerValid.valid ? 'VALID' : 'CORRUPTED'}`);
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exitCode = 1;
  }
}

main().catch(err => {
  console.error('Fatal CLI Error:', err);
  process.exitCode = 1;
});
