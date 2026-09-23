import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * known-gap D1.25 — docs/archive/ معرّف ولا وجود، وdocs/evidence/ مُفهرَس كمجلد واحد.
 * ⚠️ نجاح هذا الاختبار = تسجيل الحالة، لا دليل سلامة. يُزال في تغيير الإغلاق.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('known-gap D1.25: القاعدة تعرف docs/archive/ والمجلد غير موجود', () => {
  const index = read('docs/README.md');
  assert.match(index, /docs\/archive/, 'الفهرس لم يعد يذكر مسار الأرشيف — أعِد قراءة القاعدة');
  assert.equal(fs.existsSync(path.join(ROOT, 'docs/archive')), false,
    'docs/archive/ صار موجودًا — أما فُتِح بحالة مُعرّفة؟ أزل المُعيد في نفس التغيير');
});

test('known-gap D1.25: دليل واحد لكل الملفات — لا صفّ لملف دليل', () => {
  const root = path.join(ROOT, 'docs/evidence');
  const walk = (d, rel = '') => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name), `${rel}${e.name}/`) : [`${rel}${e.name}`]);
  const files = walk(root);
  assert.ok(files.length >= 20, `عدد ملفات الأدلة المقيس غير متوقع (${files.length}) — البنية تغيّرت؟ راجع الصياغة`);
  const index = read('docs/README.md');
  const rows = index.split('\n').filter((l) => /^\|\s*`/.test(l)).map((l) => l.split('|')[1].trim());
  const perFile = rows.filter((r) => /^`?(docs\/)?evidence\/.+\.(tap|txt|json|md|sha256sums|sums)`?$/i.test(r));
  assert.deepEqual(perFile, [],
    `أصبح للأدلة صفوف فردية (${perFile.slice(0, 3).join(', ')}) مع ${files.length} ملفًا — حُسِمت D1.25؟`);
  assert.ok(rows.some((r) => /^`?evidence\/?`?$/.test(r)), 'لا صف لمجلد الأدلة أصلًا — الفهرس أوسع من التذكرة');
});
