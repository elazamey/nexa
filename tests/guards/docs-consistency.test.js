import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Guard: docs-consistency — D1.1 (الطبقة المنهجية)
 * نجاح هذا الحارس = الوثائق (التقرير + الـ 17 assertion + العقد v0.3 + gaps.json + baseline.json)
 * متسقة مع بعضها ومع الفهرس. أي انحراف (assertion بلا مصدر، حالة enforced بلا فجوة مغلقة،
 * مرجع تعاقدي مفقود) يُكسر هنا.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const audit = read('docs/repository-audit-2026-09-22.ar.md');
const assertions = read('docs/Detector_Independence_Assertions.md');
const contract = read('docs/Artifact_Reader_Contract.md');
const gaps = JSON.parse(read('self-model/gaps.json'));
const baseline = JSON.parse(read('self-model/baseline.json'));

function parseAssertions(doc) {
  const blocks = doc.split(/^### /m).slice(1);
  const out = [];
  for (const block of blocks) {
    const idMatch = block.match(/^(DI-\d{2})/);
    if (!idMatch) continue;
    const status = block.includes('الحالة: **enforced**')
      ? 'enforced'
      : block.includes('الحالة: **open**') ? 'open' : null;
    const gapMatch = block.match(/\((D1\.\d+)/);
    out.push({ id: idMatch[1], status, gap: gapMatch ? gapMatch[1] : null });
  }
  return out;
}

test('Guard D1.1/docs: الوثائق الثلاث موسومة كإعادة بناء (لا ادعاء أصالة)', () => {
  for (const [name, doc] of [['audit', audit], ['assertions', assertions], ['contract', contract]]) {
    assert.ok(doc.includes('نسخة إعادة بناء'), `${name}: لا يوجد وسم إعادة البناء`);
    assert.ok(doc.includes('01a0cabd'), `${name}: لا يذكر الجلسة المفقودة كسبب الاستعادة`);
  }
});

test('Guard D1.1/docs: الـ assertions عددها 17 بالضبط ومتسلسلة ومسندة', () => {
  const parsed = parseAssertions(assertions);
  assert.equal(parsed.length, 17, `عدد الـ assertions يجب أن يكون 17، وجد ${parsed.length}`);
  for (let i = 1; i <= 17; i++) {
    const id = `DI-${String(i).padStart(2, '0')}`;
    assert.ok(parsed.some(p => p.id === id), `مفقود: ${id}`);
  }
  const gapIds = gaps.gaps.map(g => g.id);
  for (const p of parsed) {
    assert.ok(p.status === 'open' || p.status === 'enforced', `${p.id}: حالة غير معروفة`);
    assert.ok(p.gap && gapIds.includes(p.gap), `${p.id}: مرجع فجوة غير موجود ${p.gap}`);
  }
});

test('Guard D1.1/docs: assertion enforced تعني فجوتها مغلقة فعلًا في gaps.json', () => {
  const parsed = parseAssertions(assertions);
  for (const p of parsed) {
    if (p.status !== 'enforced') continue;
    const gap = gaps.gaps.find(g => g.id === p.gap);
    assert.ok(gap && gap.enforced === true, `${p.id}: حالة enforced لكن فجوته ${p.gap} مفتوحة`);
    assert.ok(gap.verification, `${p.id}: فجوة ${p.gap} مغلقة بلا verification`);
    assert.ok(fs.existsSync(path.join(ROOT, gap.verification)), `${p.id}: ملف verification مفقود`);
  }
});

test('Guard D1.1/docs: مصادر الفشل A01..A13 كلها معرفة في التقرير ومذكورة في الفهرس', () => {
  for (let i = 1; i <= 13; i++) {
    const code = `A${String(i).padStart(2, '0')}`;
    assert.ok(audit.includes(`**${code}**`), `التقرير لا يعرف ${code}`);
  }
  // ملحق O (gaps.json v2.1.0-ops): العائلة التشغيلية O01..O08 معرفة في التقرير أيضًا.
  for (let i = 1; i <= 8; i++) {
    const code = `O${String(i).padStart(2, '0')}`;
    assert.ok(audit.includes(`**${code}**`), `التقرير لا يعرف ${code}`);
  }
  const usedSources = new Set(gaps.gaps.flatMap(g => g.sources));
  for (let i = 1; i <= 13; i++) {
    assert.ok(usedSources.has(`A${String(i).padStart(2, '0')}`), 'كل مصادر A01..A13 يجب أن تبقى مستخدمة في الفهرس');
  }
  // تعميم محافظ: أي مصدر مستخدم (A أو O) يجب أن يكون معرّفًا في التقرير — لا إسناد وهمي.
  for (const code of usedSources) {
    assert.ok(audit.includes(`**${code}**`), `مصدر مستخدم بلا تعريف في التقرير: ${code}`);
  }
});

test('Guard D1.1/docs: العقد v0.3 يحمل البنود المرجعية للتذاكر والتعديلات الختامية', () => {
  for (const ref of ['v0.3', '§5.1', '§6.1', '§6.2', '§6.3', '§7', '§10.9', '§10.10', 'قاعدة 7/7', 'fail-closed', 'AR-E06', 'NEXA-E-REJECTED']) {
    assert.ok(contract.includes(ref), `العقد ينقصه: ${ref}`);
  }
});

test('Guard D1.1/docs: خط الأساس المقاس يطابق ما يدّعيه التقرير', () => {
  assert.equal(baseline.measured.tests, 545);
  assert.equal(baseline.measured.pass, 545);
  assert.equal(baseline.measured.fail, 0);
  assert.ok(audit.includes('545 / 545'), 'التقرير لا يذكر 545/545');
  assert.ok(audit.includes('13'), 'التقرير يجب أن ينقل ادعاء الـ 13 probes كما هو');
  // الادعاء غير القابل للتحقق يجب أن يبقى موسومًا كذلك — لا تحويله إلى "متحقق"
  assert.ok(baseline.frozen_claims.probes_13.status.startsWith('unverifiable'));
});
