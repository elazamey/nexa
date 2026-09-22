/**
 * tools/celia-perimeter-auth.mjs — D1.10 / P0-B layer 1: HTTP perimeter identity.
 *
 * SCOPE, stated once so it cannot be misread later:
 *   This module authenticates a *transport*. It never grants a capability, never
 *   touches policy, and never approves anything. `authenticated ≠ authorized`
 *   and `approved ≠ authenticated` are the two axioms the rest of NEXA keeps:
 *
 *     HTTP Authentication → Identity → Capability / Authorizer → Policy
 *                       → Approval → Execution
 *
 *   Getting past this file buys you an *identity*, nothing more. Every gate that
 *   matters is enforced downstream in packages/{capability,policy,evidence}.
 *
 * Two client classes, two mechanisms (a browser SPA must never hold a shared
 * secret — anything that reaches page JavaScript is public by definition):
 *
 *   1. operator / CLI / internal HTTP clients:
 *        `Authorization: Bearer <NEXA_API_KEY>`  or  `X-Nexa-Api-Key: <NEXA_API_KEY>`
 *      Header-only. The key is NEVER accepted in a query string (no referer,
 *      no access log, no history entry can carry it). Comparison is
 *      sha256-then-timingSafeEqual: constant time, and no length oracle.
 *
 *   2. browser SPA:
 *        POST /api/v1/session { apiKey }  →  one exchange, then a cookie.
 *      Session cookie is HttpOnly + SameSite=Strict + Path=/ (+ Secure whenever
 *      the runtime is production or the request arrived over https). The secret
 *      exists for exactly one request; afterwards the page holds only an opaque
 *      session id. No endpoint ever returns the key.
 *
 * CSRF: a cookie that the browser attaches automatically needs an
 * unguessable, JS-readable companion token. `HttpOnly` is NOT a CSRF defense —
 * so every state-changing method on a session-authenticated request must replay
 * `x-nexa-csrf` (double-submit). Header-token clients (class 1) cannot carry a
 * cross-site `Authorization` header, so they are exempt from that check only.
 *
 * Absent `NEXA_API_KEY` the wall is closed-by-construction-open: this is the
 * documented local/dev/test behaviour, kept byte-compatible so the existing HTTP
 * suite stays green without edits. Production without a key fails fast at
 * startup (see tools/celia-dashboard-server.mjs, D1.10 layer 3).
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const PERIMETER_VERSION = 'nexa:perimeter:v1';

/** Routes owned by the perimeter itself — never gated by the wall. */
export const SESSION_ROUTE = '/api/v1/session';
export const HEALTH_ROUTE = '/healthz';

export const SESSION_COOKIE = 'nexa_session';
export const CSRF_COOKIE = 'nexa_csrf';
export const CSRF_HEADER = 'x-nexa-csrf';

/** Login payloads are tiny; anything larger is a hostile or confused client. */
export const MAX_LOGIN_BODY_BYTES = 32 * 1024;

const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const DEFAULT_MAX_SESSIONS = 1_000;
/** A wall that answers with prose tells the attacker it exists; keep it terse. */
const UNAUTHENTICATED_HINT = 'NEXA perimeter: a credential is required';

const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Empty string / whitespace is a *missing* key, never a key that matches "". */
export function normalizeApiKey(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function isProductionRuntime(env = process.env) {
  return env.NODE_ENV === 'production' || env.NEXA_ENV === 'production';
}

function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest();
}

/** Constant-time secret comparison over equal-length digests (no length oracle). */
export function secretsEqual(presented, expected) {
  if (typeof presented !== 'string' || typeof expected !== 'string') return false;
  return timingSafeEqual(sha256(presented), sha256(expected));
}

function token(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

function shortId(value) {
  return sha256(value).subarray(0, 8).toString('hex');
}

/** Minimal `Cookie:` parser — no dependency, no prototype writes. */
export function parseCookies(header) {
  const out = Object.create(null);
  if (typeof header !== 'string' || header.length === 0) return out;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    if (name.length === 0 || name === '__proto__' || name === 'constructor') continue;
    out[name] = decodeURIComponentSafe(part.slice(index + 1).trim());
  }
  return out;
}

function decodeURIComponentSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function readRawBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('request body too large'), { code: 'NEXA_E_SCHEMA', status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function clientIp(req) {
  const peer = req.socket?.remoteAddress;
  return typeof peer === 'string' && peer.length > 0 ? peer : 'unknown';
}

/**
 * Only a *trusted* proxy may set `x-forwarded-for`. Default is the socket peer;
 * `NEXA_TRUST_PROXY=1` opts into the leftmost forwarded hop (Render/Fly/K8s).
 */
export function resolveClientAddress(req, { trustProxy = false } = {}) {
  if (trustProxy) {
    const header = req.headers?.['x-forwarded-for'];
    const first = typeof header === 'string' ? header.split(',')[0]?.trim() : undefined;
    if (first) return { ip: first, source: 'x-forwarded-for' };
  }
  return { ip: clientIp(req), source: 'socket' };
}

function isHttps(req, url) {
  const proto = String(req.headers?.['x-forwarded-proto'] ?? '').split(',')[0].trim().toLowerCase();
  return proto === 'https' || url?.protocol === 'https:';
}

/**
 * Build the perimeter for one server process.
 *
 * @param {object} [options]
 * @param {string} [options.apiKey] explicit secret (defaults to env.NEXA_API_KEY)
 * @param {Record<string,string|undefined>} [options.env]
 * @param {() => number} [options.now] injected clock — deterministic in tests
 * @param {number} [options.sessionTtlMs]
 * @param {number} [options.maxSessions] cap so a login flood cannot grow the map forever
 * @param {(entry: object) => void} [options.onAudit] boundary-local audit sink (never a policy source)
 * @returns {{
 *   required: boolean, production: boolean, sessionCount(): number,
 *   authenticate(req: object, url: URL): object, csrfOk(req: object, context: object): boolean,
 *   handleSession(req: object, res: object, url: URL): Promise<boolean>,
 *   checkApiKey(presented: string|null): boolean,
 *   stats(): object, dispose(): void
 * }}
 */
export function createPerimeter(options = {}) {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const ttlMs = Number.isSafeInteger(options.sessionTtlMs) && options.sessionTtlMs > 0
    ? options.sessionTtlMs : DEFAULT_SESSION_TTL_MS;
  const maxSessions = Number.isSafeInteger(options.maxSessions) && options.maxSessions > 0
    ? options.maxSessions : DEFAULT_MAX_SESSIONS;
  const trustProxy = env.NEXA_TRUST_PROXY === '1' || env.NEXA_TRUST_PROXY === 'true';
  const onAudit = typeof options.onAudit === 'function' ? options.onAudit : () => {};

  const secret = normalizeApiKey(options.apiKey ?? env.NEXA_API_KEY);
  const required = secret !== null;
  const production = isProductionRuntime(env);

  /** tokenDigest(hex) → session record. Raw tokens are never stored. */
  const sessions = new Map();
  const auditCount = { login: 0, rejectedLogin: 0, anonymous: 0 };

  function sweep() {
    const cutoff = now();
    for (const [digestId, session] of sessions) {
      if (session.expiresAt <= cutoff) sessions.delete(digestId);
    }
  }

  const sweeper = setInterval(sweep, Math.max(60_000, Math.floor(ttlMs / 4)));
  if (typeof sweeper.unref === 'function') sweeper.unref();

  function issueSession({ csrfToken }) {
    const sessionToken = token(32);
    const record = {
      csrfToken,
      sessionId: `nexa:session:${shortId(sessionToken)}`,
      createdAt: now(),
      expiresAt: now() + ttlMs,
    };
    sessions.set(sha256(sessionToken).toString('hex'), record);
    if (sessions.size > maxSessions) {
      // Oldest-first eviction: memory bound, not a security decision.
      const oldest = sessions.keys().next().value;
      if (oldest !== undefined) sessions.delete(oldest);
    }
    return { sessionToken, record };
  }

  function lookupSession(sessionToken) {
    if (typeof sessionToken !== 'string' || sessionToken.length === 0) return null;
    const key = sha256(sessionToken).toString('hex');
    const record = sessions.get(key);
    if (!record) return null;
    if (record.expiresAt <= now()) {
      sessions.delete(key);
      return null;
    }
    return { key, record };
  }

  /** Header-only key check, also used by the rate limiter to classify identity. */
  function presentedApiKey(req) {
    const header = req.headers ?? {};
    const authorization = header.authorization;
    if (typeof authorization === 'string') {
      const match = /^Bearer[ \t]+(.+?)[ \t]*$/i.exec(authorization);
      if (match) return { kind: 'bearer', value: normalizeApiKey(match[1]) };
      // Any other Authorization scheme is a client mistake, not a fallback path.
      return { kind: 'bearer', value: null };
    }
    const direct = header['x-nexa-api-key'];
    if (typeof direct === 'string') return { kind: 'x-nexa-api-key', value: normalizeApiKey(direct) };
    return { kind: null, value: null };
  }

  function checkApiKey(presented) {
    if (!required) return false;
    return secretsEqual(presented, secret);
  }

  /**
   * The single identity decision for a request.
   * @returns {{ok: true, context: object}|{ok: false, status: number, code: string, error: string}}
   */
  function authenticate(req, url) {
    const address = resolveClientAddress(req, { trustProxy });
    const cookies = parseCookies(req.headers?.cookie);
    const presented = presentedApiKey(req);

    if (presented.kind !== null && presented.value !== null) {
      if (!checkApiKey(presented.value)) {
        return { ok: false, status: 401, code: 'NEXA_E_UNAUTHENTICATED', error: UNAUTHENTICATED_HINT };
      }
      return {
        ok: true,
        context: {
          method: 'api-key',
          header: presented.kind,
          clientId: `key:${shortId(presented.value)}`,
          sessionId: null,
          csrfToken: null,
          ip: address.ip,
          ipSource: address.source,
          secure: isHttps(req, url),
        },
      };
    }
    // A present-but-empty bearer token is a failure when the wall is up, and a
    // silent no-op when it is not — never a "let it through because blank".
    if (presented.kind !== null && required) {
      return { ok: false, status: 401, code: 'NEXA_E_UNAUTHENTICATED', error: UNAUTHENTICATED_HINT };
    }

    const found = lookupSession(cookies[SESSION_COOKIE]);
    if (found) {
      return {
        ok: true,
        context: {
          method: 'session',
          header: null,
          clientId: `session:${shortId(found.record.sessionId)}`,
          sessionId: found.record.sessionId,
          csrfToken: found.record.csrfToken,
          ip: address.ip,
          ipSource: address.source,
          secure: isHttps(req, url),
        },
      };
    }
    if (found === null && typeof cookies[SESSION_COOKIE] === 'string' && cookies[SESSION_COOKIE].length > 0 && required) {
      return { ok: false, status: 401, code: 'NEXA_E_UNAUTHENTICATED', error: UNAUTHENTICATED_HINT };
    }
    if (required) {
      return { ok: false, status: 401, code: 'NEXA_E_UNAUTHENTICATED', error: UNAUTHENTICATED_HINT };
    }
    auditCount.anonymous += 1;
    return {
      ok: true,
      context: {
        method: 'anonymous',
        header: null,
        clientId: `ip:${shortId(address.ip)}`,
        sessionId: null,
        csrfToken: null,
        ip: address.ip,
        ipSource: address.source,
        secure: isHttps(req, url),
      },
    };
  }

  /**
   * Double-submit CSRF gate. Applies only where a browser cookie did the
   * authenticating; a cross-site document cannot read the token nor set a
   * custom header on a credentialed request.
   */
  function csrfOk(req, context) {
    if (!STATE_CHANGING.has(String(req.method).toUpperCase())) return true;
    if (context?.method !== 'session') return true;
    const header = req.headers?.[CSRF_HEADER];
    const presented = Array.isArray(header) ? header[0] : header;
    if (typeof presented !== 'string' || presented.length === 0) return false;
    return secretsEqual(presented, context.csrfToken);
  }

  function cookieHeaders({ sessionToken, csrfToken, secure, clear = false }) {
    const attributes = [
      'Path=/',
      'SameSite=Strict',
      ...(secure ? ['Secure'] : []),
      clear ? 'Max-Age=0' : `Max-Age=${Math.floor(ttlMs / 1000)}`,
    ];
    const out = [`${SESSION_COOKIE}=${clear ? '' : sessionToken}; ${attributes.join('; ')}; HttpOnly`];
    out.push(`${CSRF_COOKIE}=${clear ? '' : csrfToken}; ${attributes.join('; ')}`);
    return out;
  }

  function sendJson(res, status, payload, headers = {}) {
    const body = JSON.stringify(payload);
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'Cache-Control': 'no-store',
      ...headers,
    });
    res.end(body);
  }

  /**
   * Owns /api/v1/session. Returns true when the perimeter answered.
   * Never echoes a secret, never writes to the ledger, never touches policy.
   */
  async function handleSession(req, res, url) {
    const method = String(req.method).toUpperCase();
    const secure = isHttps(req, url) || production;
    const cookies = parseCookies(req.headers?.cookie);
    const presented = cookies[SESSION_COOKIE];
    const found = lookupSession(presented);

    if (method === 'GET') {
      sendJson(res, 200, {
        ok: true,
        perimeter: PERIMETER_VERSION,
        required,
        authenticated: found !== null,
        mode: required ? (found ? 'session' : 'login-required') : 'open',
        ...(found ? { sessionId: found.record.sessionId, csrfToken: found.record.csrfToken } : {}),
      });
      return true;
    }

    if (method === 'POST') {
      let args = {};
      try {
        const raw = await readRawBody(req, MAX_LOGIN_BODY_BYTES);
        args = raw.length > 0 ? JSON.parse(raw) : {};
      } catch (e) {
        const status = e.status === 413 ? 413 : 400;
        sendJson(res, status, { ok: false, code: 'NEXA_E_SCHEMA', error: 'JSON body required' });
        return true;
      }
      const candidate = normalizeApiKey(args?.apiKey);
      if (!required) {
        // Wall is down: a session is meaningless, but the SPA must not stall.
        sendJson(res, 200, { ok: true, required: false, authenticated: true, mode: 'open' });
        return true;
      }
      if (candidate === null || !checkApiKey(candidate)) {
        auditCount.rejectedLogin += 1;
        onAudit({ type: 'PERIMETER_LOGIN_REJECTED', at: new Date(now()).toISOString(), ip: resolveClientAddress(req, { trustProxy }).ip });
        sendJson(res, 401, { ok: false, code: 'NEXA_E_UNAUTHENTICATED', error: UNAUTHENTICATED_HINT });
        return true;
      }
      const csrfToken = token(24);
      const { sessionToken, record } = issueSession({ csrfToken });
      auditCount.login += 1;
      onAudit({ type: 'PERIMETER_SESSION_ISSUED', at: new Date(now()).toISOString(), sessionId: record.sessionId });
      sendJson(res, 200, {
        ok: true,
        required: true,
        authenticated: true,
        mode: 'session',
        sessionId: record.sessionId,
        csrfToken,
        expiresAt: new Date(record.expiresAt).toISOString(),
      }, { 'Set-Cookie': cookieHeaders({ sessionToken, csrfToken, secure }) });
      return true;
    }

    if (method === 'DELETE') {
      // Logout is state-changing: a cross-site document must not be able to log
      // the operator out (nor probe session validity) with a bare POST/DELETE.
      if (found) {
        const header = req.headers?.[CSRF_HEADER];
        const given = Array.isArray(header) ? header[0] : header;
        if (typeof given !== 'string' || !secretsEqual(given, found.record.csrfToken)) {
          sendJson(res, 403, { ok: false, code: 'NEXA_E_CSRF', error: 'CSRF token required' });
          return true;
        }
        sessions.delete(found.key);
      }
      sendJson(res, 200, { ok: true, authenticated: false }, {
        'Set-Cookie': cookieHeaders({ sessionToken: null, csrfToken: null, secure, clear: true }),
      });
      return true;
    }

    sendJson(res, 405, { ok: false, code: 'NEXA_E_SCHEMA', error: 'method not allowed' }, { Allow: 'GET, POST, DELETE' });
    return true;
  }

  function stats() {
    sweep();
    return {
      required,
      production,
      sessions: sessions.size,
      // Deliberately no key fingerprint: a digest of a low-entropy secret is an
      // offline dictionary oracle, and this object can end up in a log line.
      keyConfigured: required,
      ...auditCount,
    };
  }

  function dispose() {
    clearInterval(sweeper);
    sessions.clear();
  }

  return {
    required,
    production,
    authenticate,
    csrfOk,
    handleSession,
    checkApiKey,
    stats,
    dispose,
    // Read-only view for the layer-2 limiter (it keys off identity, never secrets).
    sessionCount: () => sessions.size,
  };
}

/** 401 body for the wall; deliberately carries no hint about which half failed. */
export function unauthorizedPayload() {
  return { ok: false, code: 'NEXA_E_UNAUTHENTICATED', error: UNAUTHENTICATED_HINT, authRequired: true };
}
