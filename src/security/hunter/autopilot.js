import { ReconAgent } from './recon-agent.js';
import { VulnEngine } from './vuln-engine.js';
import { SevenGateValidator } from './seven-gate-validator.js';
import { ChainBuilder } from './chain-builder.js';
import { SecretsHunter } from './secrets-hunter.js';
import { JwtScanner } from './jwt-scanner.js';
import { LlmRedTeam } from './llm-redteam.js';
import { Web3Auditor } from './web3-auditor.js';
import { ReportWriter } from './report-writer.js';
import { NexaEvidenceBridge } from './nexa-evidence-bridge.js';
import { HuntMemory } from './hunt-memory.js';

/**
 * AutopilotEngine - Full Autonomous Bug Hunting Loop
 * Orchestrates Recon -> Scan -> Gate Validation -> Chaining -> Cryptographic Receipt -> Report
 */
export class AutopilotEngine {
  constructor(options = {}) {
    this.reconAgent = new ReconAgent(options);
    this.vulnEngine = new VulnEngine(options);
    this.validator = new SevenGateValidator(options);
    this.chainBuilder = new ChainBuilder();
    this.secretsHunter = new SecretsHunter();
    this.jwtScanner = new JwtScanner();
    this.llmRedTeam = new LlmRedTeam();
    this.web3Auditor = new Web3Auditor();
    this.reportWriter = new ReportWriter();
    this.evidenceBridge = new NexaEvidenceBridge();
    this.memory = new HuntMemory();
  }

  /**
   * Runs the full autonomous hunt pipeline on a target
   */
  async runFullLoop(target) {
    console.log(`🚀 [Autopilot] Starting automated hunt loop on target: ${target}`);

    // Step 1: Scope check
    if (!this.reconAgent.isScopeAllowed(target)) {
      return {
        status: 'ABORTED',
        reason: `Target '${target}' is out of authorized scope.`
      };
    }

    // Step 2: Recon & Surface Mapping
    const surface = this.reconAgent.mapSurface(target);
    const rankedSurface = this.reconAgent.rankAttackSurface(surface);
    this.memory.rememberTarget(target, surface);

    // Step 3: Vulnerability Scanning
    const rawFindings = this.vulnEngine.scanSurface(surface);

    // Step 4: 7-Question Gate Validation
    // D1.5 (DI-13): سجل النطاق مشتق من إعداد recon نفسه — لا `{ inScope: true }` مكتوبًا.
    // يُستعمل في الموضعين (التصفية والإيصال) حتى لا يختلف «مسموح بالصيد» عن «مسموح بالتصديق».
    const gateContext = { scope: this.reconAgent.scopeRecord(target) };
    const triage = this.validator.filterValidFindings(rawFindings, gateContext);

    // Step 5: Exploit Chaining
    const chains = this.chainBuilder.synthesizeChains(triage.validated);

    // Step 6: Cryptographic NEXA Certification
    // D1.8 (DI-17): تُعدّ issued ما صدر له إيصال فعلًا — الرفض يبقى مرئيًا بلا أن يُروَّج
    const attempted = triage.validated.map(f => ({
      ...f,
      receipt: this.evidenceBridge.certifyFinding(f, target, { gateContext })
    }));
    // نفس عقد الإيصال الصادر: verified + signature (والرفض certified:false)
    const isIssued = (f) => Boolean(f.receipt) && f.receipt.verified === true && typeof f.receipt.signature === 'string' && f.receipt.certified !== false;
    const certifiedFindings = attempted.filter(isIssued);
    const refusedFindings = attempted
      .filter(f => !isIssued(f))
      .map(f => ({
        title: f.title,
        vulnClass: f.vulnClass || f.type,
        code: f.receipt?.code ?? 'NEXA-E-NO-RECEIPT',
        reasons: Array.isArray(f.receipt?.reasons) ? f.receipt.reasons : []
      }));

    // Step 7: Report Generation — تقرير لكل إيصال صادر، مربوطًا به بالمعرّف
    const reports = certifiedFindings.map(f => ({
      findingId: f.receipt.findingId,
      severity: f.severity,
      title: f.title,
      markdown: this.reportWriter.generateHackerOneReport(f, target, chains[0] || null)
    }));

    // Step 8: Memory Session Persistence
    const sessionSummary = {
      target,
      surfaceScore: surface.surfaceScore,
      totalDiscovered: rawFindings.length,
      passedGate: triage.validated.length,
      chainsFormed: chains.length,
      reportsGenerated: reports.length
    };
    // D1.6 (DI-14): نتيجة الحفظ تُبلَّغ في مخرَج الجولة — ذاكرة مكسورة إشارة، لا نجاح مزوَّف
    const memoryOutcome = this.memory.recordSession(sessionSummary);
    if (!memoryOutcome.persisted) {
      console.warn(`⚠️  [Autopilot] hunt memory NOT persisted (${memoryOutcome.status.code}): ${memoryOutcome.status.reason}`);
    }

    return {
      status: 'COMPLETED',
      target,
      surface,
      rankedSurface,
      memory: {
        persisted: memoryOutcome.persisted,
        code: memoryOutcome.status.code ?? null,
        path: memoryOutcome.status.path
      },
      counts: {
        discovered: rawFindings.length,
        validated: triage.validated.length,
        certified: certifiedFindings.length,
        refused: refusedFindings.length,
        reports: reports.length
      },
      refusedFindings,
      rawFindingsCount: rawFindings.length,
      validatedFindings: certifiedFindings,
      chains,
      reports,
      summary: sessionSummary
    };
  }
}
