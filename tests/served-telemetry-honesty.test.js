import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, execFile } from 'node:child_process';
import { spawn } from 'node:child_process';
import { cpSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startIsolatedServer, isolatedRoot, repositoryRoot, httpChildBootstrap, minimalEnv } from './celia-workspace-auth-helpers.mjs';

/**
 * D1.17 (O09 / قياس مخدوم) — لا عدد على سطح يُخدم إلا وهو قراءة.
 *
 * الفئة نفسها التي أغلقتها D1.12 في الوثائق، لكنها هنا في الحمولة الحيّة: `mockState.status`
 * كان يحمل `tests:'314/314'` و`promotion:'5/5 READY'` و`gates:'6 CLOSED'` حروفًا ثابتة،
 * ويعيد `GET /api/celia/state` تلك الكتلة كما هي، بينما شقيقه `/api/v1/system/status` يقيس فعلًا
 * عبر `check-posture.mjs` — حارسان لسطح واحد، أحدهما يقيس والآخر يروّي، برقمين مختلفين في الملف
 * نفسه (314 في الحالة، 501 في سجل الإقلاع). قرار المالك: **قياس حيّ فقط** — `gates` تُقرأ من
 * القياس، وما لا يقيسه هذا السيرفر يُحذف من الحمولة (لا وسم بتاريخ، ولا baseline عبر الشبكة).
 *
 * الحارس يفحص الاثنين: الحمولة الحيّة، والمصدر (لأن حرفًا ثابتًا يصادف أن يطابق القياس اليوم
 * ليس قياسًا — إنه مجرد حظ).
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const SERVER = 'tools/celia-dashboard-server.mjs';
const serverSrc = () => read(SERVER);
/** التعليقات ليست حمولة: سطر تعليق يذكر promotion ليس حقلًا مخدومًا — تُجبَّز قبل الفحص */
const code = (text) => text.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');

/** قياس مستقل داخل الاختبار — لا نستعير دالة السيرفر لنثبت دالة السيرفر */
function measuredPosture() {
  const out = execFileSync(process.execPath, ['tools/check-posture.mjs'], { cwd: ROOT, encoding: 'utf8' });
  const metrics = {};
  for (const line of out.split('\n')) {
    const m = line.match(/^NEXA_METRIC\s+([a-z_]+)=(\d+)$/);
    if (m) metrics[m[1]] = Number(m[2]);
  }
  assert.ok(metrics.closed_gates > 0, 'القياس المستقل نفسه فشل — لا أساس للمقارنة');
  return metrics;
}

test('D1.17: /api/celia/state لا يخدم عدد اختبارات ولا حكم ترقية', async (t) => {
  const server = await startIsolatedServer(t);
  const res = await server.get('/api/celia/state');
  assert.equal(res.status, 200);
  const status = res.body.status;
  assert.ok(status && typeof status === 'object', 'لا كتلة حالة إطلاقًا — الحذف أوسع من المسموح');
  assert.ok(!('tests' in status), 'حقل tests عاد إلى الحمولة المخدومة');
  assert.ok(!('promotion' in status), 'حقل promotion عاد إلى الحمولة المخدومة');
  const body = JSON.stringify(status);
  assert.doesNotMatch(body, /\d+\s*\/\s*\d+/, 'نسبة «ن/م» تُخدم كقراءة بلا قياس (314/314 أو 5/5 READY)');
  assert.doesNotMatch(body, /314|501/, 'عدد اختبارات مروىّ تسرّب إلى الحالة المخدومة');
  assert.doesNotMatch(body, /48\.5%|100%/, 'رقم أداء غير مقاس في حقل حالة');
});

test('D1.17: التعريف بلا أرقام، والسطح يستدعي مسار القياس (لا تثبيت لأسماء)', () => {
  const src = code(serverSrc());
  const def = src.slice(src.indexOf('let mockState'), src.indexOf('function getPosture'));
  assert.ok(def.length > 0, 'لم تُعثر على تعريف الحالة');
  assert.doesNotMatch(def, /gates:\s*'\d/, "gates ما زالت رقمًا حروفيًا في تعريف الحالة");
  assert.doesNotMatch(def, /tests:\s*'\d/, 'tests ما زالت في التعريف — الحذف لم يحدث');
  assert.doesNotMatch(def, /promotion:/, 'promotion ما زال في التعريف');
  assert.doesNotMatch(def, /llm_vectors:\s*'\d/, 'llm_vectors ما زالت رقمًا حروفيًا بلا قياس');
  // ولا ادّعاءٌ يُخدَم من حروف: مرفوع رقمٌ مقياس في أي مكان خارج كتلة القياس نفسها
  const handler = src.slice(src.indexOf("url.pathname === '/api/celia/state'"), src.indexOf("url.pathname === '/api/celia/evidence'"));
  assert.ok(handler.length > 0, 'لم تُعثر على معالج الحالة');
  assert.doesNotMatch(handler, /:\s*'\d+\//, 'الحالة تُخدَم بنسبة حروف في المعالج');
  assert.doesNotMatch(handler, /'\d+ CLOSED'/, 'الحالة تُخدَم بعدد بوابات حروف في المعالج');
});

test('D1.17: بلا قياس لا حالة مرقومة — الغياب أصدق من حرف يصادف أنه صحيح اليوم', async (t) => {
  // في الجذر المعزول لا يُنسخ spec/ ⇒ check-posture يفشل ⇒ يجب أن تُخدَم الحالة بلا عدد،
  // لا أن تعود '6 CLOSED' من ذاكرة الحروف. هذا يميز «يقيس» عن «يحفظ الجواب».
  const server = await startIsolatedServer(t);
  const res = await server.get('/api/celia/state');
  const status = res.body.status;
  assert.match(JSON.stringify(status), /NEXA-POSTURE-UN/, 'تعذّر القياس ولم يُبلَّغ في الحمولة');
  assert.ok(!('gates' in status), `عدد بوابات خُدم بلا قياس: ${JSON.stringify(status.gates)}`);
  assert.doesNotMatch(JSON.stringify(status), /\d+ CLOSED/, 'ادّاء عدد بوابات في بيئة لا يمكنها قياسه');
  const posture = await server.get('/api/posture');
  assert.equal(posture.status, 200, 'سطح القياس الشقيق معطوب — لا مرجع للمقارنة');
  const sys = await server.get('/api/v1/system/status');
  assert.equal(sys.status, 200);
});

test('D1.17: حيث يمكن القياس، الحمولة تساوي القياس حرفًا بحرف (جذر فيه spec/)', async (t) => {
  const root = isolatedRoot(t, 'nexa-telemetry-parity-');
  cpSync(join(repositoryRoot, 'spec'), join(root, 'spec'), { recursive: true });
  cpSync(join(repositoryRoot, 'src'), join(root, 'src'), { recursive: true });
  const expected = await new Promise((resolve, reject) => {
    execFile(process.execPath, ['tools/check-posture.mjs'], { cwd: root, encoding: 'utf8' }, (err, out) => {
      if (err) return resolve(null);
      const m = /^NEXA_METRIC closed_gates=(\d+)$/m.exec(String(out));
      resolve(m ? Number(m[1]) : null);
    });
  });
  const child = spawn(process.execPath, [httpChildBootstrap, join(root, 'tools/celia-dashboard-server.mjs')], {
    cwd: root, env: minimalEnv({}), stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  t.after(() => { try { if (child.exitCode === null) child.kill('SIGKILL'); } catch { /* gone */ } });
  let port = null;
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 8_000);
    child.on('message', (m) => { if (m?.type === 'ready' && Number.isInteger(m.port)) { port = m.port; clearTimeout(timer); resolve(); } });
    child.on('exit', () => { clearTimeout(timer); resolve(); });
  });
  assert.ok(port, 'لم يُقنع السيرفر على الإقلاع في الجذر المكتمل');
  const body = await fetch(`http://127.0.0.1:${port}/api/celia/state`).then(r => r.json());
  if (expected === null) {
    assert.ok(!('gates' in body.status), 'القياس متعذر هناك والحالة خدمت عددًا رغم ذلك');
    return;
  }
  assert.equal(body.status.gates, `${expected} CLOSED`, 'الحمولة لا تطابق قياس الجذر نفسه');
  assert.equal(body.status.measurement, 'node tools/check-posture.mjs');
  assert.match(String(body.status.measured_at), /^\d{4}-\d{2}-\d{2}T/);
});

test('D1.17: سجل الإقلاع يطبع ما يخدمه أو يصمت عن العدد', () => {
  const src = code(serverSrc());
  assert.doesNotMatch(src, /Tests:\s*\d+\/\d+/, 'سطر الإقلاع لا يزال يروّي عدد اختبارات');
  assert.doesNotMatch(src, /Promotion:\s*\d\/\d/, 'سطر الإقلاع لا يزال يروّي حكم ترقية');
  const bootLine = src.split('\n').find((l) => /Gates:/.test(l) && /console\.log/.test(l)) ?? '';
  assert.ok(bootLine.length > 0, 'لا سطر حالة في سجل الإقلاع لنتفحصه');
  assert.match(bootLine, /posture|measured|قِ|measure/i, 'سطر الإقلاع لا يعلن أن العدد قراءة');
  // ولا تناقض: ما يطبعه الإقلاع هو ما تُعيده الحالة (أو لا عدد في كليهما)
  assert.doesNotMatch(src, /'6 CLOSED'/, "حرف '6 CLOSED' ثابت في السيرفر — القياس يُستنسخ لا يُستدعى");
});

test('D1.17: المزروعات لا تُحوّل الرواية معرفةً — لا 314 ولا 48.5% في beliefs ولا ذاكرة', () => {
  const src = code(serverSrc());
  const seeds = src.slice(src.indexOf('async function seedGovernedMemory'), src.indexOf('let semanticSeeded'));
  assert.ok(seeds.length > 0, 'لم يُعثر على منطقة البذر لنتفحصها');
  assert.doesNotMatch(seeds, /tests:\s*'\d+\/\d+'/);
  assert.doesNotMatch(seeds, /gates:\s*'\d+ CLOSED'/);
  const semStart = src.indexOf('async function seedSemanticMemory');
  const sem = src.slice(semStart, src.indexOf('}', src.indexOf('];', semStart)));
  assert.doesNotMatch(sem, /\d+\s+tests/, 'ذاكرة دلالية تنصّ على عدد اختبارات غير مقاس هنا');
  assert.doesNotMatch(sem, /48\.5%/, 'نسبة أداء غير مقاسة مزروعة كثابت');
  assert.doesNotMatch(sem, /\bgates \d+ CLOSED\b/, 'عدد بوابات منسوخ في نص ذاكرة بدل الإشارة إلى القياس');
  // وحقول العرض المحمّلة في payload داخليًا لا تدّعي قياسًا
  assert.doesNotMatch(src, /pasteSaving:\s*'\d+(\.\d+)?%'/, 'pasteSaving لا يزال رقمًا مُروّى');
});

test('D1.17: الواجهة لا تعرض عددًا أوليًّا كأنه قراءة', () => {
  const dash = read('dashboard/src/components/NexaDashboard.jsx');
  const init = dash.slice(dash.indexOf('useState({'), dash.indexOf('const [logs'));
  assert.ok(init.length > 10, 'لم تُعثر على المبدئيات لنتفحصها');
  assert.doesNotMatch(init, /testsPass:\s*'\d+\/\d+'/, 'testsPass مبدئيًا نسبة مُروّاة');
  assert.doesNotMatch(init, /securityGates:\s*'\d+\/\d+'/, 'securityGates مبدئيًا نسبة مُروّاة');
  assert.doesNotMatch(init, /memoryDigests:\s*[1-9]/, 'عدد هضمات أولي يُعرض كأنه مقياس');
  assert.doesNotMatch(init, /contextUsage:\s*'\d/, 'نسبة استخدام سياق أولية مُروّاة');
  assert.doesNotMatch(init, /evidenceCount:\s*[1-9]/, 'عدد أدلة أولي يُعرض كأنه مقياس');
  for (const rel of ['dashboard/src/components/NexaDashboard.jsx', 'dashboard/src/components/DagVisualizer.jsx']) {
    const doc = read(rel);
    for (const line of doc.split('\n').filter((l) => /48\.5%|100%/.test(l))) {
      assert.match(line, /claim|not measured|غير مقاس|unmeasured|marketing/i, `${rel}: رقم أداء بلا وسم أنه رواية: ${line.trim().slice(0, 80)}`);
    }
  }
});
