import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * known-gap D1.14 (O06) — التوثيق بلا فهرس.
 * ⚠️ نجاح هذا الاختبار = إعادة إنتاج الفشل الحالي، لا دليل سلامة.
 * يُزال هذا الملف في نفس تغيير إغلاق D1.14.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('known-gap D1.14 (O06): عشرات الوثائق بلا فهرس', () => {
  const docs = fs.readdirSync(path.join(ROOT, 'docs')).filter(f => f.endsWith('.md'));
  assert.ok(docs.length >= 20, `تمهيد: ${docs.length} وثيقة في docs/`);
  assert.equal(
    fs.existsSync(path.join(ROOT, 'docs/README.md')),
    false,
    'الوضع الحالي: لا docs/README.md — لا فهرس ولا مالك ولا حالة'
  );
});
