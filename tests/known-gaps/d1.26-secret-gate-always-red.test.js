import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * known-gap D1.26 — بوابة «Scan for Exposed Secret Patterns» حمراء على كل push وPR، على main أيضًا.
 * يُقاس هنا بتشغيل أمر الـ workflow نفسه على الشجرة الحالية (بلا شبكة).
 * ⚠️ نجاح هذا الاختبار = الفجوة موجودة. عند الإغلاق يُنتظَر rc=0 فتُحمرّ هذه ويُحذف الملف.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const SCAN = 'grep -rn --include="*.js" --include="*.mjs" --include="*.json" -E "BEGIN (PRIVATE|RSA|EC) KEY|nexa:key:priv:" packages/ tools/';

test('known-gap D1.26: أمر الفحص حرفيًا من security-scan.yml يجد ما يُفشل البوابة', () => {
  const wf = read('.github/workflows/security-scan.yml');
  const step = wf.split('- name: Scan for Exposed Secret Patterns')[1].split('- name:')[0];
  // مقارنة بلا التنصيص: الـ YAML يكتب الأمر داخل اقتباس مع \"، فنُزيل التنصيص من الطرفين
  const unquote = (x) => x.split('"').join('');
  assert.ok(unquote(step).includes(unquote(SCAN)),
    'تغيّر نصّ الأمر في الـ workflow — حدّث المُعيد ليطابق الحرفي الجديد');
  const out = execFileSync('bash', ['-lc', `${SCAN} || true`], { cwd: ROOT, encoding: 'utf8' });
  const hits = out.split('\n').filter(Boolean);
  assert.equal(hits.length, 4, `عدد المطابقات المقيس تغيّر (${hits.length}) — أعِد قراءة التذكرة`);
  assert.ok(hits.some((h) => h.includes('tools/google-fixtures.mjs')), 'لا fixture في النتيجة — السجل صار في مسار آخر؟');
  assert.ok(hits.some((h) => h.includes('anthropic-constitutional.js')),
    'الكاشف نفسه لم يعد يطابق نصّه — راجع');
  // [ -n "$KEY_FOUND" ] ⇒ exit 1: فالحصيلة حتمية، لا قرار وقت تشغيل
  assert.ok(/exit 1/.test(step), 'الخطوة لم تعد تُفشل البناء عند أول مطابقة — أعِد صياغة التذكرة');
});

test('known-gap D1.26: لا استثناء معلَن في المستودع — فلا فرق بين تسريب حقيقي وضجيج دائم', () => {
  const wf = read('.github/workflows/security-scan.yml');
  assert.ok(!/google-fixtures/.test(wf), 'الـ workflow صرّح الاستثناء — حُسِمت D1.26؟ أزل المُعيد في نفس التغيير');
  const allowlists = ['security/allowlist.txt', '.secrets-baseline', '.github/secret-allowlist.json'];
  const present = allowlists.filter((a) => fs.existsSync(path.join(ROOT, a)));
  assert.deepEqual(present, [], `قائمة استثناء موجودة (${present.join(', ')}) — انقل الحارس إليها`);
  // والـ fixture نفسه يقول إنها مفاتيح بلا قيمة تشغيلية؛ الفجوة في البوابة لا في الملف
  const fx = read('tools/google-fixtures.mjs');
  assert.match(fx, /throwaway test keys with a known private half/);
});
