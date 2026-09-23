/**
 * D1.4 (A09 / DI-06) — مسند «عبور حدّ فعلي» (GATE_6)، مستقلًا عن مسند الأثر.
 *
 * السؤال: «هل يعبر هذا الاستغلال حدّ مستأجر أو تفويض أو عملية فعلًا؟» لا «ما شدته؟».
 * لذا يُحكم من سجلّ `finding.boundary = { from, to, kind }`:
 *   - طرفان نصّيان مختلفان غير فارغين؛
 *   - و`kind` مسموح به **لصنف الثغرة** وفق الجدول أدناه — لا kind مُختلَق ولا صنف غير معروف؛
 *   - و`severity` لا تُقرأ هنا إطلاقًا (كانت هي القرار كله، فانهيار البوابتين).
 *
 * الجدول صريح بالرفض لا بالقبول: صنف ليس له مدخل هنا لا يجد بوابة حدود، حتى لو كان CRITICAL —
 * لأن «بنر إصدار مكشوف» لا يعبر حدًّا مهما بالغنا في ترتيبه.
 */

export const BOUNDARY_KINDS_BY_CLASS = Object.freeze({
  IDOR_BOLA: Object.freeze(['authorization', 'tenant']),
  SSRF: Object.freeze(['network', 'trust']),
  CORS_MISCONFIGURATION: Object.freeze(['origin', 'tenant']),
  SQL_NOSQL_INJECTION: Object.freeze(['data', 'trust']),
  RACE_CONDITION_TOCTOU: Object.freeze(['state', 'consistency']),
  JWT_ALG_CONFUSION: Object.freeze(['authentication', 'trust']),
  JWT_NONE_ALG: Object.freeze(['authentication', 'trust']),
  REENTRANCY: Object.freeze(['state', 'consistency']),
  MISSING_ACCESS_CONTROL: Object.freeze(['authorization'])
});

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 1;

/**
 * @param {object} finding
 * @returns {{pass: boolean, reason: string}}
 */
export function evaluateBoundaryEvidence(finding) {
  const deny = (reason) => ({ pass: false, reason });
  const record = finding ? finding.boundary : undefined;

  if (record === undefined || record === null) {
    return deny('no boundary record — GATE_6 asks which boundary is crossed, and severity does not answer it');
  }
  if (typeof record !== 'object' || Array.isArray(record)) {
    return deny('boundary must be a { from, to, kind } record, not a sentence claiming a bypass');
  }
  if (!isNonEmptyString(record.from)) {
    return deny('boundary.from missing or empty — name the principal/zone the exploit starts from');
  }
  if (!isNonEmptyString(record.to)) {
    return deny('boundary.to missing or empty — name the principal/zone the exploit reaches');
  }
  if (record.from.trim() === record.to.trim()) {
    return deny('boundary.from equals boundary.to — reaching oneself is not crossing a boundary');
  }
  if (!isNonEmptyString(record.kind)) {
    return deny('boundary.kind missing — name the boundary type (authorization/tenant/origin/network/state/…)');
  }

  const vulnClass = (finding.vulnClass || finding.type || '').trim();
  const allowed = Object.prototype.hasOwnProperty.call(BOUNDARY_KINDS_BY_CLASS, vulnClass)
    ? BOUNDARY_KINDS_BY_CLASS[vulnClass]
    : null;
  if (allowed === null) {
    return deny(`class '${vulnClass || '(unnamed)'}' is not registered as crossing a boundary — no amount of severity registers it`);
  }
  if (!allowed.includes(record.kind.trim())) {
    return deny(`boundary.kind '${record.kind}' is not one of the allowed crossings for '${vulnClass}' (${allowed.join(', ')})`);
  }

  return { pass: true, reason: `crosses ${record.kind} boundary: ${record.from.trim()} → ${record.to.trim()}` };
}
