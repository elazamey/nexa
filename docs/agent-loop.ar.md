# دورة الوكيل في NEXA — Inspect → … → Evidence → Deliver

> النسخة الإنجليزية: [`agent-loop.md`](agent-loop.md).
> الصيغة القابلة للتنفيذ: `tools/verification-gate.mjs`، مثبّتة بالاختبار `tests/verification-gate.test.js`.

قاعدة NEXA الوحيدة: **الذكاء الاصطناعي يقترح، والنظام الحتمي يقرّر**. هذا المستند يحوّل
القاعدة إلى *دورة عمل* يُلزَم بها أي وكيل برمجي (Celia أو أي وكيل يتحدث بروتوكول NEXA)،
ويسمّي ثلاثة أشياء يجب ألا تُخلط أبدًا: **MOCK** و**REAL** و**EVIDENCE**.

## 1. الدورة

«يكتب الكود ثم يعدّله» ليست دورة. الدورة الهندسية هي:

```text
DISCOVER      ما الموجود وما المطلوب
UNDERSTAND    الهدف والقيود وما ليس مطلوبًا            → Specification
INSPECT       الملفات والبنية والاعتماديات والاختبارات  → Context
PLAN          أي ملفات، أي تغييرات، بأي ترتيب           → Implementation Plan
AUTHORIZE     capability + policy للخطة                → ALLOW / DENY (الافتراضي DENY)
IMPLEMENT     توليد أو تعديل الكود                     → Code Change
EXECUTE       بناء / تشغيل                            → Runtime Result
OBSERVE       التقاط السجلات ورموز الخروج والمخرجات    → Observation
TEST          unit / integration / e2e                → Test Evidence
   ┌─────────────────────────────────────────────────┐
   │ فشل؟  نعم → DIAGNOSE → REPAIR → RETEST ────┐    │
   │       لا   ↓                                │    │
   └────────────┴──────── (كرّر حتى «لا») ◄──────┘    │
REVIEW        أخطاء، أمان، انحدارات                    → Review Findings
VERIFY        هل تحقق *المطلوب* فعلًا؟                 → Verdict
EVIDENCE      سجل موقّع ومسلسل بالتجزئة للتشغيل        → Evidence chain + receipt
DELIVER       commit / PR / deploy، فقط عند التصريح    → Release
```

الترتيب مُصدَّر باسم `LOOP_STAGES` في `tools/verification-gate.mjs`، والاختبار يثبّت
قاعدتين: `AUTHORIZE` قبل `IMPLEMENT`، و`VERIFY` قبل `DELIVER`.

### أين تعيش كل مرحلة في هذا المستودع

| المرحلة | الآلية | الموضع |
| --- | --- | --- |
| INSPECT / PLAN | أوامر Celia `advise` و`catalog` و`research` — قراءة فقط | `tools/celia-system.mjs` |
| AUTHORIZE | رمز capability + policy، الرفض افتراضيًا | `packages/capability`, `packages/policy`, `packages/protocol` |
| EXECUTE (محدود) | منفّذ COMMIT في Celia، يعيد التحقق عند نقطة الكتابة | `tools/celia-workspace-commit-port.mjs` |
| OBSERVE / EVIDENCE | `EvidenceLog` و`verifyEvidenceChain` وإيصالات موقّعة | `packages/evidence` |
| TEST / RETEST | `npm test` و`npm run verify` | `tests/`, `package.json` |
| VERIFY | `assessClaim()` — PASS / FAIL / BLOCKED | `tools/verification-gate.mjs` |
| DELIVER | **مُنفَذ**: `createWorkspaceCommitter` يرفض ما لم تُرجع البوابة `PASS` | `tools/celia-workspace-commit-port.mjs` |

## 2. من يقرّر

```text
AI يقترح
     ↓
Policy تقرّر                    (packages/policy — الافتراضي DENY)
     ↓
سلطة التنفيذ تنفّذ              (handler محكوم بـcapability)
     ↓
النظام يُنتج الدليل             (packages/evidence — سلسلة تجزئة + إيصال)
     ↓
المُحقِّق يتحقق                 (مفتاح ليس هو المقترِح)
     ↓
النتيجة = PASS / FAIL / BLOCKED
```

الوكيل ليس حكمًا على نفسه أبدًا. تعيد `assessClaim()` النتيجة **BLOCKED** إذا ظهر مفتاح
المقترِح بين موقّعي سلسلة الأدلة التي يستند إليها.

## 3. MOCK ≠ REAL ≠ EVIDENCE

ثلاثة أشياء مختلفة تُثبت ثلاث عبارات مختلفة:

| الشيء | يثبت | هل يُنتج PASS وحده؟ |
| --- | --- | --- |
| **اختبار MOCK / STUB / FIXTURE** | أن الكود يحترم *عقد* الاعتمادية | **لا** → `BLOCKED` |
| **تشغيل REAL حقيقي** | أن *التكامل* يعمل فعلًا في هذه البيئة | فقط عندما يُسجَّل كدليل |
| **EVIDENCE** (سلسلة متحققة، موقّع مستقل، `HANDLER_RESULT/ALLOW`) | *ما حدث فعليًا* | **نعم** → `PASS` |

القواعد المترتبة:

1. الـmock ليس المرحلة الأولى. الترتيب: *متطلب حقيقي → عقد حقيقي → تنفيذ → اختبار
   حقيقي*؛ ويُستخدم الـmock فقط لعزل اعتمادية خارجية أو فرض حالة محددة.
2. «الـmock نجح إذن المتصفح/الطرفية/الـAPI يعمل» استنتاج باطل. قل بدلًا منه: *العقد
   محترم؛ التكامل لم يُثبَت بدليل بعد*.
3. **يجب التصريح بمصدر الدليل** (`mock` | `real`). الدليل غير المصرَّح بمصدره `BLOCKED`؛
   لا ترقية صامتة من mock إلى real.
4. **التسجيل ≠ التنفيذ.** الإدراج في كاتالوج Celia، أو وجود مجلد adapter، أو نجاح اختبار
   fixture يعني *مسجَّل*. التشغيل الحقيقي مع دليل وحده يعني *منفَّذ*.

## 4. الأحكام

توجد ثلاثة أحكام فقط. لا يوجد «غالبًا تمام».

| الحكم | المعنى | السبب المعتاد |
| --- | --- | --- |
| `PASS` | سلسلة متحققة، موقّع مستقل، `HANDLER_RESULT/ALLOW` للموضوع، بلا DENY لاحق | تشغيل حقيقي سجّله مفتاح المشغّل/المحقّق |
| `FAIL` | الدليل يناقض الادعاء، أو السلسلة معدَّلة | `GATE_BLOCKED`، `DENY`، سجل مُحرَّر |
| `BLOCKED` | لا يوجد دليل مقبول كافٍ للحكم | لا دليل، توقيع ذاتي، mock فقط، موضوع مختلف، لا `HANDLER_RESULT` |

`BLOCKED` ليس `PASS` ناعمًا. معناه أن الدورة لم تصل إلى `EVIDENCE` بعد؛ عُد إلى `EXECUTE`.

## 5. حلقة الإصلاح

```text
CODE → RUN → فشل؟
              ├── لا  → REVIEW → VERIFY → EVIDENCE → DELIVER
              └── نعم → DIAGNOSE → FIX → RETEST ─┐
                          ▲                      │
                          └──────────────────────┘
```

الإصلاح **لا** يعيد كتابة التاريخ. السجل الفاشل يبقى في السلسلة؛ الحكم الجديد يخص
التشغيل *الجديد* (انظر اختبار «the repair loop»). تعديل السجل بدل تعديل الكود يكشفه
`verifyEvidenceChain` وينتج `FAIL`.

## 6. الاستخدام الأدنى

```js
import { assessClaim } from './tools/verification-gate.mjs';

const verdict = assessClaim({
  claim:   { subject: workerKid, proposer: agentKid, asserted: true },
  records: evidenceLog.entries(),   // مختومة بمفتاح المحقّق
  source:  'real',
});
// → { verdict: 'PASS' | 'FAIL' | 'BLOCKED', reason, evidence? }
```

كل ما *يقوله* الوكيل (`asserted: true`) يُحمَل للتوثيق فقط ويُتجاهَل في القرار.

## 7. الإنفاذ عند COMMIT (مرحلة DELIVER)

البوابة ليست استشارية. `createWorkspaceCommitter({ config })` يتطلب
`config.verification = { verifiers: [kid, ...] }`، وكل طلب COMMIT يجب أن يحمل
`evidence: { source: 'real', records: [...] }`. بعد نجاح فحوص الهوية والـcapability
والـpolicy والحالة الدقيقة — و**قبل أي I/O على نظام الملفات** — يستدعي المنفّذ
`assessClaim()` ويشترط إضافةً أن سجل `HANDLER_RESULT/ALLOW` الفائز:

* موقّع من محقّق مُهيّأ (وليس المبدأ المُرسِل للـCOMMIT أبدًا)،
* يسمّي `resource = workspace_commit:<hash>` الخاص بهذا الطلب،
* يحمل `detail.changeSetHash` مساويًا لمجموعة التغييرات في الطلب.

| كود الرفض | المعنى |
| --- | --- |
| `COMMIT_VERIFICATION_UNCONFIGURED` | لا محقّق مُهيّأ → لا COMMIT ممكن |
| `COMMIT_VERIFICATION_BLOCKED` | دليل مفقود / mock / موقّع ذاتيًا / غير مربوط / من مفتاح غريب |
| `COMMIT_VERIFICATION_FAIL` | المحقّق سجّل DENY، أو السلسلة عُدِّلت |

مثبّت بالاختبارات في `tests/celia-workspace-commit-auth.test.js` ("verification gate: …")
عند حدود HTTP الحقيقية، مع التأكد أن الجذر والـstaging وسجل الأحداث لم تتغير عند كل رفض.
