import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * known-gap D1.13 (O05) — متغيرات البيئة بلا مرجع مركزي.
 * ⚠️ نجاح هذا الاختبار = إعادة إنتاج الفشل الحالي، لا دليل سلامة.
 * يُزال هذا الملف في نفس تغيير إغلاق D1.13.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('known-gap D1.13 (O05): لا .env.example رغم قراءة الخادم لمتغيرات env', () => {
  const server = fs.readFileSync(path.join(ROOT, 'tools/celia-dashboard-server.mjs'), 'utf8');
  assert.ok(server.includes('process.env.CELIA_WORKSPACE_WRITE_AUTH'), 'تمهيد: الخادم يقرأ CELIA_* من البيئة');
  assert.ok(server.includes('process.env.SUPABASE_URL'), 'تمهيد: الخادم يقرأ SUPABASE_* من البيئة');
  assert.equal(
    fs.existsSync(path.join(ROOT, '.env.example')),
    false,
    'الوضع الحالي: لا .env.example — المتغيرات مكتشفة بالقراءة فقط'
  );
});
