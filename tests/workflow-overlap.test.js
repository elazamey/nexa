import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * D1.19 (P3) — لا يقيس CI الشيء مرتين في نفس الـ workflow، ولا يعلّق بما يناقض الشجرة.
 *
 * قِيست الفجوة: خطوات metrics.yml الخمس (test / audit / posture / attacks / attacks:google) هي
 * بعينها ما ينفّذه tools/check-metrics.mjs داخليًا عبر runCommand ويخرج 1 عند أي فشل — فكل PR
 * كان يقيس مرتين بلا إشارة إضافية. والفريد في metrics.yml هو البوابة نفسها (npm run metrics)
 * وتثبيتُ جذر no-op. والتعليق الذي برّر ذلك كان يقول إن المشروع «ships without one by design»
 * عن lockfile الجذر — وقِيس أنه متتبَّع (3467 بايتًا). وبنفس القياس صحّحنا تعليق ci.yml الذي
 * كتبناه في D1.16 وكرر الادّعاء نفسه.
 *
 * لا pyyaml في نطاق صفر-اعتمادية: قارئ مستهدف لخطوات job واحد، مُختبَر في الاختبار الأول.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const hasGit = (() => {
  try { execFileSync('git', ['rev-parse', '--git-dir'], { cwd: ROOT, stdio: 'ignore' }); return true; } catch { return false; }
})();


const METRICS = '.github/workflows/metrics.yml';
const CI = '.github/workflows/ci.yml';
const DEPLOY = '.github/workflows/deploy-pages.yml';
const OWNED = [METRICS, CI, DEPLOY];
const stripComments = (t) => t.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

/** مفتاح خطوة واحد: 'block' إذا كانت كتلة | تحتاج تجميع أسطر، true لمفتاح مُلتقَط، false مجهول */
function applyKey(step, key, value) {
  if (value === '|') {
    if (key === 'run') step.run = '';
    return 'block';
  }
  const clean = value.replace(/^['"]|['"]$/g, '');
  if (key === 'name') { step.name = clean; return true; }
  if (key === 'run') { step.run = clean; return true; }
  if (key === 'uses') { step.uses = clean; return true; }
  if (key === 'working-directory') { step.workingDirectory = clean; return true; }
  return false;
}

/** خطوات أول job في الملف (يكفي هنا: كل ملف معني بوظيفة واحدة لهذا الغرض) */
function stepsOf(text) {
  const block = text.split(/^jobs:\s*$/m)[1];
  assert.ok(block, 'لا مقطع jobs: — تغيّرت البنية التي يقرأها هذا الحارس');
  const steps = [];
  let step = null;
  let blockKey = null;
  for (const raw of block.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    if (/^ {6}-\s+/.test(line)) {
      if (step) steps.push(step);
      step = { name: '', run: '', uses: '', workingDirectory: '', raw: [] };
      blockKey = null;
      // في هذا الملف تُكتب الخطوة أحيانًا في سطر الواصلة: `- name: X` أو `- run: |`
      const inline = line.replace(/^ {6}-\s+/, '');
      if (inline) {
        step.raw.push(inline);
        const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(inline);
        if (kv) {
          const r = applyKey(step, kv[1], kv[2]);
          blockKey = r === 'block' ? kv[1] : null;
        }
      }
      continue;
    }
    if (!step) continue;
    if (/^ {2}\S/.test(line)) break;
    step.raw.push(line.trim());
    const kv = /^ {8}([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv) {
      const r = applyKey(step, kv[1], kv[2]);
      if (r === 'block') blockKey = kv[1];
      else if (r === true) blockKey = null;
      continue;
    }
    const indent = line.length - line.trimStart().length;
    if (blockKey && indent > 8) step[blockKey] += `${step[blockKey] ? '\n' : ''}${line.trim()}`;
    else blockKey = null;
  }
  if (step) steps.push(step);
  return steps;
}

/** الأوامر التي ينفّذها check-metrics داخله، مقروءة من شيفرته لا من الذاكرة */
function internalCommands() {
  const tool = read('tools/check-metrics.mjs');
  const cmds = new Set();
  for (const m of tool.matchAll(/runCommand\(\['test'\]\)/g)) cmds.add('npm test');
  for (const m of tool.matchAll(/runCommand\(\['run', '([^']+)'\]\)/g)) cmds.add(`npm run ${m[1]}`);
  return cmds;
}

function runLines(steps) {
  const out = [];
  for (const s of steps) for (const l of s.run.split('\n')) if (l.trim()) out.push({ step: s, line: l.trim() });
  return out;
}

test('D1.19: القارئ يفهم metrics.yml — وإلا كان الحارس أعمى', () => {
  const raw = read(METRICS);
  assert.ok(!/\t/.test(raw), 'Tab في YAML يرفضه GitHub');
  const steps = stepsOf(stripComments(raw));
  assert.equal(steps.length, 3, `ثلاث خطوات متوقعة في metrics.yml، قِيست ${steps.length}`);
  assert.match(steps[0].uses, /actions\/checkout/, 'الخطوة الأولى ليست checkout');
  assert.match(steps[1].uses, /actions\/setup-node/, 'الخطوة الثانية ليست setup-node');
  assert.equal(steps[2].run, 'npm run metrics', 'ليست بوابة metrics هي الخطوة الأخيرة');
  // والكتلة المتعددة الأسطر تُجمَّع فعلًا (لو انهار التجميع لبقيت الفحوص كاذبة بصمت)
  const deploy = stepsOf(stripComments(read(DEPLOY)));
  const build = deploy.find((s) => /^Build Dashboard$/.test(s.name));
  assert.equal(build.run.split('\n').length, 3, 'قارئ الكتلة | لا يجمع أسطر البناء');
});

test('D1.19: لا إعادة قياس — ما تنفّذه الأداة داخلها لا يُعاد خطوةً في metrics.yml', () => {
  const internal = internalCommands();
  assert.ok(internal.size >= 5, `قراءة الأوامر الداخلية أنتجت ${internal.size} فقط — تغيّرت صيغة runCommand؟ حدّث الحارس بعلم لا بصمت`);
  for (const cmd of ['npm test', 'npm run audit', 'npm run posture', 'npm run attacks', 'npm run attacks:google']) {
    assert.ok(internal.has(cmd), `القياس الأول واهٍ: ${cmd} لم يعد داخل check-metrics.mjs`);
  }
  const lines = runLines(stepsOf(stripComments(read(METRICS))));
  const dup = lines.filter((l) => internal.has(l.line));
  assert.deepEqual(dup.map((l) => l.line), [],
    `metrics.yml يعيد أوامر تنفّذها الأداة داخلها (${dup.map((d) => d.line).join(', ')}) — قياس مضاعف بلا إشارة`);
});

test('D1.19: التغطية محفوظة — كل ما حُذف من metrics.yml باقٍ في ci.yml', () => {
  const ciRuns = new Set(runLines(stepsOf(stripComments(read(CI)))).map((l) => l.line));
  const internal = internalCommands();
  for (const cmd of internal) {
    assert.ok(ciRuns.has(cmd), `الأداة تنفّذ ${cmd} لكن ci.yml لم يعد ينفّذها — لا بوابة PR على هذا القياس`);
  }
  assert.ok([...internal].length >= 5 && ciRuns.has('npm test'), 'ci.yml بلا npm test');
});

test('D1.19: لا تثبيت جذر في الملفات الثلاثة، والتبرير مقيس', () => {
  for (const file of OWNED) {
    for (const s of stepsOf(stripComments(read(file)))) {
      const rootScoped = !s.workingDirectory && !/npm --prefix \w+/.test(s.run);
      if (!rootScoped) continue;
      assert.ok(!/^\s*npm (install|ci)\b/m.test(s.run),
        `«${file}» → «${s.name}» تعمل تثبيتًا في الجذر وهو no-op مقيس؛ أو أضِف تبريرًا وحارسًا جديدين`);
    }
  }
  const withDeps = [];
  for (const top of ['packages', 'adapters']) {
    for (const dir of fs.readdirSync(path.join(ROOT, top))) {
      const f = path.join(ROOT, top, dir, 'package.json');
      if (!fs.existsSync(f)) continue;
      const p = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (Object.keys(p.dependencies || {}).length || Object.keys(p.devDependencies || {}).length) withDeps.push(p.name);
    }
  }
  assert.deepEqual(withDeps, [], `اعتمادية معلنة في ${withDeps.join(', ')} — «بلا تثبيت جذر» لم يعد آمنًا`);
  const lock = JSON.parse(read('package-lock.json'));
  const external = Object.keys(lock.packages).filter((k) => k !== '' && k.includes('node_modules') && !k.includes('/@nexa/'));
  assert.deepEqual(external, [], 'قفل الجذر صارت فيه حزم خارجية');
});

test('D1.19: لا تعليق يناقض الشجرة — الادّعاء بلا قفل جذر مكسور، وcache يجب أن يحلّ إلى متتبَّع', (skipT) => {
  if (!hasGit) return skipT.skip('لا .git — فحص git ls-files لا يعمل على نسخة أرشيف');
  const tracked = execFileSync('git', ['ls-files', '--', 'package-lock.json'], { cwd: ROOT, encoding: 'utf8' }).trim();
  assert.ok(tracked.length > 0, 'لا قفل جذر متتبَّع — الحارس نفسه يحتاج تحديثًا (القاعدة مبنية على وجوده)');
  const lies = [/ships? without one/i, /no lockfile/i, /without a lockfile/i, /ships without \(one|a lockfile\)/i];
  for (const file of OWNED) {
    const comments = read(file).split('\n').filter((l) => /^\s*#/.test(l)).join('\n');
    for (const re of lies) {
      assert.ok(!re.test(comments), `«${file}» يدّعي ${re} وpackage-lock.json متتبَّع (${tracked}) — تعليق يكسره git`);
    }
  }
  for (const file of OWNED) {
    const t = stripComments(read(file));
    const cached = /cache:\s*['"]?npm/.test(t);
    if (!cached) continue;
    const m = /cache-dependency-path:\s*(\S+)/.exec(t);
    assert.ok(m, `«${file}» يفعّل cache بلا cache-dependency-path`);
    const listed = execFileSync('git', ['ls-files', '--', m[1]], { cwd: ROOT, encoding: 'utf8' }).trim();
    assert.ok(listed.length > 0, `cache-dependency-path → ${m[1]} غير متتبَّع: تخزين على ملف لا يعرفه git`);
  }
});

test('D1.19: البوابة باقية كما هي — على PRs، بلا ابتلاع فشل، وعلى Node تغطيه المصفوفة', () => {
  const raw = read(METRICS);
  const onBlock = raw.split(/^on:\s*$/m)[1].split(/^\S/m)[0];
  assert.match(onBlock, /pull_request:/, 'metrics.yml لم يعد يعمل على PRs — لا بوابة وثائق قبل الدمج');
  assert.match(onBlock, /branches:\s*\[\s*"main"\s*\]/, 'فلترة الفروع في PR تغيّرت — القاعدة مبنية على main');
  assert.match(onBlock, /push:/, 'metrics.yml لم يعد يعمل على push main');
  const perms = raw.split(/^permissions:\s*$/m)[1].split(/^\S/m)[0];
  assert.deepEqual(perms.split('\n').filter((l) => l.includes(':')).map((l) => l.trim()), ['contents: read'],
    'صلاحيات metrics.yml توسّعت — بوابة قراءة لا كتابة');
  const body = stripComments(raw);
  assert.ok(!/continue-on-error/.test(body), 'continue-on-error في بوابة metrics');
  assert.ok(!/\|\|\s*true/.test(body), '|| true في بوابة metrics');
  assert.ok(!/if:\s*always\(\)/.test(body), 'if: always() يجعل الفشل غير مُلزِم');
  const nodeMajor = /node-version:\s*['"]?(\d+)/.exec(body)[1];
  const matrix = /node:\s*\[([^\]]+)\]/.exec(stripComments(read(CI)))[1];
  assert.ok(matrix.includes(`'${nodeMajor}'`), `metrics.yml على node ${nodeMajor} وci.yml يختبر [${matrix.trim()}]`);
});
