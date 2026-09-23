import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

/**
 * D1.16 (P2 / O08) — بناء الداشبورد مقيسٌ في PRs، لا على main وحده.
 *
 * الفجوة كما قِيست: `dashboard/` يُبنى فقط في `deploy-pages.yml` الذي يعمل على
 * `push: [main]` و`workflow_dispatch` — أي بعد الدمج. و`ci.yml` (الوحيد الذي يرى كل PR)
 * لا يذكر كلمة dashboard، و`metrics.yml` likewise. فكسر Vite/React يصل main.
 *
 * هذا الحارس لا يؤمن أن YAML صحيح (لا pyyaml ولا actionlint في النطاق صفر-الاعتمادية)،
 * بل يقرأ البنية بقارئ مستهدف: مقاطع الوظائف والأسطر. القارئ مُختبَر هو أيضًا: نسخة
 * الانحراف التي تكسر المسافة البادئة تُحمرّه — فلو انهار القارئ صار الحارس أعمى لا أخضر.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

const ci = () => read('.github/workflows/ci.yml');

/** قارئ مستهدف: مقاطع `^  job:` تحت `jobs:`، ونقاط `^    key:` داخلها */
function workflow(text) {
  const jobsBlock = text.split(/^jobs:\s*$/m)[1];
  if (!jobsBlock) throw new Error('ci.yml بلا مقطع jobs:');
  const jobs = {};
  const lines = jobsBlock.split('\n');
  let current = null;
  for (const line of lines) {
    const jobMatch = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (jobMatch) {
      current = jobMatch[1];
      jobs[current] = [];
      continue;
    }
    // نهاية المقطع: أي سطر غير فاضي بأقل من مسافتين (أو بداية مقطع جديد في ملف آخر)
    if (current && /^\S/.test(line)) current = null;
    // التعليقات ليست شيفرة: سطر `# npm ci …` لا يبني وظيفة ولا يثبّت kernel
    if (current && !/^\s*#/.test(line)) jobs[current].push(line);
  }
  return { jobs };
}

function jobOf(text, name) {
  const { jobs } = workflow(text);
  return (jobs[name] || []).join('\n');
}

test('D1.16: القارئ المستهدف نفسه يعمل — وإلا كان الحارس أعمى', () => {
  const t = ci();
  const { jobs } = workflow(t);
  assert.ok(jobs.verify, 'لم يُقرأ job verify — القارئ لا يفهم البنية الموجودة');
  assert.match(jobOf(t, 'verify'), /runs-on: ubuntu-latest/, 'المقطع المقروء بلا runs-on: قارئ خاطئ');
  assert.ok(!/\t/.test(t), 'Tab في YAML — GitHub يرفضه، والحارس يرفضه قبله');
  // كل job معلن في النص لا بد أن يقراه القارئ (لا وظيفة مبتلعة بمسافة بادئة خاطئة)
  const jobsText = t.split(/^jobs:\s*$/m)[1];
  const declared = [...jobsText.matchAll(/^ {2}([A-Za-z0-9_-]+):\s*$/gm)].map((m) => m[1]);
  for (const name of declared) {
    if (name === 'verify' || name === 'dashboard') continue;
    assert.ok(name in jobs, `الوظيفة ${name} معلنة ولا يقرؤها القارئ`);
  }
});

test('D1.16: وظيفة بناء الداشبورد موجودة، تُثبَّت وتبني وتفحص المخرج', () => {
  const t = ci();
  const block = jobOf(t, 'dashboard');
  assert.ok(block, "ci.yml بلا وظيفة `dashboard:` — البناء لا يُرى في PR (O08)");
  assert.match(block, /runs-on:\s*ubuntu-latest/, 'وظيفة الداشبورد بلا runs-on');
  assert.match(block, /npm ci/, 'التثبيت بـ npm install لا npm ci — البناء على غير القفل لا يُكرَّر');
  assert.match(block, /npm run build/, 'لا خطوة بناء فعلية');
  // المسار في YAML لا في رأسي: cache-dependency-path يشير إلى ملف موجود فعلًا
  const cacheLine = /cache-dependency-path:\s*(\S+)/.exec(block);
  assert.ok(cacheLine, 'لا cache-dependency-path على قفل الداشبورد — setup-node يفشل أو يخبّئ خطأ');
  assert.ok(fs.existsSync(path.join(ROOT, cacheLine[1])),
    `cache-dependency-path يشير إلى ${cacheLine[1]} وهو غير موجود في المستودع`);
  assert.equal(cacheLine[1], 'dashboard/package-lock.json', 'المسار ليس قفل الداشبورد');
  // فحص المخرج: أن dist/index.html يشير إلى أصل باسمه بصمة المحتوى — لا «نجحت الخطوة» فحسب
  assert.match(block, /assets\/index-[^']*\.js|assets\\\/index-|grep -q/, 'البناء يُنجَز بلا فحص مخرج');
  assert.doesNotMatch(block, /continue-on-error/, 'continue-on-error يجعل الكسر أصفر لا أحمر');
  assert.doesNotMatch(block, /refs\/heads\/main/, 'وظيفة الداشبورد مشروطة بـ main — هذه هي الفجوة نفسها');
});

test('D1.16: تُرى في PRs — لا push فقط، ولا فلترة فروعا', () => {
  const t = ci();
  const on = t.split(/^jobs:/m)[0];
  assert.match(on, /^on:$/m, 'لا مقطع on: — من يُشغِّل CI؟');
  assert.match(on, /^\s{2}pull_request:/m, 'ci.yml لا يعمل على pull_request');
  const prLine = /^\s{2}pull_request:\s*(\{.*\})?\s*$/m.exec(on);
  assert.ok(prLine, 'pull_request له فلترة فروع — PRs من خارجها لا تُبنى');
  const { jobs } = workflow(t);
  assert.ok('dashboard' in jobs, 'لا وظيفة dashboard');
});

test('D1.16: وظيفتنا تعمل على أدوات موجودة فعلًا (لا أسماء مكسورة في YAML)', () => {
  const t = ci();
  const block = jobOf(t, 'dashboard');
  const dpath = JSON.parse(read('dashboard/package.json'));
  // كل `npm run <script>` داخل وظيفة الداشبورد يجب أن يكون موصولًا بسكربت موجود
  const scripts = new Set([...block.matchAll(/npm (?:--prefix \S+ )?run ([a-zA-Z0-9:_-]+)/g)].map((m) => m[1]));
  assert.ok(scripts.size >= 1, 'لا npm run في وظيفة الداشبورد — لا بناء مطلقًا');
  for (const script of scripts) {
    assert.ok(dpath.scripts[script], `CI ينادي npm run ${script} وهو غير موجود في dashboard/package.json`);
  }
  // وممر الـ working-directory / --prefix يصل إلى مجلد موجود
  assert.match(block, /working-directory: dashboard|npm --prefix dashboard/, 'لا اتجاه إلى مجلد الداشبورد');
  assert.ok(fs.existsSync(path.join(ROOT, 'dashboard/package.json')), 'dashboard/package.json مفقود');
  const lock = path.join(ROOT, 'dashboard/package-lock.json');
  assert.ok(fs.existsSync(lock), 'لا قفل للداشبورد — npm ci يفشل في CI');
  const lockJson = JSON.parse(fs.readFileSync(lock, 'utf8'));
  assert.equal(lockJson.packages[''].dependencies?.react ? 'react' : undefined, 'react', 'القفل لا يتتبع react — ci لن يثبّته');
});

test('D1.16: نابض D1.15 (المرايا) موصول في CI ولا يُبتلع', () => {
  const t = ci();
  assert.match(t, /npm run sync:assets:check/, 'فحص المرايا غير موصول في CI — D1.15 بلا نابض');
  const { jobs } = workflow(t);
  // الانحراف يُفحص حيث لا تثبيت: verify (Zero-dep job) — لا يُحمَّل على job يحتاج npm ci
  const host = Object.entries(jobs).find(([, body]) => /sync:assets:check/.test(body.join('\n')))[0];
  const root = jobOf(t, host);
  assert.doesNotMatch(root, /continue-on-error/, 'فحص المرايا continue-on-error — تحذير لا كسر');
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['sync:assets:check'], 'node tools/sync-dashboard-assets.mjs --check');
  assert.ok(fs.existsSync(path.join(ROOT, 'tools/sync-dashboard-assets.mjs')), 'سكربت الفحص غير موجود');
});

test('D1.16: وظيفة kernel تبقى بلا تثبيت، والمخرج لا يُتتبَّع في git', () => {
  const t = ci();
  const verify = jobOf(t, 'verify');
  assert.ok(verify, 'وظيفة verify (node 20/22) مفقودة — لا مساس بالمقيس');
  assert.doesNotMatch(verify, /npm (install|ci)\b/, 'وظيفة kernel صارت تُثبَّت — invariant صفر-الاعتمادية انكسر');
  assert.match(verify, /name: Test suite\s*\n\s*run: npm test/, 'npm test لم يعد أول خطوة في CI');
  // ولا مخرج بناء متتبَّع في git يغطي على نتيجة CI (يُقاس من الفهرس لا من التخمين)
  const tracked = execFileSync('git', ['ls-files', '--', 'dashboard/dist'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter(Boolean);
  assert.deepEqual(tracked, [], 'مخرج بناء متتبَّع في git: CI أخضر على ملف قديم بدل البناء');
  assert.match(read('.gitignore'), /^dashboard\/dist\/?$/m, 'مخرج البناء غير مستثنى في .gitignore — قد يُدمَج يومًا');
});
