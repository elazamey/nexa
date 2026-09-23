import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * D1.12 — مزامنة ادعاءات أعداد الاختبارات (README / الخطط / المحقق).
 *
 * الفجوة (O04) لم تكن «رقمًا نسي أحدُه التحديث» بل بنية تجعل الادعاء غير قابل للتكذيب:
 *   - `pub-verifier.sh` كان يهنّئ المجموعة بنصّه الثابت `tests_green: 314/314`: مقيس
 *     مُختلَق لا قراءة — مع مجموعة من اختبارين فقط نال الختم (مُثبَت بالقياس لا بالاستنتاج)،
 *     ولم تكن تُقرأ `# fail` ولا أي أرضية، فمجموعة منكمشة تُزَكّى بلا التفات؛
 *   - README/SECURITY كانا يكتبان رقمًا حرفيًا لا يربطهما به شيء داخل المجموعة؛
 *   - خطط النشر تحمل قياسات موقّعة تُقرأ كادعاء راهن؛
 *   - وحارس المزامنة نفسه كان يثبّت 545 حرفيًا، فتُكسر كل إعادة قياس بدل أن تُصحَّح.
 *
 * المصدر الواحد للحقيقة هنا: `self-model/baseline.json → live_measurement` (قياس مسجَّل)،
 * والوثائق تُطابقه، و`npm run metrics` (CI) هو من يربط ذلك القياس بالواقع المُجرى.
 * كل اختبار أدناه ينكسر إذا عاد أي من أنماط theater — وهذا هو اختبار الانقلاب المطلوب.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const readme = read('README.md');
const security = read('SECURITY.md');
const verifier = read('pub-verifier.sh');
const baseline = JSON.parse(read('self-model/baseline.json'));
const audit = read('docs/repository-audit-2026-09-22.ar.md');

function metricsValue(doc, key) {
  const block = doc.match(/<!-- NEXA_METRICS:START -->([\s\S]*?)<!-- NEXA_METRICS:END -->/);
  assert.ok(block, 'لا يوجد NEXA_METRICS block — لا مكان مشروع لرقم مقاس في الوثيقة');
  const line = block[1].match(new RegExp(`^- ${key}: (\\d+)$`, 'm'));
  assert.ok(line, `${key}: مفقود من الـ metrics block`);
  return Number(line[1]);
}

test('D1.12: لا ادعاء عدد حالي في الوثيقتين — المعتبر الوحيد هو الـ metrics block', () => {
  // صيغة «X PASS / Y FAIL of Z» هي صيغة التصديق الذاتي: رقم مجمّد يُقدَّم دليلًا.
  for (const [name, doc] of [['README.md', readme], ['SECURITY.md', security]]) {
    assert.doesNotMatch(
      doc,
      /\d+\s+PASS(ING)?\s*\/\s*\d+\s*(?:KNOWN\s+)?FAIL(ING)?\s+of\s+\d+/i,
      `${name} يعيد إنتاج صيغة ادعاء عدد حرفية (… PASS / … FAIL of …)`
    );
    assert.doesNotMatch(
      doc,
      /latest (verification|`verify`)[^\n]{0,40}\d{2,4}\s+(PASS|tests|\/)/i,
      `${name} يقدّم قياسًا قديمًا كونه «الأحدث»`
    );
  }
});

test('D1.12: README وSECURITY يشيران إلى نفس السجل المسجل — لا رقم حر', () => {
  for (const [name, doc] of [['README.md', readme], ['SECURITY.md', security]]) {
    assert.ok(doc.includes('self-model/baseline.json'), `${name} لا يُحيل إلى سجل القياس في baseline.json`);
    assert.ok(doc.includes('npm run metrics'), `${name} لا يذكر الأمر الذي يربط الوثائق بالقياس الفعلي`);
    assert.equal(
      metricsValue(doc, 'Total tests'),
      baseline.live_measurement.tests,
      `${name}: الـ metrics block لا يطابق السجل المسجل`
    );
    assert.equal(
      metricsValue(doc, 'Security tests'),
      baseline.live_measurement.security_tests,
      `${name}: عدد اختبارات الأمان لا يطابق السجل المسجل`
    );
    for (const key of ['Ω attacks', 'Google identity attacks', 'Closed gates', 'Ω error codes', 'Gated namespaces', 'Attack categories']) {
      assert.ok(
        new RegExp(`^- ${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: \\d+$`, 'm').test(doc),
        `${name}: الـ metrics block لا يحمل السطر المفروض CI فحصه: ${key}`
      );
    }
  }
  // لا تنفجار بين الوثيقتين: نفس الكتلة، نفس الأرقام
  for (const key of ['Ω error codes', 'Gated namespaces', 'Attack categories', 'Closed gates']) {
    assert.equal(
      metricsValue(readme, key),
      metricsValue(security, key),
      `الوثيقتان تختلفان في ${key} — إحداهما على الأقل خطأ`
    );
  }
});

test('D1.12: سجل القياس صالح ومتماسك ويحمل تاريخه ولحظته', () => {
  const m = baseline.live_measurement;
  assert.ok(m && typeof m === 'object', 'baseline.live_measurement مفقود');
  for (const k of ['date', 'command', 'node', 'tests', 'pass', 'fail', 'commit', 'tool', 'security_tests']) assert.ok(
    k in m, `baseline.live_measurement ينقصه الحقل ${k}`
  );
  assert.match(m.date, /^\d{4}-\d{2}-\d{2}$/, 'تاريخ القياس يجب أن يكون ISO');
  assert.match(m.commit, /^[0-9a-f]{40}$/, 'القياس يجب أن يكون مربوطًا بلحظة git');
  assert.equal(Number(m.fail), 0, 'سجل القياس الحالي لا يجوز أن يثبّت مجموعة فاشلة');
  assert.equal(Number(m.pass), Number(m.tests), 'pass يجب أن يساوي tests حين لا فشل');
  assert.ok(Number(m.tests) > 0, 'قياس بلا اختبارات ليس أساسًا');
});

test('D1.12: المحقق يقرأ العدد من المخرجات ولا يستجديه من نص ثابت', () => {
  // الحكم على سطور السكربت التنفيذية وحدها: التعليق الذي يروي ما كان عليه الفحص القديم
  // يذكر نمطه حرفيًا للتوثيق، ومنع ذلك كان سيمنع الشرح لا الركاكة.
  const code = verifier
    .split('\n')
    .filter(line => !/^\s*#/.test(line))
    .join('\n');
  assert.doesNotMatch(code, /grep\s+-q\s+"pass"/, 'عودة الـ fallback الذي يجعل الفحص لا يفشل أبدًا');
  assert.doesNotMatch(code, /grep\s+-q\s+"\d{3}"/, 'فحص عدد بحرفيات في السكربت');
  assert.doesNotMatch(code, /"\s*314\s*\/\s*314\s*"/, 'ادعاء 314/314 في السكربت');
  assert.match(code, /\^\# fail/, 'لا قراءة لملخص # fail — وهو جوهر الفحص');
  assert.match(code, /\^\# pass/, 'لا قراءة لملخص # pass');
  assert.match(code, /TAP_FAIL" -ne 0/, 'لا رفض عند وجود اختبارات فاشلة');
  assert.match(code, /self-model\/baseline\.json/, 'الأرضية يجب أن تأتي من السجل المسجل لا من نص ثابت');
  assert.match(code, /TAP_TESTS" -lt /, 'لا رفض لمجموعة انكمشت تحت الأرضية — جوهر منع العدد المختلَق');
  assert.doesNotMatch(code, /check_pass "tests_green: \d+\/\d+/, 'رسالة النجاح تختم على عدد بنص ثابت بدل ما قُرئ');
  assert.doesNotMatch(code, /grep -q "\d+ gates/i, 'بوابة تُحكم بنمط نص فيه عدد حرفي، لا بقرار الفاحص');
  assert.match(code, /NEXA_METRIC closed_gates=/, 'بوابة البوابات لا تقرأ العدد المقاس من الفاحص');
  const runs = (code.match(/npm test/g) || []).length;
  assert.equal(runs, 1, `المحقق يشغّل المجموعة ${runs} مرات — القياس يجب أن يكون تشغيلًا واحدًا`);
});

test('D1.12: كل خطة نشر تحمل قياسها موسومًا بتاريخها لا راهنية', () => {
  const plans = fs.readdirSync(ROOT).filter(f => /^publish-v0\.\d+\.plan\.json$/.test(f));
  assert.ok(plans.length >= 2, 'لم تُجد خطط النشر — تغيّر الاسم؟ الحارس يجب أن يُحدَّث عمدًا');
  for (const f of plans) {
    const p = JSON.parse(read(f));
    const claim = p.checks && p.checks.tests ? p.checks.tests : null;
    if (!claim) continue;
    assert.ok(
      typeof p.record_status === 'string' && p.record_status.includes(String(p.timestamp)),
      `${f}: قياس موقّع بلا وسم «سجل تاريخي» بتاريخه`
    );
    assert.match(p.record_status, /HISTORICAL RECORD/i, `${f}: وسم الخطة لا يقول صراحة إنها سجل تاريخي`);
    assert.match(p.record_status, /NOT a current claim/i, `${f}: الوسم لا ينفي راهنية الرقم صراحة`);
  }
});

test('D1.12: ربط الوثائق بالواقع يبقى واجب النفاذ (لا يُنقل الحارس إلى داخل المجموعة)', () => {
  // tools/check-metrics.mjs هو القياس الحي؛ إن فقد مقارنة الوثائق بطل كل ما فوق.
  const checker = read('tools/check-metrics.mjs');
  assert.match(checker, /NEXA_METRICS:START/, 'المقياس لم يعد يقرأ الـ metrics block');
  assert.match(checker, /mismatch on/, 'المقياس لم يعد يقارن الوثيقة بالقياس');
  assert.ok(
    /npm run metrics/.test(read('.github/workflows/metrics.yml')),
    'CI لم يعد يشغّل enforce Docs↔Reality — الحارس بلا سنَد'
  );
  // القياس التجميدي للتقرير المجمّد يجب أن يبقى مذكورًا كما هو (تاريخ، لا ادعاء راهنة)
  assert.match(audit, /545 \/ 545/, 'التقرير المجمّد فقد سجله التاريخي 545/545');
});
