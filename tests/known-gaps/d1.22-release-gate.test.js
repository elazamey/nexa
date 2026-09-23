import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * known-gap D1.22 — بوابة الإصدار أضعف من بوابة الـ PR.
 * ⚠️ نجاح هذا الاختبار = إعادة إنتاج الفجوة، لا دليل سلامة. يُزال في تغيير الإغلاق.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const strip = (t) => t.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
function cmds(rel) {
  const out = new Set();
  for (const line of strip(read(rel)).split('\n')) {
    const t = line.trim().replace(/^run:\s*/, '');
    const m = /^(npm (?:run )?[a-zA-Z0-9:_-]+)(\s|\||$)/.exec(t);
    if (m) out.add(m[1]);
  }
  return out;
}

test('known-gap D1.22: قياسات النواة في ci.yml غائبة عن بوابة الوسم', () => {
  const ci = cmds('.github/workflows/ci.yml');
  const rel = cmds('.github/workflows/release.yml');
  // ما يفرضه الواقع: npm test في الملفين، وmesh:verify حكْر بوابة الوسم (ليس في ci.yml — قِيس)
  assert.ok(ci.has('npm test') && rel.has('npm test'), 'بوابة الإصدار لم تعد تشغّل npm test');
  assert.ok(rel.has('npm run mesh:verify') && !ci.has('npm run mesh:verify'),
    'mesh:verify صار مشتركًا بين البوابتين — أعد قراءة الفرض');
  const missing = ['npm run audit', 'npm run posture', 'npm run attacks', 'npm run attacks:google'].filter((c) => ci.has(c) && !rel.has(c));
  assert.deepEqual(missing, ['npm run audit', 'npm run posture', 'npm run attacks', 'npm run attacks:google'],
    `القياسات المفقودة تغيّرت (${JSON.stringify(missing)}) — إمّا حُسِمت D1.22 أو انزاحت القائمة؛ حدّث التذكرة`);
});

test('known-gap D1.22: الوسوم لا يراها أي workflow فحصٍ آخر، وفحص المرايا والـ vectors خارج بوابة النشر', () => {
  const relRaw = read('.github/workflows/release.yml');
  const onBlock = relRaw.split(/^on:\s*$/m)[1].split(/^\S/m)[0];
  assert.match(onBlock, /tags:/, 'release.yml لم يعد يعمل على وسوم — إعادة قراءة الفجوة');
  const ciOn = read('.github/workflows/ci.yml').split(/^on:\s*$/m)[1].split(/^jobs:/m)[0];
  assert.ok(!/tags:/.test(ciOn), 'ci.yml صار يعمل على الوسوم — D1.22 مغلقة جزئيًا، أزل المُعيد في نفس التغيير');
  const rel = strip(relRaw);
  assert.ok(!rel.includes('sync:assets:check'), 'فحص المرايا داخل بوابة الإصدار؟');
  assert.ok(!rel.includes('npm run vectors'), 'تزامن spec/vectors داخل بوابة الإصدار؟');
});
