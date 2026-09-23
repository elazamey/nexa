import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * known-gap D1.28 — createRateLimiter يوثّق options.onAudit ويستقبله، لكنه لا يستدعيه أبدًا:
 * من يمرّر صنبورًا للتحقيق (celia-dashboard-server) يظن أن 429 تظهر في الـ DAG ولا تظهر.
 * ⚠️ نجاح هذا الاختبار = إعادة الإنتاج. عند الإغلاق يُستدعى الصنبور فتُحمرّ هذه ويُحذف الملف.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('known-gap D1.28: الصنبور مربوط ولا يُنادى عند الرفض', async () => {
  const { createRateLimiter } = await import(path.join(ROOT, 'tools/celia-rate-limit.mjs'));
  const seen = [];
  const limiter = createRateLimiter({
    max: 1,
    windowMs: 60_000,
    env: {},
    now: () => 1_700_000_000_000,
    onAudit: (entry) => seen.push(entry),
  });
  try {
    const first = limiter.consume({ method: 'api-key', clientId: 'd1.28' });
    const second = limiter.consume({ method: 'api-key', clientId: 'd1.28' });
    assert.equal(first.ok, true, 'الأول يجب أن يمر — تغيّر عقد consume؟');
    assert.equal(second.ok, false, 'الثاني لم يُرفض — لا حدّ يتجاوزه أحد، فالدليل بلا معنى');
    assert.equal(limiter.stats().rejected, 1, 'العدّاد الداخلي يرى الرفض والصنبور لا يراه — هذا هو الداء');
    assert.deepEqual(seen, [], 'الصنبور صار يُستدعى — D1.28 أُغلقت؟ انقل التأكيد إلى اختبار دائم');
  } finally {
    limiter.dispose();
  }
});

test('known-gap D1.28: المستدعي يظن أنه يُحصي، والوثيقة تعد به', () => {
  const src = read('tools/celia-rate-limit.mjs');
  assert.match(src, /const onAudit = typeof options\.onAudit/, 'الصنبور لم يعد مربوطًا — أعِد قراءة التذكرة');
  assert.equal((src.match(/onAudit\(/g) || []).length, 0,
    `يوجد استدعاء للصنبور (${(src.match(/onAudit\(/g) || []).length}) — حُسِمت D1.28؟ أزل المُعيد في نفس التغيير`);
  assert.match(src, /\[options\.onAudit\]/, 'الجسد لا يزال يوثّق الخيار — فالتصريح غير مدفوع');
  const server = read('tools/celia-dashboard-server.mjs');
  assert.ok(/onAudit: \(entry\) => emitDagEvent/.test(server), 'المستدعي لم يعد يمرّر الصنبور — قِس من جديد');
  // ولا حدث DAG آخر يغطي ما كان الصنبور يغطّيه: فالرفض لا يصل الشاشة من أي طريق
  assert.ok(!/emitDagEvent\('(RATE|PERIMETER_RATE)[A-Z_]*'/.test(server),
    'صار للحدّ حدث DAG مستقل — أعد قراءة D1.28 (قد يكون الصنبور زائدًا لا معطوبًا)');
});
