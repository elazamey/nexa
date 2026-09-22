import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * known-gap D1.16 (O08) — بناء الداشبورد غير مُختبر في PRs.
 * ⚠️ نجاح هذا الاختبار = إعادة إنتاج الفشل الحالي، لا دليل سلامة.
 * يُزال هذا الملف في نفس تغيير إغلاق D1.16.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('known-gap D1.16 (O08): سير عمل CI لا يبني الداشبورد', () => {
  const ci = fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');
  assert.ok(
    !ci.includes('dashboard'),
    'الوضع الحالي: ci.yml بلا أي ذكر للداشبورد — كسر Vite/React لا يُكتشف في PRs'
  );
});
