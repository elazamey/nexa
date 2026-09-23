import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ASSET_MIRRORS, inspectMirrors, syncMirrors } from '../tools/sync-dashboard-assets.mjs';

/**
 * D1.15 (O07) — النسخ المُخدَومة مرآةٌ مولَّدة، لا يد تُطابقها بالصبر.
 *
 * المقياس ليس «هل الملفان متطابقان الآن؟» — كانا متطابقين، وهذا هو الخداع: التطابق اليدوي
 * يبدو آمنًا حتى يُصلَح مصدرٌ ولا تُحدَّث مرآته. العقد هنا: (1) `tools/sync-dashboard-assets.mjs`
 * هو الموضع الوحيد الذي يُعرِّف الاتجاه، (2) كل نسخة ظلّ في الشجرة لا بد أن تكون معلنة فيه،
 * (3) `index.html` محسومة: مدخل Vite إنتاجي، والساكنة legacy بمسار معلن، (4) الفحص يجفّ ولا يكتب.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/** التعليقات ليست شيفرة: تعليق يذكر مسارًا قديمًا لا يجعله مستعملًا (درس D1.17) */
const code = (text) => text.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
const sha = (abs) => crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex');
const SCANNED = ['adapters', 'dashboard', 'src', 'tools', 'packages', 'spec', 'docs'];
const SKIP_DIRS = new Set(['node_modules', 'dist', '.git', 'coverage', '.next', '.venv', '__pycache__']);

test('D1.15: كل مرآة معلنة مطابقة لمصدرها الآن — والانحراف مكسور', () => {
  const { ok, drifted, missing } = inspectMirrors({ rootDir: ROOT });
  assert.equal(drifted.length, 0, `مرايا منحرفة: ${JSON.stringify(drifted)}`);
  assert.equal(missing.length, 0, `مرايا/مصادر مفقودة: ${JSON.stringify(missing)}`);
  assert.equal(ok.length, ASSET_MIRRORS.length, 'عدد المرايا المعلنة لا يطابق ما فُحص');
  assert.ok(ASSET_MIRRORS.length >= 9, 'المعلان انحسر — الاختصار بلا سبب مسموح');
});

test('D1.15: الاتجاه مُعلَّن من جهة الاختبار — لا من الأقرب', () => {
  // المصدر يجب أن يكون ما تستورده الاختبارات، والمرآة ما يُخدَم في المتصفح
  const edgeTest = read('tests/edge-rag.test.js');
  assert.match(edgeTest, /from '\.\.\/adapters\/edge-rag\/rag_core\.js'/, 'الاختبار لا يستورد من adapters/ — فالمصدر ليس ما يُختبَر عليه');
  for (const mirror of ASSET_MIRRORS) {
    assert.ok(mirror.source !== mirror.dest, `مرآة ذاتية: ${mirror.source}`);
    assert.ok(!mirror.dest.startsWith('adapters/'), `${mirror.dest}: المرآة يجب أن تكون في سطح الخدمة لا في المصدر`);
    assert.ok((mirror.reason ?? '').length >= 12, `${mirror.source}: بلا سبب مُعلَن للاتجاه`);
    assert.ok(
      mirror.dest.startsWith('dashboard/public/') || mirror.source.startsWith('dashboard/'),
      `${mirror.dest}: لا وجه لإعلان مرآة خارج سطح الخدمة/الجذر`
    );
  }
});

test('D1.15: لا نسخة ظلّ غير معلنة في الشجرة — التكرار نفسه قرار', () => {
  const groups = new Map();
  const walk = (dir) => {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) return;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const p = path.posix.join(dir, entry.name);
      const full = path.join(ROOT, p);
      if (entry.isDirectory()) walk(p);
      else {
        const st = fs.statSync(full);
        if (st.size < 32) continue;
        const h = sha(full);
        if (!groups.has(h)) groups.set(h, []);
        groups.get(h).push(p);
      }
    }
  };
  SCANNED.forEach((d) => walk(d));
  const pairOf = new Set(ASSET_MIRRORS.map((m) => [m.source, m.dest].sort().join(' <-> ')));
  const undeclared = [];
  for (const paths of groups.values()) {
    if (paths.length < 2) continue;
    const sorted = [...paths].sort();
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
        if (!pairOf.has([sorted[i], sorted[j]].sort().join(' <-> '))) {
          undeclared.push(`${sorted[i]} == ${sorted[j]}`);
        }
      }
    }
  }
  assert.deepEqual(undeclared, [], 'نسخ متطابقة لا تُعرف في ASSET_MIRRORS — إمّا مرآة معلنة أو مصدر حقيقة واحد');
  // والفرز عكسي أيضًا: كل مُعلَن موجود فعلًا كزوج متطابق (لا إعلان يتيم بعد نقل ملف)
  for (const mirror of ASSET_MIRRORS) {
    assert.ok(fs.existsSync(path.join(ROOT, mirror.source)), `المصدر مُعلَن ولا يوجد: ${mirror.source}`);
    assert.ok(fs.existsSync(path.join(ROOT, mirror.dest)), `المرآة مُعلَنة ولا توجد: ${mirror.dest}`);
  }
});

test('D1.15: index.html محسومة — مدخل Vite إنتاجي، والساكنة legacy بمسار معلن', () => {
  assert.equal(fs.existsSync(path.join(ROOT, 'dashboard/public/index.html')), false,
    'عادت نسخة index.html إلى publicDir — تتصادم مع مدخل Vite في dist (D1.15)');
  assert.match(read('dashboard/index.html'), /\/src\/main\.jsx/, 'مدخل Vite لم يعد مدخلًا — الإنتاجية غير محسومة');
  const legacy = 'dashboard/legacy/static-dashboard.html';
  assert.ok(fs.existsSync(path.join(ROOT, legacy)), 'النسخة الساكنة حُذفت بدل أن تُؤرشف — الحذف يمحو الدليل');
  const note = read('dashboard/legacy/README.md');
  assert.match(note, /static-dashboard\.html/, 'لا سجل للمسار المنقول في README الأرشيف');
  assert.match(note, /tests\/duplicate-sync\.test\.js/, 'الأرشيف لا يسمّي حارسه');
  const serverSrc = code(read('tools/celia-dashboard-server.mjs'));
  assert.ok(serverSrc.includes(`'${legacy}'`), 'السيرفر لا يخدم الأرشيف من مساره المعلن (في الشيفرة لا في تعليق)');
  assert.match(serverSrc, /legacy-static \(not the production build\)/, 'الصفحة المخدومة لا تُوسم غير إنتاجية');
  assert.ok(!serverSrc.includes("dashboard/public/index.html"), 'السيرفر لا يزال يحلّ النسخة القديمة في publicDir');
});

test('D1.15: الفحص لا يكتب، والكتابة idempotent، والسكربت موصَّل في npm', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.equal(pkg.scripts['sync:assets'], 'node tools/sync-dashboard-assets.mjs --write');
  assert.equal(pkg.scripts['sync:assets:check'], 'node tools/sync-dashboard-assets.mjs --check');
  const dry = syncMirrors({ rootDir: ROOT, write: false });
  assert.equal(dry.written.length, 0, '--check يكتب — فلا صلاحية لفحص CI');
  const before = new Map(ASSET_MIRRORS.map((m) => [m.dest, sha(path.join(ROOT, m.dest))]));
  const first = syncMirrors({ rootDir: ROOT, write: true });
  const second = syncMirrors({ rootDir: ROOT, write: true });
  assert.equal(first.written.length, 0, 'الكتابة الأولى غيّرت شيئًا — المرآة لم تكن مولَّدة من المصدر');
  assert.equal(second.written.length, 0, 'الكتابة ليست idempotent');
  for (const [dest, digest] of before) assert.equal(sha(path.join(ROOT, dest)), digest, `${dest} تغيّر بلا سبب`);
  const cli = execFileSync(process.execPath, ['tools/sync-dashboard-assets.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.match(cli, /in sync/, 'CLI الفاحص لا يعلن حالته — CI بلا قراءة');
});

test('D1.15: الفاحص يلتقط الانحراف ويكسر — لا يثق بحالة الشجرة', () => {
  const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'nexa-d115-'));
  try {
    for (const mirror of [ASSET_MIRRORS[0], ASSET_MIRRORS[4]]) {
      fs.mkdirSync(path.dirname(path.join(tmp, mirror.source)), { recursive: true });
      fs.mkdirSync(path.dirname(path.join(tmp, mirror.dest)), { recursive: true });
      fs.writeFileSync(path.join(tmp, mirror.source), 'const SOURCE = 1;\n');
      fs.writeFileSync(path.join(tmp, mirror.dest), 'const STALE_MIRROR = 2;\n');
    }
    const report = inspectMirrors({ rootDir: tmp });
    assert.equal(report.drifted.length, 2, `انحرافان مكتوبان ولم يُلتهما الفاحص: ${JSON.stringify(report.drifted)}`);
    assert.equal(report.ok.length, 0);
    const cli = spawnSync(process.execPath, ['tools/sync-dashboard-assets.mjs', '--check'], {
      cwd: ROOT, encoding: 'utf8', env: { ...process.env, NEXA_SYNC_ROOT: tmp }
    });
    assert.equal(cli.status, 1, 'الفحص لا يكسر عند الانحراف — CI بلا نابض');
    assert.match(cli.stderr, /منحرفة|DRIFT/, 'الفحص يكسر بلا بيان يُقرأ');
    assert.match(cli.stderr, new RegExp(ASSET_MIRRORS[0].dest.replace(/[/.]/g, (c) => '\\' + c)), 'البيان لا يسمّي الملف المنحرف');
    // والفحص يفحص فقط: لا يصلح الانحراف سرًّا وإلا صار CI أخضر لأن أحدهم كتب القرص
    const mirrored = fs.readFileSync(path.join(tmp, ASSET_MIRRORS[0].dest), 'utf8');
    assert.match(mirrored, /STALE_MIRROR/, '--check أصلح المرآة: الفحص لم يعد فحصًا');
    assert.equal(inspectMirrors({ rootDir: tmp }).drifted.length, 2, 'الفحص غيّر حالة الجذر المفحوص');
    // والفحص لا يرحم المفقود: مرآة محذوفة = فشل لا تجاهل
    fs.rmSync(path.join(tmp, ASSET_MIRRORS[0].dest));
    assert.equal(inspectMirrors({ rootDir: tmp }).missing.length >= 1, true, 'مرآة مفقودة تمرّ بلا كسر');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
