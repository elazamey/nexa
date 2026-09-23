import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AgenticBugHunter } from '../src/security/agentic-hunter.js';
import { ArtifactReader, SevenGateValidator } from '../src/security/hunter/index.js';

/**
 * D1.7 (A05 + A06 / DI-01، DI-15، DI-16) — الكواشف وحدات، والنطاق نطاقُ الدالة.
 *
 * كان ثلاثة كواشف يعيشون في جسم المنسِّق (`agentic-hunter.js:81-116`) ويدفعون في
 * `this.findings` مباشرة، بشرطين يُقيَّمان على **محتوى الملف كله** (`!content.includes('try {')`,
 * `!content.includes('.close')`) — أي أن `try` في دالة لا علاقة لها يُسكِت كشفًا حقيقيًا
 * (false negative مضمون البنية)، وكل سطر `async` يكرر نفس الحكم، ولا artifact ولا شهادة ⇒
 * تُرفض عند GATE_2/GATE_7. هنا تُفصل الوحدات، ويُقاس كل شرط في نطاق هدفه، ويحمل كل finding
 * دليله. ملاحظة صدق: لا تُشترى 7/7 — صنوف الجودة الثلاثة غير مُسجَّلة عابرةً لحدّ (D1.4)،
 * فتبقى مرفوضة عند GATE_6 لسبب صحيح، لا لعيب في الدليل.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readSrc = (...rel) => fs.readFileSync(path.join(ROOT, ...rel), 'utf8');
const codeOnly = (src) => src.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const tmp = (label) => fs.mkdtempSync(path.join(os.tmpdir(), `nexa-d17-${label}-`));

const CTX = (root) => ({ scope: { target: root, allow: [root], deny: [] } });

// تحميل ديناميكي مُفحَص: عند HEAD الوحدات غير موجودة — كل اختبار يفشل على ادّعائه هو،
// لا على خطأ استيراد يُلغي الحارس كله (إثبات أدقّ لكل بارِعاء على حدة).
const DETECTOR_DIR = '../src/security/hunter/';
async function loadModule(file, exportName) {
  const mod = await import(DETECTOR_DIR + file).catch(() => null);
  assert.ok(mod, `الوحدة ${file} غير موجودة — الكاشف ما زال inline في المنسِّق (DI-15)`);
  if (exportName) {
    assert.equal(typeof mod[exportName], 'function', `${file}: لا يُصدِّر ${exportName} دالة`);
    return mod[exportName];
  }
  return mod;
}
const loadDetect = (file, exportName) => loadModule(file, exportName);

const NO_TRY_IN_OTHER_FUNCTION = [
  'function handler() {',
  '  async function load() {',
  '    return await Promise.reject(new Error("boom"));',
  '  }',
  '  load();',
  '}',
  'function unrelated() {',
  '  try { syncWork(); } catch (e) { /* دالة أخرى لا علاقة لها */ }',
  '}',
  ''
].join('\n');

test('D1.7: لا كاشف في جسم المنسِّق — وحدات مستقلة تُستورد وتُركَّب (DI-15)', () => {
  const orchestrator = codeOnly(readSrc('src', 'security', 'agentic-hunter.js'));
  for (const literal of ['UNHANDLED_ASYNC_ERROR', 'WEAK_CRYPTOGRAPHY', 'POTENTIAL_RESOURCE_LEAK', 'createHash', 'fs.openSync', 'createReadStream']) {
    assert.ok(
      !orchestrator.includes(literal),
      `المنسِّق لا يزال يحمل منطق الكشف (${literal}) — الاقتران لم يُفصل`
    );
  }
  assert.doesNotMatch(orchestrator, /this\.findings\.push\(\{/, 'المنسِّق يبني finding بيده بدل أن يركّب ناتج كاشف');
  assert.match(orchestrator, /SOURCE_DETECTORS|source-detectors/, 'لا تجميع للوحدات في المنسِّق');

  for (const rel of [
    'src/security/hunter/detector-unhandled-async.js',
    'src/security/hunter/detector-weak-crypto.js',
    'src/security/hunter/detector-resource-leak.js',
    'src/security/hunter/source-detectors.js'
  ]) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), `وحدة مفقودة: ${rel}`);
  }
});

test('D1.7: نقاء الكاشف — دالة في مدخلاتها المعلنة فقط، بلا حالة محيط ولا زمن (DI-01)', async () => {
  const detectors = {
    'unhandled-async': await loadDetect('detector-unhandled-async.js', 'detectUnhandledAsync'),
    'weak-crypto': await loadDetect('detector-weak-crypto.js', 'detectWeakCrypto'),
    'resource-leak': await loadDetect('detector-resource-leak.js', 'detectResourceLeak')
  };
  const sample = {
    relativePath: 'src/service.js',
    content: NO_TRY_IN_OTHER_FUNCTION + "\nconst h = crypto.createHash('md5');\nconst fd = fs.openSync('/tmp/x', 'r');\n"
  };
  for (const [slug, fn] of Object.entries(detectors)) {
    const source = codeOnly(readSrc('src', 'security', 'hunter', `detector-${slug}.js`));
    // نداءات文件系统 لا ذكرها داخل أنماط regex (المحظور هو القراءة، لا السلسلة)
    assert.doesNotMatch(source, /\bfs\.[a-zA-Z]+\s*\(/, `${slug}: يقرأ نظام الملفات بنفسه — ليس نقيًا`);
    assert.doesNotMatch(source, /process\.(cwd|env|argv)/, `${slug}: يلتقط حالة المحيط`);
    assert.doesNotMatch(source, /Date\.now\(|new Date\(/, `${slug}: حقل لحظي — ينكسر حتمية §6.3`);

    const first = fn({ ...sample });
    const second = fn(structuredClone(sample));
    assert.deepEqual(second, first, `${slug}: نفس المدخل لا يعطي نفس الناتج (DI-16)`);
    assert.ok(Array.isArray(first), `${slug}: لا تُرجع مصفوفة findings`);
    const frozen = Object.freeze({ ...sample });
    assert.doesNotThrow(() => fn(frozen), `${slug}: يعدّل مدخله`);
    for (const f of first) {
      assert.equal(f.file, sample.relativePath, `${slug}: الأصل ليس من المدخلات`);
      assert.equal(f.artifact.producedBy, f.safeTesting.attestedBy, `${slug}: الشهادة غير مربوطة بالمنتِج`);
      assert.ok(f.artifact.locator.startsWith(`file:${sample.relativePath}#L`), `${slug}: locator بلا سطر: ${f.artifact.locator}`);
      assert.ok(Number.isInteger(f.line) && f.line > 0);
      assert.ok(typeof f.cwe === 'string' && /^CWE-\d+$/.test(f.cwe), `${slug}: بلا CWE`);
    }
  }
});

test('D1.7: النطاق نطاقُ الدالة — try في دالة أخرى لا يُسكِت، ولا تكرار لكل سطر (DI-16)', async () => {
  const detectUnhandledAsync = await loadDetect('detector-unhandled-async.js', 'detectUnhandledAsync');
  const out = detectUnhandledAsync({ relativePath: 'a/service.js', content: NO_TRY_IN_OTHER_FUNCTION });
  assert.equal(out.length, 1, `كشف واحد متوقع، وجد ${out.length} — التكرار لكل سطر أو القمع بـ try غريب`);
  assert.equal(out[0].type, 'UNHANDLED_ASYNC_ERROR');
  assert.equal(out[0].line, 3, 'السطر المُبلَّغ يجب أن يكون موضع await غير المعالَج');
  assert.deepEqual(
    out[0].artifact.evidence.scope,
    { function: 'load', startLine: 2, endLine: 4 },
    'نطاق الدالة غير مُعلَّن في الدليل — لا يمكن إعادة إنتاج الحكم'
  );

  // ثلاث دوال غير معالَجة ⇒ ثلاثة أحكام مستقلة (لا دمج، لا تكرار)
  const three = ['async function a() { await f(); }', 'async function b() { await g(); }', 'const c = async () => { await h(); };', ''].join('\n');
  const many = detectUnhandledAsync({ relativePath: 'b/three.js', content: three });
  assert.equal(many.length, 3, `ثلاث دوال ⇒ ثلاثة findings، وجد ${many.length}`);
  assert.deepEqual(new Set(many.map(f => f.line)).size, 3, 'سطران متطابقان = كشف غير مُسند');

  // المعالَج في نفس النطاق لا يُبلَّغ (لا إنذارات كاذبة مُكافأةً على الفصل)
  for (const handled of [
    'async function a() { try { await f(); } catch (e) { log(e); } }',
    'async function b() { await g().catch(retry); }',
    'async function c() { const r = await Promise.allSettled([p]); return r; }',
    'function d() { return f(); }'
  ]) {
    const found = detectUnhandledAsync({ relativePath: 'c/handled.js', content: handled + '\n' });
    assert.deepEqual(found, [], `معالَج في نطاقه وأُبلِّغ رغم ذلك: ${handled.slice(0, 44)}`);
  }
});

test('D1.7: التشفير الضعيف والتسريب — الإباحة والرفض في نطاقهما الصحيح', async () => {
  const detectWeakCrypto = await loadDetect('detector-weak-crypto.js', 'detectWeakCrypto');
  const detectResourceLeak = await loadDetect('detector-resource-leak.js', 'detectResourceLeak');
  const weak = detectWeakCrypto({
    relativePath: 'd/hash.js',
    content: ["const a = crypto.createHash('md5').update(pw).digest('hex');", '// createHash("md5") في تعليق لا يُحتسب', 'const b = crypto.createHash("sha1").update(t);', 'const ok = crypto.createHash("sha256").update(x);', ''].join('\n')
  });
  assert.deepEqual(weak.map(f => f.line), [1, 3], `md5/sha1 سطرين فقط، وجد ${JSON.stringify(weak.map(f => f.line))}`);
  assert.ok(weak.every(f => f.vulnClass === 'WEAK_CRYPTOGRAPHY' && f.severity === 'HIGH'));
  // suppression مضمّن في السطر نفسه لا في الملف كله
  const suppressed = detectWeakCrypto({ relativePath: 'd/hash.js', content: "const a = crypto.createHash('md5'); // ignore-security\n" });
  assert.deepEqual(suppressed, [], 'تجاهل في سطر آخر كان سيُسكِت الملف كله');

  const leakSource = [
    'function one() {',
    '  const fd = fs.openSync(target, "r");',
    '  return read(fd);',
    '}',
    'function two() {',
    '  const s = fs.createReadStream(src);',
    '  s.pipe(res);',
    '}',
    'function three() {',
    '  const fd = fs.openSync(other, "r");',
    '  try { return read(fd); } finally { fs.closeSync(fd); }',
    '}',
    'function four() {',
    '  const s = fs.createReadStream(another);',
    '  s.on("error", () => s.destroy());',
    '  s.close();',
    '}',
    ''
  ].join('\n');
  const leaks = detectResourceLeak({ relativePath: 'e/streams.js', content: leakSource });
  assert.deepEqual(leaks.map(f => f.line), [2, 6], 'الإغلاق في دالة أخرى لا يرحم (عمى A06) والمُغلق حقًا لا يُبلَّغ');
  assert.ok(leaks.every(f => f.type === 'POTENTIAL_RESOURCE_LEAK' && f.cwe === 'CWE-775'));
  // لا تكرار لنفس المورد في نفس الدالة
  const dup = detectResourceLeak({ relativePath: 'e/streams.js', content: 'function z() { const fd = fs.openSync(a, "r"); const g = fs.openSync(b, "r"); }\n' });
  assert.equal(dup.length, 2, 'موردان مختلفان في نفس الدالة = حكمان');
});

test('D1.7: الدليل قابل للتقييم — و7/7 لا تُشترى بصناعة حدود وهمية', async () => {
  const detectUnhandledAsync = await loadDetect('detector-unhandled-async.js', 'detectUnhandledAsync');
  const detectWeakCrypto = await loadDetect('detector-weak-crypto.js', 'detectWeakCrypto');
  const detectResourceLeak = await loadDetect('detector-resource-leak.js', 'detectResourceLeak');
  const reader = new ArtifactReader();
  const validator = new SevenGateValidator();
  const root = '/srv/audit';
  const inputs = [
    ['UNHANDLED_ASYNC_ERROR', detectUnhandledAsync({ relativePath: 'src/s.js', content: NO_TRY_IN_OTHER_FUNCTION })],
    ['WEAK_CRYPTOGRAPHY', detectWeakCrypto({ relativePath: 'src/s.js', content: "const a = crypto.createHash('md5');\n" })],
    ['POTENTIAL_RESOURCE_LEAK', detectResourceLeak({ relativePath: 'src/s.js', content: 'function z() { const fd = fs.openSync(p, "r"); }\n' })]
  ];
  for (const [type, findings] of inputs) {
    assert.ok(findings.length > 0, `${type}: لا كشف في حالة يجب أن تُصَاب`);
    for (const f of findings) {
      const read = reader.validate(f.artifact);
      assert.equal(read.valid, true, `${type}: الدليل مرفوض من القارئ المستقل: ${JSON.stringify(read.reasons)}`);
      const evaluated = validator.evaluateFinding(f, CTX(path.posix.join(root, 'src/s.js').replace(/\/[^/]+$/, '')));
      const byId = (id) => evaluated.checks.find(c => c.id === id).pass;
      assert.equal(byId('GATE_2_REPRODUCIBILITY'), true, `${type}: GATE_2 لم تُستوفَ بالدليل المُنتَج`);
      assert.equal(byId('GATE_7_SAFE_TESTING_COMPLIANCE'), true, `${type}: GATE_7 — شهادة غير مربوطة؟ ${JSON.stringify(evaluated.failedGates)}`);
      assert.equal(byId('GATE_1_SCOPE'), true, `${type}: GATE_1 رفضت أصلًا داخل الجذر: ${JSON.stringify(evaluated.failedGates.find(g => g.id === 'GATE_1_SCOPE'))}`);
      // الصدق: هذه صنوف جودة لا تعبر حدًّا — تُرفض عند GATE_6 ولا نوسّع الجدول على مقاسها
      assert.equal(byId('GATE_6_BOUNDARY_BYPASS'), false, `${type}: مُرِّرت بوابة الحدود بلا عبور حقيقي`);
      const reason = evaluated.failedGates.find(g => g.id === 'GATE_6_BOUNDARY_BYPASS').reason;
      assert.match(reason, /boundary/i, `تعليل GATE_6 لا يسمّي الحدود: ${reason}`);
      // الصدق مُثبَّت بنيويًا: الكاشف لا يبتكر سجل حدود، وجدول D1.4 لم يُوَسَّع على مقاسه
      assert.equal(f.boundary, undefined, `${type}: سجل حدود مُختلَق ليسر 7/7`);
      const { BOUNDARY_KINDS_BY_CLASS } = await import('../src/security/hunter/boundary-evidence.js');
      assert.equal(
        Object.prototype.hasOwnProperty.call(BOUNDARY_KINDS_BY_CLASS, f.vulnClass),
        false,
        `${type}: صنف جودة أُضيف لجدول الحدود على المقاس (ممنوع — D1.4)`
      );
      assert.equal(evaluated.isValid, false, `${type}: 7/7 مُهداة — D1.7 لا تُصدِق ما لا يُصدَّق`);
    }
  }
});

test('D1.7: الجولة الكاملة — findings من الوحدات فقط، والمدخل المتكرر حتمي', async () => {
  const dir = tmp('hunt');
  fs.writeFileSync(
    path.join(dir, 'service.js'),
    ['async function boot() {', '  await connect();', '}', 'const md5 = crypto.createHash("sha1");', 'function openIt() {', '  const fd = fs.openSync(cfg, "r");', '}', ''].join('\n'),
    'utf8'
  );
  fs.mkdirSync(path.join(dir, 'nested'));
  fs.writeFileSync(
    path.join(dir, 'nested', 'util.js'),
    ['async function second() {', '  try { await work(); } catch (e) { handle(e); }', '}', ''].join('\n'),
    'utf8'
  );

  const run = async () => {
    const hunter = new AgenticBugHunter(dir);
    await hunter.scan();
    return hunter.findings;
  };
  const first = await run();
  const second = await run();
  assert.ok(first.length >= 3, `ثلاثة أحكام متوقعة على الأقل، وجد ${first.length}`);
  assert.deepEqual(second.map(f => `${f.type}@${f.file}:${f.line}`), first.map(f => `${f.type}@${f.file}:${f.line}`), 'الجولة غير حتمية');
  // الدالة المُعالَجة في nested لم تُبلَّغ (النطاق، لا اسم الملف)
  assert.ok(!first.some(f => f.file.endsWith('util.js')), 'util.jsعالج await فيه وأُبلَّغ');
  for (const f of first) {
    assert.ok(f.artifact && f.safeTesting, `finding بلا دليل أو شهادة: ${f.type}`);
    assert.equal(f.artifact.producedBy, f.safeTesting.attestedBy);
    assert.match(f.file, /^nested\/|^service\.js$/, `الأصل ليس مسارًا نسبيًا لجذر الجولة: ${f.file}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

test('D1.7: التجميع مصدر واحد — قائمة مسجلة تُغذا من نفس المكان الذي تُستورد منه الوحدات', async () => {
  const registry = codeOnly(readSrc('src', 'security', 'hunter', 'source-detectors.js'));
  for (const slug of ['unhandled-async', 'weak-crypto', 'resource-leak']) {
    assert.ok(registry.includes(`detector-${slug}.js`), `الوحدة detector-${slug}.js غير مُجمَّعة في القائمة`);
  }
  assert.match(registry, /SOURCE_DETECTORS/, 'لا قائمة تجميع مُصدَّرة');
  const { SOURCE_DETECTORS: listed } = await loadModule('source-detectors.js');
  assert.deepEqual(listed.map(d => d.id), ['unhandled-async', 'weak-crypto', 'resource-leak'], 'محتوى القائمة ليس الكواشف الثلاثة');
  const exported = readSrc('src', 'security', 'hunter', 'index.js');
  assert.match(exported, /source-detectors\.js/, 'index.js لا يُصدِّر قائمة الكواشف — ينفصل المسار عن التجميع');
  // كل مُسجَّل بمُنتِج واحد: الصنف في artifact.producedBy هو اسم الكاشف نفسه
  for (const d of listed) {
    assert.equal(typeof d.detect, 'function', `${d.id}: بلا دالة detect`);
    assert.match(d.producer, /^[A-Z][A-Za-z0-9]*Detector$/, `${d.id}: اسم المنتج ليس معرّفًا: ${d.producer}`);
    assert.ok(Array.isArray(d.types) && d.types.length > 0, `${d.id}: لا أصناف معلنة للكاشف`);
  }
  assert.equal(listed.length, 3, 'قائمة التجميع يجب أن تحمل الكواشف الثلاثة المستعادة');
});
