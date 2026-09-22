import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import {
  isolatedRoot, minimalEnv, startIsolatedServer,
} from './celia-workspace-auth-helpers.mjs';
import { assertProductionPerimeter, operatorSeedWarning } from '../tools/celia-startup-guard.mjs';

/**
 * D1.10 (O02) / P0-B layer 3 — production refuses to start with an open wall
 * (D1.10.1: production + no API key → startup FAIL).
 *
 * The boundary that keeps the four layers from collapsing into each other: this
 * guard only reads the perimeter credential. Production + mock memory stays the
 * subject of D1.11 (its own reproducer asserts that booting still succeeds), and
 * the demo operator seed is a warning, never a second fail-fast.
 */

const KEY = 'nexa-startup-test-key-0123456789abcdef';
const ENTRY = 'tools/celia-dashboard-server.mjs';

/** Boot a server that is expected to refuse: no readiness fixture, no listen. */
async function bootToExit(t, env) {
  const root = isolatedRoot(t, 'nexa-startup-');
  const child = spawn(process.execPath, [join(root, ENTRY)], {
    cwd: root, env: minimalEnv(env), stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => { logs = (logs + chunk).slice(-8_000); });
  }
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve({ code: null, timedOut: true, logs });
    }, 10_000);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal, logs }); });
  });
  return { ...result, logs };
}

test('D1.10.1: production بلا مفتاح = فشل إقلاع برمز غير صفري قبل أي listen', async (t) => {
  const { code, logs } = await bootToExit(t, { NODE_ENV: 'production' });
  assert.equal(code, 1, `الإقلاع رفض أن يفشل: ${logs}`);
  assert.match(logs, /NEXA_E_PERIMETER_UNCONFIGURED|perimeter credential/i);
  assert.match(logs, /NEXA_API_KEY/);
  assert.ok(!/running/.test(logs), 'الخادم خدم قبل أن يرفض (يجب أن يموت قبل listen)');
  assert.ok(!logs.includes(KEY), 'رسالة الرفض تسرّح مفتاحًا');
});

test('D1.10.1: مفتاح فارغ/مسافات = مفقود، وإشارة NEXA_ENV وحدها تكفي', async (t) => {
  const blank = await bootToExit(t, { NODE_ENV: 'production', NEXA_API_KEY: '   ' });
  assert.equal(blank.code, 1, 'مفتاح مكوّن من فراغ ليس سرًا (وإلا طابق "")');
  const empty = await bootToExit(t, { NODE_ENV: 'production', NEXA_API_KEY: '' });
  assert.equal(empty.code, 1, 'مفتاح فارغ ليس سرًا');
  const byNexaEnv = await bootToExit(t, { NEXA_ENV: 'production' });
  assert.equal(byNexaEnv.code, 1, 'NODE_ENV مضبوط من منصة وقد تتجاهله: الإشارتان معتمدتان');
});

test('D1.10 layer 3: production بمفتاح يقلع، والصحة تمر بلا مصرّح والمسار لا يخدع الحارس', async (t) => {
  const server = await startIsolatedServer(t, undefined, undefined, {
    env: { NODE_ENV: 'production', NEXA_API_KEY: KEY },
  });
  const health = await server.raw({ method: 'GET', path: '/healthz' });
  assert.equal(health.status, 200, 'مفتش الصحة لا يحمل مصرّحًا: 401 هنا يعني إعادة تدوير لا انقطاعًا');
  assert.equal(health.body.authRequired, true);
  const anon = await server.raw({ method: 'GET', path: '/api/celia/state' });
  assert.equal(anon.status, 401);
  const keyed = await server.raw({
    method: 'GET', path: '/api/celia/state', headers: { Authorization: `Bearer ${KEY}` },
  });
  assert.equal(keyed.status, 200);
  const login = await server.raw({ method: 'POST', path: '/api/v1/session', body: { apiKey: KEY } });
  assert.match((login.headers['set-cookie'] ?? []).find((c) => c.startsWith('nexa_session=')) ?? '', /Secure/);
});

test('D1.10 layer 3: إنتاج + ذاكرة mock يقلع — الحارس لا يبتلع D1.11', async (t) => {
  // SUPABASE_URL='' يسقط إلى mock://memory في الكود: هذا بالضبط ثغرة D1.11،
  // وتذكرة D1.11 تبقى مفتوحة — طبقة المحيط لا تُغلقها عرضًا.
  const server = await startIsolatedServer(t, undefined, undefined, {
    env: { NODE_ENV: 'production', NEXA_API_KEY: KEY, SUPABASE_URL: '', SUPABASE_ANON_KEY: '' },
  });
  const state = await server.raw({
    method: 'GET', path: '/api/celia/state', headers: { Authorization: `Bearer ${KEY}` },
  });
  assert.equal(state.status, 200, 'mock://memory ليست مسؤولية حارس المحيط (انظر known-gaps D1.11)');
});

test('D1.10 layer 3: بيئات التطوير/الاختبار غير معنية بالحارس', async (t) => {
  const dev = await startIsolatedServer(t, undefined, undefined, { env: { NODE_ENV: 'test' } });
  const state = await dev.get('/api/celia/state');
  assert.equal(state.status, 200, 'بلا مفتاح في test = سلوك اليوم');
  const stageless = await startIsolatedServer(t);
  assert.equal((await stageless.raw({ method: 'GET', path: '/api/celia/state' })).status, 200);
});

test('D1.10 layer 3: الحارس دالة نقية بلا إشارات جانبية', () => {
  assert.deepEqual(assertProductionPerimeter({ env: {} }), { ok: true, production: false });
  assert.deepEqual(assertProductionPerimeter({ env: { NODE_ENV: 'development', NEXA_API_KEY: '  ' } }),
    { ok: true, production: false }, 'غير الإنتاج لا رأي فيه');
  const refused = assertProductionPerimeter({ env: { NODE_ENV: 'production' } });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'NEXA_E_PERIMETER_UNCONFIGURED');
  assert.match(refused.message, /NEXA_API_KEY/);
  assert.ok(refused.message.length < 2_000, 'رسالة الإقلاع يجب أن تُقرأ، لا أن تُستنطق');
  assert.deepEqual(assertProductionPerimeter({ env: { NODE_ENV: 'production', NEXA_API_KEY: KEY } }),
    { ok: true, production: true });
  // required wins when the caller already normalised the secret (server path).
  assert.equal(assertProductionPerimeter({ env: { NODE_ENV: 'production', NEXA_API_KEY: KEY }, required: false }).ok, false);
  assert.equal(assertProductionPerimeter({ env: { NEXA_ENV: 'production' }, production: false }).ok, true);

  assert.equal(operatorSeedWarning({ NODE_ENV: 'development' }), null);
  assert.match(operatorSeedWarning({ NODE_ENV: 'production' }), /NEXA_OPERATOR_SEED/);
  assert.equal(operatorSeedWarning({ NODE_ENV: 'production', NEXA_OPERATOR_SEED: 'ab'.repeat(32) }), null,
    'تحذير فقط: لا fail-fast ثانٍ على البذرة — وإلا انكسر كل نشر موثّق');
});
