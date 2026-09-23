import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * D1.28 — صنبور التحقيق في `createRateLimiter` يُستدعى عند الرفض، وبلا خام.
 *
 * السطر بشكل سطر الـ perimeter (`type`/`at`) لأن الـ DAG يخلط الاثنين، و`bucket` هو
 * الوسم القاصر الذي يعيده الحكم أصلًا (sha256→8 بايت، tools/celia-rate-limit.mjs:50) فلا
 * يعرّف أحدًا من خارجه ولا يُقلَب إلى مفتاح أو عنوان. والنداء غير محجوب بـ try ولا
 * مُبتلَع: صنبورٌ يرمي هو خلل في صاحبه، وتغليفه بصمت يعيد إنتاج عادة || true (D1.18/D1.20).
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

async function limiter(opts = {}) {
  const { createRateLimiter } = await import(path.join(ROOT, 'tools/celia-rate-limit.mjs'));
  const seen = [];
  const l = createRateLimiter({ env: {}, now: () => 1_700_000_000_000, onAudit: (e) => seen.push(e), ...opts });
  return { l, seen };
}

test('D1.28: الرفض ينادي الصنبور مرة واحدة وبالحقول المعلنة', async () => {
  const { l, seen } = await limiter({ max: 1, windowMs: 60_000 });
  try {
    assert.equal(l.consume('key:operator-d1-28').ok, true);
    const second = l.consume('key:operator-d1-28');
    assert.equal(second.ok, false, 'لم يُرفض الثاني — لا حدّ يتجاوزه أحد');
    assert.equal(seen.length, 1, `الرفض أنتج ${seen.length} سطرًا بدل واحد`);
    const e = seen[0];
    assert.equal(e.type, 'RATE_LIMIT_REJECTED');
    assert.equal(l.stats().rejected, 1, 'العدّاد الداخلي يرى الرفض والسطر لا يراه');
    assert.match(String(e.at), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/, '`at` ليس ISO من ساعة الحقن');
    assert.equal(e.limit, 1);
    assert.ok(Number.isInteger(e.retryAfterSec) && e.retryAfterSec >= 1, '`retryAfterSec` يجب أن يُرى في السطر');
    assert.match(String(e.bucket), /^[0-9a-f]{16}$/, 'الوسم ليس الوسم القاصر الذي يعيده الحكم');
    assert.equal(e.bucket, second.bucket, 'سطر التحقيق والحكم يسمّيان دلوين مختلفين');
  } finally { l.dispose(); }
});

test('D1.28: القبول لا يثرثر، والمطفأ بلا سطر', async () => {
  const { l, seen } = await limiter({ max: 5, windowMs: 60_000 });
  try {
    for (let i = 0; i < 5; i++) assert.equal(l.consume('key:quiet').ok, true);
    assert.deepEqual(seen, [], 'صنبور يكتب على كل قبول = ضجيج يقتل دلالة الرفض');
  } finally { l.dispose(); }

  const off = await limiter({ env: { NEXA_RATE_LIMIT_MAX: '0' }, max: 1, windowMs: 60_000 });
  try {
    for (let i = 0; i < 10; i++) assert.equal(off.l.consume('key:loadtest').ok, true, 'مفتاح الإطفاء لم يعد يطفئ');
    assert.deepEqual(off.seen, [], 'المطفأ يصرخ في الصنبور');
  } finally { off.l.dispose(); }
});

test('D1.28: السطر لا يحمل خامًا — لا مفتاحًا ولا عنوانًا ولا تجزئة', async () => {
  const secret = 'NEXA-KEY-0123456789abcdef';
  const { l, seen } = await limiter({ max: 1, windowMs: 60_000 });
  try {
    l.consume(`key:${secret}`);
    l.consume(`key:${secret}`);
    l.consume('ip:198.51.100.7');
    l.consume('ip:198.51.100.7');
    assert.equal(seen.length, 2, `سطران متوقعان عند رفض دلوين، قيس ${seen.length}`);
    const dump = JSON.stringify(seen);
    assert.ok(!dump.includes(secret), 'مادّة المفتاح تسرّبت إلى سطر التحقيق');
    assert.ok(!dump.includes('198.51.100.7'), 'عنوان وصل تسرّب إلى سطر التحقيق');
    assert.ok(!/ip:|key:|login:/.test(dump), 'الوسم يعيد بناء بادئة الدلو الخام');
    assert.ok(!Object.keys(seen[0]).some((k) => /count|windowStart/i.test(k)), 'السطر ينقل محتويات الدلو');
  } finally { l.dispose(); }
});

test('D1.28: النداء في مسار الرفض نفسه، لا في المستدعي، وبلا ابتلاع', async () => {
  const src = read('tools/celia-rate-limit.mjs');
  const rejectBranch = src.split('rejected += 1;')[1]?.split('}')[0] ?? '';
  assert.ok(/onAudit\(/.test(rejectBranch), 'لا نداء في فرع الرفض — رُد إلى هناك لا إلى caller');
  assert.match(src, /\[options\.onAudit\]/, 'التصريح حُذف من JSDoc بينما الخيار ما زال مستقبَلًا');
  assert.ok(!/try\s*\{[\s\S]{0,80}onAudit\(/.test(src), 'النداء محجوب بـ try — لا صمت على فشل الصنبور');
  assert.ok(!/onAudit\([^)]*\)\s*(\|\||\?\?)/.test(src), 'النداء متبوع بابتلاع فشل');
  const server = read('tools/celia-dashboard-server.mjs');
  for (const fact of ['createPerimeter', 'createRateLimiter']) {
    const wiring = server.split(`${fact}({`)[1].split('});')[0];
    assert.match(wiring, /onAudit: \(entry\) => emitDagEvent\(entry\.type, entry\)/,
      `الوصلة في ${fact} تغيّرت — حدّث الحارس بعلم`);
  }
});
