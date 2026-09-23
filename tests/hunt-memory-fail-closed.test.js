import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HuntMemory, AutopilotEngine } from '../src/security/agentic-hunter.js';

/**
 * D1.6 (A11 / DI-14) — ذاكرة الصيد لا تبتلع الفشل.
 *
 * كان `_load` يبتلع أي استثناء ويرجع ذاكرة فارغة («Fallback» بصمت)، و`save` يبتلع خطأ الكتابة
 * بـ `console.error` ويكمل. الأثر ليس «نسيانًا» بل **مسحًا**: ذاكرة فارغة تُحفظ فوق الملف
 * الفاسد فتضيع الجلسات السابقة بلا إشارة. هنا يُغلَق المسار: حالة قراءة صريحة، حالة كتابة
 * صريحة، امتناع عن الكتابة فوق مخزن غير مقروء، واستعادة صريحة بمفتاح `force` فقط.
 *
 * الملف مستقل عن حراس D1.2–D1.5: شلّ إصلاح D1.6 وحده يُحمرّ هذا الملف وحده.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HUNT_MEMORY_SRC = path.join(ROOT, 'src', 'security', 'hunter', 'hunt-memory.js');
const AUTOPILOT_SRC = path.join(ROOT, 'src', 'security', 'hunter', 'autopilot.js');

const tmp = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `nexa-d16-${label}-`));
const storeIn = (dir, name = 'hunt-memory.json') => path.join(dir, name);

test('D1.6: مخزن فاسد = إشارة صريحة، لا ذاكرة فارغة تُحفظ فوقه وتمحو الجلسات', () => {
  const dir = tmp('corrupt');
  const store = storeIn(dir);
  const original = '{ هذا ليس JSON صالحًا ((( ';
  fs.writeFileSync(store, original, 'utf8');

  const mem = new HuntMemory(store); // لا يرمي: الجولة يجب أن تستمر…
  assert.equal(mem.loadStatus.ok, false, 'الفساد لم يُبلَّغ في loadStatus');
  assert.equal(mem.loadStatus.code, 'NEXA-HM-CORRUPT');
  assert.equal(mem.loadStatus.phase, 'load');
  assert.equal(mem.loadStatus.path, store, 'الحالة لا تسمّي الملف المعني');
  assert.ok(typeof mem.loadStatus.reason === 'string' && mem.loadStatus.reason.length > 8, 'بلا تعليل');

  // …لكن الكتابة ممتنعة: لا يُدهس الدليل القديم بذاكرة فارغة
  const write = mem.save();
  assert.equal(write.ok, false, 'حفظ فوق مخزن غير مقروء نجح — وهو المحو الصامت');
  assert.equal(write.code, 'NEXA-HM-REFUSED-OVERWRITE');
  assert.equal(fs.readFileSync(store, 'utf8'), original, 'ملف الأصل تغيّر رغم الامتناع');
  const session = mem.recordSession({ target: 'a.example.com' });
  assert.equal(session.persisted, false, 'جلسة أُبلغت أنها محفوظة وهي لم تُحفظ');
  assert.equal(session.status.code, 'NEXA-HM-REFUSED-OVERWRITE');

  // الاستعادة قرار صريح لا حادث جانبي
  const forced = mem.save({ force: true });
  assert.equal(forced.ok, true, 'الاستعادة الصريحة لم تنجح: ' + JSON.stringify(forced));
  assert.notEqual(fs.readFileSync(store, 'utf8'), original);
  assert.deepEqual(JSON.parse(fs.readFileSync(store, 'utf8')).sessions.length, 1);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('D1.6: JSON صالح لكنه ليس بنية ذاكرة — يُرفض كفساد، ولا يُعاد تفسيره كـ«فارغ»', () => {
  for (const [name, body] of [
    ['مصفوفة', '[]'],
    ['كائن بلا حقول', '{}'],
    ['sessions ليس مصفوفة', JSON.stringify({ version: '1.0.0', sessions: 'nope' })],
    ['null', 'null'],
    ['رقم', '42']
  ]) {
    const dir = tmp('shape');
    const store = storeIn(dir);
    fs.writeFileSync(store, body, 'utf8');
    const mem = new HuntMemory(store);
    assert.equal(mem.loadStatus.ok, false, `${name}: قُبلت بنية غير ذاكرة`);
    assert.equal(mem.loadStatus.code, 'NEXA-HM-MALFORMED', `${name}: رمز خاطئ لفساد البنية`);
    assert.equal(mem.save().ok, false, `${name}: كُتب فوق مخزن مرفوض`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('D1.6: فشل الكتابة يظهر كحالة لا كسطر console.error وحيد', () => {
  // (أ) فشل كتابة: الأب ملف لا دليل ⇒ mkdir يفشل — ولا عذر للصمت
  const dir = tmp('writefail');
  fs.writeFileSync(path.join(dir, 'afile'), 'x', 'utf8');
  const mem = new HuntMemory(path.join(dir, 'afile', 'hunt-memory.json'));
  assert.equal(mem.loadStatus.ok, true, 'ملف غير موجود يجب أن يبقى fresh');
  const res = mem.save();
  assert.equal(res.ok, false, 'الفشل ابتُلع');
  assert.equal(res.code, 'NEXA-HM-WRITE-FAILED');
  assert.ok(res.errno || res.syscall, 'بلا سبب نظامي: ' + JSON.stringify(res));
  assert.ok(mem.memory.sessions, 'الذاكرة الحية يجب أن تبقى usable في العملية الحالية');
  // ولا ملف مؤقت متروك بعد الفشل
  assert.deepEqual(fs.readdirSync(dir).filter(f => f.includes('.tmp')), [], 'الأثر المؤقت تُرِك بعد الفشل');

  // (ب) المسار نفسه دليل ⇒ القراءة تفشل صراحةً والكتابة تُمنع (لا دَهس دليل)
  const dirStore = path.join(tmp('readfail'), 'sub');
  fs.mkdirSync(dirStore, { recursive: true });
  const asDir = new HuntMemory(dirStore);
  assert.equal(asDir.loadStatus.ok, false, 'قراءة دليل لا تُبلَّغ كخطأ');
  assert.equal(asDir.loadStatus.code, 'NEXA-HM-READ-FAILED');
  assert.equal(asDir.save().code, 'NEXA-HM-REFUSED-OVERWRITE', 'الذاكرة غير المقروءة كُتبت فوق المسار');

  // وD1.9 لا ينكسر: لا مسار افتراضي يكتب داخل المستودع هنا
  const dir2 = tmp('ok');
  const store2 = storeIn(dir2);
  const good = new HuntMemory(store2);
  assert.equal(good.loadStatus.ok, true, 'مخزن جديد يُعامَل كخطأ');
  assert.equal(good.loadStatus.fresh, true);
  const saved = good.recordSession({ target: 'b.example.com' });
  assert.equal(saved.persisted, true, JSON.stringify(saved));
  assert.equal(saved.status.ok, true);
  assert.ok(saved.sessionId);
  const reopened = new HuntMemory(store2);
  assert.equal(reopened.loadStatus.ok, true, 'قراءة ما كُتب فشلت');
  assert.equal(reopened.memory.sessions.length, 1);
  // لا بقايا كتابة غير ذرّية
  const leftovers = fs.readdirSync(dir2).filter(f => f.includes('.tmp'));
  assert.deepEqual(leftovers, [], 'ملف مؤقت متروك — الكتابة غير ذرّية');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(dir2, { recursive: true, force: true });
});

test('D1.6: الحالة تعُود من كل نقطة كتابة، والفارغ لا يُخلط بالفساد', () => {
  const dir = tmp('statuses');
  const store = storeIn(dir);
  const mem = new HuntMemory(store);
  const calls = {
    save: mem.save(),
    recordSession: mem.recordSession({ target: 'c.example.com' }),
    rememberTarget: mem.rememberTarget('c.example.com', { endpoints: 3 })
  };
  for (const [name, outcome] of Object.entries(calls)) {
    assert.ok(outcome && typeof outcome === 'object', `${name}: لا تُرجع حالة`);
    // save يُرجع الحالة مباشرة؛ والنقاط الأعلى تُغلّفها مع persisted
    const status = name === 'save' ? outcome : outcome.status;
    assert.equal(typeof status.ok, 'boolean', `${name}: ok غير مبلَّغ`);
    assert.equal(status.ok, true, `${name}: ${JSON.stringify(status)}`);
    if (name !== 'save') assert.equal(outcome.persisted, status.ok, `${name}: persisted لا تطابق الحالة`);
  }
  // garbageCollect يعيد الحالة نفسها (او null صريحًا عند لا عمل) — لا undefined
  const collected = mem.garbageCollect(1);
  assert.ok(collected === null || (collected && typeof collected.ok === 'boolean'), 'garbageCollect بصمة غير معلنة');

  // مخزن نظيف غير موجود ≠ فشل، ومخزن فاسد ≠ نظيف
  const missing = new HuntMemory(storeIn(tmp('missing')));
  assert.equal(missing.loadStatus.ok, true);
  assert.equal(missing.loadStatus.fresh, true);
  fs.writeFileSync(store, '{{{', 'utf8');
  const broken = new HuntMemory(store);
  assert.equal(broken.loadStatus.ok, false);
  assert.equal(broken.loadStatus.fresh, undefined, 'الفساد وُسِم كأنه أول تشغيل');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('D1.6: المنسِّق يتصرّف على الحالة — ذاكرة مكسورة تُبلَّغ ولا تُزَفَّف كنجاح', async () => {
  const autopilotSrc = fs.readFileSync(AUTOPILOT_SRC, 'utf8');
  assert.doesNotMatch(
    autopilotSrc,
    /^\s*this\.memory\.recordSession\([^)]*\);\s*$/m,
    'autopilot لا يزال يتجاهل نتيجة حفظ الذاكرة'
  );

  const dir = tmp('autopilot');
  const store = storeIn(dir);
  fs.writeFileSync(store, 'NOT JSON ', 'utf8');
  const previous = process.env.NEXA_HUNT_MEMORY;
  process.env.NEXA_HUNT_MEMORY = store;
  try {
    const autopilot = new AutopilotEngine({ inScopePatterns: ['*.testdomain.com', 'testdomain.com'] });
    const result = await autopilot.runFullLoop('testdomain.com');
    assert.equal(result.status, 'COMPLETED', 'ذاكرة مكسورة يجب أن تُبلَّغ، لا تُسقط الجولة');
    assert.ok(result.memory, 'النتيجة لا تحمل حالة الذاكرة');
    assert.equal(result.memory.persisted, false, 'فشل الحفظ زُفِّف كنجاح');
    assert.match(String(result.memory.code), /NEXA-HM-/, 'لا رمز فشل نظامي في النتيجة');
    // ذاكرة ليست بوابة: الإيصالات لا تُمنح ولا تُسحب بسببها
    assert.ok(result.validatedFindings.length > 0);
    assert.ok(result.validatedFindings.every(f => f.receipt.signature));
    // Bytes المحفوظة لم تُدهس
    assert.equal(fs.readFileSync(store, 'utf8'), 'NOT JSON ');
  } finally {
    if (previous === undefined) delete process.env.NEXA_HUNT_MEMORY;
    else process.env.NEXA_HUNT_MEMORY = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('D1.6: لا catch صامت ولا سجل يبتلع محل الحالة — والأربع رموز عقد مسمّرة', () => {
  const src = fs.readFileSync(HUNT_MEMORY_SRC, 'utf8');
  const code = src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(code, /catch\s*(?:\([^)]*\))?\s*\{\s*\}/, 'catch فارغ — ابتلاع صريح');
  assert.doesNotMatch(code, /console\.error\(/, 'console.error ليس قناة حالة: الابتلاع صار استثناءً');
  assert.doesNotMatch(code, /catch\s*\([^)]*\)\s*\{[^}]*\n\s*return\s*HuntMemory\._blank|catch\s*\([^)]*\)\s*\{[^}]{0,120}?\n\s*\}\s*\n\s*return\s*this\._blankMemory\(\)/, 'catch يرجع ذاكرة فارغة بلا إشارة');
  for (const token of ['NEXA-HM-CORRUPT', 'NEXA-HM-MALFORMED', 'NEXA-HM-WRITE-FAILED', 'NEXA-HM-REFUSED-OVERWRITE']) {
    assert.ok(code.includes(token), `العقد بلا الرمز ${token}`);
  }
  assert.match(code, /loadStatus/, 'لا حالة قراءة معلنة');
  assert.match(code, /saveStatus|status\.ok/, 'لا حالة كتابة معلنة');
  // ذاكرة البداية لا تُبنى في موضع الفشل فقط — بل في مصنع واحد يُستدعى صراحةً
  assert.match(code, /_blankMemory\s*\(/, 'لا مصنع واحد للذاكرة الفارغة (موضعان يتفرّعان = انحراف لاحق)');
});

