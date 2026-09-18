# NEXA Ω∞ — الطبقة الخلوية (ملخّص عربي)

> **الخلية تُركِّب، ولا تُصرِّح.**
> في Ω v1 صارت السلطة والأدلة *قواعد في اللغة*؛ وفي Ω∞ صارتا *بنية*: وحدة التركيب هي الخلية،
> ولا شيء يُركَّب بالاستيراد. الطبقة تقف **فوق** أسس Ω ولا تهدم منها شيئًا.

خريطة الوثيقة الكاملة (بالإنجليزية): [`cellular.md`](cellular.md)

---

## 1. لماذا طبقة جديدة؟

أسس Ω تجيب عن سؤالين: «هل تُسمح هذه الدعوة؟» و«ما دليلها؟». أما «ما الشيء الذي يستدعي؟»
فلم تكن لها إجابة. الطبقة الخلوية تجيب بلا إضافة نوع جديد من السلطة:

- **الخلية** وحدة التركيب: هوية، نواة، غشاء، مستقبلات، منافذ، ذاكرة محلية، قدرات، سياسة،
  ميزانية، صحة، دورة حياة، أدلة، إصدار؛
- **التركيب متكرّر**: خلية → نسيج → عضو → كائن حي، والعضو يُستخدم كخلية في المستوى الأعلى؛
- **لا خلية تحمل سلطة**: تحمل منفذًا يتحقق ويُسجّل، ولا يصدر قدرات أبدًا.

## 2. تشريح الخلية (بالمقابل في الشيفرة)

| الجزء | المعنى | الملف |
| --- | --- | --- |
| الهوية | زوج مفاتيح NEXA-ID يُنشئه المضيف، لا الخلية | `packages/identity` |
| النواة | `{ module, invariants }` مجمّدة لا تكتب فيها الدوال | `packages/cell/src/cell.js` |
| الغشاء | سبع خطوات مرتّبة، لا مدخل غيرها | `packages/cell/src/membrane.js` |
| المستقبلات | نقاط دخول معلنة مع `accepts` و`requires` | `createCell({receptors})` |
| المنافذ | `{ verify, record }` — تحقّق وتسجيل، لا إصدار | `packages/cell/src/tissue.js` |
| الذاكرة المحلية | بصمات ومراجع، لا قيم | `createCell({memory})` |
| القدرات | يقدّمها العارض؛ الخلية تُقترح فقط | `packages/cell/src/guarantor.js` |
| الميزانية | `max_payload_bytes` · `max_calls` · `max_failures` | `membrane.js` · `health.js` |
| الصحة | أعداد صحيحة + قاطع الدائرة الموجود في زمن التشغيل | `packages/cell/src/health.js` |
| دورة الحياة | ست حالات ومجموعة انتقالات مغلقة | `packages/cell/src/lifecycle.js` |
| الأدلة | كل عبور: سجل في سجل Ω | `guarantor.record()` |

## 3. مسار الرسالة (سبع خطوات، هذا ترتيبها وليس اقتراحًا)

```text
Cell A → Membrane → Identity → Capability → Type/Schema → Policy → Budget → Execution → Evidence → Cell B
```

| الخطوة | الرفض |
| --- | --- |
| identity | `OMEGA_E_MEMBRANE` · `OMEGA_E_IDENTITY` · `OMEGA_E_RECEPTOR` · `OMEGA_E_ISOLATED` |
| capability | `OMEGA_E_CAP_MISSING` · `NEXA_E_CAP_AUDIENCE` · `NEXA_E_SIG` · `NEXA_E_UNTRUSTED` · `NEXA_E_REPLAY` |
| type | `OMEGA_E_SCHEMA` |
| policy | `OMEGA_E_POLICY` |
| budget | `OMEGA_E_BUDGET` |
| execution | رمز الاستثناء أو `OMEGA_E_HANDLER` |
| evidence | — (سجل `CELL_MESSAGE`) |

قاعدتان لا تُخالفان: **الرفض يُسجَّل دائمًا** (الغشاء يسجّل رفضه بنفسه)، و**الحمولة لا تدخل
السجل** — يُسجَّل `payload_digest` فقط.

## 4. السلطة: `Cell → Proposal → Authority → Policy → Execution`

- لا `issue` ولا `mint` داخل الخلية، بل `propose()` الذي يُنتج اقتراحًا خاملًا لا يحمل رمزًا؛
- **الضامن (Guarantor)** صلة النسيج بالسلطة، والنسيج يحتفظ به ولا يسلّمه لأي خلية؛
- **المسارات تُعلن قبل الحركة**: المجموعة تُختم عند أول إصدار، وإضافة مسار لاحقًا
  `OMEGA_E_ROUTE`؛
- **دعوة واحدة = قدرة واحدة**: إعادة التقديم `NEXA_E_REPLAY`، وقديمة غريب `NEXA_E_CAP_AUDIENCE`،
  ومزوّرة `NEXA_E_UNTRUSTED` (التحقق يفشل مغلقًا).

## 5. النسيج والعضو والكائن

- **النسيج = خلايا + عقد**، والعقد هو مجموعة التصاريح نفسها: ما لا يذكره لا توجد قدرة تسير
  عليه. نقاط الدخول تُنتج **خلية مركّبة** تمثّل النسيج (`tissue.asCell()`).
- **العضو = أنسجة + عقد عابر للأنسجة**، وبسلطة واحدة (`OMEGA_E_CELL_AMPLIFY` لغير ذلك)، والعضو
  نفسه خلية (`organ.asCell()`).
- **الكائن الحي = أعضاء + عقد عابر للأعضاء + توازن داخلي**، ويقرأ النظام:
  `organism.sample()` · `react()` · `recover(check)` · `contract()`.

مثال مبني في المستودع: النسيج البرمجي `Planner → Coder → Tester → Reviewer → Evidence`،
ونسيج الذاكرة، ونسيج الأمن، وثلاثة أعضاء، وكائن حي واحد.

## 6. دورة الحياة والتوازن الداخلي

```text
DEFINED → READY → ACTIVE ⇄ DEGRADED → ISOLATED → READY → ACTIVE
الكل → RETIRED (نهائية)
```

- `DEGRADED` **تخدم**: حالة تحذير؛ `ISOLATED` هي التي توقف الحركة ولا تستثني إلا الدعم
  الحياتي (`health`, `recover`, `retire`)؛
- **الاسترجاع قرار لا مؤقّت**: لا عودة إلى `ACTIVE` إلا بفحص تحقّق ناجح؛ والخلية المتقاعدة لا
  تُستَرجع؛
- القاطع (Circuit Breaker) هو آلية الاحتواء نفسها في زمن التشغيل — لا آلية موازية —
  والعتبات: ٣ إخفاقات متتالية أو `4000` نقطة أساس (٤٠٪) بعد ٣ استدعاءات.

## 7. التعلّم الخلوي

```text
خلية ترصد → تعلّم محلي → فرضية → نشر الدليل → النسيج يُجمّع → العضو يرى النمط → الكائن يتعلّم
```

ثم دون استثناء:

```text
Learning → Reflection → Proposal → Simulation → Attack → Verification → Benchmark → Canary → Activation
```

- `learner.apply()` يرمي `OMEGA_E_LEARNER_AUTHORITY`: **اقتراح لا تطبيق**؛
- كل فرضية تحمل أدلتها، والترقية بلا دليل `OMEGA_E_UNPROVEN`؛
- كل اقتراح يحمل `baseline` و`expected_change` و`confidence_bp` وبواباته المطلوبة؛
- الأدلة المتعارضة **تُبطل** المعرفة: `OMEGA_E_KNOWLEDGE_INVALIDATED` · `OMEGA_E_EPISTEMIC`.

## 8. الانقسام والاندماج

- **الانقسام**: تعميم → تخصيص، وكل ابنة تأخذ ما تحتاجه فقط؛ قدرة لم تكن للأم
  = `OMEGA_E_CELL_AMPLIFY`.
- **الاندماج** لا يُلغي طرفًا:
  `Compatibility → Contract → Capability Analysis → State Migration → Sandbox →
  Security Tests → Benchmark → Canary → إصدار جديد غير قابل للتعديل`، والنتيجة تسمّي أبويها.
- تعارض اسم مستقبِل = حجر لا دمج؛ وحكم بوابة غير ناجح = `OMEGA_E_QUARANTINED`.
- **الحجر نهائي**: `Quarantine.release()` يرمي `OMEGA_E_QUARANTINED` دائمًا؛ يُستبدل المرشح
  بإصدار أحدث (`supersede`) ولا يُحرَّر.

## 9. الأدلة

كل عبور = سجل `CELL_MESSAGE` واحد في سجل Ω، موقّع ومُجزّأ، والحمولة ببصمتها فقط:

```js
{ kind: 'CELL_MESSAGE', decision: 'ALLOW'|'DENY', mission: '<cell>', resource: '<cell>',
  action: '<receptor>', capability: '<grant id>',
  detail: { from, step, code, reason, latency_ms, bytes, payload_digest } }
```

وبلا سجل، تبقى مجلة الضامن في الذاكرة مجزّأة وبالشكل نفسه، فتقرأ طبقة التعلّم الحقول ذاتها
في الحالتين.

## 10. الشكل الفعلي مقابل المخطّط

المخطّط اقترح `packages/{cell/{nucleus,membrane,receptor,ports,lifecycle,health,metabolism},
tissue/{topology,routing,contracts}, organ/{coordinator,registry,contracts},
organism/{orchestration,system-state,homeostasis}}`. المنفَّذ هو `packages/cell` (وفيه النواة
والغشاء والمنافذ ودورة الحياة والصحة والضمان والنسيج والعضو والكائن والتوازن الداخلي)
و`packages/cellular-evolution` (انقسام · اندماج · حجر).

والفرق مقصود ومبرَّر في [`cellular.md`](cellular.md) §14 بأربعة أسباب: المستقبل والمنفذ ليسا
كيانين بل وصفان للبيانات؛ والنسيج والعضو والكائن تشترك في ضامن واحد فتُقرأ السلطة في مكان
واحد؛ و«الأيض» هو الميزانية + التوازن الداخلي ولا شيء خاص به. أما الحدّ الحقيقي بين الحزمتين
فهو بين *التركيب* (`packages/cell`) و*التغيير* (`packages/cellular-evolution`).

## 11. ما لم يُبنَ بعد (بوضوح)

- **لا نقل شبكي بين الخلايا**: الخلية كائن داخل العملية، وجسر MCP بين الخلايا مُصمَّم لا منفَّذ.
- **لا تخزين دائم**: بوابة `FILESYSTEM_WRITE` مغلقة، والطبقة الخلوية لا تفتحها؛ الذاكرة المحلية
  بصمات في الذاكرة.
- **لا خلايا خدمات Google**: الهوية عبر Google/Firebase وDrive وSheets وGmail وCalendar
  وGemini (مراحل G0–G4) مُصمَّمة ولم تُنفَّذ بعد، ولا شيء في هذه الطبقة يلمس الشبكة.
- **لا إصلاح ذاتي تلقائي**: التوازن الداخلي يرصد ويعزل ويبلّغ، والإصلاح اقتراح يمرّ بالبوابة.

## 12. المقيس الآن (وليس المُدَّعى)

| المقياس | القيمة |
| --- | --- |
| هجمات المجموعة العدائية | 23 هجومًا في 11 فئة — كلها محجوبة |
| منها هجمات على الطبقة الخلوية | 10 |
| اختبارات الطبقة الخلوية | 26 (`tests/cellular.test.js`) |
| اختبارات المشروع كاملة | 207 |
| رموز الأخطاء المسجّلة | 72 |
| خطوات الغشاء | 7 |
| حالات دورة حياة الخلية | 6 |
| أدوات تشغيل مطلوبة | صفر |

الأوامر: `npm run demo:cellular` · `npm run attacks` · `npm run vectors` · `npm run verify`.

## 13. القاعدة التي تحكم الطبقة

```text
لا خلية تصدر قدرة.
لا نسيج يوسّع عقده بعد أول دعوة.
لا اندماج يمحو أصلًا.
لا حجر يُحرَّر.
لا تعلّم يُطبَّق.
```
