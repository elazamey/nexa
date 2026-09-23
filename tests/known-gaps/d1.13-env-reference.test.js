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

const BOUNDARY_FILES = [
  'tools/celia-dashboard-server.mjs',
  // من طبقتي المحيط وحارس الإقلاع فصاعدًا، قراءات البيئة التشغيلية تعيش في وحدات
  // الحدود لا في
  // السيرفر وحده (محيط، حد معدل، حارس إقلاع) — أي أن الفجوة اتسعت، لا ضاقت:
  // لا مرجع واحد يسمّي المتغيرات العشرة الآن الموزّعة على أربعة ملفات.
  'tools/celia-perimeter-auth.mjs',
  'tools/celia-rate-limit.mjs',
  'tools/celia-startup-guard.mjs',
];

test('known-gap D1.13 (O05): لا .env.example رغم قراءة حدود الخادم لمتغيرات env', () => {
  const boundary = BOUNDARY_FILES.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  assert.ok(boundary.includes('process.env.CELIA_WORKSPACE_WRITE_AUTH'), 'تمهيد: الحدود تقرأ CELIA_* من البيئة');
  assert.ok(boundary.includes('process.env.SUPABASE_URL') || boundary.includes('env.SUPABASE_URL'),
    'تمهيد: الحدود تقرأ SUPABASE_* من البيئة');
  assert.ok(boundary.includes('NEXA_API_KEY') && boundary.includes('NEXA_RATE_LIMIT_MAX')
    && boundary.includes('NEXA_PRODUCTION_PERSISTENCE'),
    'تمهيد: متغيرات المحيط/الحد/الإقلاع تُقرأ بلا مرجع مركزي يسمّيها');
  assert.equal(
    fs.existsSync(path.join(ROOT, '.env.example')),
    false,
    'الوضع الحالي: لا .env.example — المتغيرات مكتشفة بالقراءة فقط'
  );
});
