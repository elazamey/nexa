import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Guard: gaps-consistency — D1.1 (الطبقة المنهجية)
 * نجاح هذا الحارس = ملف الفجوات self-model/gaps.json متسق مع الاختبارات والقواعد.
 * القاعدة المركزية: enforced:true بلا verification في tests/ خارج known-gaps = مرفوض.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GAPS_PATH = path.join(ROOT, 'self-model', 'gaps.json');
const KNOWN_GAPS_DIR = path.join(ROOT, 'tests', 'known-gaps');
const A_CODE_RE = /^A(0[1-9]|1[0-3])$/; // A01..A13

const gaps = JSON.parse(fs.readFileSync(GAPS_PATH, 'utf8'));

function knownGapFiles() {
  if (!fs.existsSync(KNOWN_GAPS_DIR)) return [];
  return fs.readdirSync(KNOWN_GAPS_DIR).filter(f => f.endsWith('.test.js'));
}

// Whole-id match: "D1.1" must not match inside "D1.10".
const mentions = (content, id) => new RegExp(`(^|[^\\d.])${id.replace('.', '\\.')}(?![\\d])`).test(content);

function knownGapContent(id) {
  const hits = [];
  for (const f of knownGapFiles()) {
    const content = fs.readFileSync(path.join(KNOWN_GAPS_DIR, f), 'utf8');
    if (mentions(content, id)) hits.push(f);
  }
  return hits;
}

test('Guard D1.1/gaps: البنية العامة لفهرس الفجوات سليمة', () => {
  assert.ok(Array.isArray(gaps.gaps) && gaps.gaps.length >= 8, 'يجب أن يحوي الفهرس 8 فجوات على الأقل');
  const ids = gaps.gaps.map(g => g.id);
  assert.equal(new Set(ids).size, ids.length, 'معرفات الفجوات غير مكررة');
  for (const g of gaps.gaps) {
    assert.match(g.id, /^D1\.\d+$/, `معرف غير صالح: ${g.id}`);
    assert.equal(typeof g.title, 'string');
    assert.equal(typeof g.current, 'string');
    assert.equal(typeof g.required, 'string');
    assert.equal(typeof g.enforced, 'boolean');
    assert.equal(typeof g.area, 'string');
    assert.ok(g.acceptance && typeof g.acceptance === 'object', `${g.id}: acceptance مطلوبة`);
    assert.ok(Array.isArray(g.sources), `${g.id}: sources مصفوفة`);
    if (g.area !== 'methodology') {
      assert.ok(g.sources.length > 0, `${g.id}: فجوة src بلا مصدر فشل`);
    }
    for (const s of g.sources) {
      assert.match(s, A_CODE_RE, `${g.id}: مصدر فشل غير صالح ${s} (المسموح A01..A13)`);
    }
  }
});

test('Guard D1.1/gaps: enforced:true يستلزم verification حيًا في tests/ خارج known-gaps', () => {
  for (const g of gaps.gaps) {
    if (!g.enforced) continue;
    assert.ok(g.verification, `${g.id}: enforced:true بلا verification — مرفوض`);
    assert.ok(g.closed_at, `${g.id}: enforced:true بلا closed_at — مرفوض`);
    assert.ok(!g.verification.includes('known-gaps'), `${g.id}: verification داخل known-gaps لا يُقبل`);
    const vPath = path.join(ROOT, g.verification);
    assert.ok(fs.existsSync(vPath), `${g.id}: ملف verification غير موجود: ${g.verification}`);
    const vContent = fs.readFileSync(vPath, 'utf8');
    assert.ok(vContent.includes(g.id), `${g.id}: ملف verification لا يشير إلى الفجوة`);
  }
});

test('Guard D1.1/gaps: الفجوة المفتوحة إما بمُعيد إنتاج في known-gaps أو محجوبة صراحةً', () => {
  for (const g of gaps.gaps) {
    if (g.enforced) continue;
    assert.ok(g.opened_at, `${g.id}: فجوة مفتوحة بلا opened_at`);
    if (g.reproducer === 'test') {
      const hits = knownGapContent(g.id);
      assert.ok(hits.length > 0, `${g.id}: مفتوحة بلا مُعيد إنتاج في tests/known-gaps/`);
    } else {
      assert.ok(Array.isArray(g.blocked_by) && g.blocked_by.length > 0,
        `${g.id}: مفتوحة بلا reproducer:test يجب أن تكون محجوبة (blocked_by)`);
      const ids = gaps.gaps.map(x => x.id);
      for (const b of g.blocked_by) assert.ok(ids.includes(b), `${g.id}: حجب لفجوة غير موجودة ${b}`);
    }
  }
});

test('Guard D1.1/gaps: لا ملفات known-gaps يتيمة ولا لفجوات مغلقة', () => {
  const openIds = gaps.gaps.filter(g => !g.enforced).map(g => g.id);
  const allIds = gaps.gaps.map(g => g.id);
  for (const f of knownGapFiles()) {
    const content = fs.readFileSync(path.join(KNOWN_GAPS_DIR, f), 'utf8');
    const referenced = allIds.filter(id => mentions(content, id));
    assert.ok(referenced.length > 0, `${f}: لا يشير إلى أي فجوة (يتيم)`);
    for (const id of referenced) {
      assert.ok(openIds.includes(id),
        `${f}: يعيد إنتاج الفجوة ${id} وهي مغلقة — يجب إزالته في تغيير الإغلاق نفسه`);
    }
  }
});

test('Guard D1.1/gaps: acceptance لتذكرة D1.2 يحدد اختبار الانعكاس وشرط الإغلاق', () => {
  const d12 = gaps.gaps.find(g => g.id === 'D1.2');
  assert.ok(d12, 'تذكرة D1.2 موجودة');
  assert.equal(d12.acceptance.inversion_test, 'tests/artifact-reader.test.js');
  assert.ok(Array.isArray(d12.acceptance.criteria) && d12.acceptance.criteria.length >= 10);
  assert.ok(d12.acceptance.pre_condition.includes('يفشل'));
  assert.ok(String(d12.acceptance.closure).includes('نفس تغيير'));
  // بعد الإغلاق: اختبار الانعكاس المخطط هو نفسه verification الحي
  if (d12.enforced) {
    assert.equal(d12.verification, 'tests/artifact-reader.test.js', 'D1.2: verification يجب أن يكون اختبار الانعكاس نفسه');
  }
  // مراجع تعاقدية أساسية داخل معيار القبول
  const joined = d12.acceptance.criteria.join(' ');
  for (const ref of ['§5.1', '§6.1', '§6.3', '§10.9', '§10.10']) {
    assert.ok(joined.includes(ref) || d12.required.includes(ref), `D1.2: مرجع تعاقدي مفقود ${ref}`);
  }
});
