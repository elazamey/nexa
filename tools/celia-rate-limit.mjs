/**
 * tools/celia-rate-limit.mjs — D1.10 / P0-B layer 2: fixed-window rate limit.
 *
 * A DEFENCE-IN-DEPTH THROTTLE, NOT AN AUTHORIZATION MECHANISM. It bounds request
 * churn and credential-guessing cost; it does not decide whether an operation is
 * permitted. `terminal/execute` is protected by the approval ledger and the
 * kernel gates — never by "the limiter will catch it". If this file were deleted,
 * every security decision would still have to be made correctly downstream.
 *
 * Position is contractual (D1.10 layer ordering):
 *
 *   Request → Authentication → RATE LIMIT → Authorization/CSRF → Policy → Executor
 *
 * so a key is charged to the identity that reached it, and unauthenticated or
 * failed traffic to the peer address. One nuance, deliberate: when a request is
 * BOTH unauthenticated and over budget, 429 wins over 401 — otherwise the 401
 * path is an unlimited credential oracle. The identity step still runs first;
 * only the error precedence differs.
 *
 * Bucket key is configurable because a bare peer address is meaningless behind a
 * proxy (every user shares one egress IP, and a spoofed `x-forwarded-for` would
 * let an attacker hand their neighbour the quota):
 *
 *   NEXA_RATE_LIMIT_KEY_MODE=identity   (default) identity first, IP for the
 *                                       unauthenticated remainder
 *   NEXA_RATE_LIMIT_KEY_MODE=ip         always the socket peer
 *   NEXA_RATE_LIMIT_KEY_MODE=forwarded  leftmost x-forwarded-for, ONLY when a
 *                                       trusted proxy is guaranteed
 *
 * Zero dependencies, fixed window (one counter per key per window). A token bucket
 * or a sliding window would need a data structure this repo does not have and a
 * guarantee it does not need: approximate bounds are enough for a defence layer.
 */
import { createHash } from 'node:crypto';

export const RATE_LIMIT_VERSION = 'nexa:rate-limit:v1';
export const DEFAULT_WINDOW_MS = 60_000;
/** Generous for a human driving a dashboard, tiny compared to a flood. */
export const DEFAULT_MAX_REQUESTS = 120;
/** Login attempts get their own, much smaller budget: credential stuffing cost. */
export const DEFAULT_MAX_LOGIN_ATTEMPTS = 20;
const MAX_BUCKETS = 10_000;
const RETRY_AFTER_HEADER = 'Retry-After';

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function bucketId(key) {
  return createHash('sha256').update(String(key), 'utf8').digest().subarray(0, 8).toString('hex');
}

function peerAddress(req, { trustProxy = false } = {}) {
  if (trustProxy) {
    const header = req.headers?.['x-forwarded-for'];
    const first = typeof header === 'string' ? header.split(',')[0]?.trim() : undefined;
    if (first) return first;
  }
  const socket = req.socket?.remoteAddress;
  return typeof socket === 'string' && socket.length > 0 ? socket : 'unknown';
}

/**
 * @param {object} [options]
 * @param {Record<string,string|undefined>} [options.env]
 * @param {() => number} [options.now] injected clock (deterministic in tests)
 * @param {number} [options.max] override NEXA_RATE_LIMIT_MAX
 * @param {number} [options.windowMs] override NEXA_RATE_LIMIT_WINDOW_MS
 * @param {number} [options.loginMax] override NEXA_RATE_LIMIT_LOGIN_MAX
 * @param {string} [options.keyMode] override NEXA_RATE_LIMIT_KEY_MODE
 * @param {(entry: object) => void} [options.onAudit]
 */
export function createRateLimiter(options = {}) {
  const env = options.env ?? process.env;
  const now = options.now ?? Date.now;
  const windowMs = positiveInt(options.windowMs ?? env.NEXA_RATE_LIMIT_WINDOW_MS, DEFAULT_WINDOW_MS);
  const max = positiveInt(options.max ?? env.NEXA_RATE_LIMIT_MAX, DEFAULT_MAX_REQUESTS);
  const loginMax = positiveInt(options.loginMax ?? env.NEXA_RATE_LIMIT_LOGIN_MAX, DEFAULT_MAX_LOGIN_ATTEMPTS);
  // 0 is an explicit "off" switch for a load test; anything invalid keeps the default.
  const enabled = !(String(env.NEXA_RATE_LIMIT_MAX ?? '').trim() === '0');
  const requestedMode = String(options.keyMode ?? env.NEXA_RATE_LIMIT_KEY_MODE ?? 'identity').trim().toLowerCase();
  const keyMode = ['identity', 'ip', 'forwarded'].includes(requestedMode) ? requestedMode : 'identity';
  const trustProxy = keyMode === 'forwarded';
  const onAudit = typeof options.onAudit === 'function' ? options.onAudit : () => {};

  /** bucketId → { count, windowStart } */
  const buckets = new Map();
  let rejected = 0;

  function sweep() {
    const cutoff = now() - windowMs;
    for (const [id, bucket] of buckets) {
      if (bucket.windowStart <= cutoff) buckets.delete(id);
    }
  }

  function keyFor(req, { context, kind = 'api' } = {}) {
    if (kind === 'login') return `login:${peerAddress(req, { trustProxy })}`;
    if (keyMode === 'ip') return `ip:${peerAddress(req, { trustProxy })}`;
    if (keyMode === 'forwarded') return `fwd:${peerAddress(req, { trustProxy })}`;
    // identity mode: a named caller owns its own budget; nobody else does.
    if (context?.method === 'api-key') return `key:${context.clientId}`;
    if (context?.method === 'session') return `session:${context.clientId}`;
    return `ip:${peerAddress(req, { trustProxy })}`;
  }

  /**
   * Charge one unit to the caller's window. Pure: no I/O, no policy knowledge.
   * @returns {{ok: true, limit: number, remaining: number, resetMs: number, bucket: string}
   *          | {ok: false, limit: number, retryAfterSec: number, bucket: string}}
   */
  function consume(key, { limit = max, cost = 1 } = {}) {
    if (!enabled) return { ok: true, limit, remaining: limit, resetMs: 0, bucket: 'disabled' };
    const id = bucketId(key);
    const at = now();
    let bucket = buckets.get(id);
    if (!bucket || at - bucket.windowStart >= windowMs) {
      if (buckets.size >= MAX_BUCKETS) {
        sweep();
        if (buckets.size >= MAX_BUCKETS) buckets.clear(); // bounded memory over exactness
      }
      bucket = { count: 0, windowStart: at };
      buckets.set(id, bucket);
    }
    bucket.count += cost;
    if (bucket.count <= limit) {
      return {
        ok: true,
        limit,
        remaining: Math.max(0, limit - bucket.count),
        resetMs: Math.max(0, bucket.windowStart + windowMs - at),
        bucket: id,
      };
    }
    const retryAfterSec = Math.max(1, Math.ceil((bucket.windowStart + windowMs - at) / 1000));
    rejected += 1;
    // D1.28: الرفض يصل صنبور التحقيق — بنفس شكل سطر الـ perimeter (type/at) لأن الـ DAG يخلط
    // الاثنين، وبـ bucket هو الوسم القاصر الذي يعيده الحكم نفسه (لا الدلو الخام ولا عنوان صاحبه).
    // الصنبور لا يُلفّ بـ try: صنبورٌ يرمي خلل في صاحبه، وإسكاته بصمت يعيد عادة || true.
    onAudit({
      type: 'RATE_LIMIT_REJECTED',
      at: new Date(now()).toISOString(),
      bucket: id,
      limit,
      retryAfterSec,
    });
    return { ok: false, limit, retryAfterSec, bucket: id };
  }

  const sweeper = setInterval(sweep, Math.max(30_000, Math.floor(windowMs / 2)));
  if (typeof sweeper.unref === 'function') sweeper.unref();

  function stats() {
    sweep();
    return { enabled, keyMode, windowMs, max, loginMax, buckets: buckets.size, rejected };
  }

  function dispose() {
    clearInterval(sweeper);
    buckets.clear();
  }

  return {
    enabled,
    keyMode,
    max,
    loginMax,
    windowMs,
    version: RATE_LIMIT_VERSION,
    keyFor,
    consume,
    stats,
    dispose,
  };
}

/** 429 body + Retry-After. No bucket contents, no other caller's data. */
export function sendTooManyRequests(res, verdict) {
  const body = JSON.stringify({
    ok: false,
    code: 'NEXA_E_RATE_LIMITED',
    error: 'perimeter rate limit exceeded',
    limit: verdict.limit,
    retryAfterMs: verdict.retryAfterSec * 1000,
  });
  res.writeHead(429, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    [RETRY_AFTER_HEADER]: String(verdict.retryAfterSec),
  });
  res.end(body);
}

/** Informational headers for accepted traffic (never a decision input). */
export function rateLimitHeaders(verdict) {
  if (verdict.bucket === 'disabled') return {};
  return {
    'X-RateLimit-Limit': String(verdict.limit),
    'X-RateLimit-Remaining': String(verdict.remaining),
  };
}
