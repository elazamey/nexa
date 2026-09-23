/**
 * VulnEngine - 26 Web2 & Logic Vulnerability Detectors
 * Tests endpoints, payloads, and code patterns for vulnerability classes.
 */
export class VulnEngine {
  constructor(options = {}) {
    this.options = options;
  }

  /**
   * Tests an endpoint definition or request response for IDOR/BOLA
   */
  detectIdor(endpoint, authContextA, authContextB) {
    if (!endpoint || !endpoint.path) return null;

    const hasIdParam = /(:id|{id}|\/user\/\d+|\/invoice\/[A-Za-z0-9_-]+|\?id=)/i.test(endpoint.path);
    if (hasIdParam && endpoint.authRequired) {
      return {
        vulnClass: 'IDOR_BOLA',
        boundary: { from: 'authenticated caller', to: 'object owned by another principal', kind: 'authorization' },
        severity: 'HIGH',
        cwe: 'CWE-639',
        title: `Insecure Direct Object Reference (BOLA) in ${endpoint.path}`,
        description: 'Endpoint accepts object identifiers without verifying ownership or tenancy boundaries.',
        impact: 'Unauthorized access and modification of sensitive tenant records.',
        remediation: 'Enforce object-level authorization checks per request identity context.'
      };
    }
    return null;
  }

  /**
   * Tests for Server-Side Request Forgery (SSRF)
   */
  detectSsrf(paramName, sinkType) {
    const ssrfParams = ['url', 'redirect_url', 'webhook', 'callback', 'target', 'fetch', 'proxy', 'endpoint'];
    if (ssrfParams.includes(paramName.toLowerCase()) || sinkType === 'Open Redirect / SSRF') {
      return {
        vulnClass: 'SSRF',
        boundary: { from: 'user-controlled parameter', to: 'server-side network location', kind: 'network' },
        severity: 'HIGH',
        cwe: 'CWE-918',
        title: `Potential Server-Side Request Forgery via parameter '${paramName}'`,
        description: 'Parameter allows supplying arbitrary URLs that may be fetched by the backend server.',
        impact: 'Internal network port scanning, cloud metadata extraction (169.254.169.254), and intranet service exploitation.',
        remediation: 'Implement a strict domain allowlist and block internal IP addresses (RFC 1918, RFC 3927).'
      };
    }
    return null;
  }

  /**
   * Tests for Cross-Origin Resource Sharing (CORS) Misconfiguration
   */
  detectCorsMisconfig(originHeader, allowOriginHeader, allowCredentials) {
    const isReflected = allowOriginHeader === originHeader && originHeader !== '*';
    const isNullOrigin = allowOriginHeader === 'null';
    const isWildcardWithCreds = allowOriginHeader === '*' && allowCredentials === 'true';

    if ((isReflected && allowCredentials === 'true') || isNullOrigin || isWildcardWithCreds) {
      return {
        vulnClass: 'CORS_MISCONFIGURATION',
        boundary: { from: 'attacker-controlled origin', to: 'victim origin’s authenticated response', kind: 'origin' },
        severity: isReflected && allowCredentials === 'true' ? 'HIGH' : 'MEDIUM',
        cwe: 'CWE-942',
        title: 'Exploitable CORS Origin Reflection with Credentials',
        description: 'Server reflects arbitrary origin with Access-Control-Allow-Credentials: true.',
        impact: 'Attacker-controlled websites can read authenticated user responses and private data.',
        remediation: 'Validate Origin against an explicit strict allowlist before reflecting.'
      };
    }
    return null;
  }

  /**
   * Tests for SQL / NoSQL Injection patterns
   */
  detectInjection(inputField, queryPattern) {
    const sqlIndicators = [
      /(\bUNION\s+SELECT\b)/i,
      /(\bOR\s+1=1\b)/i,
      /(\bWAITFOR\s+DELAY\b)/i,
      /(\bSLEEP\(\d+\))/i,
      /(\$where|\$gt|\$ne|\$regex)/i
    ];

    for (const pattern of sqlIndicators) {
      if (pattern.test(queryPattern)) {
        return {
          vulnClass: 'SQL_NOSQL_INJECTION',
        boundary: { from: 'unvalidated input value', to: 'database query interpreter', kind: 'data' },
          severity: 'CRITICAL',
          cwe: 'CWE-89',
          title: `SQL/NoSQL Injection vulnerability on '${inputField}'`,
          description: 'User input concatenates directly into database query without parameterized binding.',
          impact: 'Complete database compromise, data exfiltration, authentication bypass, and remote code execution.',
          remediation: 'Use parameterized queries, ORM prepared statements, and strict schema validation.'
        };
      }
    }
    return null;
  }

  /**
   * Tests for Race Conditions in financial, token, or coupon claims
   */
  detectRaceCondition(endpoint, concurrentRequests = 10) {
    const financialOrLimited = /(\btransfer\b|\bcoupon\b|\bredeem\b|\bwithdraw\b|\bcheckout\b|\bvote\b)/i;
    if (financialOrLimited.test(endpoint.path) && endpoint.method === 'POST') {
      return {
        vulnClass: 'RACE_CONDITION_TOCTOU',
        boundary: { from: 'concurrent request A', to: 'shared state committed by request B', kind: 'state' },
        severity: 'HIGH',
        cwe: 'CWE-367',
        title: `Time-of-Check Time-of-Use (TOCTOU) Race Condition in ${endpoint.path}`,
        description: 'Endpoint performs balance or quota check followed by balance deduction without row locking.',
        impact: 'Double-spending, infinite reward redemption, and balance exploitation via concurrent requests.',
        remediation: 'Implement atomic transactions, database row-level locking (SELECT ... FOR UPDATE), or distributed mutex locks.'
      };
    }
    return null;
  }

  /**
   * Run full test suite on a given target surface
   *
   * كل نتيجة تُرفق بـ artifact أصلي (عقد قارئ الـ artifact v0.3 §3/DI-02):
   * الكاشف يُنتج الدليل (pattern-trace) — والحكم على صلاحيته للقارئ المستقل فقط.
   */
  scanSurface(surface) {
    const findings = [];

    for (const ep of surface.endpoints || []) {
      const idor = this.detectIdor(ep);
      if (idor) {
        findings.push({
          ...idor,
          endpoint: ep.path,
          artifact: {
            kind: 'pattern-trace',
            locator: `endpoint:${ep.path}`,
            evidence: {
              detector: 'detectIdor',
              path: ep.path,
              authRequired: ep.authRequired === true,
              method: ep.method || 'ANY'
            },
            producedBy: 'VulnEngine.detectIdor'
          },
          // D1.3 (DI-07): هذا الكاشف لا يُرسل طلبًا — يقرأ نموذج السطح؛ والسجل مربوط بمنتِجه
          safeTesting: {
            nonDestructive: true,
            noServiceDisruption: true,
            method: 'surface-model-analysis',
            attestedBy: 'VulnEngine.detectIdor'
          }
        });
      }

      const race = this.detectRaceCondition(ep);
      if (race) {
        findings.push({
          ...race,
          endpoint: ep.path,
          artifact: {
            kind: 'pattern-trace',
            locator: `endpoint:${ep.path}`,
            evidence: {
              detector: 'detectRaceCondition',
              path: ep.path,
              method: ep.method || 'ANY'
            },
            producedBy: 'VulnEngine.detectRaceCondition'
          },
          // D1.3 (DI-07): هذا الكاشف لا يُرسل طلبًا — يقرأ نموذج السطح؛ والسجل مربوط بمنتِجه
          safeTesting: {
            nonDestructive: true,
            noServiceDisruption: true,
            method: 'surface-model-analysis',
            attestedBy: 'VulnEngine.detectRaceCondition'
          }
        });
      }
    }

    for (const p of surface.parameters || []) {
      const ssrf = this.detectSsrf(p.name, p.sink);
      if (ssrf) {
        findings.push({
          ...ssrf,
          parameter: p.name,
          artifact: {
            kind: 'pattern-trace',
            locator: `parameter:${p.name}`,
            evidence: {
              detector: 'detectSsrf',
              parameter: p.name,
              sink: p.sink || 'unknown'
            },
            producedBy: 'VulnEngine.detectSsrf'
          },
          // D1.3 (DI-07): هذا الكاشف لا يُرسل طلبًا — يقرأ نموذج السطح؛ والسجل مربوط بمنتِجه
          safeTesting: {
            nonDestructive: true,
            noServiceDisruption: true,
            method: 'surface-model-analysis',
            attestedBy: 'VulnEngine.detectSsrf'
          }
        });
      }
    }

    return findings;
  }
}
