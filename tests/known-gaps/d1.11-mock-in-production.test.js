import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, lstatSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * known-gap D1.11 (O03) — الإنتاج يقلع مع mock://memory بصمت.
 * ⚠️ نجاح هذا الاختبار = إعادة إنتاج الفشل الحالي، لا دليل سلامة.
 * يُزال هذا الملف في نفس تغيير إغلاق D1.11.
 * (spawn مستقل: الـ helper المشترك لا يمرر NODE_ENV، وهذا الاختبار يثبت
 *  سلوك الإقلاع تحت NODE_ENV=production تحديدًا.)
 *
 * تحديث طبقة المحيط (P0-B، حارس الإقلاع tools/celia-startup-guard.mjs): الإنتاج
 * صار يرفض الإقلاع بلا NEXA_API_KEY، فبقاء هذا المُعيد صالحًا إثباتُه يستلزم
 * مفتاحًا تجريبيًا في البيئة وعلى الطلب — لا علاقة لذلك بالفجوة نفسها. ما يُختبر
 * هنا ما زال هو: «production + mock://memory يقلع ويخدم». حارس المحيط لا يبتلع
 * هذه الفجوة ولا يغلقها (قابلْ tests/server-production-failfast.test.js — نفس الجملة
 * معكوسة عمدًا).
 */

const PERIMETER_TEST_KEY = 'd1.11-reproducer-placeholder-key';

const repository = fileURLToPath(new URL('../../', import.meta.url));
const bootstrap = fileURLToPath(new URL('../fixtures/celia-http-child.mjs', import.meta.url));

async function startProductionServer(t) {
  const root = mkdtempSync(join(tmpdir(), 'nexa-prod-boot-'));
  let child;
  let closed;
  t.after(async () => {
    try {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        const force = setTimeout(() => child.kill('SIGKILL'), 2_000);
        try { await closed; } finally { clearTimeout(force); }
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  for (const area of ['packages', 'adapters', 'tools']) {
    cpSync(join(repository, area), join(root, area), {
      recursive: true,
      filter(path) {
        const stat = lstatSync(path);
        if (stat.isSymbolicLink()) return false;
        const name = basename(path);
        if (name.startsWith('.') || name === 'node_modules') return false;
        return stat.isDirectory() || /\.(?:m?js)$/.test(name) || name === 'package.json';
      },
    });
  }
  cpSync(join(repository, 'package.json'), join(root, 'package.json'));

  // مفتاح محيط تجريبي: بدونه يرفض الحارس الإقلاع فلا نصل إلى ما نريد إثباته.
  const env = { PORT: '0', NODE_ENV: 'production', NEXA_API_KEY: PERIMETER_TEST_KEY };
  for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR']) {
    if (process.env[name]) env[name] = process.env[name];
  }
  // عمدًا: لا SUPABASE_* — نختبر السقوط إلى mock تحت production.
  child = spawn(process.execPath, [bootstrap, join(root, 'tools/celia-dashboard-server.mjs')], {
    cwd: root, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  closed = new Promise(resolve => child.once('close', resolve));
  let logs = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', chunk => { logs = (logs + chunk).slice(-8_000); });
  }
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`Celia startup timed out\n${logs}`)), 10_000);
    const onError = error => finish(error);
    const onExit = (code, signal) => finish(new Error(`Celia exited before readiness (${code}/${signal})\n${logs}`));
    const onMessage = message => {
      if (message.type === 'ready' && Number.isInteger(message.port) && message.port > 0) {
        finish(null, message.port);
      }
    };
    function finish(error, value) {
      clearTimeout(timer);
      child.off('error', onError);
      child.off('exit', onExit);
      child.off('message', onMessage);
      if (error) reject(error); else resolve(value);
    }
    child.once('error', onError);
    child.once('exit', onExit);
    child.on('message', onMessage);
  });
  return port;
}

test('known-gap D1.11 (O03): إنتاج بلا SUPABASE يقلع ويخدم بدل fail-fast', async (t) => {
  const port = await startProductionServer(t);
  const response = await fetch(`http://127.0.0.1:${port}/api/celia/state`, {
    headers: { Authorization: `Bearer ${PERIMETER_TEST_KEY}` },
    signal: AbortSignal.timeout(5_000),
  });
  assert.equal(response.status, 200, 'الوضع الحالي: إنتاج + mock = إقلاع ناجح بصمت (لا حارس ذاكرة)');
});
