import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * known-gap D1.15 (O07) — ملفات مكررة بلا حارس مزامنة.
 * ⚠️ نجاح هذا الاختبار = إعادة إنتاج الفشل الحالي، لا دليل سلامة.
 * يُزال هذا الملف في نفس تغيير إغلاق D1.15.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EDGE_RAG = [
  'cost_guard.js', 'evidence_ledger.js', 'hybrid_memory.js',
  'provider_broker.js', 'rag_core.js', 'reflection_engine.js', 'worker.js',
];

test('known-gap D1.15 (O07): نسخ edge-rag السبع مكررة يدويًا بلا مصدر حقيقة', () => {
  for (const file of EDGE_RAG) {
    const a = fs.readFileSync(path.join(ROOT, 'adapters/edge-rag', file));
    const b = fs.readFileSync(path.join(ROOT, 'dashboard/public', file));
    assert.ok(a.equals(b), `تمهيد: ${file} متطابق حاليًا — والخطر أن التطابق يدوي`);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(
    !Object.keys(pkg.scripts).some(s => s.includes('sync')),
    'الوضع الحالي: لا سكربت مزامنة — التطابق الحالي صدفة صيانة لا ضمان'
  );
  assert.equal(
    fs.existsSync(path.join(ROOT, 'tests/duplicate-sync.test.js')),
    false,
    'الوضع الحالي: لا حارس مزامنة — اختلاف مستقبلي لن يُكتشف'
  );
});
