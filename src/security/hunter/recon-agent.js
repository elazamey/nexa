import { URL } from 'node:url';

/**
 * ReconAgent - Surface Mapping & Target Enumeration
 * Maps attack surface, enumerates paths/parameters, and enforces program scope.
 */
export class ReconAgent {
  constructor(options = {}) {
    this.inScopePatterns = options.inScopePatterns || [];
    this.outOfScopePatterns = options.outOfScopePatterns || [];
  }

  /**
   * Checks if a target URL/domain is within allowed scope rules
   */
  isScopeAllowed(targetUrl) {
    let hostname;
    try {
      const parsed = targetUrl.startsWith('http') ? new URL(targetUrl) : new URL(`https://${targetUrl}`);
      hostname = parsed.hostname;
    } catch {
      hostname = targetUrl;
    }

    // Explicitly out of scope takes precedence
    for (const pattern of this.outOfScopePatterns) {
      if (this._matchPattern(hostname, pattern)) {
        return false;
      }
    }

    // If no in-scope patterns are specified, default to true
    if (this.inScopePatterns.length === 0) {
      return true;
    }

    for (const pattern of this.inScopePatterns) {
      if (this._matchPattern(hostname, pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Discovers and simulates endpoint and subdomain attack surfaces
   */
  mapSurface(target, options = {}) {
    const rootDomain = target.replace(/^https?:\/\//, '').split('/')[0];
    
    // Subdomain permutation list
    const subdomains = [
      `api.${rootDomain}`,
      `auth.${rootDomain}`,
      `admin.${rootDomain}`,
      `dev.${rootDomain}`,
      `staging.${rootDomain}`,
      `internal.${rootDomain}`,
      `graphql.${rootDomain}`,
      `v1.${rootDomain}`,
      `v2.${rootDomain}`
    ].filter(sub => this.isScopeAllowed(sub));

    // Common sensitive endpoints
    const endpoints = [
      { path: '/api/v1/user/profile', method: 'GET', authRequired: true, risk: 'MEDIUM' },
      { path: '/api/v1/admin/users', method: 'GET', authRequired: true, risk: 'HIGH' },
      { path: '/api/v1/billing/invoices', method: 'GET', authRequired: true, risk: 'HIGH' },
      { path: '/graphql', method: 'POST', authRequired: false, risk: 'HIGH' },
      { path: '/oauth/token', method: 'POST', authRequired: false, risk: 'CRITICAL' },
      { path: '/debug/vars', method: 'GET', authRequired: false, risk: 'MEDIUM' },
      { path: '/.env', method: 'GET', authRequired: false, risk: 'CRITICAL' },
      { path: '/api/v1/internal/health', method: 'GET', authRequired: false, risk: 'LOW' },
      { path: '/api/v1/export?format=csv', method: 'GET', authRequired: true, risk: 'HIGH' }
    ];

    // Discovered parameters
    const params = [
      { name: 'id', type: 'integer', sink: 'IDOR / SQLi' },
      { name: 'user_id', type: 'uuid', sink: 'IDOR / BOLA' },
      { name: 'redirect_url', type: 'url', sink: 'Open Redirect / SSRF' },
      { name: 'callback', type: 'string', sink: 'JSONP / DOM XSS' },
      { name: 'query', type: 'string', sink: 'SQLi / NoSQLi' },
      { name: 'template', type: 'string', sink: 'SSTI' },
      { name: 'file', type: 'filepath', sink: 'LFI / Path Traversal' }
    ];

    return {
      target: rootDomain,
      timestamp: new Date().toISOString(),
      subdomains,
      endpoints,
      parameters: params,
      surfaceScore: this._computeSurfaceScore(subdomains, endpoints, params)
    };
  }

  /**
   * Ranks attack surface items by priority/risk
   */
  rankAttackSurface(surface) {
    const priorityEndpoints = surface.endpoints
      .slice()
      .sort((a, b) => {
        const score = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
        return (score[b.risk] || 0) - (score[a.risk] || 0);
      });

    return {
      target: surface.target,
      highestRiskEndpoints: priorityEndpoints.filter(e => e.risk === 'CRITICAL' || e.risk === 'HIGH'),
      recommendedAttackOrder: [
        '1. Authenticated IDOR / BOLA in User & Billing endpoints',
        '2. GraphQL introspection and unauthenticated mutations',
        '3. OAuth token exchange & state parameter validation',
        '4. Parameter injection on template/redirect sinks',
        '5. Secrets leak in client JS bundles / debug endpoints'
      ]
    };
  }

  _computeSurfaceScore(subdomains, endpoints, params) {
    const base = subdomains.length * 10 + endpoints.length * 5 + params.length * 3;
    return Math.min(100, Math.max(10, base));
  }

  _matchPattern(hostname, pattern) {
    if (pattern === hostname) return true;
    if (pattern.startsWith('*.')) {
      const root = pattern.slice(2);
      return hostname === root || hostname.endsWith(`.${root}`);
    }
    return false;
  }
}
