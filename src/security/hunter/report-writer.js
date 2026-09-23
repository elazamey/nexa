/**
 * ReportWriter - Multi-Platform Bug Bounty & Cryptographic Report Generator
 * Builds high-impact, submission-ready reports for HackerOne, Bugcrowd, Intigriti, and Immunefi.
 */
/**
 * D1.8 (A13 / DI-17): تذييل مشتق من إيصال finding نفسه — لا نص ثابت.
 * «7/7 PASSED» و«cryptographically pre-validated» كانا يُروَّيان لأي finding، بما فيه
 * من لا إيصال له أصلًا؛ الآن: إيصال صادر ⇒ معرّفه ودرجته وبصمة توقيعه، وغير ذلك ⇒ NOT
 * CERTIFIED مع الرمز والأسباب، ولا ادعاء تشفيري.
 */
function certificationFooter(finding) {
  const receipt = finding?.receipt;
  const issued = Boolean(receipt) && receipt.verified === true && typeof receipt.signature === 'string' && receipt.certified !== false;
  if (issued) {
    return (
      `*Gate validation: ${receipt.gateScore ?? 'issued'} · receipt ${receipt.findingId ?? '(unidentified)'} · ` +
      `signature ${String(receipt.signature).slice(0, 16)}… · NEXA Evidence Bridge (cryptographically signed).*`
    );
  }
  if (!receipt) {
    return '*NOT CERTIFIED — no NEXA receipt was issued for this finding; nothing in this report is cryptographically validated.*';
  }
  const reasons = Array.isArray(receipt.reasons) && receipt.reasons.length > 0 ? `\n*Refusal reasons: ${receipt.reasons.join(' | ')}*` : '';
  return `*NOT CERTIFIED (${receipt.code ?? 'NEXA-E-NO-RECEIPT'}) — the evidence bridge refused this finding; submit nothing on it.*${reasons}`;
}

export class ReportWriter {
  /**
   * Generates a HackerOne submission markdown report
   */
  generateHackerOneReport(finding, target, chain = null) {
    const title = chain 
      ? `[CRITICAL] ${chain.name} on ${target}`
      : `[${finding.severity}] ${finding.title || finding.type} on ${target}`;

    return `# ${title}

## Summary
${finding.description || 'Vulnerability detected by NEXA Agentic Bug Hunter.'}

## Target Asset
- **Asset**: \`${target}\`
- **Endpoint/Sink**: \`${finding.endpoint || finding.file || 'N/A'}\`
- **Vulnerability Class**: \`${finding.vulnClass || finding.type || 'Custom'}\`
- **Severity**: **${finding.severity}** (CWE: \`${finding.cwe || 'CWE-Unknown'}\`)

${chain ? `## Exploit Chain
This finding was synthesized as part of an exploit chain (${chain.chainId}):
${chain.exploitationScenario.map(s => `- ${s}`).join('\n')}
` : ''}

## Steps To Reproduce
1. Target the asset: \`${target}\`
2. Send request to endpoint: \`${finding.endpoint || finding.file || '/'}\`
3. Observe unauthorized bypass / behavior without identity validation.

## Impact
${finding.impact || 'Direct violation of authorization boundaries and sensitive data exposure.'}

## Remediation / Recommended Fix
${finding.remediation || 'Apply input sanitization and strict capability-based authorization checks.'}

---
${certificationFooter(finding)}
`;
  }

  /**
   * Generates an Immunefi format report for Web3 vulnerabilities
   */
  generateImmunefiReport(finding, targetContract) {
    return `# Bug Report: ${finding.name || finding.ruleId} on ${targetContract}

## Target
- **Contract Address/Name**: \`${targetContract}\`
- **Severity**: **${finding.severity}**
- **Vulnerability Category**: \`${finding.ruleId}\`

## Description
${finding.description}

## Impact
Direct exploitability in EVM contract context, risking user locked funds or contract invariants.

## Proof of Concept
\`\`\`solidity
// Foundry PoC test case
function testExploitScenario() public {
    // 1. Trigger vulnerable state transition
    // 2. Validate drained balance or hijacked owner
}
\`\`\`

## Recommendation
${finding.remediation}
`;
  }
}
