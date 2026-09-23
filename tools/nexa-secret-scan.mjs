#!/usr/bin/env node
/**
 * nexa-secret-scan — فاحص الأسرار التعاقدي (SEC-NEXT-03 / D1.11).
 * المرجع الملزم: docs/sec-next-03-secret-scanner-contract.ar.md (§3 القواعد R1–R5).
 *
 * لا استثناء-بمسار أعمى: كتلة المفتاح تُخطَّى فقط إذا طابق تلخيصها القانوني قيدًا
 * في tools/secret-fixtures.registry.json ووُجدت في المسار المُعلَن لذلك القيد (R2).
 * الانتهاك نتيجة مُبلَّغة لا استثناء مرميّ؛ والفشل في التهيئة/السجل fail-closed (exit 2).
 *
 * CLI:  node tools/nexa-secret-scan.mjs [--root <dir>] [--registry <file>] [--json]
 * خروج: 0 لا انتهاكات · 1 انتهاك واحد على الأقل · 2 فشل تهيئة/سجل.
 */

import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CONTRACT_REF = 'docs/sec-next-03-secret-scanner-contract.ar.md';

export class RegistryError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RegistryError';
    this.code = 'REGISTRY_ERROR';
  }
}

// P1 — كتل PEM للمفاتيح الخاصة (يغطي RSA/EC/ENCRYPTED التي كان الفاحص القديم أعمى عنها).
const PEM_BLOCK_RE =
  /-----BEGIN ((?:RSA |EC |ENCRYPTED )?PRIVATE KEY)-----[\s\S]*?-----END (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----/g;

// P2 — الرمز الملزوم: nexa:key:priv: متبوعًا بحمولة ≥ 8 أحرف من أبجدية المعرفات.
const BOUND_PRIV_URN_RE = /nexa:key:priv:[A-Za-z0-9][A-Za-z0-9:_-]{7,}/g;
const PRIV_TOKEN = 'nexa:key:priv:';

const SCAN_DIRS = ['packages', 'tools'];
const SCAN_EXTS = new Set(['.js', '.mjs', '.json']);
const SKIP_DIRS = new Set(['node_modules', '.git']);

/** الصيغة القانونية لكتلة PEM: التسمية + محارف قاعدة 64 فقط (مستقلة عن أسلوب التهريب). */
export function canonicalPem(block) {
  const m = block.match(
    /^-----BEGIN ((?:RSA |EC |ENCRYPTED )?PRIVATE KEY)-----([\s\S]*?)-----END (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----$/
  );
  if (!m) throw new Error('canonicalPem: كتلة غير مطابقة');
  const body = m[2].replace(/\\n/g, '');
  return `${m[1]}:${body.replace(/[^A-Za-z0-9+/=]/g, '')}`;
}

const sha256Hex = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

/** تحميل سجل التصريح والتحقق من بنيته — أي خلل = RegistryError (fail-closed). */
export function loadRegistry(registryPath) {
  let raw;
  try {
    raw = readFileSync(registryPath, 'utf8');
  } catch (e) {
    throw new RegistryError(`تعذّرت قراءة السجل ${registryPath}: ${e.message}`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new RegistryError(`سجل غير قابل للتحليل ${registryPath}: ${e.message}`);
  }
  if (!data || data.version !== 1 || !Array.isArray(data.entries)) {
    throw new RegistryError('بنية السجل غير صالحة: يلزم {version:1, entries:[...]}');
  }
  const digests = new Set();
  const kids = new Set();
  for (const [i, entry] of data.entries.entries()) {
    const bad = (why) => new RegistryError(`القيد ${i} (${entry?.kid ?? '؟'}): ${why}`);
    if (!entry || typeof entry !== 'object') throw bad('ليس كائنًا');
    for (const field of ['kid', 'path', 'sha256', 'purpose', 'declared_by']) {
      if (typeof entry[field] !== 'string' || entry[field].length === 0) throw bad(`الحقل ${field} مفقود`);
    }
    if (!/^[0-9a-f]{64}$/.test(entry.sha256)) throw bad('sha256 ليس 64 محرف hex');
    if (entry.path.startsWith('/') || entry.path.includes('..') || entry.path.includes('\\')) {
      throw bad(`مسار غير نسبي/غير posix: ${entry.path}`);
    }
    if (digests.has(entry.sha256)) throw bad(`تلخيص مكرر ${entry.sha256.slice(0, 12)}…`);
    if (kids.has(entry.kid)) throw bad(`kid مكرر ${entry.kid}`);
    digests.add(entry.sha256);
    kids.add(entry.kid);
  }
  return data;
}

function* walk(dir) {
  let names;
  try {
    names = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // مجلد نطاق غير موجود في هذا الجذر — ليس خطأً
  }
  for (const d of names.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (d.isDirectory()) {
      if (!SKIP_DIRS.has(d.name)) yield* walk(join(dir, d.name));
    } else if (SCAN_EXTS.has(d.name.slice(d.name.lastIndexOf('.')))) {
      yield join(dir, d.name);
    }
  }
}

const lineOf = (content, index) => {
  let line = 1;
  for (let i = 0; i < index; i++) if (content.charCodeAt(i) === 10) line++;
  return line;
};

/**
 * scanForSecrets({ root, registryPath }) → report
 * يرمي RegistryError عند فشل التهيئة فقط؛ الانتهاكات تُرجَع في report.violations.
 */
export async function scanForSecrets({ root, registryPath }) {
  const absRoot = resolve(root);
  const registry = loadRegistry(registryPath);
  const rel = (abs) => relative(absRoot, abs).split(sep).join('/');

  const violations = [];
  const recognized = new Map(); // kid → {kid, path}
  const matchCount = new Map(); // `${sha256}` → عدد التطابقات في المسار المُعلَن
  let inertTokens = 0;
  let filesScanned = 0;

  for (const dirName of SCAN_DIRS) {
    for (const file of walk(join(absRoot, dirName))) {
      filesScanned++;
      const content = readFileSync(file, 'utf8');
      const path = rel(file);

      for (const m of content.matchAll(PEM_BLOCK_RE)) {
        const digest = sha256Hex(canonicalPem(m[0]));
        const line = lineOf(content, m.index);
        const entry = registry.entries.find(e => e.sha256 === digest);
        if (!entry) {
          violations.push({ class: 'UNDECLARED_KEY_MATERIAL', path, line,
            detail: 'مادة مفتاح غير مصرَّح بها في السجل (R2)' });
        } else if (entry.path !== path) {
          violations.push({ class: 'FIXTURE_OUTSIDE_REGISTERED_PATH', path, line,
            declaredPath: entry.path,
            detail: `تلخيص القيد ${entry.kid} وُجد خارج مساره المُعلَن (R3)` });
        } else {
          matchCount.set(digest, (matchCount.get(digest) ?? 0) + 1);
          recognized.set(entry.kid, { kid: entry.kid, path });
        }
      }

      let prefixCount = 0;
      for (let i = content.indexOf(PRIV_TOKEN); i !== -1; i = content.indexOf(PRIV_TOKEN, i + 1)) prefixCount++;
      let bound = 0;
      for (const m of content.matchAll(BOUND_PRIV_URN_RE)) {
        bound++;
        violations.push({ class: 'BOUND_PRIV_URN', path, line: lineOf(content, m.index),
          detail: 'رمز nexa:key:priv: ملزوم بحمولة مادية — يخالف S7 (R4)' });
      }
      inertTokens += prefixCount - bound;
    }
  }

  const staleEntries = [];
  for (const entry of registry.entries) {
    if ((matchCount.get(entry.sha256) ?? 0) !== 1) {
      staleEntries.push({ kid: entry.kid, path: entry.path });
      violations.push({ class: 'REGISTRY_STALE', path: entry.path, line: null,
        detail: `القيد ${entry.kid} لا يطابق كتلة واحدة بالضبط في مساره المُعلَن (R5)` });
    }
  }

  violations.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : (a.line ?? 0) - (b.line ?? 0)));

  return {
    contract: CONTRACT_REF,
    root: absRoot,
    filesScanned,
    recognizedFixtures: [...recognized.values()].sort((a, b) => (a.kid < b.kid ? -1 : 1)),
    inertTokens,
    violations,
    staleEntries,
    verdict: violations.length === 0 ? 'clean' : 'violations',
  };
}

function parseArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--json') opts.json = true;
    else if (argv[i] === '--root') opts.root = argv[++i];
    else if (argv[i] === '--registry') opts.registry = argv[++i];
    else throw new RegistryError(`وسيط غير معروف: ${argv[i]}`);
  }
  return opts;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  (async () => {
    try {
      const opts = parseArgs(process.argv.slice(2));
      const root = opts.root ?? resolve(dirname(fileURLToPath(import.meta.url)), '..');
      const registryPath = opts.registry ?? join(root, 'tools', 'secret-fixtures.registry.json');
      const report = await scanForSecrets({ root, registryPath });
      if (opts.json) {
        process.stdout.write(JSON.stringify(report, null, 2) + '\n');
      } else {
        console.log(`🔍 nexa-secret-scan (SEC-NEXT-03): ${report.filesScanned} ملفًا مفحوصًا`);
        console.log(`   fixtures مصرَّح بها ومعروفة: ${report.recognizedFixtures.map(f => f.kid).join(', ') || '(لا شيء)'}`);
        console.log(`   رموز بروتوكول خاملة (nexa:key:priv: مجرّد): ${report.inertTokens}`);
        for (const v of report.violations) {
          console.log(`   ❌ [${v.class}] ${v.path}${v.line == null ? '' : `:${v.line}`} — ${v.detail}`);
        }
        console.log(report.verdict === 'clean'
          ? '✅ verdict: clean — لا مادة سرية غير مصرَّح بها.'
          : `❌ verdict: violations — ${report.violations.length} انتهاكًا.`);
      }
      process.exit(report.verdict === 'clean' ? 0 : 1);
    } catch (e) {
      if (e?.code === 'REGISTRY_ERROR') {
        console.error(`❌ REGISTRY_ERROR: ${e.message}`);
        process.exit(2);
      }
      console.error(`❌ REGISTRY_ERROR: فشل غير متوقع في الفاحص (fail-closed): ${e?.message ?? e}`);
      process.exit(2);
    }
  })();
}
