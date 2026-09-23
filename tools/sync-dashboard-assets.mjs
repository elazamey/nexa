#!/usr/bin/env node
/**
 * D1.15 (O07) — مصدر حقيقة واحد للأصول التي تُخدَم من `dashboard/public/`.
 *
 * الداء ليس وجود نسختين، بل أن التطابق **يدوي**: سبع وحدات `adapters/edge-rag/*.js`
 * و`index.html` و`dashboard/workspace.html` كانت تُنسخ بالحرف إلى `dashboard/public/`،
 * فأي إصلاح في الجهة المُختبَرة يهدأ ساكنًا في الجهة المخدومة حتى يلاحظها أحد. السكربت
 * هنا هو الموضع الوحيد الذي يُعرَّف فيه الاتجاه، و`--check` هو ما يجعل CI يكسر.
 *
 * صراحةً: الأصول المرئية تُنسخ لا تُرمَّز لأن `dashboard/public/` يُخدَم كما هو (لا بناء
 * JS للوحة الساكنة)؛ والحارس `tests/duplicate-sync.test.js` يمنع (1) أن تنحرف مرآة عن
 * مصدرها، و(2) أن تظهر نسخة جديدة غير معلنة هنا.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** الاتجاه مُعلَّن: المصدر هو ما تُختبَر عليه الوحدة، والمرآة ما يُخدَم في المتصفح. */
export const ASSET_MIRRORS = [
  ...[
    'cost_guard.js',
    'evidence_ledger.js',
    'hybrid_memory.js',
    'provider_broker.js',
    'rag_core.js',
    'reflection_engine.js',
    'worker.js'
  ].map((file) => ({
    source: `adapters/edge-rag/${file}`,
    dest: `dashboard/public/${file}`,
    reason: 'وحدة edge-rag تُختبَر من adapters/ وتُخدَم من public/'
  })),
  {
    source: 'adapters/edge-rag/index.html',
    dest: 'dashboard/public/edge-rag.html',
    reason: 'واجهة edge-rag: المصدر في الـ adapter، والاسم المخدوم مختلف عمدًا'
  },
  {
    source: 'dashboard/workspace.html',
    dest: 'dashboard/public/workspace.html',
    reason: 'HUD الكتابة: يخدمه السيرفر من الجذر، وdist يحتاج النسخة نفسها'
  }
];

const digest = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

/** الحالة الراهنة للمرايا: في محلها، منحرفة، أم مفقودة. */
export function inspectMirrors({ rootDir = ROOT, mirrors = ASSET_MIRRORS } = {}) {
  const ok = [];
  const drifted = [];
  const missing = [];
  for (const mirror of mirrors) {
    const srcAbs = path.join(rootDir, mirror.source);
    const dstAbs = path.join(rootDir, mirror.dest);
    if (!fs.existsSync(srcAbs)) {
      missing.push({ ...mirror, problem: 'source-missing' });
      continue;
    }
    if (!fs.existsSync(dstAbs)) {
      missing.push({ ...mirror, problem: 'mirror-missing' });
      continue;
    }
    const src = fs.readFileSync(srcAbs);
    const dst = fs.readFileSync(dstAbs);
    if (src.equals(dst)) ok.push(mirror.dest);
    else drifted.push({ ...mirror, sourceDigest: digest(src).slice(0, 16), destDigest: digest(dst).slice(0, 16) });
  }
  return { ok, drifted, missing };
}

/** كتابة المرايا من مصادرها. `write:false` = فحص جاف (ما يفعله `--check`). */
export function syncMirrors({ rootDir = ROOT, write = false } = {}) {
  const before = inspectMirrors({ rootDir });
  const written = [];
  if (write) {
    for (const mirror of ASSET_MIRRORS) {
      const srcAbs = path.join(rootDir, mirror.source);
      const dstAbs = path.join(rootDir, mirror.dest);
      if (!fs.existsSync(srcAbs)) continue;
      const bytes = fs.readFileSync(srcAbs);
      if (fs.existsSync(dstAbs) && fs.readFileSync(dstAbs).equals(bytes)) continue;
      fs.mkdirSync(path.dirname(dstAbs), { recursive: true });
      // كتابة ذرّية: المرآة لا تُخدَم نصف ملف (عقد D1.6/D1.8 نفسه)
      const temp = `${dstAbs}.${process.pid}.tmp`;
      fs.writeFileSync(temp, bytes);
      fs.renameSync(temp, dstAbs);
      written.push(mirror.dest);
    }
  }
  return { ...before, written, write };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const write = process.argv.includes('--write');
  // NEXA_SYNC_ROOT يعزل الفاحص في الاختبارات (نفس أسلوب NEXA_BUG_REPORT) — الافتراضي الشجرة
  const rootDir = process.env.NEXA_SYNC_ROOT || ROOT;
  const result = syncMirrors({ rootDir, write });
  const state = result.drifted.length === 0 && result.missing.length === 0 ? 'in sync' : 'DRIFT';
  console.log(`[sync-dashboard-assets] ${state} · ${result.ok.length} مرآة مطابقة · ${result.drifted.length} منحرفة · ${result.missing.length} مفقودة${write ? ` · ${result.written.length} كُتبت` : ''}`);
  for (const d of result.drifted) {
    console.error(`  ✗ منحرفة: ${d.dest} (${d.destDigest}) ≠ ${d.source} (${d.sourceDigest}) — شغّل: npm run sync:assets`);
  }
  for (const m of result.missing) {
    console.error(`  ✗ ${m.dest}: ${m.problem} — صحّح ASSET_MIRRORS أو استعد الملف`);
  }
  if (!write && (result.drifted.length || result.missing.length)) {
    console.error('  الفحص لا يكتب؛ هذه هي حالة CI: انحراف = فشل.');
    process.exitCode = 1;
  }
}
