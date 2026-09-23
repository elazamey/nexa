#!/usr/bin/env node
/**
 * D1.26 — فاحص مادة المفاتيح الخاصة، بتمييز معلَن بدل صفر تمييز.
 *
 * البوابة القديمة كانت `grep -E "BEGIN (PRIVATE|RSA|EC) KEY|nexa:key:priv:"` على packages/ وtools/،
 * فأنذرت بأربعة أسطر لا تنفد: ثلاثة كتل PEM في tools/google-fixtures.mjs (throwaway، معلَّن في رأس
 * الملف) وسطّر في كاشف الحدّ الذاتي يطابق نصّه. النتيجة: حمرٌ دائم على main، فلا فرق بين تسريب
 * حقيقي وضجيج. الفارق الذي يحتاجه القرار ليس «ملفًا أم سطرًا» بل «هل هناك **مادة** مفتاح؟»:
 *  - كتلة PEM تُحتسب مادةً إذا تلاها ≥ 200 حرفًا من base64 (بعد إزالة \n التهرّبية)، فسطرٌ يعرض
 *    العلامة وحدها (توثيق أو كاشف) لا يُحتسب.
 *  - Nexa key reference يُحتسب إذا تلاه ≥ 64 حرفًا من مادة، فمجرّد مفتاح بحثٍ في شيفر لا يُحتسب.
 * الاستثناء الوحيد المُسمَح به ملفٌ في المستودع: self-model/secret-scan-allowlist.json، كل مدخل له
 * مسار وسبب ومالك وتاريخ. ومسار مطروح بلا مادة اليوم = مدخل ميت ⇒ فشل (لا تسامح يتّسع بصمت).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXTS = new Set(['.js', '.mjs', '.cjs', '.json']);

function args(argv) {
  const out = { roots: ['packages', 'tools'], allowlist: 'self-model/secret-scan-allowlist.json' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--roots') out.roots = argv[++i].split(',').map((s) => s.trim()).filter(Boolean);
    else if (argv[i] === '--allowlist') out.allowlist = argv[++i];
    else if (argv[i] === '--base') out.base = argv[++i];
  }
  return out;
}

function walk(dir, base) {
  const rel = path.relative(base, dir);
  const out = [];
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ent.name === 'node_modules' || ent.name.startsWith('.')) continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) out.push(...walk(full, base));
    else if (EXTS.has(path.extname(ent.name))) out.push({ full, rel: rel ? `${rel}/${ent.name}` : ent.name });
  }
  return out;
}

const stripNoise = (s) => s.replace(/\\+n/g, ' ').replace(/\\+r/g, ' ').replace(/[\s"'`]/g, '');

function findMaterial(text, relPath) {
  const hits = [];
  const pem = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----(?:\s*([\s\S]{0,4000}?)-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----)?/g;
  for (const m of text.matchAll(pem)) {
    const tail = stripNoise(m[1] ?? text.slice((m.index ?? 0) + m[0].length, (m.index ?? 0) + m[0].length + 1200));
    if (/^[A-Za-z0-9+/=]{200,}$/.test(tail)) {
      hits.push({ path: relPath, line: text.slice(0, m.index ?? 0).split('\n').length, kind: 'PEM key material' });
    }
  }
  for (const m of text.matchAll(/nexa:key:priv:([A-Za-z0-9+/=._-]{64,})/g)) {
    hits.push({ path: relPath, line: text.slice(0, m.index ?? 0).split('\n').length, kind: 'Nexa key reference with material' });
  }
  return hits;
}

function loadAllowlist(file) {
  if (!fs.existsSync(file)) {
    return { entries: [], errors: [`لا ملف استثناء في ${path.relative(ROOT, file)} — الفحص بلا تمييز لا يُقبل`] };
  }
  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { return { entries: [], errors: [`ملف الاستثناء ليس JSON صالحًا: ${e.message}`] }; }
  const entries = Array.isArray(doc.entries) ? doc.entries : [];
  const errors = [];
  for (const [i, e] of entries.entries()) {
    for (const k of ['path', 'reason', 'owner', 'added']) {
      if (typeof e[k] !== 'string' || e[k].trim().length === 0) errors.push(`مدخل #${i + 1}: الحقل ${k} مفقود أو فارغ`);
    }
    if (typeof e.reason === 'string' && e.reason.trim().length < 20) errors.push(`مدخل #${i + 1}: السبب أقصر من أن يُراجَع (${e.reason})`);
    if (typeof e.added === 'string' && !/^\d{4}-\d{2}-\d{2}/.test(e.added)) errors.push(`مدخل #${i + 1}: added ليس تاريخًا (${e.added})`);
    if (typeof e.path === 'string' && !fs.existsSync(path.join(ROOT, e.path))) errors.push(`مدخل #${i + 1}: مسار مطروح من الفحص وهو محذوف من المستودع: ${e.path}`);
  }
  return { entries, errors };
}

const opt = args(process.argv.slice(2));
const base = opt.base ?? ROOT;
// المسار النسبي يُحَلّ نسبةً إلى الجذر المفحوص نفسه: القياس على نسخة لا يلوّث باستثناءات المستودع
const alPath = path.isAbsolute(opt.allowlist) ? opt.allowlist : path.join(opt.base ?? ROOT, opt.allowlist);
const { entries, errors } = loadAllowlist(alPath);
const allowed = new Set(entries.map((e) => e.path));

let hits = [];
for (const root of opt.roots) {
  const dir = path.join(base, root);
  if (!fs.existsSync(dir)) { errors.push(`جذر غير موجود: ${root}`); continue; }
  for (const f of walk(dir, base)) hits.push(...findMaterial(fs.readFileSync(f.full, 'utf8'), f.rel));
}

const flagged = hits.filter((h) => !allowed.has(h.path));
const covered = hits.filter((h) => allowed.has(h.path));
const stale = [...allowed].filter((p) => !hits.some((h) => h.path === p));

for (const h of flagged) console.log(`LEAK ${h.path}:${h.line} — ${h.kind}`);
for (const h of covered) console.log(`allowlisted ${h.path}:${h.line} — ${h.kind}`);
for (const p of stale) console.log(`STALE ${p} — في الاستثناء ولا مادة فيه اليوم: إمّا أن تُحذف المدخل أو يعيده صاحبُه بسبب`);
for (const e of errors) console.log(`ERROR ${e}`);

console.log(`# فحص مادة المفاتيح: ${hits.length} مادة مقيسة، ${covered.length} مستثناة بملف معلَن، ${flagged.length} غير مسموح بها`);
if (flagged.length || stale.length || errors.length) {
  console.log('FAIL — البوابة تُنهي rc=1 (قرار لا ابتلاع)');
  process.exit(1);
}
console.log('PASS — لا مادة مفتاح خارج الاستثناء المعلَن');
