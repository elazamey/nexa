/**
 * ChainBuilder - Exploit Chain Synthesis Engine
 * Identifies compounding vulnerabilities and constructs multi-stage exploit chains.
 */
export class ChainBuilder {
  constructor() {
    this.chainRecipes = [
      {
        id: 'CHAIN_ATO_OAUTH',
        name: 'Account Takeover via Open Redirect & OAuth Misconfiguration',
        requires: ['SSRF', 'CORS_MISCONFIGURATION'],
        severity: 'CRITICAL',
        cvss: 9.6,
        impact: 'Full account takeover of any target user without interaction beyond clicking a link.',
        steps: [
          'Step 1: Exploit Open Redirect / SSRF sink on callback URL parameter.',
          'Step 2: Poison OAuth authorization flow redirect_uri to leak authorization code.',
          'Step 3: Exchange captured authorization code for authenticated session token.'
        ]
      },
      {
        id: 'CHAIN_MASS_EXFIL_IDOR_CORS',
        name: 'Mass Data Exfiltration via CORS Origin Reflection & BOLA/IDOR',
        requires: ['IDOR_BOLA', 'CORS_MISCONFIGURATION'],
        severity: 'CRITICAL',
        cvss: 9.1,
        impact: 'Attacker website silently iterates and extracts all tenant records via authenticated browser context.',
        steps: [
          'Step 1: Host malicious page that issues authenticated cross-origin requests.',
          'Step 2: CORS wildcard reflection allows reading response bodies with credentials.',
          'Step 3: Iterate object IDs via BOLA sink to drain the entire customer database.'
        ]
      },
      {
        id: 'CHAIN_SSRF_TO_CLOUD_TAKEOVER',
        name: 'Internal Cloud Infrastructure Takeover via SSRF Metadata Extraction',
        requires: ['SSRF', 'HARDCODED_SECRET'],
        severity: 'CRITICAL',
        cvss: 9.8,
        impact: 'Full cluster and cloud environment takeover via IAM role token exfiltration.',
        steps: [
          'Step 1: Direct SSRF parameter to 169.254.169.254/latest/meta-data/iam/security-credentials/.',
          'Step 2: Retrieve AWS/GCP instance temporary IAM credentials.',
          'Step 3: Assume role with administrative policy to take over backend cluster.'
        ]
      }
    ];
  }

  /**
   * Evaluates validated findings to find chaining opportunities
   */
  synthesizeChains(findings) {
    const findingTypes = new Set(findings.map(f => f.vulnClass || f.type));
    const synthesizedChains = [];

    for (const recipe of this.chainRecipes) {
      const match = recipe.requires.every(req => findingTypes.has(req));
      if (match) {
        synthesizedChains.push({
          chainId: recipe.id,
          name: recipe.name,
          severity: recipe.severity,
          cvssScore: recipe.cvss,
          impact: recipe.impact,
          contributingFindings: findings.filter(f => recipe.requires.includes(f.vulnClass || f.type)),
          exploitationScenario: recipe.steps
        });
      }
    }

    return synthesizedChains;
  }
}
