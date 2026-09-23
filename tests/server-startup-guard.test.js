import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { connect as netConnect, createServer as createNetServer } from 'node:net';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { isolatedRoot, minimalEnv, httpChildBootstrap, startIsolatedServer } from './celia-workspace-auth-helpers.mjs';
import * as guard from '../tools/celia-startup-guard.mjs';

/**
 * D1.11 (O03) — الإنتاج لا يقلع حين تكون متطلبات الاستمرارية غير متحققة.
 *
 * العقد المطلوب ليس «exit != 0» فقط، بل ثلاثته معًا:
 *
 *   production + NEXA persistence = mock://memory + startup
 *     → NON-ZERO EXIT  ∧  NO LISTEN  ∧  رمز محدد قابل للتفتيش
 *
 * «لا listen» مُثبَت بطريقتين مستقلتين، لأن فشل العملية *بعد* أن استمعت لا يشفي
 * شيئًا: (أ) ناقل الإقلاع في الاختبارات يرسل {type:'ready'} من داخل listen() —
 * غيابه برهان على أن الاستماع لم يُستدعَ قط؛ (ب) منفذ TCP محجوز مسبقًا يُستطرق
 * أثناء حياة العملية وبعدها: لا اتصال ناجح واحد، والمنفذ قابل للربط بعد الخروج.
 *
 * النفي المقابل مُثبَت أيضًا: development + mock = إقلاع مسموح كما كان، و
 * production + خلفية حقيقية = العقد محفوظ. والحارس يستند إلى **حكم البورت**
 * (`_isMock`) لا إلى شكل الإعداد: `SUPABASE_URL` حقيقي مع سائق غائب هو بالضبط
 * ادعاء الاستمرارية الكاذب الذي أُغلق هذا الملف لأجله، فلا يُقبل بأي مفتاح
 * «looks real».
 */

const ENTRY = 'tools/celia-dashboard-server.mjs';
const CODE = 'NEXA_E_PERSISTENCE_MOCK';

/** Spawn through the test transport: 'ready' arrives only if listen() ran. */
async function bootViaFixture(t, env, { waitMs = 6_000 } = {}) {
  const root = isolatedRoot(t, 'nexa-guard-boot-');
  const child = spawn(process.execPath, [httpChildBootstrap, join(root, ENTRY)], {
    cwd: root, env: minimalEnv(env), stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  const state = { logs: '', listened: false, port: null, code: 'running', signal: null };
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => { state.logs = (state.logs + chunk).slice(-8_000); });
  }
  child.on('message', (message) => {
    if (message?.type === 'ready' && Number.isInteger(message.port)) {
      state.listened = true;
      state.port = message.port;
    }
  });
  const exited = new Promise((resolve) => child.once('exit', (code, signal) => resolve({ code, signal })));
  const verdict = await Promise.race([exited, sleep(waitMs).then(() => ({ code: 'running', signal: null }))]);
  state.code = verdict.code;
  state.signal = verdict.signal;
  // A child that is still 'running' is the SUCCESS case here, so it stays alive
  // for the caller's HTTP assertions and dies with the test only.
  t.after(async () => {
    try { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); } catch { /* gone */ }
  });
  return state;
}

/** Free a port we own, then hand it to the child: proves the child never bound it. */
async function reservePort() {
  const probe = createNetServer();
  probe.unref();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

function tryConnect(port, timeoutMs = 250) {
  return new Promise((resolve) => {
    const socket = netConnect({ host: '127.0.0.1', port });
    const done = (ok) => { socket.destroy(); resolve(ok); };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(timeoutMs, () => done(false));
  });
}

async function bindableAgain(port) {
  const probe = createNetServer();
  probe.unref();
  try {
    await new Promise((resolve, reject) => {
      probe.once('error', reject);
      probe.listen(port, '127.0.0.1', resolve);
    });
    await new Promise((resolve) => probe.close(resolve));
    return true;
  } catch {
    return false;
  }
}

test('D1.11 (وحدة): الحارس يقرر من حكم البورت، ومنطوق الإغلاق محدد', () => {
  assert.equal(typeof guard.assertProductionPersistence, 'function', 'لا حارس استمرارية بعد');
  assert.equal(typeof guard.resolvePersistenceBackend, 'function', 'لا محلّ واحد للحقول التي يقرأها البورت');

  // غير الإنتاج: لا رأي إطلاقًا — سلوك التطوير/الاختبار كما هو.
  for (const env of [{}, { NODE_ENV: 'development' }, { NODE_ENV: 'test' }, { CI: 'true' }]) {
    assert.deepEqual(guard.assertProductionPersistence({ env, backend: { claimedReal: false }, realBackend: false }),
      { ok: true, production: false }, `env=${JSON.stringify(env)} لم يكن مسموحًا أن يتغير`);
  }

  // production + mock بلا إقرار: رفض برمز محدد ورسالة تحوي السبب والعلاجين.
  const refused = guard.assertProductionPersistence({
    env: { NODE_ENV: 'production' }, realBackend: false,
    backend: guard.resolvePersistenceBackend({ env: { NODE_ENV: 'production' } }),
  });
  assert.equal(refused.ok, false);
  assert.equal(refused.code, CODE);
  assert.match(refused.message, /mock:\/\/memory/);
  assert.match(refused.message, /NEXA_PRODUCTION_PERSISTENCE/);
  assert.ok(refused.message.length < 2_400, 'رسالة إقلاع تُقرأ، لا تُستنطق');
  assert.ok(!refused.message.includes('mock-key'), 'رسالة الإقلاع تطبع المفتاح التجريبي');
  assert.equal(refused.reason, 'unconfigured', 'السبب: الإعداد غائب أصلًا');

  // الإعداد يبدو حقيقيًا لكن السائق غير مثبَّت: أخطر حالة (ادعاء بلا تحقق) — ترفض.
  const silentFallback = guard.assertProductionPersistence({
    env: { NODE_ENV: 'production' }, realBackend: false,
    backend: guard.resolvePersistenceBackend({ env: {
      NODE_ENV: 'production', SUPABASE_URL: 'https://real-project.supabase.co', SUPABASE_ANON_KEY: 'k',
    } }),
  });
  assert.equal(silentFallback.ok, false, 'URL حقيقي مع سائق غائب = ادعاء استمرارية كاذب');
  assert.equal(silentFallback.code, CODE);
  assert.equal(silentFallback.reason, 'no-driver');
  assert.match(silentFallback.message, /driver|السائق/i);
  assert.ok(!silentFallback.message.includes('real-project.supabase.co'), 'مضيف المشروع يُطبع في رسالة إقلاع');
  assert.ok(!silentFallback.message.includes('SUPABASE_ANON_KEY'), 'اسم المتغير وقيمته يُطبعان في الرسالة');

  // خلفية استمرارية حقيقية فعلًا: العقد محفوظ — يقلع بلا أي إقرار.
  assert.deepEqual(
    guard.assertProductionPersistence({ env: { NODE_ENV: 'production' }, realBackend: true, backend: { claimedReal: true, source: 'SUPABASE_URL' } }),
    { ok: true, production: true, real: true, acknowledged: false },
  );

  // الإقرار الصريح بموت الحالة عند إعادة التشغيل: مسموح، لكنه موسوم لا مضلّل.
  const acked = guard.assertProductionPersistence({
    env: { NODE_ENV: 'production', NEXA_PRODUCTION_PERSISTENCE: 'ack-mock-ephemeral' }, realBackend: false,
    backend: guard.resolvePersistenceBackend({ env: { NODE_ENV: 'production' } }),
  });
  assert.equal(acked.ok, true);
  assert.equal(acked.acknowledged, true);
  assert.match(acked.warning, /DEMO|لا تدّعي|no continuity/i);

  // قيمتان غير المطابقتين ليستا إقرارًا (لا «أي شيء غير فارغ = موافقة»).
  for (const value of ['1', 'yes', '', 'ACK-MOCK-EPHEMERAL', 'ack-mock-ephemeral ']) {
    const verdict = guard.assertProductionPersistence({
      env: { NODE_ENV: 'production', NEXA_PRODUCTION_PERSISTENCE: value }, realBackend: false,
      backend: { claimedReal: false, source: 'default-mock' },
    });
    assert.equal(verdict.ok, false, `الإقرار بـ ${JSON.stringify(value)} يجب ألا يُقبل`);
  }
});

test('D1.11 (وحدة): محلّ الحقول هو نفسه ما يراه البورت — بلا انحراف', () => {
  assert.equal(typeof guard.resolvePersistenceBackend, 'function');
  const bare = guard.resolvePersistenceBackend({ env: {} });
  assert.equal(bare.url, 'mock://memory', 'الإسقاط الحالي إلى mock://memory محفوظ حرفيًا');
  assert.equal(bare.key, 'mock-key');
  assert.equal(bare.source, 'default-mock');
  assert.equal(bare.claimedReal, false);

  const integration = guard.resolvePersistenceBackend({ env: { SUPABASE_URL: 'mock://integration-test', SUPABASE_ANON_KEY: 'mock-key' } });
  assert.equal(integration.url, 'mock://integration-test');
  assert.equal(integration.claimedReal, false, 'mock:// في أي مضيف لا يُقرأ خلفية حقيقية');

  const serviceKey = guard.resolvePersistenceBackend({ env: { SUPABASE_URL: 'https://p.supabase.co', SUPABASE_SERVICE_KEY: 'svc' } });
  assert.equal(serviceKey.key, 'svc', 'سلسلة تفضيل المفاتيح الحالية محفوظة');
  assert.equal(serviceKey.claimedReal, true);
  assert.equal(serviceKey.source, 'SUPABASE_URL');

  const urlOnly = guard.resolvePersistenceBackend({ env: { SUPABASE_URL: 'https://p.supabase.co' } });
  assert.equal(urlOnly.claimedReal, false, 'URL بلا مصرّح ليس خلفية متحققة');

  const demoHost = guard.resolvePersistenceBackend({ env: { SUPABASE_URL: 'https://demo.supabase.co', SUPABASE_ANON_KEY: 'k' } });
  assert.equal(demoHost.claimedReal, false, 'المضيف الذي يحوي demo يُقرأ تجريبيًا كما يقرؤه البورت');
});

test('D1.11.1: production + mock = خروج غير صفري، وغياب تام لأي listen', async (t) => {
  const booted = await bootViaFixture(t, { NODE_ENV: 'production', NEXA_API_KEY: 'd1.11-guard-perimeter-key-1234567890' });
  assert.equal(booted.listened, false, 'listen() استُدعي: العملية خدمت قبل أن ترفض');
  assert.notEqual(booted.code, 'running');
  assert.equal(booted.code, 1, `رمز الخروج غير صفري مطلوب، وجد ${booted.code}/${booted.signal}`);
  assert.match(booted.logs, new RegExp(CODE));
  assert.match(booted.logs, /mock:\/\/memory/);
  assert.ok(!/running \(v1\.1 Omega|Celia Dashboard Server running/.test(booted.logs), 'لافتة البدء طُبعت رغم الرفض');
});

test('D1.11.2: النفي القابل للتفتيش — لا منفذ TCP مفتوح أثناء الحياة ولا بعدها', async (t) => {
  const port = await reservePort();
  const root = isolatedRoot(t, 'nexa-guard-tcp-');
  const child = spawn(process.execPath, [join(root, ENTRY)], {
    cwd: root,
    env: minimalEnv({ NODE_ENV: 'production', NEXA_API_KEY: 'd1.11-guard-perimeter-key-1234567890', PORT: String(port) }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { try { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); } catch { /* gone */ } });
  let logs = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', (chunk) => { logs = (logs + chunk).slice(-8_000); });
  }

  // الاستطراق يغطي عمر العملية كلها (لا أول 12ms منها): وإلا مرّ «لا اتصال» كذبًا
  // على خادم يعمل فعلًا ولم يربط المنفذ بعد في لحظة القياس.
  const exited = new Promise((resolve) => child.once('exit', resolve));
  const attempts = [];
  const deadline = Date.now() + 4_000;
  while (child.exitCode === null && Date.now() < deadline) {
    attempts.push(await tryConnect(port, 150));
    await sleep(150);
  }
  const code = await Promise.race([exited, sleep(4_000).then(() => 'timeout')]);

  assert.equal(attempts.filter(Boolean).length, 0, 'المنفذ قُبل أثناء حياة العملية: الخادم استمع');
  assert.equal(code, 1, `لم يخرج بالرمز 1 (وجد ${code})؛ logs:\n${logs}`);
  assert.equal(await bindableAgain(port), true, 'المنفذ ما زال محجوزًا بعد الخروج');
  assert.match(logs, new RegExp(CODE));
});

test('D1.11.3: development/test + mock = الإقلاع مسموح كما كان تمامًا', async (t) => {
  for (const env of [{ NODE_ENV: 'development' }, { NODE_ENV: 'test' }, {}]) {
    const booted = await bootViaFixture(t, env, { waitMs: 8_000 });
    assert.equal(booted.code, 'running', `${JSON.stringify(env)}: العملية خرجت (${booted.code}) — الحارس تجاوز الإنتاج\n${booted.logs}`);
    assert.equal(booted.listened, true, `${JSON.stringify(env)}: لم يستمع`);
    const state = await fetch(`http://127.0.0.1:${booted.port}/api/celia/state`, { signal: AbortSignal.timeout(5_000) });
    assert.equal(state.status, 200);
  }
});

test('D1.11.4: إقرار صريح = يقلع، والوضوح يبقى موسومًا لا ادّعاءً', async (t) => {
  const booted = await bootViaFixture(t, {
    NODE_ENV: 'production',
    NEXA_API_KEY: 'd1.11-guard-perimeter-key-1234567890',
    NEXA_PRODUCTION_PERSISTENCE: 'ack-mock-ephemeral',
  }, { waitMs: 8_000 });
  assert.equal(booted.code, 'running', 'الإقرار الصريح يجب أن يُبقي النشر التجريبي قابلًا للإقلاع');
  assert.equal(booted.listened, true);
  assert.match(booted.logs, /DEMO|no continuity|استمرارية/i, 'الإقرار مرّ بلا تحذير مسموع');

  const withKey = { Authorization: 'Bearer d1.11-guard-perimeter-key-1234567890' };
  const status = await fetch(`http://127.0.0.1:${booted.port}/api/v1/system/status`, {
    headers: withKey, signal: AbortSignal.timeout(5_000),
  }).then((r) => r.json());
  const memory = status.honesty.find((row) => row.component === 'memory');
  assert.ok(memory, 'لا صفة استمرارية في قائمة الصدق: الادعاء بلا counter-claim');
  assert.equal(memory.mode, 'DEMO');
  assert.match(memory.detail, /mock|restart|ephemeral/i);
});

test('D1.11 honesty: وضع الذاكرة يُعلن من حالة البورت لا من الأمنية', async (t) => {
  const server = await startIsolatedServer(t);   // mock://integration-test (dev) — كالمعتاد
  const status = await server.get('/api/v1/system/status');
  assert.equal(status.status, 200);
  const memory = status.body.honesty.find((row) => row.component === 'memory');
  assert.ok(memory, 'مسار الحالة لا يصرّح بنوعية الاستمرارية');
  assert.equal(memory.mode, 'DEMO', 'mock قُدِّم كأنه خلفي دائم');
  assert.ok(!/LIVE/.test(JSON.stringify(memory)));
});

test('D1.11 ترتيب الحراس: محيط مفتاحه ناقص يرفض أولًا، والاثنان معًا لا يبتلع أحدهما الآخر', async (t) => {
  const noKeyMock = await bootViaFixture(t, { NODE_ENV: 'production' }, { waitMs: 4_000 });
  assert.equal(noKeyMock.code, 1);
  assert.match(noKeyMock.logs, /NEXA_E_PERIMETER_UNCONFIGURED/, 'حارس المحيط ما زال أول من يتكلم');
  assert.ok(!noKeyMock.logs.includes(CODE), 'رسالتان في إقلاع واحد = قراءتهما كرسالة واحدة');

  const noKeyReal = await bootViaFixture(t, { NODE_ENV: 'production', NEXA_PRODUCTION_PERSISTENCE: 'ack-mock-ephemeral' }, { waitMs: 4_000 });
  assert.equal(noKeyReal.code, 1, 'إقرار الاستمرارية لا يعفي المحيط (ولا العكس)');
  assert.match(noKeyReal.logs, /NEXA_E_PERIMETER_UNCONFIGURED/);
  assert.equal(noKeyReal.listened, false);
});
