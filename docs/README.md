# فهرس التوثيق (D1.14 / O06)

لا وثيقة في `docs/` تُلقى بلا صفّ هنا. الفهرس يقول ثلاثة أشياء فقط: ما غرض الملف، أي صنف هو،
وأين يُراجَع. **ولا حذف**: من استُبدلت وثيقة تُنقل إلى `docs/archive/` ويُحدَّث صفّها إلى
`مؤرشفة` مع المسار الجديد — فالحذف يمسح الدليل، والأرشفة تتركه قابلًا للمراجعة.

الحارس: `tests/docs-index-sync.test.js` — يقطع عند وثيقة جديدة بلا صفّ، وعند صفّ لا ملف له،
وعند صنف غير معلَن، وعند أرشفة بلا مسار تحت `docs/archive/`.

## الأصناف ومعناها

| الصنف | معناه | كيف تُقرأ أرقامه |
|:---|:---|:---|
| **سارية** | تصف السلوك الحالي؛ يجب أن تُحدَّث مع الكود في نفس التغيير | ما يُقرأ منها حالةً؛ لكن الأرقام تُقاس لا تُنسخ (`npm run metrics`) |
| **سجلّ** | دليل إغلاق/أحمر-أخضر/مراجعة مؤرَّخ؛ **append-only** لا يُعاد كتابته | قياس لحظة تسجيله، لا حالة اليوم |
| **تخطيط** | خطة/مصفوفة/Backlog لحظة كتابتها | الحالة الحيّة في `self-model/gaps.json`، لا هنا |
| **تصميم** | رؤية معمارية؛ لا تدّعي تنفيذًا | لا تُقرأ حالةً إطلاقًا |
| **مؤرشفة** | استُبدلت؛ بقيت للمراجعة مع إشارة إلى البديل | تاريخية بالضرورة |

## الفهرس

| الوثيقة | الغرض | الصنف | المرجع / ما يُبقيها صادقة |
|:---|:---|:---|:---|
| `Artifact_Reader_Contract.md` | عقد قارئ الـ artifact: ما الذي يجعل الدليل دليلاً (kind/locator/evidence وتجريد حقول الحكم الذاتي) | سارية | `tests/artifact-reader.test.js` (16) |
| `Detector_Independence_Assertions.md` | 17 assertion لاستقلالية الكواشف، لكلٍّ منها حالة وسطر مصدر | سارية | `tests/guards/docs-consistency.test.js` + `tests/guards/gaps-consistency.test.js` |
| `environment-reference.md` | مرجع متغيرات البيئة: كل قراءة `process.env` مع قارئها وافتراضها وأثرها وصنفها | سارية | `tests/env-reference-sync.test.js` (6) |
| `protocol-surface.md` | مواصفة سطح البروتوكول و invariants السلسلة S على `packages/*` | سارية | `tests/protocol.test.js` + `npm run posture` (NEXA_METRIC) |
| `agentic-bug-hunter.md` | خط أنابيب الصياد الذاتي: استطلاع → كشف → بوابات → شهادة → تقرير | سارية | `tests/detector-independence.test.js`, `tests/bug-report-consistency.test.js`, `tests/gates-computed.test.js` |
| `celia-workspace-commit-contract.ar.md` | عقد COMMIT v1 واستقلاله عن WRITE (الحجز، الترميز، الاستهلاك) | سارية | `tests/celia-workspace-commit-auth.test.js` (19) + `tests/celia-workspace-commit-http.test.js` |
| `mesh-architecture.md` | المخطط المعماري للشبكة (مشغّل نماذج محلية، MCP/A2A، حوكمة) — 2026-09 | تصميم | بلا حارس — رؤية معمارية لا حالة تنفيذ |
| `mesh-architecture.ar.md` | النسخة العربية من المخطط المعماري نفسه — 2026-09 | تصميم | بلا حارس — رؤية معمارية لا حالة تنفيذ |
| `grand-synthesis-manifesto.ar.md` | مانيفستو الائتلاف الأعظم (توحيد الرؤى تحت النواة المشفَّرة) — 2026-09-22، وادّعاء «100% PASS» وقتها | سجلّ | تاريخي؛ لا يُقرأ حالة |
| `grand-synthesis-manifesto.en.md` | النسخة الإنجليزية من المانيفستو — 2026-09-22 | سجلّ | تاريخي؛ لا يُقرأ حالة |
| `repository-audit-2026-09-22.ar.md` | مراجعة المستودع @ `085a9c7` بتاريخ 2026-09-22: §§0–7 مُجمَّدة، و O-series append-only (O8…O17 سجلّات الإغلاق) | سجلّ | الحارس يربط كل §O بما في `self-model/gaps.json` |
| `celia-workspace-red-test.ar.md` | أول اختبار تكامل أحمر لتفويض الكتابة — 2026-09-20 | سجلّ | دليل RED مؤرَّخ |
| `celia-workspace-write-authorization.ar.md` | إصلاح WRITE المحدود ودليله RED → GREEN (نتيجة 331/331 وقتها) — 2026-09-20 | سجلّ | أرقامه قياس تلك الجولة |
| `celia-workspace-write-recheck.ar.md` | إعادة إثبات الرفض الافتراضي والتفويض القائم بعد الإصلاح — 2026-09-20 | سجلّ | أدلته في `docs/evidence/workspace-write-recheck-2026-09-20/` |
| `celia-workspace-commit-red.ar.md` | دليل RED مستقل لسطح COMMIT — 2026-09-21 | سجلّ | سابق على الإصلاح؛ لا يُقرأ حالة |
| `celia-workspace-commit-green.ar.md` | دليل الإصلاح المحدود RED → GREEN لـ COMMIT — 2026-09-21 | سجلّ | قياس جولة الإغلاق تلك |
| `celia-workspace-commit-hardening-red.ar.md` | أدلة H1/H2/H3 قبل التسريد النهائي — 2026-09-21 | سجلّ | قياس ما قبل الإصلاح |
| `celia-workspace-commit-h1-persistence.ar.md` | حزمة H1-PERSISTENCE: عقد التخزين وحدوده — 2026-09-21 | سجلّ | يصف العقد الذي تبنّاه `tools/celia-startup-guard.mjs` |
| `celia-system.ar.md` | النظام الاستشاري الموحَّد كما قيس عند تسجيله (415 اختبارًا، 2 معلَّمة معروفة) — 2026-09 | سجلّ | الأرقام لحظة التسجيل؛ الحيّ في `self-model/baseline.json` |
| `celia-adaptive-learning.ar.md` | تعلّم ترتيب خطط الإصلاح (18 اختبارًا جديدًا وقتها) — 2026-09 | سجلّ | تاريخي؛ الحيّ منه في `self-model/gaps.json` |
| `celia-research-skills.ar.md` | مكتبة الأبحاث والمهارات الاستشارية (52/52 و428 اختبارًا وقتها) — 2026-09 | سجلّ | تاريخي؛ ويُقيَّد بدخول المراجع في `tests/celia-library.test.js` |
| `nexa-capability-matrix.ar.md` | مصفوفة البنود الـ200 كما صُنِّفت — 2026-09-20 | تخطيط | الحالة الحيّة في `self-model/gaps.json` |
| `nexa-capability-matrix.csv` | البيانات المصفوفة نفسها (A001–B100 مع أكواد الحالة والمسارات) — 2026-09-20 | تخطيط | تُراجَع قبل أي توسيع كشف؛ لا تُقرأ حالة |
| `nexa-capability-expansion-plan.ar.md` | خطة الفجوات والتوسعة: مراجعة المستودع وخطة تنفيذ فقط، لا تفويض — 2026-09-20 | تخطيط | مُنفَّذُها مُسجَّل في `self-model/gaps.json` |
| `nexa-execution-plan.ar.md` | حزم الاستكمال الجاهزة للبدء المنضبط (415 اختبارًا و2 FAIL وقتها) — 2026-09 | تخطيط | تاريخي؛ حالته في `self-model/gaps.json` |
| `nexa-execution-backlog.csv` | Backlog الحزم (P00… مع بوابة القبول والتراجع) — 2026-09 | تخطيط | لا يُنفَّذ منه شيء بلا تذكرة في `self-model/gaps.json` |
| `nexa-execution-map.csv` | خريطة التنفيذ بمساراتها وأصحابها — 2026-09 | تخطيط | حالة كل بند في `self-model/gaps.json`، لا هنا |
| `nexa-remaining-phases-and-h2.ar.md` | «المتبقي» بعد تثبيت الأساس ونتيجة H2 (قرار عام: HOLD، لا نشر ولا دمج) — 2026-09-20 | سجلّ | مُستبدَل بسلسلة D1؛ يبقى قرار HOLD مسجَّلًا |
| `project-status-and-roadmap.ar.md` | مخطط الإنجاز وخطة التطوير كما كان — 2026-09 | سجلّ | تاريخي؛ تُبدَّل به `self-model/gaps.json` |
| `evidence/` | أدلة مرفقة بالوثائق: `celia-library` و`celia-library-*.json`، و`h2-atomicity` مع `SHA256SUMS`، و`workspace-write-recheck-2026-09-20` — 2026-09 | سجلّ | append-only: لا تُعاد كتابتها؛ كل دليل جديد يُضاف مع الوثيقة التي يستند إليها |

## ما لا يفعله هذا الفهرس

- لا يُصدّق أرقامًا: عدد الاختبارات الحيّ يُقاس في `self-model/baseline.json` (`live_measurement`)
  وتطابقه `README.md`/`SECURITY.md` بحارس `tests/count-claims-sync.test.js` — لا بنسخ رقم هنا.
- لا يُلخِّص الحالة: التذاكر وأحكامها (`enforced:true` أم لا) في `self-model/gaps.json`.
- لا يحكم على جودة الوثائق المسجَّلة: صنف «سجلّ» يعني أنها صحيحة لوقتها، لا أنها توصية حالية.
