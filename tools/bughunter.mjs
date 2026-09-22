#!/usr/bin/env node

/**
 * NEXA Agentic Bug Hunter - Autonomous Security & Bug Bounty CLI
 * Powered by AwareXone-inspired agentic methodology and NEXA Ed25519 cryptographic receipts.
 */

import {
  ReconAgent,
  VulnEngine,
  SevenGateValidator,
  ChainBuilder,
  SecretsHunter,
  JwtScanner,
  LlmRedTeam,
  Web3Auditor,
  ReportWriter,
  NexaEvidenceBridge,
  HuntMemory,
  AutopilotEngine,
  AgenticBugHunter
} from '../src/security/agentic-hunter.js';

const [,, command, ...args] = process.argv;

function printHelp() {
  console.log(`
🛡️  NEXA AGENTIC BUG HUNTER (v1.0.0)
Autonomous AI-driven Bug Bounty Reconnaissance, Vulnerability Discovery & Cryptographic Verification

USAGE:
  bughunter <command> [arguments]

CORE COMMANDS:
  recon <target>            Map attack surface, subdomains, and ranked endpoints
  hunt <target>             Hunt for 26 Web2 vulnerability classes (IDOR, SSRF, SQLi, Race)
  validate <finding>        Run strict 7-Question Gate & 4-Gate false-positive filter
  report <target>           Generate submission-ready reports (HackerOne, Bugcrowd, Immunefi)
  autopilot <target>        Autonomous full-loop: Recon -> Hunt -> Validate -> Chain -> Sign
  chain                     Synthesize multi-stage exploit chains from active findings
  secrets <dir>             Scan codebase/bundles for leaked credentials and API tokens
  jwt <token>               Analyze JWT for alg:none, RS256->HS256, and weak secrets
  llm-redteam               Run prompt injection & jailbreak safety benchmarks
  web3 <file>               Audit Solidity smart contracts for 10 DeFi vulnerability classes
  memory                    View cross-session persistent hunt memory & cached targets
  scan <dir>                Run AST & static code safety invariant inspection

EXAMPLES:
  node tools/bughunter.mjs recon target.com
  node tools/bughunter.mjs hunt target.com
  node tools/bughunter.mjs autopilot target.com
  node tools/bughunter.mjs secrets packages/
`);
}

async function main() {
  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  switch (command) {
    case 'recon':
    case 'r': {
      const target = args[0] || 'target.com';
      console.log(`🌐 [Recon] Mapping attack surface for: ${target}`);
      const recon = new ReconAgent();
      const surface = recon.mapSurface(target);
      const ranked = recon.rankAttackSurface(surface);
      console.log(`\n📌 Target Surface Score: ${surface.surfaceScore}/100`);
      console.log(`📡 Discovered Subdomains: ${surface.subdomains.length}`);
      console.log(`🚪 Discovered Endpoints: ${surface.endpoints.length}`);
      console.log(`\n🔥 Recommended Attack Priority:`);
      ranked.recommendedAttackOrder.forEach(order => console.log(`   ${order}`));
      break;
    }

    case 'hunt':
    case 'h': {
      const target = args[0] || 'target.com';
      console.log(`🎯 [Hunt] Testing 26 Web2 vulnerability classes on: ${target}`);
      const recon = new ReconAgent();
      const engine = new VulnEngine();
      const validator = new SevenGateValidator();
      const surface = recon.mapSurface(target);
      const findings = engine.scanSurface(surface);
      const triage = validator.filterValidFindings(findings);

      console.log(`\n🔍 Found ${findings.length} candidate finding(s).`);
      console.log(`✅ Passed 7-Question Gate: ${triage.validated.length}`);
      triage.validated.forEach((f, i) => {
        console.log(`   ${i + 1}. [${f.severity}] ${f.title} (${f.cwe || 'Logic'})`);
      });
      break;
    }

    case 'validate':
    case 'v': {
      const sample = args[0] || 'IDOR_BOLA';
      console.log(`⚖️  [7-Question Gate] Evaluating finding: ${sample}`);
      const validator = new SevenGateValidator();
      const result = validator.evaluateFinding({
        title: sample,
        severity: 'HIGH',
        endpoint: '/api/v1/user/123',
        description: 'BOLA bypass allows accessing peer user invoice',
        cwe: 'CWE-639',
        impact: 'Full customer data disclosure'
      });
      console.log(`Status: ${result.status} (Score: ${result.score})`);
      console.log(`Verdict: ${result.verdict}`);
      break;
    }

    case 'autopilot': {
      const target = args[0] || 'target.com';
      const autopilot = new AutopilotEngine();
      const result = await autopilot.runFullLoop(target);
      console.log(`\n✨ Autopilot Finished with Status: ${result.status}`);
      console.log(`📊 Validated Findings: ${result.validatedFindings.length}`);
      console.log(`🔗 Exploit Chains Synthesized: ${result.chains.length}`);
      if (result.chains.length > 0) {
        console.log(`   🔥 ${result.chains[0].name} (CVSS: ${result.chains[0].cvssScore})`);
      }
      console.log(`📝 Generated Reports: ${result.reports.length}`);
      console.log(`🔏 All findings certified with Ed25519 cryptographic receipts.`);
      break;
    }

    case 'secrets': {
      const dir = args[0] || 'packages';
      console.log(`🔑 [Secrets Hunter] Scanning directory: ${dir}`);
      const hunter = new AgenticBugHunter(dir);
      await hunter.scan();
      break;
    }

    case 'jwt': {
      const token = args[0] || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyIjoiYWRtaW4ifQ.sample_sig';
      console.log(`🛡️  [JWT Scanner] Analyzing Token`);
      const jwtScanner = new JwtScanner();
      const analysis = jwtScanner.analyzeToken(token);
      console.log(JSON.stringify(analysis, null, 2));
      const algNone = jwtScanner.forgeAlgNone(token);
      console.log(`\nForged alg:none Token: \n${algNone}`);
      break;
    }

    case 'llm-redteam': {
      console.log(`🤖 [LLM RedTeam] Running Prompt Injection & Safety Benchmark`);
      const redteam = new LlmRedTeam();
      const probes = redteam.getProbes();
      console.log(`Loaded ${probes.length} Red-Team test cases.`);
      probes.forEach(p => {
        console.log(`   - [${p.severity}] ${p.category}: "${p.prompt.slice(0, 45)}..."`);
      });
      break;
    }

    case 'web3': {
      console.log(`⚡ [Web3 Auditor] Scanning Solidity Code across 10 DeFi Bug Classes`);
      const web3 = new Web3Auditor();
      const mockContract = `
        contract Vault {
          mapping(address => uint) public balances;
          function withdraw() public {
            (bool s, ) = msg.sender.call{value: balances[msg.sender]}("");
            balances[msg.sender] = 0;
          }
        }
      `;
      const report = web3.auditSolidity(mockContract, 'Vault.sol');
      console.log(`Contract: ${report.contract}`);
      console.log(`Findings: ${report.findingsCount}`);
      report.findings.forEach(f => {
        console.log(`   ⚠️  [${f.severity}] ${f.name} (${f.ruleId})`);
      });
      break;
    }

    case 'memory': {
      console.log(`🧠 [Hunt Memory] Inspecting Cross-Session Intelligence`);
      const mem = new HuntMemory();
      console.log(`Stored Sessions: ${mem.memory.sessions.length}`);
      console.log(`Cached Targets: ${Object.keys(mem.memory.targetSurfaceCache).length}`);
      break;
    }

    case 'scan': {
      const dir = args[0] || 'packages';
      const hunter = new AgenticBugHunter(dir);
      await hunter.scan();
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exitCode = 1;
  }
}

main().catch(err => {
  console.error('Fatal CLI error:', err);
  process.exitCode = 1;
});
