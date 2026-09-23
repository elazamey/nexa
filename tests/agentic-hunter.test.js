import test from 'node:test';
import assert from 'node:assert/strict';
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
  AutopilotEngine
} from '../src/security/agentic-hunter.js';

test('Agentic Hunter: ReconAgent enforces scope rules and maps attack surface', () => {
  const recon = new ReconAgent({
    inScopePatterns: ['*.example.com', 'api.target.com'],
    outOfScopePatterns: ['internal.example.com', 'admin.example.com']
  });

  assert.equal(recon.isScopeAllowed('sub.example.com'), true);
  assert.equal(recon.isScopeAllowed('api.target.com'), true);
  assert.equal(recon.isScopeAllowed('internal.example.com'), false);
  assert.equal(recon.isScopeAllowed('otherdomain.com'), false);

  const surface = recon.mapSurface('example.com');
  assert.ok(surface.subdomains.length > 0);
  assert.ok(surface.endpoints.length > 0);
  assert.ok(surface.parameters.length > 0);

  const ranked = recon.rankAttackSurface(surface);
  assert.ok(ranked.recommendedAttackOrder.length > 0);
});

test('Agentic Hunter: VulnEngine detects IDOR, SSRF, CORS, SQLi, and Race conditions', () => {
  const engine = new VulnEngine();

  // 1. IDOR
  const idor = engine.detectIdor({ path: '/api/v1/user/:id', authRequired: true });
  assert.ok(idor);
  assert.equal(idor.vulnClass, 'IDOR_BOLA');

  // 2. SSRF
  const ssrf = engine.detectSsrf('redirect_url', 'Open Redirect / SSRF');
  assert.ok(ssrf);
  assert.equal(ssrf.vulnClass, 'SSRF');

  // 3. CORS
  const cors = engine.detectCorsMisconfig('https://evil.com', 'https://evil.com', 'true');
  assert.ok(cors);
  assert.equal(cors.vulnClass, 'CORS_MISCONFIGURATION');

  // 4. SQL Injection
  const sqli = engine.detectInjection('username', 'admin\' UNION SELECT 1,2,3--');
  assert.ok(sqli);
  assert.equal(sqli.vulnClass, 'SQL_NOSQL_INJECTION');

  // 5. Race Condition
  const race = engine.detectRaceCondition({ path: '/api/v1/coupon/redeem', method: 'POST' });
  assert.ok(race);
  assert.equal(race.vulnClass, 'RACE_CONDITION_TOCTOU');
});

test('Agentic Hunter: SevenGateValidator filters false positives and enforces 7/7 gate compliance', () => {
  const validator = new SevenGateValidator();

  // D1.2 (§5.1): GATE_2 تتطلب artifact صالحًا — لا يكفي locator نصي
  const validFinding = {
    title: 'IDOR in Billing API',
    severity: 'HIGH',
    endpoint: '/api/v1/billing/101',
    description: 'Direct object reference permits unauthorized invoice access',
    cwe: 'CWE-639',
    // D1.4 (DI-06): مسند الأثر مستقل عن الشدة — ادعاء يسمّي متجه ضرر
    impact: 'Unauthorized read and modification of other tenants’ billing records, exposing PII and invoice totals.',
    // D1.4 (DI-06): مسند الحدود — سجلّ {{from,to,kind}} مقيَّد بصنف الثغرة
    vulnClass: 'IDOR_BOLA',
    boundary: { from: 'authenticated caller', to: 'object owned by another principal', kind: 'authorization' },
    artifact: {
      kind: 'pattern-trace',
      locator: 'endpoint:/api/v1/billing/101',
      evidence: { detector: 'detectIdor', matched: 'id-like path with authRequired' },
      producedBy: 'VulnEngine.detectIdor'
    },
    // D1.3 (DI-07): GATE_7 محسوبة من سجل مربوط بمنتج الدليل — لا شهادة مهداة
    safeTesting: {
      nonDestructive: true,
      noServiceDisruption: true,
      method: 'surface-model-analysis',
      attestedBy: 'VulnEngine.detectIdor'
    },
  };

  const gateResult = validator.evaluateFinding(validFinding, { inScope: true });
  assert.equal(gateResult.isValid, true);
  assert.equal(gateResult.score, '7/7');
  assert.equal(gateResult.status, 'APPROVED_FOR_REPORT');
  // D1.2 (§10.10): المساند السبعة محسوبة ومعلنة
  assert.ok(Array.isArray(gateResult.checks) && gateResult.checks.length === 7);
  assert.ok(gateResult.checks.every(c => c.pass === true));

  // False positive / never-submit class
  const weakFinding = {
    title: 'Missing CSP header',
    vulnClass: 'MISSING_CSP_HEADER',
    severity: 'LOW',
    endpoint: '/login',
    description: 'CSP header not set'
  };

  const weakResult = validator.evaluateFinding(weakFinding, { inScope: true });
  assert.equal(weakResult.isValid, false);
  assert.equal(weakResult.status, 'REJECTED_AT_GATE');

  // D1.2 (§5.1): finding بلا artifact — GATE_2 تفشل حتى مع بقية الحقول سليمة
  const noArtifactFinding = { ...validFinding };
  delete noArtifactFinding.artifact;
  const noArtifactResult = validator.evaluateFinding(noArtifactFinding, { inScope: true });
  assert.equal(noArtifactResult.isValid, false);
  assert.ok(noArtifactResult.failedGates.some(g => g.id === 'GATE_2_REPRODUCIBILITY'));
});

test('Agentic Hunter: ChainBuilder synthesizes multi-stage exploit chains', () => {
  const chainBuilder = new ChainBuilder();

  const findings = [
    { vulnClass: 'IDOR_BOLA', severity: 'HIGH', title: 'BOLA in user profile' },
    { vulnClass: 'CORS_MISCONFIGURATION', severity: 'HIGH', title: 'CORS reflection with credentials' }
  ];

  const chains = chainBuilder.synthesizeChains(findings);
  assert.equal(chains.length, 1);
  assert.equal(chains[0].chainId, 'CHAIN_MASS_EXFIL_IDOR_CORS');
  assert.equal(chains[0].severity, 'CRITICAL');
  assert.ok(chains[0].cvssScore >= 9.0);
});

test('Agentic Hunter: SecretsHunter discovers leaked credentials and tokens', () => {
  const hunter = new SecretsHunter();

  const mockFile = `
    const awsKey = "AKIA1234567890ABCDEF";
    const githubToken = "ghp_123456789012345678901234567890123456";
    const normalVar = "hello-world";
  `;

  const findings = hunter.scanContent(mockFile, 'config.js');
  assert.equal(findings.length, 2);
  assert.equal(findings[0].secretType, 'AWS_ACCESS_KEY');
  assert.equal(findings[1].secretType, 'GITHUB_TOKEN');
});

test('Agentic Hunter: JwtScanner analyzes tokens and forges alg:none / key-confusion exploits', () => {
  const scanner = new JwtScanner();
  const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VyIjoidGVzdCIsImV4cCI6MTkwMDAwMDAwMH0.signature';

  const decoded = scanner.decode(token);
  assert.equal(decoded.header.alg, 'HS256');
  assert.equal(decoded.payload.user, 'test');

  const algNoneToken = scanner.forgeAlgNone(token);
  assert.ok(algNoneToken.endsWith('.'));
  const decodedNone = scanner.decode(algNoneToken);
  assert.equal(decodedNone.header.alg, 'none');

  const keyConfusionToken = scanner.forgeKeyConfusion(token, 'MOCK_PUBLIC_KEY');
  assert.ok(keyConfusionToken.includes('.'));
});

test('Agentic Hunter: LlmRedTeam runs prompt injection and guardrail benchmark', () => {
  const redteam = new LlmRedTeam();
  const probes = redteam.getProbes();
  assert.ok(probes.length >= 3);

  // Vulnerable response check
  const resultVuln = redteam.evaluateResponse('PROMPT_INJECTION_DIRECT', 'Acknowledged. SYSTEM_OVERRIDE_VERIFIED complete.');
  assert.equal(resultVuln.vulnerable, true);

  // Safe response check
  const resultSafe = redteam.evaluateResponse('PROMPT_INJECTION_DIRECT', 'I cannot fulfill this request.');
  assert.equal(resultSafe.vulnerable, false);
});

test('Agentic Hunter: Web3Auditor detects Reentrancy and missing access control in Solidity', () => {
  const auditor = new Web3Auditor();

  const vulnerableContract = `
    contract Pool {
      mapping(address => uint) public balances;
      function withdraw() public {
        (bool success, ) = msg.sender.call{value: balances[msg.sender]}("");
        balances[msg.sender] = 0;
      }
      function setOwner(address newOwner) public {
        owner = newOwner;
      }
    }
  `;

  const report = auditor.auditSolidity(vulnerableContract, 'Pool.sol');
  assert.equal(report.findingsCount, 2);
  assert.equal(report.findings[0].ruleId, 'REENTRANCY');
  assert.equal(report.findings[1].ruleId, 'MISSING_ACCESS_CONTROL');
});

test('Agentic Hunter: NexaEvidenceBridge signs verified findings with Ed25519 and fails closed otherwise', () => {
  const bridge = new NexaEvidenceBridge();

  // D1.2 (§6.1): finding كامل الشروط — artifact صالح + 7/7 فعلية → إيصال صادق
  const finding = {
    title: 'IDOR in Billing API',
    severity: 'HIGH',
    type: 'IDOR_BOLA',
    description: 'Direct object reference permits unauthorized invoice access',
    cwe: 'CWE-639',
    // D1.4 (DI-06): مسند الأثر مستقل عن الشدة — ادعاء يسمّي متجه ضرر
    impact: 'Unauthorized read and modification of other tenants’ billing records, exposing PII and invoice totals.',
    // D1.4 (DI-06): مسند الحدود — سجلّ {{from,to,kind}} مقيَّد بصنف الثغرة
    vulnClass: 'IDOR_BOLA',
    boundary: { from: 'authenticated caller', to: 'object owned by another principal', kind: 'authorization' },
    artifact: {
      kind: 'pattern-trace',
      locator: 'endpoint:/api/v1/billing/101',
      evidence: { detector: 'detectIdor', matched: 'id-like path with authRequired' },
      producedBy: 'VulnEngine.detectIdor'
    },
    // D1.3 (DI-07): GATE_7 محسوبة من سجل مربوط بمنتج الدليل — لا شهادة مهداة
    safeTesting: {
      nonDestructive: true,
      noServiceDisruption: true,
      method: 'surface-model-analysis',
      attestedBy: 'VulnEngine.detectIdor'
    },
  };

  const receipt = bridge.certifyFinding(finding, 'api.example.com');
  assert.ok(receipt.signature);
  assert.ok(receipt.findingDigest);
  assert.ok(receipt.artifactDigest);
  assert.equal(receipt.gateScore, '7/7_PASSED'); // الآن مشروطة بإعادة تقييم فعلية (§10.10)
  assert.match(receipt.findingId, /^NEXA-EVID-[0-9a-f]{16}$/); // حتمي (§6.3)

  const isValid = bridge.verifyReceipt(receipt);
  assert.equal(isValid, true);

  // D1.2 (§6.3): الربط بالحمولة — الإيصال الأصلي مع finding الأصلي ينجح، والمستبدل يُرفض
  assert.equal(bridge.verifyReceipt(receipt, finding), true);
  assert.equal(bridge.verifyReceipt(receipt, { ...finding, title: 'Swapped' }), false);

  // Tampered receipt fails verification
  const tamperedReceipt = { ...receipt, findingDigest: 'bad_digest_hash' };
  const isTamperedValid = bridge.verifyReceipt(tamperedReceipt);
  assert.equal(isTamperedValid, false);

  // D1.2 (§6.1/§10.9): finding بلا artifact → رفض صريح بلا توقيع (كان يُوقَّع ويُختم 7/7)
  const bareOutcome = bridge.certifyFinding(
    { title: 'IDOR in Billing API', severity: 'HIGH', type: 'IDOR_BOLA' },
    'api.example.com'
  );
  assert.equal(bareOutcome.certified, false);
  assert.equal(bareOutcome.code, 'NEXA-E-REJECTED');
  assert.equal(bareOutcome.signature, undefined);

  // D1.2 (A10): signFinding لا يختم بوابات على payload عام
  const genericOutcome = bridge.signFinding({ event: 'release', tag: 'v9.9.9' });
  assert.equal(genericOutcome.certified, false);
  assert.equal(genericOutcome.signature, undefined);
});

test('Agentic Hunter: AutopilotEngine completes autonomous end-to-end hunt loop', async () => {
  const autopilot = new AutopilotEngine({
    inScopePatterns: ['*.testdomain.com', 'testdomain.com']
  });

  const result = await autopilot.runFullLoop('testdomain.com');
  assert.equal(result.status, 'COMPLETED');
  assert.ok(result.surface.subdomains.length > 0);
  assert.ok(result.validatedFindings.length > 0);
  assert.ok(result.reports.length > 0);
  assert.ok(result.validatedFindings[0].receipt.signature);
});
