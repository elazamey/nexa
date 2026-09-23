import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * D1.13 (O05) — مرجع متغيرات البيئة مُلزَم، لا اختيارى.
 *
 * الفجوة لم تكن «لا قالب env» (القالب مرفوض بقرار مُجمَّد: السرّ في ملف مودَع ليس سِرًّا) بل
 * «لا سجل يسمّي القراءات ولا رقيب يمنع نموّها صامتةً». الحارس إذن ثلاثي: كل قراءة موثَّقة، ولا
 * صفّ جامد، وكل موضع قراءة غير مباشرة مُعلَن — زائدًا منع تسرّب أسماء الأسرار إلى الواجهة الأمامية.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOC = 'docs/environment-reference.md';
const CODE_AREAS = ['tools', 'src', 'packages', 'adapters', 'examples'];
const PIPELINE_FILES = ['.github/workflows/release.yml', '.github/workflows/ci.yml', 'render.yaml'];

const sourceFiles = (dirs) => {
  const out = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') continue;
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(?:m?js|cjs)$/.test(entry.name)) out.push(p);
    }
  };
  dirs.forEach((d) => walk(path.join(ROOT, d)));
  return out;
};

const read = (abs) => fs.readFileSync(abs, 'utf8');

/** ملفات تصل إلى المتصفح (jsx/html مضمّنة في الحزمة) */
function frontEndFiles() {
  const out = [];
  const dir = path.join(ROOT, 'dashboard');
  const walk = (d) => {
    if (!fs.existsSync(d)) return;
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      if (['node_modules', 'dist', '.next', 'build'].includes(entry.name)) continue;
      const p = path.join(d, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (/\.(?:m?js|cjs|jsx|tsx|html)$/.test(entry.name)) out.push(p);
    }
  };
  walk(dir);
  const filtered = out.filter((f) => !f.includes(`${path.sep}public${path.sep}dashboard-dist`));
  assert.ok(filtered.length > 20, 'جولة الواجهة شبه فارغة — نطاق الفحص انكمش؟');
  return filtered;
}

/** قراءة ثابتة: process.env.X / env.X / process.env['X'] — لا تشمل process.env[key] */
const STATIC_READ_RE = /(?:process\.)?\benv\s*(?:\.\s*|\[\s*['"`])([A-Z][A-Z0-9_]{2,})(?![A-Za-z0-9_])/g;
const DYNAMIC_RE = /\bprocess\.env\s*\[\s*[A-Za-z_$]/g;

function readInventory() {
  const reads = new Map();
  const dynamicFiles = new Set();
  const files = [...sourceFiles(CODE_AREAS), ...PIPELINE_FILES.map((f) => path.join(ROOT, f))].filter((f) => fs.existsSync(f));
  for (const file of files) {
    const text = read(file).replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of text.matchAll(STATIC_READ_RE)) {
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      if (!reads.has(m[1])) reads.set(m[1], new Set());
      reads.get(m[1]).add(rel);
    }
    if (DYNAMIC_RE.test(text)) dynamicFiles.add(path.relative(ROOT, file).split(path.sep).join('/'));
    DYNAMIC_RE.lastIndex = 0;
  }
  return { reads, dynamicFiles };
}

function docRows(doc) {
  const rows = new Map();
  let inTable = false;
  for (const line of doc.split('\n')) {
    if (/^\|\s*المتغير\s*\|/.test(line)) { inTable = true; continue; }
    // صف الفواصل في جدول markdown: | :--- | :--- | … |
    if (inTable && /^\|(\s*:?-{2,}:?\s*\|)+$/.test(line.trim())) continue;
    if (!inTable || !line.startsWith('|')) { if (inTable && line.trim() === '') inTable = false; continue; }
    const cells = line.split('|').slice(1, -1).map((c) => c.trim());
    if (cells.length !== 5) {
      rows.set('__malformed__', (rows.get('__malformed__') ?? []).concat([line]));
      continue;
    }
    const name = cells[0].replace(/`/g, '');
    if (!/^[A-Z][A-Z0-9_]{2,}$/.test(name)) {
      rows.set('__malformed__', (rows.get('__malformed__') ?? []).concat([line]));
      continue;
    }
    rows.set(name, { readers: cells[1], defaultValue: cells[2], effect: cells[3], kind: cells[4] });
  }
  return rows;
}

test('D1.13: المرجع موجود ويُسمّي كل قراءة بيئة في الكود والخطوط', () => {
  assert.ok(fs.existsSync(path.join(ROOT, DOC)), 'لا docs/environment-reference.md — مرجع البيئة اختفى');
  const doc = read(path.join(ROOT, DOC));
  const rows = docRows(doc);
  assert.ok(!rows.has('__malformed__'), `أصفاف المرجع يجب أن تكون 5 أعمدة (المتغير|القارئ|الافتراضي|الأثر|الصنف): ${JSON.stringify(rows.get('__malformed__'))}`);
  const { reads } = readInventory();
  assert.ok(reads.size >= 18, `تمهيد: ${reads.size} قراءة بيئة مُستنفَدة — تغيّر نطاق الفحص؟`);
  const undocumented = [...reads.keys()].filter((v) => !rows.has(v));
  assert.deepEqual(undocumented, [], 'قراءات بيئة بلا توثيق في المرجع — أضِف صفّها في نفس التغيير');
});

test('D1.13: لا صفّ جامد — ما يُوثَّق يُقرأ فعلًا، أو يُعلَن في قسم القراءة غير المباشرة', () => {
  const doc = read(path.join(ROOT, DOC));
  const rows = docRows(doc);
  const { reads, dynamicFiles } = readInventory();
  // العذر الوحيد لصفٍّ لا يقابل قراءة ثابتة: أن يكون المتغير مذكورًا داخل قسم «قراءات غير مباشرة»
  // نفسه — ذكرٌ عابر في مكان آخر من الوثيقة لا يجعله توثيقًا، وإلا كان أي نصّ تبرئةً لأي صفّ.
  const section = doc.slice(doc.indexOf('## قراءات غير مباشرة'), doc.indexOf('## ما ليس متغيّر بيئة'));
  assert.ok(section.length > 0, 'لا قسم قراءة غير مباشرة ليطابق');
  const stale = [...rows.keys()].filter((v) => {
    if (reads.has(v)) return false;
    return !section.includes(`\`${v}\``);
  });
  assert.deepEqual(stale, [], 'صفوف في المرجع لا يقرأها أحد ولا تُعلَن في قسم غير المباشر — احذفها أو صحّح اسم المتغير');
  void dynamicFiles;
});

test('D1.13: كل موضع قراءة غير مباشرة مُعلَن في المرجع', () => {
  const doc = read(path.join(ROOT, DOC));
  const { dynamicFiles } = readInventory();
  assert.ok(dynamicFiles.size > 0, 'لا مواقع قراءة غير مباشرة؟ تغيّر نمط الحافظة؟');
  const undeclared = [...dynamicFiles].filter((f) => !doc.includes(f));
  assert.deepEqual(undeclared, [], 'قراءة process.env[key] جديدة بلا إعلان في قسم «قراءات غير مباشرة»');
});

test('D1.13: لا قالب env — والرفض موثَّق سببه، والمرجع لا يحمل قيمة سرّ', () => {
  assert.equal(fs.existsSync(path.join(ROOT, '.env.example')), false, '.env.example عاد رغم القرار المُجمَّد بأسرار في قالب مودَع');
  const doc = read(path.join(ROOT, DOC));
  assert.match(doc, /\.env\.example/, 'المرجع لا يشرح لماذا لا قالب');
  assert.match(doc, /القالب المودَع|لا أسرار في قالب|لم يعد سِر/i, 'شرح رفض القالب مبتور — السبب لازم لا الاكتفاء بالنفي');
  for (const [name, row] of docRows(doc).entries()) {
    if (row.kind !== 'سرّ') continue;
    assert.ok(
      row.defaultValue === '—' || /mock-key|demo-key|منشورة|بذرة تجريبية/.test(row.defaultValue),
      `المرجع يُعطي قيمة حقيقية لمتغير سرّي (${name}) — المرجع يصف لا يسلّم`
    );
  }
});

test('D1.13: لا سرّ يصل إلى الواجهة الأمامية', () => {
  // مصدر المتصفح يشمل jsx/html أيضًا: حصر الفحص في js/mjs كان يترك الثغرة مفتوحة على الاتساع نفسه
  const front = frontEndFiles();
  const offenders = [];
  for (const file of front) {
    const text = read(file).replace(/^\s*\/\/.*$/gm, '');
    if (/\bprocess\.env\b/.test(text)) offenders.push(`${path.relative(ROOT, file)}: يقرأ process.env`);
    for (const m of text.matchAll(/import\.meta\.env\.([A-Za-z0-9_]+)/g)) {
      if (/(KEY|TOKEN|SECRET|SEED|PASSWORD)/.test(m[1])) offenders.push(`${path.relative(ROOT, file)}: يكشف ${m[1]} في حزمة المتصفح`);
    }
  }
  assert.deepEqual(offenders, [], 'سرّ بلغ حزمة أمامية — ما يصل إلى JS المتصفح لم يعد سِرًّا');
});

test('D1.13: الصفوف تشرح الأثر ولا تكتفي بالاسم، والافتراضي مُصرَّح به', () => {
  const rows = docRows(read(path.join(ROOT, DOC)));
  rows.delete('__malformed__');
  for (const [name, row] of rows.entries()) {
    assert.ok(row.readers.length > 0 && row.readers.includes('.'), `${name}: لا ملف قارئ مُسمًّى`);
    assert.ok(row.effect.length >= 12, `${name}: الأثر مبتور — المرجع بلا أثر لا يُغني`);
    assert.ok(/^(—|[^\s].*)$/.test(row.defaultValue), `${name}: خانة الافتراضي فارغة (اكتب — إن لا افتراضي)`);
  }
  // وأسماء الأسرار مُصنَّفة سرّ، فلا يُقرأ «لا افتراضي» كأنه «آمن»
  for (const secret of ['NEXA_API_KEY', 'SUPABASE_SERVICE_KEY', 'SUPABASE_ANON_KEY', 'NEXA_OPERATOR_SEED', 'XAI_API_KEY']) {
    assert.equal(rows.get(secret)?.kind, 'سرّ', `${secret} غير مصنَّف سرًّا في المرجع`);
  }
});
