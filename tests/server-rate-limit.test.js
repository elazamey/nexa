import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { startIsolatedServer } from './celia-workspace-auth-helpers.mjs';

/**
 * D1.10 (O02) / P0-B layer 2 — fixed-window rate limit (D1.10.6: flood → 429).
 *
 * The limiter is a throttle, not a gate: these tests assert both the 429 half and
 * the "it must never be mistaken for authorization" half — an under-budget,
 * unauthenticated `terminal/execute` still has to be refused by the approval
 * contract, not by the throttle.
 */

const KEY = 'nexa-rate-limit-test-key-0123456789';

test('D1.10.6: تجاوز الحد = 429 مع Retry-After، والنافذة تُعاد فتحها', async (t) => {
  const server = await startIsolatedServer(t, undefined, undefined, {
    env: { NEXA_API_KEY: KEY, NEXA_RATE_LIMIT_MAX: '3', NEXA_RATE_LIMIT_WINDOW_MS: '400' },
  });
  const headers = { Authorization: `Bearer ${KEY}` };
  for (let i = 0; i < 3; i += 1) {
    const ok = await server.raw({ method: 'GET', path: '/api/celia/state', headers });
    assert.equal(ok.status, 200, `الطلب ${i + 1} داخل الميزانية`);
    assert.equal(ok.headers['x-ratelimit-limit'], '3');
    assert.equal(ok.headers['x-ratelimit-remaining'], String(2 - i));
  }
  const flooded = await server.raw({ method: 'GET', path: '/api/celia/state', headers });
  assert.equal(flooded.status, 429);
  assert.equal(flooded.body.code, 'NEXA_E_RATE_LIMITED');
  assert.equal(flooded.body.ok, false);
  const retryAfter = Number(flooded.headers['retry-after']);
  assert.ok(Number.isInteger(retryAfter) && retryAfter >= 1, 'Retry-After بالثواني، صحيح موجب');

  await sleep(450);
  const after = await server.raw({ method: 'GET', path: '/api/celia/state', headers });
  assert.equal(after.status, 200, 'نافذة ثابتة: تُعاد فتحها بدل العقاب الدائم');
});

test('D1.10.6: الفاشلون لا يستهلكون ميزانية المشغّل (مفتاح الهوية لا الـIP وحده)', async (t) => {
  const server = await startIsolatedServer(t, undefined, undefined, {
    env: { NEXA_API_KEY: KEY, NEXA_RATE_LIMIT_MAX: '5', NEXA_RATE_LIMIT_WINDOW_MS: '60000' },
  });
  // Flood unauthenticated traffic (keyed to the peer address).
  for (let i = 0; i < 12; i += 1) {
    await server.raw({ method: 'GET', path: '/api/celia/state' });
  }
  const operator = await server.raw({
    method: 'GET', path: '/api/celia/state', headers: { Authorization: `Bearer ${KEY}` },
  });
  assert.equal(operator.status, 200, 'إغراق مجهول لا يقفل المشغّل الموثوق (خلف proxy كل المستخدمين عنوان واحد)');
});

test('D1.10.6: مسارات الصحة والهيكل الساكن خارج الحد', async (t) => {
  const server = await startIsolatedServer(t, undefined, undefined, {
    env: { NEXA_API_KEY: KEY, NEXA_RATE_LIMIT_MAX: '2', NEXA_RATE_LIMIT_WINDOW_MS: '60000' },
  });
  for (let i = 0; i < 6; i += 1) {
    const health = await server.raw({ method: 'GET', path: '/healthz' });
    assert.equal(health.status, 200, 'Probe القصة يُقفل = إعادة تدوير الخدمة');
    const shell = await server.raw({ method: 'GET', path: '/' });
    assert.equal(shell.status, 200, 'هيكل الـSPA لا يُخنق: بوابة الدخول يجب أن تُحمّل');
  }
  const probe = await server.raw({ method: 'GET', path: '/api/v1/session' });
  assert.equal(probe.status, 200, 'استكشاف الجلسة قراءة حالة، لا ميزانية');
});

test('D1.10.6: ميزانية دخول أصغر لأنحاول المفتاح، والرميز يفرّق عن /api', async (t) => {
  const server = await startIsolatedServer(t, undefined, undefined, {
    env: { NEXA_API_KEY: KEY, NEXA_RATE_LIMIT_LOGIN_MAX: '2' },
  });
  const first = await server.raw({ method: 'POST', path: '/api/v1/session', body: { apiKey: 'wrong-1' } });
  assert.equal(first.status, 401);
  const second = await server.raw({ method: 'POST', path: '/api/v1/session', body: { apiKey: 'wrong-2' } });
  assert.equal(second.status, 401);
  const third = await server.raw({ method: 'POST', path: '/api/v1/session', body: { apiKey: 'wrong-3' } });
  assert.equal(third.status, 429, 'تخمين المفتاح مكلف');
  const fourth = await server.raw({ method: 'POST', path: '/api/v1/session', body: { apiKey: KEY } });
  assert.equal(fourth.status, 429, 'الميزانية لا تُفرَّغ بمحاولة صحيحة بعد الامتلاء');
});

test('D1.10.6: الحد يعمل في كل بيئة — حتى والجدار منخفض (local/dev/test)', async (t) => {
  const server = await startIsolatedServer(t, undefined, undefined, {
    env: { NEXA_RATE_LIMIT_MAX: '4', NEXA_RATE_LIMIT_WINDOW_MS: '60000' },
  });
  for (let i = 0; i < 4; i += 1) {
    const ok = await server.raw({ method: 'GET', path: '/api/celia/state' });
    assert.equal(ok.status, 200, `بلا مفتاح: بلا جدار، لكن بميزانية (${i + 1}/4)`);
  }
  const blocked = await server.raw({ method: 'GET', path: '/api/celia/state' });
  assert.equal(blocked.status, 429);
});

test('D1.10.6: الحد ليس تفويضًا — طلب unter-budget بلا موافقة يُرفض بالسياسة لا بالـ429', async (t) => {
  const server = await startIsolatedServer(t, undefined, undefined, {
    env: { NEXA_RATE_LIMIT_MAX: '200' },
  });
  const run = await server.raw({
    method: 'POST', path: '/api/v1/terminal/execute',
    body: { program: 'echo', args: ['rate-limit-is-not-authorization'] },
  });
  assert.equal(run.status, 400, 'الرفض من عقد الأسفل/السياسة، لا من الخنق');
  assert.equal(run.body.ok, false);
  assert.notEqual(run.status, 429, 'المِحدّ لا يجوز أن يكون هو من رفض');
  assert.notEqual(run.body.code, 'NEXA_E_RATE_LIMITED');
  assert.match(String(run.body.code), /^NEXA_E_/, 'سبب NEXA من طبقة أعمق');
});

test('D1.10.6: الوضع القابل للضبط (ip / forwarded) يغيّر المفتاح لا النتيجة', async (t) => {
  const ipMode = await startIsolatedServer(t, undefined, undefined, {
    env: { NEXA_API_KEY: KEY, NEXA_RATE_LIMIT_MAX: '3', NEXA_RATE_LIMIT_KEY_MODE: 'ip' },
  });
  // Same socket peer for both a keyed and an anonymous caller ⇒ shared bucket.
  for (let i = 0; i < 3; i += 1) {
    await ipMode.raw({ method: 'GET', path: '/api/celia/state', headers: { Authorization: `Bearer ${KEY}` } });
  }
  const starved = await ipMode.raw({
    method: 'GET', path: '/api/celia/state', headers: { Authorization: `Bearer ${KEY}` },
  });
  assert.equal(starved.status, 429, 'ip mode: مشغّل ومجهول يتقاسمان الدلو — وهذا بالضبط سبب كون الوضع افتراضيًا identity');

  const forwarded = await startIsolatedServer(t, undefined, undefined, {
    env: { NEXA_RATE_LIMIT_MAX: '2', NEXA_RATE_LIMIT_KEY_MODE: 'forwarded' },
  });
  const a = [];
  for (let i = 0; i < 2; i += 1) {
    a.push(await forwarded.raw({ method: 'GET', path: '/api/celia/state', headers: { 'x-forwarded-for': '203.0.113.7' } }));
  }
  assert.deepEqual(a.map((r) => r.status), [200, 200]);
  const b = await forwarded.raw({ method: 'GET', path: '/api/celia/state', headers: { 'x-forwarded-for': '198.51.100.4' } });
  assert.equal(b.status, 200, 'forwarded mode: جيران الـproxy لا يتقاسمون الدلو');
});
