import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * known-gap D1.24 — قاعدة الأرقام محصورة في README/SECURITY، وdocs/ خارجها.
 * ⚠️ نجاح هذا الاختبار = إعادة إنتاج الفجوة. يُزال في تغيير الإغلاق.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('known-gap D1.24: حارس الأرقام يفرض على ملفين فقط', () => {
  const guard = read('tests/count-claims-sync.test.js');
  // ما يُفرَض فعلًا هو ما تظهر أزواجه في حلقات [name, doc]؛ القراءة قد تُذكر لأغراض أخرى
  const pairs = [...guard.matchAll(/\[\s*'([\w./\-]+)'\s*,\s*[A-Za-z_$][\w$]*\s*\]/g)].map((m) => m[1]);
  const enforced = new Set(pairs);
  assert.ok(enforced.size >= 2, `استخراج الأزواج أنتج ${[...enforced].join(', ')} — تغيّرت صيغة الحارس؟`);
  assert.ok(enforced.has('README.md') && enforced.has('SECURITY.md'), `الحارس لم يعد يفرض على الملفين: ${[...enforced].join(', ')}`);
  const docsCovered = [...enforced].filter((d) => d.startsWith('docs/'));
  assert.deepEqual(docsCovered, [],
    `docs/ صارت داخل الحلقات (${docsCovered.join(', ')}) — حُسِمت D1.24؟ أزل المُعيد في نفس التغيير`);
});

test('known-gap D1.24: الخطر حيّ — أرقام بصيغة قياس في وثائق سارية خارج النطاق المفروض', () => {
  const dir = path.join(ROOT, 'docs');
  const hits = [];
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.md'))) {
    const t = read(path.join('docs', f));
    const nums = [...t.matchAll(/\b\d{1,4}\/\d{1,4}\b/g)].length;
    const pct = (t.match(/100\s?%/g) || []).length;
    if (nums + pct > 0) hits.push({ f, nums, pct });
  }
  assert.ok(hits.length >= 1, 'لا رقم بصيغة N/M ولا 100% في docs/ — الفجوة لا موضوع لها، أزلها');
  assert.ok(hits.reduce((a, h) => a + h.nums + h.pct, 0) >= 3, `أرقام قليلة (${JSON.stringify(hits)}) — راجع مدى الحاجة قبل التوسيع`);
});
