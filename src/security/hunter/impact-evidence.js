/**
 * D1.4 (A09 / DI-06) — مسند «الأثر الملموس» (GATE_3)، منفصلًا عن مسند عبور الحدود.
 *
 * كانت GATE_3 وGATE_6 تقرآن نفس الشرط (`severity ∈ {CRITICAL,HIGH,MEDIUM}`): سؤالان بإجابة
 * واحدة، فـ«السبعة» خمسة، و7/7 تُغلَّق بمسندٍ مُعاد استخدامه. الحُكم هنا على **مضمون الادعاء**:
 * عبارة أثر كافية طولًا، تسمّي متجه ضرر معروفًا، ولا تصيغ نفسها كاحتمال نظري.
 *
 * لا تُقرأ `severity` هنا إطلاقًا: الشدة ترتيب أولوية، لا دليل أثر — وإلا كان رفع الشدة
 * وحده يفتّح البوابتين معًا، وهو بالضبط ما كان يحدث.
 */

// متجهات الضرر المقبولة — مغلقة عمدًا: «شيء ما ينكسر» ليس أثرًا
export const IMPACT_VECTORS = Object.freeze({
  data: /(?:\bread\b|\baccess\b|exfiltrat|disclos|leak|modif|compromis|\bdump\b|extract|harvest)/i,
  privacy: /(?:\bpii\b|personal|private|identity|credential|token|secret)/i,
  financial: /(?:billing|invoice|payment|refund|spent|spending|redeem|redemption|monetiz|charge|balance)/i,
  privilege: /(?:unauthorized|authorisation|authorization|bypass|escalat|impersonat|\badmin\b|forg)/i,
  availability: /(?:outage|denial of service|\bcrash\b|unavailab|resource exhaustion|halting)/i,
  integrity: /(?:tamper|integrity|corrupt|unsanctioned)/i,
  network: /(?:port scan|internal network|metadata|intranet|lateral movement|loopback)/i
});

// صياغة الاحتمال النظري — ما يميّز «finding نظري» عن ادعاء مُثبت
const THEORETICAL_PHRASING = /\b(?:may|might|could|potentially|theoretically|hypothetically|in theory|speculative)\b/i;

const MIN_IMPACT_STATEMENT = 60;

/**
 * @param {object} finding
 * @returns {{pass: boolean, reason: string}}
 */
export function evaluateImpactDemonstration(finding) {
  const deny = (reason) => ({ pass: false, reason });
  const impact = finding ? finding.impact : undefined;

  if (typeof impact !== 'string') {
    return deny('impact must be a written claim (string), not a tag or a number');
  }
  const statement = impact.trim();
  if (statement.length < MIN_IMPACT_STATEMENT) {
    return deny(`impact statement is ${statement.length} chars — under ${MIN_IMPACT_STATEMENT} it is a label, not a demonstration`);
  }
  if (THEORETICAL_PHRASING.test(statement)) {
    return deny('impact is phrased as a possibility (may/might/could/potentially) — theoretical findings are filtered by GATE_3');
  }
  const matched = Object.keys(IMPACT_VECTORS).filter(vector => IMPACT_VECTORS[vector].test(statement));
  if (matched.length === 0) {
    return deny(`impact names no harm vector (${Object.keys(IMPACT_VECTORS).join('|')}) — nothing concrete is asserted`);
  }
  return { pass: true, reason: `impact asserted on vector(s): ${matched.join(', ')}` };
}
