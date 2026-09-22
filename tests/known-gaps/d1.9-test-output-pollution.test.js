import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HuntMemory } from '../../src/security/hunter/hunt-memory.js';

/**
 * known-gap D1.9 (O01) — مخرجات التشغيل تلوث ملفات tracked.
 * ⚠️ نجاح هذا الاختبار = إعادة إنتاج الفشل الحالي، لا دليل سلامة.
 * يُزال هذا الملف في نفس تغيير إغلاق D1.9.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('known-gap D1.9 (O01): HuntMemory الافتراضي يحل إلى ملف tracked داخل الشجرة', () => {
  const mem = new HuntMemory(); // بناء فقط (قراءة) — لا كتابة هنا
  assert.equal(
    mem.storagePath,
    path.resolve(ROOT, 'dashboard/data/hunt-memory.json'),
    'الوضع الحالي: الافتراضي ملف مُتتبَّع — أي save() يلوث الشجرة (hunt-memory.js:9)'
  );
});

test('known-gap D1.9 (O01): سكربت الاختبار لا يعزل المخرجات عن الشجرة', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(
    !pkg.scripts.test.includes('NEXA_HUNT_MEMORY') && !pkg.scripts.test.includes('NEXA_BUG_REPORT'),
    `الوضع الحالي: سكربت الاختبار بلا عزل («${pkg.scripts.test}») — npm test يلوث dashboard/data`
  );
});

test('known-gap D1.9 (O01): مسار bug-report.json متصلب داخل الشجرة', () => {
  const hunter = fs.readFileSync(path.join(ROOT, 'src/security/agentic-hunter.js'), 'utf8');
  assert.ok(
    hunter.includes("path.resolve('dashboard/data')") && !hunter.includes('NEXA_BUG_REPORT'),
    'الوضع الحالي: outputDir متصلب على dashboard/data بلا env override (agentic-hunter.js:143)'
  );
});
