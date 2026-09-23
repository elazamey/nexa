import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * D1.20 (P2) — مسار الإصدار لا يبتلع فشله، ولا يُعلّق على أدلّة ومسارات بلا فحص.
 *
 * المقيس قبل الإصلاح: `npm publish --access public || true` (خطوة اسمها Publish ثم ترمي فشلها) و
 * `npm ci || npm install` (no-op مقيس في O22/O23 + ابتلاع فشل القفل دقيقةً قبل النشر)، ولا حارس
 * سلوكي على release.yml إطلاقًا (المُعيد يقيس أن الذكرى الوحيدة له في tests/ هي قائمة ملفات بيئة).
 *
 * الحارس لا يقرّر هوية الحزمة — ذلك D1.21 المفتوحة؛ يفحص أن التناقض معلن لا مبطّن: إن صارت
 * package.json غير private فلازم الاسم موسّع بالـ scope المعلن في setup-node، وإلاّ لازم أن تكون
 * تذكرة مفتوحة تسمّي ذلك في self-model/gaps.json. لا «|| true» ولا صمت.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REL = '.github/workflows/release.yml';
const CI = '.github/workflows/ci.yml';
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const stripComments = (t) => t.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

function steps(text) {
  const block = text.split(/^jobs:\s*$/m)[1];
  assert.ok(block, 'لا jobs: في release.yml — البنية تغيّرت');
  const out = [];
  let step = null;
  let key = null;
  for (const raw of block.split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    if (/^ {4}-\s+/.test(line)) {
      if (step) out.push(step);
      step = { name: '', run: '', uses: '', with: {}, env: {} };
      key = null;
      const inline = line.replace(/^ {4}-\s+/, '');
      const kv = /^([A-Za-z][\w-]*):\s*(.*)$/.exec(inline);
      if (kv) {
        if (kv[2] === '|') key = kv[1];
        else apply(step, kv[1], kv[2]);
      }
      continue;
    }
    if (!step) continue;
    if (/^\S/.test(line)) break;
    const kv = /^ {6}([A-Za-z][\w-]*):\s*(.*)$/.exec(line);
    if (kv) {
      if (kv[2] === '|') { key = kv[1]; continue; }
      if (kv[2] === '') { key = kv[1] === 'with' || kv[1] === 'env' ? kv[1] : null; step[key] = step[key] || {}; continue; }
      apply(step, kv[1], kv[2]);
      key = null;
      continue;
    }
    const nested = /^ {8}([A-Za-z][\w._-]*):\s*(.*)$/.exec(line);
    if (nested && key && typeof step[key] === 'object') { step[key][nested[1]] = nested[2].replace(/^['"]|['"]$/g, ''); continue; }
    const indent = line.length - line.trimStart().length;
    if (key === 'run' && indent >= 8) step.run += `${step.run ? '\n' : ''}${line.trim()}`;
    else key = null;
  }
  if (step) out.push(step);
  return out;
}

function apply(step, key, value) {
  const v = value.replace(/^['"]|['"]$/g, '');
  if (key === 'name') step.name = v;
  else if (key === 'run') step.run = v;
  else if (key === 'uses') step.uses = v;
}

const releaseSteps = () => steps(stripComments(read(REL)));
const findStep = (re) => releaseSteps().find((s) => re.test(s.name));

test('D1.20: القارئ يفهم release.yml — وإلا كان الحارس أعمى', () => {
  const raw = read(REL);
  assert.ok(!/\t/.test(raw), 'Tab في YAML يرفضه GitHub');
  const st = releaseSteps();
  assert.ok(st.length >= 6, `قِيست ${st.length} خطوة — البنية أوسع من القارئ؟`);
  assert.ok(st.every((s) => s.name || s.uses), 'خطوة بلا اسم ولا uses — قارئ خاطئ');
  const gate = findStep(/Run Full Test Suite/);
  assert.ok(gate, 'لا خطوة بوابة الاختبار');
  assert.deepEqual(gate.run.split('\n'), ['npm test', 'npm run mesh:verify'], 'القارئ يبتسر كتلة |');
  const publish = findStep(/Publish Package/);
  assert.equal(publish.env.NODE_AUTH_TOKEN, "${{ secrets.GITHUB_TOKEN }}", 'القارئ لا يقرأ with/env المتداخلة');
});

test('D1.20: لا ابتلاع فشل في أي خطوة — النشر أحمر لو لم يُنشر', () => {
  for (const s of releaseSteps()) {
    assert.ok(!/\|\|\s*true/.test(s.run), `«${s.name}» تبتلع فشلها بـ || true`);
    assert.ok(!/\|\|\s*npm install/.test(s.run), `«${s.name}» تلتفّ على القفل بـ || npm install`);
    assert.ok(!/\btee\b.*-a|set \+e/.test(s.run), `«${s.name}» تُمرِّر الفشل جانبًا`);
  }
  const body = stripComments(read(REL));
  assert.ok(!/continue-on-error/.test(body), 'continue-on-error في مسار الإصدار');
  assert.ok(!/if:\s*always\(\)/.test(body), 'if: always() يجعل الإصدار غير مُلزِم');
  const publish = findStep(/Publish Package/);
  assert.match(publish.run, /npm publish --access public/, 'لم تعد هناك دعوة نشر فعلية');
  assert.match(publish.run, /package\.json/, 'لا قراءة لحالة الحزمة: التخطّي قد يصير صامتًا');
  assert.match(publish.run, /::warning::/, 'التخطّي بلا إعلان — هذا هو الصمت الذي حاربناه بـ || true');
});

test('D1.20: لا خطوة تثبيت في الجذر، والتبرير مقيس في الحارس', () => {
  for (const s of releaseSteps()) {
    assert.ok(!/^\s*npm (install|ci)\b/m.test(s.run), `«${s.name}» تعمل تثبيت جذر — أُنشئت أم حُذِف التبرير؟`);
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

test('D1.20: جسر الأدلة الذي تستورده خطوة node -e موجود ويصدّر ما يُستعمل', () => {
  const step = findStep(/Generate Cryptographic Checksums/);
  const spec = /from '(\.\.[^']+\.js)'/.exec(step.run);
  assert.ok(spec, 'خطوة التوقيع لا تستورد جسرًا بمسار نسبي معلن — الحارس فقد مرساته');
  // الخطوة تعمل بعد `cd dist/packages`؛ فالمسار النسبي يُحلّ من هناك لا من جذر المستودع
  assert.match(step.run, /^cd dist\/packages$/m, 'لا cd إلى مجلد المنتجات — المسار النسبي بلا سياق');
  const from = path.resolve(ROOT, 'dist/packages', spec[1]);
  assert.ok(fs.existsSync(from), `المسار الذي تنادي عليه خطوة التوقيع غير موجود: ${spec[1]}`);
  const src = fs.readFileSync(from, 'utf8');
  assert.match(src, /export class NexaEvidenceBridge/, 'لا صنف مصدَّر بالاسم المستعمل');
  for (const call of step.run.matchAll(/bridge\.([A-Za-z0-9_]+)\(/g)) {
    assert.ok(new RegExp(`\\b${call[1]}\\s*\\(`).test(src), `الدالة ${call[1]} مستعمَلة في YAML ولا توجد في الجسر`);
  }
  assert.match(step.run, /fs\.writeFileSync\('RELEASE_RECEIPT\.json'/, 'لا كتابة لإيصال موقّع في مجلد المنتجات');
});

test('D1.20: مسارات المنتجات متماسكة — pack والتوقيع والإلحاق في مجلد واحد', () => {
  const pack = findStep(/Pack Distribution/);
  const dir = /npm pack --pack-destination=(\S+)/.exec(pack.run)?.[1];
  assert.ok(dir, 'لا --pack-destination صريح — مسار النشر يعتمد على cwd');
  const sums = findStep(/Checksums|Receipts/i);
  assert.equal(/cd (\S+)/.exec(sums.run)[1], dir, `التوقيع يعمل في مجلد غير مقصد الحزمة (${dir})`);
  assert.match(sums.run, /sha256sum \* > SHA256SUMS/, 'لا قائمة بصمات على كل المنتجات');
  assert.match(sums.run, /RELEASE_RECEIPT\.json/, 'لا إيصال مكتوب في مجلد المنتجات');
  const release = releaseSteps().find((s) => /Create Official GitHub Release/.test(s.name) || /action-gh-release/.test(s.uses));
  assert.ok(release, 'لا خطوة إصدار على GitHub');
  const files = read(REL).split(/^ {8}files:\s*\|$/m)[1].split(/^\S/m)[0];
  for (const f of ['dist/packages/*', 'dist/packages/SHA256SUMS', 'dist/packages/RELEASE_RECEIPT.json']) {
    assert.ok(files.includes(f), `قائمة الإلحاق لم تعد تشمل ${f}`);
  }
});

test('D1.20: بوابة الإصدار وصلاحياته — مقاسات لا إرث', () => {
  const raw = read(REL);
  const onBlock = raw.split(/^on:\s*$/m)[1].split(/^\S/m)[0];
  assert.match(onBlock, /push:/, 'لا on.push');
  assert.match(onBlock, /tags:[\s\S]*'v\*\.\*\.\*'/, 'نمط الوسم تغيّر — القاعدة مبنية على v*.*.*');
  assert.ok(!/pull_request/.test(onBlock), 'الإصدار يعمل على PRs — هذا ليس موضعه (PRs ملك ci.yml)');
  const perms = raw.split(/^permissions:\s*$/m)[1].split(/^\S/m)[0]
    .split('\n').filter((l) => l.includes(':')).map((l) => l.trim());
  assert.deepEqual(perms, ['contents: write', 'packages: write', 'id-token: write'],
    `صلاحيات الإصدار تغيّرت: ${JSON.stringify(perms)} — كل write هنا يُراجع واحدًا واحدًا`);
  const body = stripComments(raw);
  const nodeMajor = /node-version:\s*['"]?(\d+)/.exec(body)[1];
  const matrix = /node:\s*\[([^\]]+)\]/.exec(stripComments(read(CI)))[1];
  assert.ok(matrix.includes(`'${nodeMajor}'`), `الإصدار على node ${nodeMajor} وci.yml يختبر [${matrix.trim()}]`);
  assert.match(body, /fetch-depth:\s*0/, 'fetch-depth: 0 مفقود — ملاحظات الإصدار وسجل الوسوم تحتاج الاستنساخ الكامل');
  const gate = findStep(/Run Full Test Suite/);
  for (const cmd of ['npm test', 'npm run mesh:verify']) {
    assert.ok(gate.run.split('\n').includes(cmd), `بوابة الإصدار لا تشغّل ${cmd}`);
  }
});

test('D1.20: التناقض معلن لا مبطّن — private/package مقابل خطوة تُسمّي نفسها Publish', () => {
  const pkg = JSON.parse(read('package.json'));
  const gaps = JSON.parse(read('self-model/gaps.json'));
  const scoped = /node-version[\s\S]*?scope:\s*'(@[^']+)'/;
  const m = scoped.exec(stripComments(read(REL)));
  assert.ok(m, 'لا scope معلن في setup-node — الحارس فقد مرجعه');
  const scope = m[1];
  if (pkg.private) {
    const open = gaps.gaps.filter((g) => !g.enforced);
    assert.ok(open.length > 0, 'الحزمة private ولا تذكرة مفتوحة واحدة تقول ذلك — القرار ضاع');
    const named = open.filter((g) => /publish|private|نشر/i.test(`${g.title} ${g.required} ${g.area}`));
    assert.ok(named.length > 0, `private:true وخطوة اسمها Publish وبلا تذكرة مسجّلة (${open.map((o) => o.id).join(',')})`);
    assert.ok(named.some((g) => Array.isArray(g.reproducer) ? false : !!g.reproducer),
      'التذكرة المفتوحة بلا مُعيد/حجب — لا يُقبل ادّعاء معلّق');
    assert.match(findStep(/Publish Package/).run, /private/, 'خطوة النشر لا تذكر حالتها الفعلية للقارئ');
  } else {
    assert.ok(String(pkg.name).startsWith(`${scope}/`),
      `النشر مفعّل (private:false) لكن name=${pkg.name} لا يطابق scope المعلن ${scope} — D1.21 لم تُحسم و|| true ممنوع`);
    assert.ok(!gaps.gaps.some((g) => !g.enforced && /D1\.21/.test(g.id)),
      'D1.21 ما زالت مفتوحة مع أن الإعدادات صارت متسقة — اقلب السجل');
  }
});
