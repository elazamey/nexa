import test from 'node:test';
import assert from 'node:assert/strict';
import { startIsolatedServer } from './celia-workspace-auth-helpers.mjs';

/**
 * D1.10 (O02) / P0-B layer 1 — HTTP perimeter identity.
 *
 * Contract under test (docs/repository-audit-2026-09-22.ar.md §ملحق O — O02):
 *   D1.10.2 invalid credential              → 401
 *   D1.10.3 valid operator key (CLI/header) → authenticated
 *   D1.10.4 SPA session                     → authenticated, no secret in JS
 *   D1.10.5 state change without CSRF       → DENY (403 NEXA_E_CSRF)
 * plus the compatibility half: with no key configured the suite behaves exactly
 * as before this change, and /healthz never needs a credential.
 *
 * Perimeter ≠ authorization: nothing here proves a gate decision — that is
 * tests/server-approval-contract.test.js (layers 1+2 do not substitute for it).
 */

const KEY = 'nexa-perimeter-test-key-0123456789';

function withKey(env = {}) {
  return { ...env, NEXA_API_KEY: KEY };
}

test('D1.10.2: مفتاح خاطئ = 401 على /api/*، ولا تُقرأ الحالة إطلاقًا', async (t) => {
  const server = await startIsolatedServer(t, undefined, undefined, { env: withKey() });
  const bad = await server.raw({ method: 'GET', path: '/api/celia/state', headers: { Authorization: `Bearer ${KEY.slice(0, -2)}zz` } });
  assert.equal(bad.status, 401);
  assert.equal(bad.body.code, 'NEXA_E_UNAUTHENTICATED');
  assert.equal(bad.body.ok, false);
  assert.equal(bad.body.authRequired, true);
  assert.match(bad.headers['www-authenticate'] ?? '', /Bearer/);
  // 401 must not become an oracle: no key material, no prefix, no hint.
  assert.ok(!bad.text.includes(KEY), 'جسم الرفض يسرّب المفتاح');
});

test('D1.10.2: بلا أي مصرّح = 401؛ والمفتاح في query string مرفوض أصلًا', async (t) => {
  const server = await startIsolatedServer(t, undefined, undefined, { env: withKey() });
  const anon = await server.raw({ method: 'GET', path: '/api/celia/state' });
  assert.equal(anon.status, 401, 'الجدار قائم: المجهول لا يقرأ الحالة');
  // Query-string credentials are never a supported form (logs/referer/history).
  const queried = await server.raw({ method: 'GET', path: `/api/celia/state?apiKey=${KEY}` });
  assert.equal(queried.status, 401, 'المفتاح لا يُقبل في الرابط');
  const bogusScheme = await server.raw({ method: 'GET', path: '/api/celia/state', headers: { Authorization: `Basic ${KEY}` } });
  assert.equal(bogusScheme.status, 401, 'مخطط Authorization آخر ليس مسار احتياطي');
});

test('D1.10.3: مفتاح المشغّل الصحيح يمرّ عبر Authorization أو X-Nexa-Api-Key', async (t) => {
  const server = await startIsolatedServer(t, undefined, undefined, { env: withKey() });
  const bearer = await server.raw({ method: 'GET', path: '/api/celia/state', headers: { Authorization: `Bearer ${KEY}` } });
  assert.equal(bearer.status, 200);
  assert.ok(bearer.body && typeof bearer.body === 'object');
  const headered = await server.raw({ method: 'GET', path: '/api/celia/state', headers: { 'X-Nexa-Api-Key': KEY } });
  assert.equal(headered.status, 200);
  // Same-origin CLI surface still works end to end through the wall.
  const requested = await server.raw({
    method: 'POST',
    path: '/api/v1/authorizations/request',
    headers: { Authorization: `Bearer ${KEY}` },
    body: { resource: 'terminal:exec', action: 'exec', target: 'echo perimeter-auth' },
  });
  assert.equal(requested.status, 200, 'الهوية تمرّر الطلب إلى السياسة كما كان قبل الجدار');
  assert.match(String(requested.body.approvalId), /^urn:nexa:approval:/);
});

test('D1.10.4: جلسة الـSPA — كوكي HttpOnly، والسر لا يصل إلى JavaScript', async (t) => {
  const server = await startIsolatedServer(t, undefined, undefined, { env: withKey() });
  const probe = await server.raw({ method: 'GET', path: '/api/v1/session' });
  assert.equal(probe.status, 200, 'بوابة الدخول يجب أن تُستكشف بلا مصرّح');
  assert.equal(probe.body.required, true);
  assert.equal(probe.body.authenticated, false);

  const denied = await server.raw({ method: 'POST', path: '/api/v1/session', body: { apiKey: 'nope' } });
  assert.equal(denied.status, 401);
  assert.ok(!denied.text.includes(KEY));

  const login = await server.raw({ method: 'POST', path: '/api/v1/session', body: { apiKey: KEY } });
  assert.equal(login.status, 200);
  assert.equal(login.body.authenticated, true);
  const cookies = login.headers['set-cookie'] ?? [];
  const sessionCookie = cookies.find((c) => c.startsWith('nexa_session='));
  const csrfCookie = cookies.find((c) => c.startsWith('nexa_csrf='));
  assert.ok(sessionCookie, 'لا كوكي جلسة');
  assert.match(sessionCookie, /HttpOnly/, 'كوكي الجلسة يجب أن يكون HttpOnly');
  assert.match(sessionCookie, /SameSite=Strict/);
  assert.match(sessionCookie, /Path=\//);
  assert.ok(csrfCookie, 'لا كوكي CSRF مرافق');
  assert.ok(!/HttpOnly/.test(csrfCookie), 'رمز CSRF يجب أن يقرأه الصفحة (double-submit)');
  assert.ok(!login.text.includes(KEY), 'استجابة الجلسة تُعيد المفتاح — تسريب');
  assert.ok(!login.body.sessionId.includes(KEY), 'معرّف الجلسة مشتق من المفتاح');

  const cookieHeader = `${sessionCookie.split(';')[0]}`;
  const state = await server.raw({ method: 'GET', path: '/api/celia/state', headers: { cookie: cookieHeader } });
  assert.equal(state.status, 200, 'الجلسة تُصادَق بلا أي سر في JavaScript');

  const html = await server.raw({ method: 'GET', path: '/' });
  assert.equal(html.status, 200, 'هيكل الـSPA يحمّل بلا جلسة حتى تُعرض بوابة الدخول');
  assert.ok(!html.text.includes(KEY), 'المفتاح تسرّب إلى HTML');

  const stale = await server.raw({ method: 'GET', path: '/api/celia/state', headers: { cookie: 'nexa_session=nosuchtoken' } });
  assert.equal(stale.status, 401, 'كوكي غير معروف لا يمرّ');

  const logoutWithoutCsrf = await server.raw({ method: 'DELETE', path: '/api/v1/session', headers: { cookie: cookieHeader } });
  assert.equal(logoutWithoutCsrf.status, 403, 'تسجيل الخروج حالة تغيير أيضًا');
  const logout = await server.raw({
    method: 'DELETE', path: '/api/v1/session',
    headers: { cookie: cookieHeader, 'x-nexa-csrf': login.body.csrfToken },
  });
  assert.equal(logout.status, 200);
  const after = await server.raw({ method: 'GET', path: '/api/celia/state', headers: { cookie: cookieHeader } });
  assert.equal(after.status, 401, 'الجلسة تُسحق عند الخروج');
});

test('D1.10.5: تغيير حالة بجلسة بلا CSRF = مرفوض (HttpOnly ليس دفاع CSRF)', async (t) => {
  const server = await startIsolatedServer(t, undefined, undefined, { env: withKey() });
  const login = await server.raw({ method: 'POST', path: '/api/v1/session', body: { apiKey: KEY } });
  assert.equal(login.status, 200);
  const cookie = (login.headers['set-cookie'] ?? []).find((c) => c.startsWith('nexa_session=')).split(';')[0];

  const crossSite = await server.raw({
    method: 'POST', path: '/api/v1/authorizations/request',
    headers: { cookie },
    body: { resource: 'terminal:exec', action: 'exec', target: 'echo csrf-probe' },
  });
  assert.equal(crossSite.status, 403, 'POST بجلسة بلا رمز CSRF يجب أن يُرفض');
  assert.equal(crossSite.body.code, 'NEXA_E_CSRF');

  const wrong = await server.raw({
    method: 'POST', path: '/api/v1/authorizations/request',
    headers: { cookie, 'x-nexa-csrf': 'guessed' },
    body: { resource: 'terminal:exec', action: 'exec', target: 'echo csrf-probe' },
  });
  assert.equal(wrong.status, 403, 'رمز CSRF خاطئ لا يمر');

  const ok = await server.raw({
    method: 'POST', path: '/api/v1/authorizations/request',
    headers: { cookie, 'x-nexa-csrf': login.body.csrfToken },
    body: { resource: 'terminal:exec', action: 'exec', target: 'echo csrf-probe' },
  });
  assert.equal(ok.status, 200, 'الرمز الصحيح يعيد المسار إلى سلوكه الطبيعي');

  // A header-token client is not a cookie carrier: CSRF does not apply to it,
  // and the wall must not silently start requiring a token it never issued.
  const cli = await server.raw({
    method: 'POST', path: '/api/v1/authorizations/request',
    headers: { Authorization: `Bearer ${KEY}` },
    body: { resource: 'terminal:exec', action: 'exec', target: 'echo csrf-cli' },
  });
  assert.equal(cli.status, 200);
});

test('D1.10 perimeter: بلا مفتاح الجدار منخفض — سلوك التطوير/الاختبار كما هو', async (t) => {
  const server = await startIsolatedServer(t);
  const session = await server.raw({ method: 'GET', path: '/api/v1/session' });
  assert.equal(session.status, 200);
  assert.equal(session.body.required, false);
  assert.equal(session.body.mode, 'open');
  const open = await server.get('/api/celia/state');
  assert.equal(open.status, 200, 'absent key = today’s behaviour (compatibility clause)');
  const login = await server.raw({ method: 'POST', path: '/api/v1/session', body: { apiKey: 'whatever' } });
  assert.equal(login.status, 200, 'بوابة الدخول لا تُعطّل الواجهة عندما يكون الجدار منخفضًا');
  assert.equal(login.body.required, false);
});

test('D1.10 perimeter: /healthz بلا سر وبلا جدار، ولا يعيد أي مادة حساسة', async (t) => {
  const server = await startIsolatedServer(t, undefined, undefined, { env: withKey() });
  const health = await server.raw({ method: 'GET', path: '/healthz' });
  assert.equal(health.status, 200);
  assert.equal(health.body.ok, true);
  assert.equal(health.body.authRequired, true);
  assert.ok(!health.text.includes(KEY));
  assert.equal(Object.keys(health.body).sort().join(','), 'authRequired,ok,service');
});

test('D1.10 perimeter: كوكي Secure في الإنتاج أو خلف https، والمفتاح الفارغ = غائب', async (t) => {
  // إقرار مؤقتية الحالة مطلوب من D1.11 فصاعدًا لأي إقلاع production: هذا الاختبار
  // يقيس أعلام الكوكي في الإنتاج، لا خلفية الاستمرارية (انظر server-startup-guard).
  const prod = await startIsolatedServer(t, undefined, undefined, {
    env: withKey({ NODE_ENV: 'production', NEXA_PRODUCTION_PERSISTENCE: 'ack-mock-ephemeral' }),
  });
  const prodLogin = await prod.raw({ method: 'POST', path: '/api/v1/session', body: { apiKey: KEY } });
  assert.equal(prodLogin.status, 200);
  const prodCookie = (prodLogin.headers['set-cookie'] ?? []).find((c) => c.startsWith('nexa_session='));
  assert.match(prodCookie, /Secure/, 'production cookie must be Secure');
  const devLogin = await prod.raw({
    method: 'POST', path: '/api/v1/session', body: { apiKey: KEY },
    headers: { 'x-forwarded-proto': 'https' },
  });
  assert.match((devLogin.headers['set-cookie'] ?? []).find((c) => c.startsWith('nexa_session=')), /Secure/);

  const blank = await startIsolatedServer(t, undefined, undefined, { env: { NEXA_API_KEY: '   ' } });
  const blankSession = await blank.raw({ method: 'GET', path: '/api/v1/session' });
  assert.equal(blankSession.body.required, false, 'مفتاح مكوّن من فراغ = مفتاح مفقود، لا مفتاح يطابق ""');
  const blankState = await blank.raw({ method: 'GET', path: '/api/celia/state' });
  assert.equal(blankState.status, 200);
});

test('D1.10 perimeter: CORS — المسارات المسموحة تتسع للرأسين ولا تتغير سياسة الأصل', async (t) => {
  const server = await startIsolatedServer(t, undefined, undefined, { env: withKey() });
  const preflight = await server.raw({ method: 'OPTIONS', path: '/api/v1/authorizations/request' });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers['access-control-allow-headers'] ?? '', /Authorization/);
  assert.match(preflight.headers['access-control-allow-headers'] ?? '', /X-Nexa-Api-Key/i);
  assert.equal(preflight.headers['access-control-allow-origin'], '*', 'سياسة الأصل خارج نطاق D1.10');
});
