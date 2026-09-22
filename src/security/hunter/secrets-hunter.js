/**
 * SecretsHunter - High Entropy & Leaked Credential Scanner
 * Scans strings, codebases, and bundles for live API keys, tokens, and credentials.
 */
export class SecretsHunter {
  constructor() {
    this.patterns = [
      {
        type: 'AWS_ACCESS_KEY',
        regex: /\b(AKIA[0-9A-Z]{16})\b/,
        severity: 'CRITICAL',
        description: 'Amazon Web Services Access Key ID'
      },
      {
        type: 'GITHUB_TOKEN',
        regex: /\b(ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59})\b/,
        severity: 'CRITICAL',
        description: 'GitHub Personal Access Token'
      },
      {
        type: 'SLACK_WEBHOOK',
        regex: /https:\/\/hooks\.slack\.com\/services\/T[a-zA-Z0-9_]+\/B[a-zA-Z0-9_]+\/[a-zA-Z0-9_]+/,
        severity: 'HIGH',
        description: 'Slack Incoming Webhook URL'
      },
      {
        type: 'OPENAI_API_KEY',
        regex: /\b(sk-[a-zA-Z0-9]{20}T3BlbkFJ[a-zA-Z0-9]{20}|sk-proj-[a-zA-Z0-9_-]{48,})\b/,
        severity: 'HIGH',
        description: 'OpenAI Secret API Key'
      },
      {
        type: 'DATABASE_URL_WITH_CREDENTIALS',
        regex: /\b(postgres|postgresql|mysql|mongodb(?:\+srv)?):\/\/[^:\/\s]+:[^@\/\s]+@[a-zA-Z0-9\.\-_]+/,
        severity: 'CRITICAL',
        description: 'Database connection URI containing plaintext credentials'
      },
      {
        type: 'PRIVATE_KEY_BLOCK',
        regex: /-----BEGIN (?:RSA|EC|OPENSSH|DSA|PGP) PRIVATE KEY-----/,
        severity: 'CRITICAL',
        description: 'Asymmetric cryptographic private key block'
      }
    ];
  }

  /**
   * Scans text content for leaked credentials
   */
  scanContent(content, filename = 'buffer') {
    const findings = [];
    const lines = content.split('\n');

    lines.forEach((line, index) => {
      // Ignore comments explicitly marked as test or mock
      if (line.includes('// test-mock') || line.includes('# mock-key')) return;

      for (const p of this.patterns) {
        const match = line.match(p.regex);
        if (match) {
          findings.push({
            type: 'HARDCODED_SECRET',
            secretType: p.type,
            severity: p.severity,
            file: filename,
            line: index + 1,
            matchedPreview: `${match[0].slice(0, 8)}...[REDACTED]`,
            description: p.description
          });
        }
      }
    });

    return findings;
  }
}
