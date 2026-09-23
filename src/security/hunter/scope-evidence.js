/**
 * D1.5 (A12 / DI-13) — قرار النطاق (GATE_1) محسوب من بيانات، لا من ادعاء المستدعي.
 *
 * قبل هذا الإصلاح كانت البوابة تكتب `context.inScope !== false`: غياب السياق يُقرأ ترخيصًا،
 * والجسر يعوّض الغياب بـ `{ inScope: true }`، وautopilot يروي الحكم حرفيًا بعد أن أجرى فحص
 * نطاق حقيقي عند خطوة الاستطلاع — أي أن أرخص طريق لتمرير finding كان قول «inScope: true».
 *
 * السجل المطلوب الآن (كائن، لا boolean):
 *   { target, allow: [...], deny: [...] }        — وضع المضيف (جولة شبكة)
 *   { target: '/repo', allow: ['/repo'], deny: [] } — وضع المسار (فحص مصدر محلي)
 * ويُعيد المُقيِّم حسابه بنفسه: المطابقة لـ allow، ثم استبعاد deny، ثم أن **أصل الـ finding**
 * (مضيفه في `endpoint|url|host|asset`، أو ملفه في `file|path`) هو نفسه الأصل المُرخَّص —
 * فلا يستعير finding يُشير إلى `/etc/passwd` أو `metadata.google.internal` ترشيحَ هدفٍ آخر.
 */

import os from 'node:os';
import path from 'node:path';

const ASSET_HOST_FIELDS = Object.freeze(['endpoint', 'url', 'host', 'asset']);
const ASSET_FILE_FIELDS = Object.freeze(['file', 'path']);
const MIN_PATTERN_LENGTH = 3;

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;
const looksLikePath = (value) =>
  typeof value === 'string' &&
  (/^(?:\/|~\/|\.\/|\.\.\/)/.test(value.trim()) || /^[A-Za-z]:[\\/]/.test(value.trim()));

/** يستخرج اسم المضيف من قيمة الأصل؛ يعيد null للمسار النسبي أو النص غير المفهوم. */
function hostnameFrom(value) {
  if (!isNonEmptyString(value)) return null;
  const raw = value.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
    try {
      const host = new URL(raw).hostname.toLowerCase().replace(/\.$/, '');
      return host === '' ? null : host;
    } catch {
      return null;
    }
  }
  const authority = raw.split(/[/?#]/)[0].split('?')[0];
  const host = authority.split('@').pop().split(':')[0].toLowerCase().replace(/\.$/, '');
  // «api/v1/x» مسار نسبي لا مضيف: أول مقطع ليس نطاقًا ما لم يحتوِ نقطة
  return host.includes('.') ? host : null;
}

/** مطابقة نمط مضيف — نفس دلالة ReconAgent: مطابقة تامة أو بادئة «*.». */
function hostMatches(hostname, pattern) {
  const p = pattern.trim().toLowerCase();
  if (p === hostname) return true;
  if (p.startsWith('*.')) {
    const root = p.slice(2);
    return root.length > 0 && (hostname === root || hostname.endsWith(`.${root}`));
  }
  return false;
}

/**
 * عيوب الأنماط التي تجعل السجل غير صالح — تُرفض لا تُغفَل: نمط يبتلع كل المضيفين
 * ليس «نطاق برنامج»، ونمط بلا نقطة هو TLD أو اسم مضيف أعزل.
 */
function patternDefect(pattern) {
  if (typeof pattern !== 'string') return 'not a string';
  const p = pattern.trim();
  if (p.length < MIN_PATTERN_LENGTH) return 'empty or too short';
  if (/^[.*]+$/.test(p) || p === '*.' || p === '*') return 'admits every host';
  const bare = p.startsWith('*.') ? p.slice(2) : p;
  if (!bare.includes('.')) return 'has no domain anchor (TLD or bare label)';
  if (bare.startsWith('.') || bare.endsWith('.')) return 'malformed domain';
  return null;
}

function rootDefect(root) {
  if (typeof root !== 'string') return 'not a string';
  const r = root.trim();
  if (r.length < 2) return 'empty or too short';
  if (r === '/' || r === '.' || r === './' || r === '~') return 'admits every path';
  if (r.includes('*')) return 'wildcards are not supported for path roots';
  return null;
}

const normalizeRoot = (value) => path.resolve(value.trim().replace(/^~(?=\/|$)/, os.homedir()));

/** هل `asset` داخل `root` فعلًا بعد حلّ الروابط النسبية؟ (لا «../» مستعار) */
function isInsideRoot(root, asset) {
  const rel = path.relative(normalizeRoot(root), path.resolve(asset));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

const assetFileOf = (finding) => {
  for (const field of ASSET_FILE_FIELDS) {
    if (isNonEmptyString(finding?.[field])) return finding[field].trim();
  }
  return null;
};

/**
 * @param {object} finding
 * @param {object} context سياق المُستدعي — يُقرأ منه `scope` (بيانات) و`inScope`/التضييق فقط
 * @returns {{pass: boolean, reason: string}}
 */
export function evaluateScopeAuthorization(finding, context = {}) {
  const deny = (reason) => ({ pass: false, reason });

  if (finding && finding.outOfScope === true) {
    return deny('finding is marked outOfScope by its producer — no scope record overrides a producer’s own exclusion');
  }
  if (context && context.inScope === false) {
    return deny('caller narrowed the run (context.inScope === false) — narrowing is honored, widening is not');
  }

  const record = context ? context.scope : undefined;
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return deny(
      'no scope record (object) in the evaluation context — an inScope assertion is not authorization, and absent scope data is not a grant'
    );
  }
  if (record.authorized === false) {
    return deny('scope record states this target is not authorized for the run');
  }

  const allow = record.allow;
  if (!Array.isArray(allow)) {
    return deny('scope.allow must be an array of authorized patterns — a string or a boolean is not a scope');
  }
  if (allow.length === 0) {
    return deny('scope.allow is empty — no authorized pattern was configured, so nothing is in scope (enumeration may still proceed, certification may not)');
  }
  const denyList = record.deny === undefined ? [] : record.deny;
  if (!Array.isArray(denyList)) {
    return deny('scope.deny must be an array of patterns when present');
  }

  const target = record.target;
  if (!isNonEmptyString(target)) {
    return deny('scope.target missing or empty — the record must name the authorized asset this run is against');
  }

  if (looksLikePath(target)) {
    // ── وضع المسار: فحص مصدر محلي ├──
    for (const p of [...allow, ...denyList]) {
      const defect = rootDefect(p);
      if (defect) return deny(`scope path pattern '${String(p).slice(0, 60)}' is ${defect} — not a bounded scope root`);
    }
    const roots = allow.map(normalizeRoot);
    if (roots.some(r => r === path.sep)) {
      return deny("scope.allow resolves to the filesystem root — that is not a scope, it is 'everything'");
    }
    const asset = assetFileOf(finding);
    if (asset === null) {
      return deny(`path-mode scope requires the finding to name its own file (${ASSET_FILE_FIELDS.join('|')}) — a verdict without an asset cannot be bounded`);
    }
    const resolved = path.isAbsolute(asset) ? path.resolve(asset) : path.resolve(normalizeRoot(target), asset);
    for (const excluded of denyList.map(normalizeRoot)) {
      if (isInsideRoot(excluded, resolved)) {
        return deny(`asset '${resolved}' is inside an excluded scope root '${excluded}'`);
      }
    }
    if (!roots.some(root => isInsideRoot(root, resolved))) {
      return deny(
        `asset '${resolved}' resolves outside the authorized scope roots (${roots.join(', ')}) — escaping the root with '..' does not borrow its authorization`
      );
    }
    return { pass: true, reason: `authorized: asset '${resolved}' is inside declared scope root(s)` };
  }

  // ── وضع المضيف: جولة شبكة ├──
  for (const p of [...allow, ...denyList]) {
    const defect = patternDefect(p);
    if (defect) return deny(`scope pattern '${String(p).slice(0, 60)}' is ${defect} — not a bounded program scope`);
  }
  const hostname = hostnameFrom(target);
  if (hostname === null) {
    return deny(`scope.target '${String(target).slice(0, 60)}' is not a parseable host — name the host or use a path root for local source hunts`);
  }
  if (denyList.some(p => hostMatches(hostname, p))) {
    return deny(`target '${hostname}' is explicitly excluded by scope.deny`);
  }
  if (!allow.some(p => hostMatches(hostname, p))) {
    return deny(`target '${hostname}' matches no authorized pattern (${allow.join(', ')})`);
  }
  for (const field of ASSET_HOST_FIELDS) {
    const value = finding?.[field];
    if (!isNonEmptyString(value)) continue;
    const assetHost = hostnameFrom(value);
    if (assetHost !== null && assetHost !== hostname) {
      return deny(`finding.${field} names host '${assetHost}' — a different asset than the authorized target '${hostname}'; foreign hosts do not inherit scope`);
    }
  }
  return {
    pass: true,
    reason: `authorized: target '${hostname}' matched scope allow-list (${allow.length} pattern(s), ${denyList.length} exclusion(s))`
  };
}
