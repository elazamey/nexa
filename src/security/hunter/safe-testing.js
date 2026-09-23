/**
 * D1.3 (A02 / DI-07) — سجل سلوك الاختبار الآمن.
 *
 * البوابة السابعة («هل أُجري التحقق بغير إضرار وبلا قطع خدمة؟») كانت تُكتب `pass: true`
 * لكل finding: سؤال بلا مُجيب، وقاعدة 7/7 تُغلَّق بستة محسوبة وواحد مُهدى. هذا الملف يجعل
 * السؤال يُجاب من مُدخل: سجلّ يصرّح به من أنتج الدليل، ويُحكى منه قرار — لا قرارًا يُهدى.
 *
 * العقد (كائن، لا boolean):
 *   { nonDestructive: true, noServiceDisruption: true, method: <معرّف>, attestedBy: <artifact.producedBy> }
 *
 * ثلاث خصائص مقصودة:
 *   1) fail-closed (§10.9): كل غياب أو خلل أو إقرار بالضرر → رفض مُعلَّل، لا تمرير.
 *   2) الربط: `attestedBy` يجب أن يساوي منتج الدليل التحقق-به القارئ — شهادة عاملة واحدة
 *      لا تغطي كل الكواشف، لأن الشهادة إذن ليست عن هذا الدليل بعينه.
 *   3) الحتمية (§6.3): لا حقول لحظية (timestamp ولا nonce): الصدق في الربط لا في الزمن؛
 *      السجل يدخل حمولة الإيصال الموقّعة، فأي لحظة فيه تكسر حتمية الـ digest.
 *
 * `method` معرّف لا نثر: «تم بحذر» ليس طريقة اختبار.
 */

export const SAFE_TESTING_REQUIRED_FLAGS = Object.freeze(['nonDestructive', 'noServiceDisruption']);

// إقرار صريح بالضرر داخل نفس السجل — يُلغي أي «true» مجاور
const SAFE_TESTING_ADMITTED_HARM = Object.freeze(['serviceDisrupted', 'destructiveAction', 'causedOutage']);

const METHOD_PATTERN = /^[a-z0-9][a-z0-9._-]{3,63}$/;

/**
 * يحسب قرار البوابة السابعة من السجل والـ artifact المنقّح.
 * @param {unknown} record السجل كما مرّحه الكاشف أو سياق الجولة
 * @param {{producedBy?: string}|null} artifact نسخة القارئ المنقّحة (لا原文 الـ artifact)
 * @returns {{pass: boolean, reason: string}}
 */
export function evaluateSafeTestingRecord(record, artifact) {
  const deny = (reason) => ({ pass: false, reason });

  if (record === undefined || record === null) {
    return deny('no safe-testing record — GATE_7 is computed from one, never granted');
  }
  if (record === false) {
    return deny('the finding records explicitly that its testing was not safe');
  }
  if (typeof record !== 'object' || Array.isArray(record)) {
    return deny('safeTesting must be a record object, not a word');
  }

  for (const harm of SAFE_TESTING_ADMITTED_HARM) {
    if (record[harm] === true) {
      return deny(`the record admits '${harm}' — non-destructive testing cannot be claimed alongside it`);
    }
  }

  for (const flag of SAFE_TESTING_REQUIRED_FLAGS) {
    if (record[flag] !== true) {
      return deny(`${flag} must be recorded true`);
    }
  }

  if (typeof record.method !== 'string' || !METHOD_PATTERN.test(record.method)) {
    return deny('method must be an identifier-like string (prose is not a testing method)');
  }

  const producer = artifact && typeof artifact.producedBy === 'string' ? artifact.producedBy : null;
  if (producer === null) {
    return deny('the validated artifact carries no producedBy for the attestation to bind to');
  }
  if (record.attestedBy !== producer) {
    return deny(
      `attestedBy must equal the artifact producer '${producer}' — one generic attestation does not speak for this evidence`
    );
  }

  return { pass: true, reason: `attested by ${producer} via method '${record.method}'` };
}
