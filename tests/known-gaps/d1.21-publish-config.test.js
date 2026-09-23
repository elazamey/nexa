import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * known-gap D1.21 — إعدادات النشر متناقضة، والقرار للمالك لا للوكيل.
 * ⚠️ هذا الملف **يجب أن يبقى أخضر**: نجاحه = تسجيل حالة معلّقة، لا دليل سلامة.
 * يختفي حين تُحسم D1.21 (اسم/نطاق/private أو حذف خطوة النشر) في نفس التغيير.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('known-gap D1.21 (مفتوحة): الحزمة private وغير موسّعة معًا، ومع هذا workflow اسمه Publish', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.private, true, 'تغيّرت الحالة: private لم يعد true — تُقفل D1.21 ويُحدَّث الحارس السلوكي');
  assert.ok(!String(pkg.name).startsWith('@'), `الحزمة موسّعة (${pkg.name}) — انتُقل القرار؟`);
  const rel = read('.github/workflows/release.yml');
  const scope = /scope:\s*'(@[^']+)'/.exec(rel)[1];
  assert.equal(scope, '@elazamey', 'تغيّر الـ scope المعلن — راجع التذكرة');
  assert.match(read('package.json'), /"@elazamey:registry"/, 'publishConfig لم يعد يوجّه @elazamey إلى GHPR');
  // ونطاق GHPR لا ينطبق على اسم غير موسّع ⇒ لا يوجد إعداد يمكن معه لـ npm publish أن ينجح
  const publishCfg = pkg.publishConfig || {};
  assert.equal(publishCfg.registry, undefined, 'publishConfig.registry معلن الآن — الحالة تغيّرت');
});

test('known-gap D1.21 (مفتوحة): حجم الـ tarball بلا whitelist — قرار النشر ليس قرار اسم فقط', () => {
  // npm يكتب notices على stderr؛ القياس يحتاج المخرجين معًا (لا stdout وحده فيصبح NaN ثم «نجح» بلا قياس)
  const out = execFileSync('bash', ['-lc', 'npm pack --dry-run 2>&1'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64e6 });
  const files = Number(/total files:\s*(\d+)/.exec(out)?.[1] ?? NaN);
  const size = /unpacked size:\s*([\d.]+)\s*MB/.exec(out)?.[1];
  assert.ok(files > 300, `عدد الملفات في الـ tarball صار ${files} — راجع الحارس إن نُظّفت files`);
  assert.equal(JSON.parse(read('package.json')).files, undefined, 'package.json صار فيه files — الحارس يحتاج تحديثًا مقصودًا');
  assert.ok(size && Number(size) > 1, `الحجم ${size}MB — حُسمت القائمة؟`);
});
