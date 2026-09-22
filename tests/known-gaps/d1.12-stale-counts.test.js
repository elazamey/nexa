import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * known-gap D1.12 (O04) — ادعاءات أعداد اختبارات متقادمة ومتضاربة.
 * ⚠️ نجاح هذا الاختبار = إعادة إنتاج الفشل الحالي، لا دليل سلامة.
 * يُزال هذا الملف في نفس تغيير إغلاق D1.12.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('known-gap D1.12 (O04): README يدعي رقمًا ثابتًا متقادمًا', () => {
  const readme = read('README.md');
  assert.ok(
    readme.includes('501 PASS / 0 FAIL of 501'),
    'الوضع الحالي: README يدعي 501/501 حرفيًا بينما المجموعة تجاوزته'
  );
});

test('known-gap D1.12 (O04): المحقق وخطط النشر عالقة على 314', () => {
  assert.ok(read('pub-verifier.sh').includes('"314"'), 'الوضع الحالي: pub-verifier.sh يفحص «314» حرفيًا');
  assert.ok(read('publish-v0.1.plan.json').includes('314/314'), 'الوضع الحالي: خطة النشر تدعي 314/314');
});
