import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * D1.18 (P2) — النشر يثبّت ما فحصه CI حرفيًا، لا عناوين عائمة.
 *
 * قِيست الفجوة لا صياغة التذكرة: العيب ليس «npm ci يفشل في الجذر» (قِيس أنه ينجح: القفل متتبَّع
 * وخرجُه 15 رابط workspace بلا أي اعتمادية خارجية)، بل (1) `npm --prefix dashboard install` يحلّ
 * `react ^18.2.0`/`vite ^5.0.0` عائمًا بينما وظيفة الداشبورد في ci.yml تعمل `npm ci` على القفل —
 * فالمنشور قد يكون غير ما اختُبر؛ و(2) `|| npm install` يحوّل فشل القفل الحقيقي إلى خطوة خضراء؛
 * و(3) خطوة الجذر لا يستهلك خرجَها أحد (قِيس: hunter والبناء يعملان بلا root/node_modules).
 *
 * لا pyyaml هنا (النطاق صفر-اعتمادية)، فالقارئ مستهدف ومُختبَر هو نفسه في الاختبار الأول؛
 * والتعليقات تُسقط قبل أي assert — درس D1.16 (R1): سطر `# npm ci` لا يبني خطوة.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEPLOY = '.github/workflows/deploy-pages.yml';
const CI = '.github/workflows/ci.yml';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripComments = (t) => t.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

/** قارئ مستهدف لخطوات job في workflow-actions YAML: `- name:` و`run:` (كتلة | أو سطر) و`uses:` */
function jobSteps(text, jobName) {
  const jobsBlock = text.split(/^jobs:\s*$/m)[1];
  assert.ok(jobsBlock, 'لا مقطع jobs: — تغيّرت البنية التي يقرأها هذا الحارس');
  const lines = jobsBlock.split('\n');
  let inJob = false;
  let jobIndent = 0;
  const steps = [];
  let step = null;
  let blockKey = null;
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    const jobMatch = new RegExp(`^ {2}${jobName}:\\s*$`).exec(line);
    if (jobMatch) { inJob = true; jobIndent = 2; continue; }
    if (inJob && /^ {2}\S/.test(line)) { inJob = false; }
    if (!inJob) continue;
    if (line.match(/^ {6}-\s+/)) {
      if (step) steps.push(step);
      step = { run: '', raw: [] };
      const inline = line.replace(/^ {6}-\s+/, '');
      if (inline) step.raw.push(inline);
      blockKey = null;
      continue;
    }
    if (!step) continue;
    step.raw.push(line.trim());
    const kv = /^ {8}([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv) {
      if (kv[2] === '|') { blockKey = kv[1]; continue; }
      if (kv[2] !== '') { step[kv[1]] = kv[2].replace(/^['"]|['"]$/g, ''); blockKey = null; continue; }
      blockKey = null;
      continue;
    }
    if (blockKey && indent > 8) { step[blockKey] += `${step[blockKey] ? '\n' : ''}${line.trim()}`; continue; }
    blockKey = null;
  }
  if (step) steps.push(step);
  return steps.map((s) => {
    const nameLine = s.raw.find((l) => l.startsWith('name:'));
    return {
      name: nameLine ? nameLine.replace(/^name:\s*/, '').replace(/^['"]|['"]$/g, '') : '',
      run: s.run || '',
      uses: s.uses || '',
      workingDirectory: s['working-directory'] || ''
    };
  });
}

/** الخطوة التي تثبّت الداشبورد من القفل: `npm ci` داخل dashboard/ (أو --prefix) */
function pinnedDashboardInstall(steps) {
  return steps.filter((s) => /(^|\n| )npm ci\b/.test(s.run)
    && (s.workingDirectory === 'dashboard' || /npm --prefix dashboard\b/.test(s.run)));
}

test('D1.18: القارئ المستهدف يفهم الملفين — وإلا كان الحارس أعمى', () => {
  const deployText = stripComments(read(DEPLOY));
  const ciText = stripComments(read(CI));
  assert.ok(!/\t/.test(read(DEPLOY)) && !/\t/.test(read(CI)), 'Tab في YAML يرفضه GitHub');
  const deploy = jobSteps(deployText, 'build-and-deploy');
  const ci = jobSteps(ciText, 'dashboard');
  assert.ok(deploy.length >= 5, `قراءة ${deploy.length} خطوة من النشر — البنية تغيّرت؟`);
  assert.ok(ci.length >= 4, `قراءة ${ci.length} خطوة من وظيفة الداشبورد في CI`);
  assert.ok(deploy.every((s) => s.name || s.uses || s.run), 'خطوة بلا اسم ولاrun ولا uses — قارئ خاطئ');
  assert.ok(deploy.some((s) => s.name === 'Checkout Repository' && /actions\/checkout/.test(s.uses)),
    'لا checkout في النشر — القارئ لا يقرأ uses');
  const buildStep = deploy.find((s) => /Build/i.test(s.name));
  assert.match(buildStep.run, /npm run build/, 'القارئ لا يجمع أسطر كتلة | — فحص المخرج سيكون كذبًا');
  assert.equal(buildStep.workingDirectory, 'dashboard', 'القارئ لا يقرأ working-directory');
});

test('D1.18: النشر يثبّت الداشبورد من القفل، بلا install عائم وبلا ||', () => {
  const steps = jobSteps(stripComments(read(DEPLOY)), 'build-and-deploy');
  const pins = pinnedDashboardInstall(steps);
  assert.equal(pins.length, 1, `خطوة تثبيت واحدة موصولة بالقفل مطلوبة، qِيست ${pins.length} — الفجوة الأصلية (install عائم)`);
  for (const s of steps) {
    assert.ok(!/npm (--prefix dashboard )?install\b/.test(s.run),
      `«${s.name}» تعمل npm install — عناوين عائمة بدل القفل الذي فحصه CI`);
    assert.ok(!/\|\|\s*npm install/.test(s.run),
      `«${s.name}» تبتلع فشل التثبيت بـ || — القفل الفاسد يصير أخضر`);
  }
});

test('D1.18: لا تثبيت في الجذر، والتبرير مقيس لا موروَث', () => {
  const steps = jobSteps(stripComments(read(DEPLOY)), 'build-and-deploy');
  const rootInstalls = steps.filter((s) => !s.workingDirectory && !/npm --prefix dashboard\b/.test(s.run)
    && /(^|\n| )npm (ci|install)\b/.test(s.run));
  assert.deepEqual(rootInstalls.map((s) => s.name), [],
    'خطوة تثبيت جذر عادت — والتبرير ما زال صادقًا؟ راجع invariant الاعتماديات في الاختبار السادس');
  // التبرير: لا اعتماديات خارجية معلنة في أي workspace، ولا في قفل الجذر
  const workspaces = [...fs.readdirSync(path.join(ROOT, 'packages')), ...fs.readdirSync(path.join(ROOT, 'adapters'))]
    .map((d) => ['packages', 'adapters'].flatMap((top) => (top === 'packages' ? ['packages'] : ['adapters']).map((t) => path.join(ROOT, t, d, 'package.json'))))
    .flat()
    .filter((f) => fs.existsSync(f));
  const withDeps = [];
  for (const f of workspaces) {
    const p = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (Object.keys(p.dependencies || {}).length || Object.keys(p.devDependencies || {}).length) withDeps.push(p.name);
  }
  assert.deepEqual(withDeps, [], `workspace فيه اعتمادية معلنة (${withDeps.join(', ')}) ولا خطوة تثبيت جذر تخدمه`);
  const lock = JSON.parse(read('package-lock.json'));
  const external = Object.keys(lock.packages).filter((k) => k.includes('node_modules') && !k.includes('/@nexa/'));
  assert.deepEqual(external, [], 'قفل الجذر صار فيه حزم خارجية — «بلا تثبيت جذر» لم يعد آمنًا');
});

test('D1.18: تكافؤ النشر مع CI — نفس القفل ونفس major لـ node', () => {
  const deployText = stripComments(read(DEPLOY));
  const ciText = stripComments(read(CI));
  const lockOf = (t) => {
    const m = /cache-dependency-path:\s*(\S+)/.exec(t);
    assert.ok(m, 'لا cache-dependency-path — النشر وCI قد يخزّنان شيئًا مختلفًا');
    return m[1];
  };
  const dLock = lockOf(deployText);
  const cLock = lockOf(ciText);
  assert.equal(dLock, 'dashboard/package-lock.json', `قفل النشر ${dLock}`);
  assert.equal(cLock, dLock, 'النشر وCI يخزّنان قفلين مختلفين');
  assert.ok(fs.existsSync(path.join(ROOT, dLock)), 'قفل الداشبورد غير موجود — npm ci يفشل');
  const dNode = /node-version:\s*['"]?([\d.x]+)/.exec(deployText)[1];
  const cNode = /node-version:\s*['"]?(2[\d.x]*)/.exec(/dashboard:[\s\S]*?(?=\n {2}\S|\n*$)/.exec(ciText)?.[0] ?? ciText)[1];
  assert.equal(dNode.split('.')[0], cNode.split('.')[0],
    `major مختلف: نشر ${dNode} مقابل CI ${cNode} — ما يُختبَر ليس ما يُنشر`);
  const lock = JSON.parse(read('dashboard/package-lock.json'));
  const react = lock.packages['node_modules/react']?.version;
  const vite = lock.packages['node_modules/vite']?.version;
  assert.match(String(react), /^18\./, `القفل لا يثبّت react 18 بل ${react}`);
  assert.match(String(vite), /^5\./, `القفل لا يثبّت vite 5 بل ${vite}`);
});

test('D1.18: الترتيب والبيانات — hunter قبل البناء، والمخرج فيه data، والرفع من dist', () => {
  const steps = jobSteps(stripComments(read(DEPLOY)), 'build-and-deploy');
  const idx = (re) => steps.findIndex((s) => re.test(s.name) || re.test(s.run));
  const hunter = idx(/Agentic Bug Hunter/i), build = idx(/Build Dashboard/i);
  assert.ok(hunter >= 0 && build >= 0, 'خطوتَا hunter/Build مفقودتان');
  assert.ok(hunter < build, 'البناء قبل توليد البيانات — dist سيُرفع ببيانات قديمة أو بلا بيانات');
  const run = steps[build].run.split('\n').map((l) => l.trim());
  assert.ok(run.some((l) => /^mkdir -p dist\/data$/.test(l)), 'لا إنشاء dist/data — الموقع يُنشر بلا بيانات');
  const copy = run.filter((l) => l.startsWith('cp -r '));
  assert.equal(copy.length, 1, `نسخة بيانات واحدة متوقعة، قِيست ${copy.length}`);
  assert.match(copy[0], /^cp -r (\S+) dist\/data\/?$/, 'صيغة نسخ البيانات تغيّرت — الحارس يحتاج تحديثًا مقصودًا لا صمتًا');
  // والمسارات تُحلّ من داخل dashboard/ (working-directory)، لا من جذر المستودع: هذا ما كسر البروفة
  const src = /cp -r (\S+) dist\/data/.exec(copy[0])[1];
  assert.ok(!src.startsWith('../'), `مسار يبدأ بـ ../ من داخل dashboard/ = جذر المستودع: ${src}`);
  const resolved = path.resolve(ROOT, 'dashboard', src.replace(/\/\*$/, ''));
  assert.ok(fs.existsSync(resolved), `${src} لا يحلّ إلى موجود من داخل dashboard/ (qِيست dist فارغة من البيانات)`);
  const dataSrc = path.resolve(ROOT, 'dashboard', 'data');
  assert.ok(fs.readdirSync(dataSrc).length > 0, 'dashboard/ data فارغ — النسخ سينجح إلى شيء بلا محتوى');
  assert.ok(!/\|\|\s*true/.test(copy[0]), 'نسخ البيانات بـ || true — الموقع قد يُنشر بلا بيانات وخُضرة صامتة');
  const upload = steps.find((s) => /upload-pages-artifact/.test(s.uses));
  assert.ok(upload, 'لا خطوة رفع للمواقع');
  assert.equal(upload.with_path ?? read(DEPLOY).match(/path:\s*'?(dashboard\/dist)'?/)?.[1], 'dashboard/dist',
    'المسار المرفوع ليس dashboard/dist');
});

test('D1.18: الأدوار معلنة بلا انزلاق — PRs لـ ci.yml والنشر على main، وصلاحيات بلا توسّع', () => {
  const deployRaw = read(DEPLOY);
  const onBlock = deployRaw.split(/^on:\s*$/m)[1].split(/^\S/m)[0];
  assert.match(onBlock, /push:/, 'النشر بلا on.push');
  assert.match(onBlock, /main/, 'النشر لا يستهدف main');
  assert.match(onBlock, /workflow_dispatch:/, 'النشر بلا تشغيل يدوي — لا سبيل لإعادة النشر بلا دفع');
  assert.ok(!/pull_request/.test(onBlock), 'النشر صار يعمل على PRs — هذا دور ci.yml (D1.16) وتشغيلان يبنيان نفس الشيء');
  assert.match(read(CI), /^\s{2}pull_request:/m, 'ci.yml لم يعد يرى PRs — لا بديل عن النشر في الفحص');
  const perms = deployRaw.split(/^permissions:\s*$/m)[1].split(/^\S/m)[0];
  const map = Object.fromEntries(perms.split('\n').filter((l) => l.includes(':')).map((l) => l.trim().split(/:\s*/)));
  assert.deepEqual(map, { 'contents': 'read', 'pages': 'write', 'id-token': 'write' },
    `صلاحيات النشر تغيّرت: ${JSON.stringify(map)} — write زائد عن الحاجة`);
  assert.match(deployRaw, /^concurrency:/m, 'بلا concurrency — نشران متزامنان يتصارعان');
});

test('D1.18: كل أمر يناديه النشر يؤول إلى شيء موجود، والتعليق لا يبني خطوة', () => {
  const raw = read(DEPLOY);
  const steps = jobSteps(stripComments(raw), 'build-and-deploy');
  const dpkg = JSON.parse(read('dashboard/package.json'));
  for (const s of steps) {
    for (const m of s.run.matchAll(/npm run ([a-zA-Z0-9:_-]+)/g)) {
      const target = s.workingDirectory === 'dashboard' ? dpkg : JSON.parse(read('package.json'));
      assert.ok(target.scripts[m[1]], `«${s.name}» تنادي npm run ${m[1]} وهي غير موجودة`);
    }
    for (const m of s.run.matchAll(/(?:^|\n)\s*node\s+([^\s]+\.js)/g)) {
      const rel = m[1];
      const base = s.workingDirectory ? path.join(ROOT, s.workingDirectory) : ROOT;
      assert.ok(fs.existsSync(path.join(base, rel)), `«${s.name}» تنادي node ${rel} وهو غير موجود`);
    }
  }
  // والحارس لا يُرضى بتعليق: لو صارت خطوة التثبيت تعليقًا تختفي
  const doctored = raw.replace('      - name: Install pinned dashboard dependencies\n        run: npm ci\n        working-directory: dashboard',
    '      # npm ci with working-directory: dashboard');
  assert.notEqual(doctored, raw, 'الطُعم لم يُطبَّق — تغيّرت صياغة الخطوة؟');
  assert.equal(pinnedDashboardInstall(jobSteps(stripComments(doctored), 'build-and-deploy')).length, 0,
    'تعليق انتحل خطوة تثبيت — الحارس أعمى عن الفرق بين # وشيفرة');
});
