/**
 * D1.26 — بوابة مادة المفاتيح الخاصة تفرّق، والاستثناء معلَن في المستودع لا في head commit للوظيفة.
 * الفاحص نفسه هو ما يناديه الـ workflow (لا نسخة ثانية من منطقه هنا)، فالقياس على الشجرة = القياس في CI.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const SCRIPT = 'tools/check-secret-scan-allowlist.mjs';
const MATERIAL = 'MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC2NwSWncnwdPjk' + 'A'.repeat(220) + 'AB3QlTnbAgMBAAECggEA';

function runAt(base, { allowlist = null, roots = 'tools' } = {}) {
  if (!allowlist && base !== ROOT) {
    // نسخة نظيفة بلا استثناءات: ملف فارغ صريح، لا ارث استثناءات المستودع
    allowlist = path.join(base, 'empty-allowlist.json');
    fs.writeFileSync(allowlist, JSON.stringify({ entries: [] }));
  }
  const argv = [SCRIPT, '--base', base, '--roots', roots];
  if (allowlist) argv.push('--allowlist', allowlist);
  try {
    return { rc: 0, out: execFileSync(process.execPath, argv, { encoding: 'utf8', cwd: ROOT }) };
  } catch (e) {
    return { rc: e.status ?? 1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}
function tree(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-secscan-'));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}

test('D1.26: البوابة تنادي الفاحص نفسه — لا grep مكرر ولا ||', () => {
  const wf = read('.github/workflows/security-scan.yml');
  const step = wf.split('- name: Scan for Exposed Secret Patterns')[1].split('- name:')[0];
  assert.ok(step.includes(`node ${SCRIPT}`), `الخطوة لا تنادي ${SCRIPT} — النسخة في الـ workflow والمنطق هنا ينفصلان`);
  assert.ok(!/\|\|\s*true/.test(step), 'ابتلاع فشل في خطوة الفحص (عادة D1.18/D1.20 نفسها)');
  assert.ok(!/KEY_FOUND=\$\(grep/.test(step), 'الفحص القديم ما زال قائمًا بجانب الفاحص: من ينتصر؟');
  // التفويض كامل: سطر run واحد بلا && ولا ||، فrc للفاحص هو rc للوظيفة (لا exit 1 زائدة ولا ابتلاع)
  assert.match(step, /^\s*run: node tools\/check-secret-scan-allowlist\.mjs\s*$/m,
    'الخطوة ليست نداءً واحدًا للفاحص — من يقرّر الحصيلة؟');
  assert.ok(!/&&|\|\|/.test(step), 'سلسلة أوامر حول نداء الفاحص: قرار مُشوَّه');
});

test('D1.26: على الشجرة rc=0، والمواد الثلاث معلَّنة الاستثناء، والكاشف غير محتسب', () => {
  const { rc, out } = runAt(ROOT, { allowlist: path.join(ROOT, 'self-model/secret-scan-allowlist.json'), roots: 'packages,tools' });
  assert.equal(rc, 0, `الفاحص فشل على الشجرة:\n${out}`);
  assert.equal(out.match(/^allowlisted tools\/google-fixtures\.mjs/gm)?.length, 3, 'عدد مواد الـ fixtures المقيسة تغيّر — حدّث الاستثناء بعلم');
  assert.ok(!/^LEAK/gm.test(out), 'تسريب غير مستثنًى على الشجرة');
  assert.ok(!out.includes('anthropic-constitutional'), 'سطر الكاشف الذاتي عاد إلى النتيجة — النّمط أوسع من المسموح');
});

test('D1.26: تسريب محقون يُفشل البوابة (قياس في نسخة، لا في المستودع)', () => {
  const dir = tree({
    'tools/leak.mjs': `const k = \`-----BEGIN PRIVATE KEY-----\\n${MATERIAL}\\n-----END PRIVATE KEY-----\`;\nexport default k;\n`,
  });
  try {
    const { rc, out } = runAt(dir);
    assert.equal(rc, 1, 'مادة مفتاح بلا استثناء والبوابة خضراء');
    assert.match(out, /^LEAK tools\/leak\.mjs/m);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('D1.26: سطر كاشف أو توثيق لا يُحتسب — الفارق هو المادة لا الكلمة', () => {
  const dir = tree({
    'tools/detector.js': "if (opStr.includes('nexa:key:priv:') || opStr.includes('private_key')) block();\n",
    'tools/doc.mjs': '/** اذكر أن PEM يبدأ بـ -----BEGIN PRIVATE KEY----- ولا شيء آخر. */\nexport const x = 1;\n',
    'tools/short.mjs': `const s = '-----BEGIN PRIVATE KEY-----\\n${'A'.repeat(40)}\\n-----END PRIVATE KEY-----';\n`,
  });
  try {
    const { rc, out } = runAt(dir);
    assert.equal(rc, 0, `البوابة تظن أن كاشفًا/توثيقًا مادة مفتاح:\n${out}`);
    assert.match(out, /0 مادة مقيسة/, 'لم يُصرَّح بالعدد صفرًا — القياس بلا معنى');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('D1.26: لا مدخل ميت ولا مدخل على محذوف ولا استثناء بلا ملف', () => {
  const dir = tree({ 'tools/clean.mjs': 'export const ok = true;\n' });
  const al = path.join(dir, 'allow.json');
  fs.writeFileSync(al, JSON.stringify({ entries: [{ path: 'tools/clean.mjs', reason: 'مادة مقيسة فعلاً هنا ويجب أن تُغطّى', owner: 'me', added: '2026-09-24' }] }));
  try {
    let r = runAt(dir, { allowlist: al });
    assert.equal(r.rc, 1, 'مدخل استثناء بلا مادة مقابلة مرّ أخضر: الاتساع الصامت');
    assert.match(r.out, /^STALE /m);

    fs.writeFileSync(al, JSON.stringify({ entries: [{ path: 'tools/deleted-forever.mjs', reason: 'مسار محذوف من المستودع وبقي في القائمة', owner: 'me', added: '2026-09-24' }] }));
    r = runAt(dir, { allowlist: al });
    assert.equal(r.rc, 1, 'مدخل على مسار محذوف مرّ أخضر');
    assert.match(r.out, /محذوف من المستودع/);

    fs.rmSync(al);
    r = runAt(dir, { allowlist: al });
    assert.equal(r.rc, 1, 'غياب ملف الاستثناء نفسه لا يُفسَّر «لا شيء»');
    assert.match(r.out, /لا ملف استثناء/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('D1.26: الملف المعلَن في المستودع صادق البنية والسبب', () => {
  const doc = JSON.parse(read('self-model/secret-scan-allowlist.json'));
  assert.ok(Array.isArray(doc.entries) && doc.entries.length >= 1, 'لا مدخل واحد — فالفحّاص يفشل بغياب الملف؟ راجع');
  for (const e of doc.entries) {
    for (const k of ['path', 'reason', 'owner', 'added']) assert.ok(String(e[k] ?? '').trim(), `مدخل بلا ${k}`);
    assert.ok(e.reason.length >= 20, 'سبب أقصر من أن يُراجَع');
    assert.match(String(e.added), /^\d{4}-\d{2}-\d{2}/, 'تاريخ غير معياري');
    assert.ok(fs.existsSync(path.join(ROOT, e.path)), `المسار ${e.path} في الاستثناء ومحذوف من المستودع`);
    const body = read(e.path);
    if (e.reason.includes('throwaway')) {
      assert.match(body, /throwaway test keys with a known private half/,
        `رأس ${e.path} لم يعد يصرّح بما يستثنيه السبب — السّبب كذب، احذف المدخل أو أعد التعليق`);
    }
  }
});

test('D1.26: ما يناديه security-scan.yml يؤول إلى شيء موجود (وراثية D1.16 لهذا الملف)', () => {
  const wf = read('.github/workflows/security-scan.yml');
  const body = wf.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const scripts = JSON.parse(read('package.json')).scripts;
  for (const m of body.matchAll(/(?:^|\s)(?:npm run |npm ci|npm test)/g)) assert.ok(m[0], m[0]);
  for (const m of body.matchAll(/npm run ([a-zA-Z0-9:_-]+)/g)) {
    assert.ok(scripts[m[1]], `npm run ${m[1]} منادى في security-scan.yml ولا سكربت بهذا الاسم`);
  }
  for (const m of body.matchAll(/node\s+([^\s|;&]+\.m?js)/g)) {
    assert.ok(fs.existsSync(path.join(ROOT, m[1])), `node ${m[1]} ينادى وهو غير موجود`);
    assert.doesNotMatch(read(m[1]), /TODO-PLACEHOLDER/, `${m[1]} معلن غير مكتمل`);
  }
  for (const m of body.matchAll(/node --test\s+([^\s|;&]+)/g)) {
    assert.ok(fs.existsSync(path.join(ROOT, m[1])), `node --test ${m[1]} ينادى وهو غير موجود`);
  }
});
