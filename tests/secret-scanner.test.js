import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeyPairSync } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { scanForSecrets, canonicalPem } from '../tools/nexa-secret-scan.mjs';

/**
 * اختبار الانعكاس لفجوة D1.11 (SEC-NEXT-03) — عقد فاحص الأسرار v1.
 * المرجع التعاقدي: docs/sec-next-03-secret-scanner-contract.ar.md (§3 القواعد R1–R5، §4 معايير القبول).
 * يُكتب هذا الاختبار قبل التنفيذ ويفشل (الأحمر موثق في self-model/evidence/sec-next-03-red.tap).
 * بوابة التذكرة الحرفية: سرٌّ حقيقي داخل «المسار المستثنى» يجب أن يظل يُلتقط — لا whitelist أعمى.
 */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCANNER = join(ROOT, 'tools', 'nexa-secret-scan.mjs');
const REAL_REGISTRY = join(ROOT, 'tools', 'secret-fixtures.registry.json');
const CONTRACT_REF = 'docs/sec-next-03-secret-scanner-contract.ar.md';
const FIXTURE_REL = 'tools/google-fixtures.mjs';

const PEM_RE = /-----BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----/;

function tmpRoot(t) {
  const dir = mkdtempSync(join(tmpdir(), 'nexa-sec-next-03-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function place(dir, rel, content) {
  const abs = join(dir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  return abs;
}

function writeRegistry(dir, entries) {
  const abs = join(dir, 'registry.json');
  writeFileSync(abs, JSON.stringify({ version: 1, contract: CONTRACT_REF, entries }, null, 2));
  return abs;
}

/** مفتاح RSA حقيقي مولَّد للتوّ داخل الاختبار — لا يُخزَّن ولا يدخل السجل. */
function freshPem() {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return privateKey.export({ type: 'pkcs8', format: 'pem' });
}

const escapedOneLine = (pem) => pem.replace(/\n/g, '\\n');

const emptyRegistry = (dir) => writeRegistry(dir, []);

// ── §4.1 — المستودع الحقيقي نظيف والـ fixtures الثلاثة معروفة ────────────────
test('D1.11/§4.1: المستودع الحقيقي نظيف وكل fixtures مُصرَّح بها', async () => {
  const report = await scanForSecrets({ root: ROOT, registryPath: REAL_REGISTRY });
  assert.equal(report.verdict, 'clean', JSON.stringify(report.violations, null, 2));
  assert.equal(report.violations.length, 0);
  assert.equal(report.staleEntries.length, 0);
  assert.ok(report.filesScanned > 0, 'الفاحص يجب أن يفحص ملفات فعلًا');
  const kids = report.recognizedFixtures.map(f => f.kid).sort();
  assert.deepEqual(kids, ['offline-key-1', 'offline-key-2', 'offline-key-3']);
  assert.ok(report.recognizedFixtures.every(f => f.path === FIXTURE_REL), 'الاعتراف مربوط بالمسار المُعلَن فقط');
  assert.equal(report.contract, CONTRACT_REF);
});

// ── §4.2 — بوابة التذكرة: سرٌّ جديد داخل «المسار المستثنى» يُلتقط ──────────
test('D1.11/§4.2: مادة مفتاح جديدة داخل نسخة ملف الـ fixtures نفسه تُلتقط', async (t) => {
  const dir = tmpRoot(t);
  const original = readFileSync(join(ROOT, FIXTURE_REL), 'utf8');
  const appended = `export const leakedKey = '${escapedOneLine(freshPem())}';\n`;
  const lineCount = (original.match(/\n/g) || []).length; // الملف ينتهي بسطر جديد
  place(dir, FIXTURE_REL, original + appended);

  const report = await scanForSecrets({ root: dir, registryPath: REAL_REGISTRY });
  assert.equal(report.verdict, 'violations');
  const hit = report.violations.find(v => v.class === 'UNDECLARED_KEY_MATERIAL');
  assert.ok(hit, `متوقع UNDECLARED_KEY_MATERIAL، وُجد: ${JSON.stringify(report.violations)}`);
  assert.equal(hit.path, FIXTURE_REL);
  assert.equal(hit.line, lineCount + 1, 'السطر المُبلَّغ هو سطر المادة المُلحقة');
  // الـ fixtures المُعلَنة نفسها ما زالت معروفة ولم تُوسم كانتهاك
  assert.equal(report.recognizedFixtures.length, 3);
  assert.equal(report.violations.filter(v => v.class === 'UNDECLARED_KEY_MATERIAL').length, 1);

  // وعبر CLI: الخروج 1
  const cli = spawnSync(process.execPath, [SCANNER, '--root', dir, '--registry', REAL_REGISTRY, '--json'], { encoding: 'utf8' });
  assert.equal(cli.status, 1, cli.stderr);
  assert.equal(JSON.parse(cli.stdout).verdict, 'violations');
});

// ── §4.3 — تلخيص مُعلَن خارج مساره المُعلَن يُلتقط (R3) ──────────────────────
test('D1.11/§4.3: تلخيص مُعلَن في مسار مختلف = FIXTURE_OUTSIDE_REGISTERED_PATH', async (t) => {
  const dir = tmpRoot(t);
  const source = readFileSync(join(ROOT, FIXTURE_REL), 'utf8');
  const key1 = source.match(PEM_RE)[0];
  place(dir, 'packages/some-runtime/index.js', `export const embedded = \`${key1}\`;\n`);
  const { createHash } = await import('node:crypto');
  const digest = createHash('sha256').update(canonicalPem(key1), 'utf8').digest('hex');
  const registry = writeRegistry(dir, [
    { kid: 'offline-key-1', path: FIXTURE_REL, sha256: digest, purpose: 'test', declared_by: 'sec-next-03-test' },
  ]);

  const report = await scanForSecrets({ root: dir, registryPath: registry });
  assert.equal(report.verdict, 'violations');
  const hit = report.violations.find(v => v.class === 'FIXTURE_OUTSIDE_REGISTERED_PATH');
  assert.ok(hit, `متوقع FIXTURE_OUTSIDE_REGISTERED_PATH، وُجد: ${JSON.stringify(report.violations)}`);
  assert.equal(hit.path, 'packages/some-runtime/index.js');
  assert.equal(hit.declaredPath, FIXTURE_REL, 'التقرير يسمّي المسار المُعلَن الذي خُرق');
});

// ── §4.4 — Q2: الرمز المجرّد خامل والملزوم مادة ─────────────────────────────
test('D1.11/§4.4: nexa:key:priv: المجرّد خامل، والملزوم BOUND_PRIV_URN', async (t) => {
  const dir = tmpRoot(t);
  // نفس صورة السطر 136 من anthropic-constitutional.js — كاشف يبحث عن الرمز لا قيمة ملزومة
  place(dir, 'tools/detector.js',
    `if (opStr.includes('nexa:key:priv:') || opStr.includes('private_key')) { p4Pass = false; }\n`);
  place(dir, 'tools/doc-example.mjs',
    `// S7: no envelope may contain nexa:key:priv:* or raw seeds\nexport const S7 = 'nexa:key:priv:*';\n`);
  const registry = emptyRegistry(dir);

  const clean = await scanForSecrets({ root: dir, registryPath: registry });
  assert.equal(clean.verdict, 'clean', JSON.stringify(clean.violations, null, 2));
  assert.ok(clean.inertTokens >= 3, 'الرموز الخاملة تُحصى ولا تُسقط الفحص');

  place(dir, 'tools/leak.mjs',
    `export const SEED_URN = 'nexa:key:priv:ed25519:z6MkAttackerControlledSeed9xQY';\n`);
  const dirty = await scanForSecrets({ root: dir, registryPath: registry });
  assert.equal(dirty.verdict, 'violations');
  const hit = dirty.violations.find(v => v.class === 'BOUND_PRIV_URN');
  assert.ok(hit, `متوقع BOUND_PRIV_URN، وُجد: ${JSON.stringify(dirty.violations)}`);
  assert.equal(hit.path, 'tools/leak.mjs');
  assert.equal(hit.line, 1);
});

// ── §4.5 — fail-closed: سجل مفقود/فاسد/مكرر ⇒ REGISTRY_ERROR وخروج 2 ────────
test('D1.11/§4.5: سجل مفقود أو فاسد أو مكرر = فشل مغلق (لا فحص بلا سجل)', async (t) => {
  const dir = tmpRoot(t);
  place(dir, 'tools/x.mjs', 'export const x = 1;\n');

  await assert.rejects(
    scanForSecrets({ root: dir, registryPath: join(dir, 'missing.json') }),
    (e) => e.code === 'REGISTRY_ERROR'
  );

  const corrupt = join(dir, 'corrupt.json');
  writeFileSync(corrupt, '{ not json');
  await assert.rejects(
    scanForSecrets({ root: dir, registryPath: corrupt }),
    (e) => e.code === 'REGISTRY_ERROR'
  );

  const dupDigest = writeRegistry(dir, [
    { kid: 'a', path: 'tools/x.mjs', sha256: 'f'.repeat(64), purpose: 'p', declared_by: 't' },
    { kid: 'b', path: 'tools/y.mjs', sha256: 'f'.repeat(64), purpose: 'p', declared_by: 't' },
  ]);
  await assert.rejects(
    scanForSecrets({ root: dir, registryPath: dupDigest }),
    (e) => e.code === 'REGISTRY_ERROR'
  );

  const badDigest = writeRegistry(dir, [
    { kid: 'a', path: 'tools/x.mjs', sha256: 'not-a-sha256', purpose: 'p', declared_by: 't' },
  ]);
  await assert.rejects(
    scanForSecrets({ root: dir, registryPath: badDigest }),
    (e) => e.code === 'REGISTRY_ERROR'
  );

  const cli = spawnSync(process.execPath, [SCANNER, '--root', dir, '--registry', join(dir, 'missing.json')], { encoding: 'utf8' });
  assert.equal(cli.status, 2, `متوقع خروج 2، حصل: ${cli.status} — ${cli.stdout}`);
  assert.match(cli.stderr, /REGISTRY_ERROR/);
});

// ── §4.6 — قيد بلا تطابق = REGISTRY_STALE (انتهاك لا تحذير صامت) ────────────
test('D1.11/§4.6: القيد المتقادم انتهاك — السجل لا يتقادم صامتًا (R5)', async (t) => {
  const dir = tmpRoot(t);
  place(dir, 'tools/x.mjs', 'export const x = 1;\n');
  const registry = writeRegistry(dir, [
    { kid: 'ghost-key', path: 'tools/ghost.mjs', sha256: 'a'.repeat(64), purpose: 'p', declared_by: 't' },
  ]);
  const report = await scanForSecrets({ root: dir, registryPath: registry });
  assert.equal(report.verdict, 'violations');
  assert.deepEqual(report.staleEntries.map(e => e.kid), ['ghost-key']);
  assert.ok(report.violations.some(v => v.class === 'REGISTRY_STALE' && v.path === 'tools/ghost.mjs'));
});

// ── §4.7 — الـ workflow موصّل بالفاحص التعاقدي لا بأنبوب grep الأعمى ─────────
test('D1.11/§4.7: security-scan.yml يستدعي الفاحص التعاقدي ولا يحوي grep الأعمى', () => {
  const yml = readFileSync(join(ROOT, '.github', 'workflows', 'security-scan.yml'), 'utf8');
  assert.ok(yml.includes('tools/nexa-secret-scan.mjs'), 'خطوة الفحص يجب أن تستدعي الفاحص التعاقدي');
  assert.ok(!yml.includes('BEGIN (PRIVATE|RSA|EC) KEY'), 'أنبوب grep الأعمى القديم يجب أن يُزال');
});

// ── §4.8 — CLI على المستودع الحقيقي: خروج 0 وتقرير clean ────────────────────
test('D1.11/§4.8: CLI على الجذر الحقيقي = خروج 0 وverdict clean', () => {
  const cli = spawnSync(process.execPath, [SCANNER, '--json'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  const report = JSON.parse(cli.stdout);
  assert.equal(report.verdict, 'clean');
  assert.equal(report.recognizedFixtures.length, 3);
  // وبدون --json ملخص بشري لا JSON
  const human = spawnSync(process.execPath, [SCANNER], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /clean/i);
  assert.ok(!human.stdout.trimStart().startsWith('{'), 'الوضع البشري لا يطبع JSON');
});
