import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * D1.14 (O06) — فهرس التوثيق مُلزَم، لا liste مُهذَّبة.
 *
 * كان في `docs/` 29 ملفًا ومجلد أدلة بلا فهرس ولا صنف: أي وثيقة جديدة تُلقى في المجلد ولا شيء
 * يقول هل هي سارية أم سجلّ لحظةٍ ولا أين تُراجَع. الفارق بين الصنفين ليس تجميلًا: «سجلّ» يعني أن
 * أرقامه قياس وقته ولا تُقرأ حالةً — وهو الداء الذي أغلقت D1.12 صورته في README/SECURITY.
 *
 * الحارس يفحص التزامن في الاتجاهين (لا ملف بلا صفّ، ولا صفّ بلا ملف)، ويمنع أن يُنسب مسار إلى
 * حارس أو دليل غير موجود، ويُلزِم الأرشيف بمسار تحت `docs/archive/` بدل الحذف.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = 'docs/README.md';
const DOCS = path.join(ROOT, 'docs');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const STATUSES = ['سارية', 'سجلّ', 'تخطيط', 'تصميم', 'مؤرشفة'];

function topLevelDocs() {
  return fs.readdirSync(DOCS).filter((name) => name !== 'README.md');
}

function indexRows() {
  const lines = read(INDEX).split('\n');
  const start = lines.findIndex((l) => /^\|\s*الوثيقة\s*\|/.test(l));
  assert.ok(start >= 0, 'لا جدول فهرس في docs/README.md — الفهرس انقلب نصًّا حرًّا');
  const rows = [];
  for (const line of lines.slice(start + 2)) {
    if (!line.startsWith('|')) break;
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    rows.push(cells);
  }
  return rows;
}

test('D1.14: كل ملف أو مجلد في docs/ له صفّ واحد بالضبط، وبلا صفّ يتيم', () => {
  const entries = topLevelDocs();
  assert.ok(entries.length >= 25, `تمهيد: ${entries.length} مدخلًا في docs/`);
  const rows = indexRows();
  // أسماء العمود الأول قد تُعرض بميل لاحق للمجلدات — تُطبَّع للمقارنة
  const named = rows.map((r) => (r[0] ?? '').replace(/`/g, '').replace(/\/+$/, ''));
  const normalised = entries.map((f) => f.replace(/\/+$/, ''));
  const missing = normalised.filter((f) => !named.includes(f));
  assert.deepEqual(missing, [], 'وثيقة في docs/ بلا صفّ في الفهرس — أضِفها في نفس التغيير');
  const dupes = named.filter((n, i) => named.indexOf(n) !== i);
  assert.deepEqual([...new Set(dupes)], [], 'صفّ مكرر لنفس الوثيقة — الفهرس صار غموضًا');
});

test('D1.14: لا صفّ جامد — كل صفّ يشير إلى ملف موجود (أو أرشيف معلن)', () => {
  const rows = indexRows();
  const broken = [];
  for (const cells of rows) {
    const name = (cells[0] ?? '').replace(/`/g, '');
    const status = cells[2] ?? '';
    if (!name) continue;
    const direct = path.join(DOCS, name);
    const archived = path.join(DOCS, 'archive', name.replace(/\/$/, ''));
    if (fs.existsSync(direct)) continue;
    if (status === 'مؤرشفة' && fs.existsSync(archived)) continue;
    broken.push(`${name} (صنف: ${status || '—'})`);
  }
  assert.deepEqual(broken, [], 'صفوف في الفهرس لا ملف لها — لا حذف للتوثيق؛ تُؤرشف إلى docs/archive/ ويُحدَّث الصفّ');
});

test('D1.14: الصنف معلَن من مغلق، والتاريخ لازم لما ليس ساريًا', () => {
  const rows = indexRows();
  for (const cells of rows) {
    const [name, purpose, status, reference] = cells;
    assert.equal(cells.length, 4, `صفّ ${name}: أربعة أعمدة لا أكثر ولا أقل`);
    assert.ok(STATUSES.includes(status), `صفّ ${name}: صنف غير معلَن (${status}) — الخيارات: ${STATUSES.join('/')}`);
    assert.ok((purpose ?? '').length >= 12, `صفّ ${name}: غرض مبتور`);
    assert.ok((reference ?? '').length >= 8, `صفّ ${name}: بلا مرجع/مُحدِّث`);
    if (status === 'سجلّ' || status === 'تخطيط' || status === 'مؤرشفة') {
      assert.match(`${purpose} ${reference}`, /20\d\d/, `صفّ ${name}: ${status} مؤرَّخ بلا تاريخ — فلا يُفرَّق بينه وبين سارية`);
    }
    if (status === 'سارية') {
      assert.doesNotMatch(`${purpose}`, /\bHOLD\b|لا يُقرأ حالة|تاريخي/, `صفّ ${name}: مصنَّف سارية وهو يعلن نفسه تاريخيًا`);
    }
  }
});

test('D1.14: ما يُسنَد إلى حارس أو دليل موجود فعلًا — لا مسار مُختلَق', () => {
  const rows = indexRows();
  const cited = new Set();
  for (const cells of rows) {
    for (const token of cells.join(' ').matchAll(/`([A-Za-z0-9._\-/]{3,})`/g)) {
      const p = token[1];
      if (!p.includes('/') && !/\.(?:md|json|csv|tap|txt|ya?ml)$/.test(p)) continue;
      cited.add(p.replace(/\/$/, ''));
    }
  }
  assert.ok(cited.size >= 10, `تمهيد: ${cited.size} مسارًا مُسنَدًا في الفهرس — نطاق الفحص انكمش؟`);
  const existsSomewhere = (p) => fs.existsSync(path.join(ROOT, p)) || fs.existsSync(path.join(DOCS, p));
  const phantoms = [...cited].filter((p) => !existsSomewhere(p));
  assert.deepEqual(phantoms, [], 'الفهرس يستند إلى ملفات غير موجودة — حارس محذوف أو دليل لم يُولَّد');
});

test('D1.14: الفهرس يعلن قاعدته — لا حذف، وأرشيف موسوم، ولا أرقام منسوخة', () => {
  const doc = read(INDEX);
  assert.match(doc, /لا حذف/, 'الفهرس لا يعلن منع الحذف');
  assert.match(doc, /docs\/archive\//, 'الفهرس لا يسمّي مسار الأرشيف');
  assert.match(doc, /append-only|لا يُعاد كتابته/, 'سجلّات الإغلاق بلا تصريح append-only');
  // والأرقام تُقاس لا تُنسخ: لا وعد بحالة في الفهرس نفسه
  assert.match(doc, /self-model\/gaps\.json/, 'الفهرس لا يُحيل الحالة إلى السجل');
  assert.match(doc, /live_measurement|npm run metrics/, 'الفهرس لا يُحيل العدد المقيس إلى مصدره');
  // والاكتشاف: لا يُنتظر من أحد أن يخمّن وجود الفهرس
  const entry = [ 'CONTRIBUTING.md', 'README.md' ].some((f) => read(f).includes('docs/README.md'));
  assert.ok(entry, 'لا إشارة إلى docs/README.md في CONTRIBUTING.md ولا README.md — فهرس لا يُقرأ ليس فهرسًا');
});
