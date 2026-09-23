import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * known-gap D1.27 — تنبيهات CodeQL بلا مصافحة معلنة: اثنان منها على نمط مُراجَع في
 * tools/celia-perimeter-auth.mjs، والفرع يُقرأ أحمر ولا من يوقّع بأنه مطبَّلة لا ثغرة.
 * ⚠️ نجاح هذا الاختبار = الفجوة موجودة؛ يُحذف في تغيير الإغلاق.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('known-gap D1.27: لا ملف مصافحة في المستودع للنمطين المراجَعين', () => {
  const triage = ['.github/codeql/codeql-triage.md', 'self-model/codeql-triage.json', 'docs/codeql-triage.md'];
  const present = triage.filter((a) => fs.existsSync(path.join(ROOT, a)));
  assert.deepEqual(present, [], `ملف مصافحة موجود (${present.join(', ')}) — انقل الحارس إليه واحذف المُعيد`);
  // والنمط المُراجَع ما زال في مكانه (فالإغلاق بـ bcrypt ليس مطلوبًا ولا مقبولًا بلا قياس)
  const per = read('tools/celia-perimeter-auth.mjs');
  assert.match(per, /timingSafeEqual\(sha256\(presented\), sha256\(expected\)\)/,
    'مقارنة المفتاح تغيّرت — أعِد قراءة التنبيه قبل إغلاق D1.27');
  assert.match(per, /Object\.create\(null\)/, 'الكوكيز لم تعد بلا نموذج — أعِد قراءة التنبيه');
});

test('known-gap D1.27: نظافتان صُرِفتا في حراس هذه الجلسة لا ترجعان', () => {
  // (أ) لا حلقة أحادية السطر بمتغيّر غير مستعمل (نفس ما أنذر به CodeQL)
  const section = read('tests/workflow-overlap.test.js').split('function internalCommands')[1].split('return cmds')[0];
  for (const line of section.split('\n')) {
    const m = /^\s*for \(const (\w+) of .+\) (.+);$/.exec(line);
    if (!m) continue;
    const [, v, body] = m;
    assert.ok(v === '_' || body.includes(v), `سطر ${line.trim()} — حلقة بمتغيّر لا يُستعمل؛ استعمل if أو ${v}`);
  }
  assert.ok(/if \(\/runCommand/.test(section), 'فحص npm test داخل internalCommands لم يعد if — أعِد القراءة');
  // (ب) مقارنة أمر الـ workflow تُزيل التنصيص ولا تهربه بـ replace
  // (ب) لا هروب تنصيص بـ replace في حراس tests/: هذه عادة مطابقة نصّ ممرَّرة، والإزالة أصدق.
  // كان هذا البند يقرأ مُعيد تذكرةٍ أخرى فانكسر عند إغلاق تلك؛ المسح العام هنا لا يعتمد على ملف يُذاب في تغيير إغلاق غيره (قاعدة الدفتر: الحراس لا يقرؤون بعضهم).
  for (const f of fs.readdirSync(path.join(ROOT, 'tests')).filter((x) => x.endsWith('.test.js'))) {
    const t = read(path.join('tests', f));
    assert.ok(!/\.replace\(\s*\/[^/\n]*\/[gimsuy]*\s*,\s*["'][^"']*\\"/.test(t),
      `${f}: replace يستبدل بـ backslash-quote — أزل التنصيص بـ split/join بدل الهروب`);
  }
});
