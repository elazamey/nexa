# مراجعة المستودع — NEXA @ 085a9c7 — 2026-09-22

> **⚠️ هذه نسخة إعادة بناء (استعادة)، ليست الأصل المجمد.**
> التقرير الأصلي كُتب في جلسة `arena/01a0cabd-nexa` وبقي untracked ولم يُدفع أبدًا إلى GitHub،
> وفقد مع بيئة تلك الجلسة. هذه النسخة مُعادة الاشتقاق بالكامل من الكود في الـ commit
> `085a9c7898c9b8f19b59f33a4a298d67730a8a53` بتاريخ 2026-09-22، بقراءة مباشرة للملفات
> (الملفات هي مصدر الحقيقة). كل ادعاء هنا مسنَد إلى `ملف:سطر` قابل للتحقق.
> الأرقام المجمدة تاريخيًا من الجلسة المفقودة منقولة كما هي في §2 مع بيان قابلية التحقق.

---

## 0. بطاقة الهوية

| البند | القيمة |
|:---|:---|
| المستودع | `elazamey/nexa` |
| الـ commit المُراجَع | `085a9c7898c9b8f19b59f33a4a298d67730a8a53` (main — "Grand Synthesis & 2026 Zero-Cost Edge RAG") |
| فرع العمل | `arena/01a0cb16-nexa` |
| التاريخ | 2026-09-22 |
| المنهج | قراءة مباشرة للكود + تشغيلة أساس واحدة موثقة + اشتقاق فجوات → تذاكر |
| نطاق التركيز | خط الأنابيب الأمني `src/security/**` (Agentic Bug Hunter) — المنطقة التي تشير إليها تذاكر D1.x |

## 1. سياق الاستعادة (لماذا هذا التقرير نسخة ثانية)

الجلسة السابقة أنتجت: تقرير مراجعة + ملفات أدلة + `Detector_Independence_Assertions.md` +
`Artifact_Reader_Contract.md` (v0.3) + `self-model/gaps.json` + اختبارات فجوات وحراس — **كلها كانت untracked ولم تُرتبط بأي commit**،
لذا لم تنتقل إلى هذه البيئة (تحقق: شجرة عمل نظيفة عند 085a9c7، لا stash، لا كائنات معلّقة
في git، لا فرع `01a0cabd` على GitHub، ولا أي ملف مطابق في نظام الملفات).
القرار المعتمَد من المستخدم: استئناف المسار بأدوات كاملة مع ضمان عدم الكسر،
وإعادة بناء الطبقة المفقودة من الكود نفسه **موسومةً كإعادة بناء** — لا ادعاء بأنها الأصل.

**الدرس المؤسسي:** أي عمل غير مرتبط بـ commit في نهاية الجلسة يُفقد. من الآن: كل إنجاز
يُثبَّت بـ commit ثم push على فرع الجلسة فورًا.

## 2. خط الأساس المُتحقق مقابل الأرقام المجمدة

| الرقم | القيمة | الحالة |
|:---|:---|:---|
| اختبارات المجموعة الكاملة | **545 / 545 نجاح / 0 فشل** (node v22.22.3، ‏32.0 ثانية) | ✅ مُتحقق اليوم بالقياس (`npm test`) |
| probes (ادعاء الجلسة المفقودة) | 13 | ⚠️ مجمّد تاريخيًا؛ **غير قابل للتحقق الحرفي** — تعذّر تحديد مصدر العدّ في المستودع الحالي بيقين، ولا يُدَّعى تحققه |
| التوقع 557 للتشغيل الكامل القادم | 557 | ⛔ **ملغى** — كان يشمل اختبارات الجلسة المفقودة؛ يُستبدل بقياس فعلي بعد كل تذكرة (يُسجَّل في `self-model/baseline.json`) |

الأثر الجانبي للتشغيل: تعديل `dashboard/data/hunt-memory.json` — **استُعيد من HEAD** بعد
القياس (قاعدة ثابتة). القياس موثق في `self-model/baseline.json`.

## 3. جرد نطاق المراجعة

- `packages/` — 17 حزمة (parser، lexer، ast، runtime، policy، evidence، crypto، identity، protocol، capability، cell(s)، cellular-evolution، learning، evolution، compiler، cli)
- `tools/` — 45 أداة (bughunter، celia-*، omega-*، google-*، vectors، permission-probe/proof، dashboards)
- `src/security/` — خط الأنابيب الأمني: `agentic-hunter.js` + `hunter/` (14 وحدة)
- `tests/` — 51 ملف اختبار (بما فيها `agentic-hunter.test.js` الذي يغطي خط الأنابيب)
- `docs/evidence/` — أدلة مجمدة تاريخيًا (45 ملفًا) — **لا تُمس** (يحميها guard بقائمة hashes)
- `dashboard/data/` — مخرجات حية (`bug-report.json`, `hunt-memory.json`) — تُعدَّل بالتشغيل وتُستعاد

**نطاق هذه المراجعة:** خط الأنابيب الأمني فقط (من Recon إلى الإيصال المشفّر)، لأنه موضوع
تذاكر D1.x. بقية المستودع يعمل بمجموعته الخضراء (545/545) ولا يُلمس في هذه التذاكر.

## 4. مصادر الفشل A01–A13 (كلها مُسندة إلى الكود الحالي)

| الرمز | مصدر الفشل | الإسناد |
|:---|:---|:---|
| **A01** | شهادة ذاتية لنتيجة البوابات: `certifyFinding` يكتب `gateScore: '7/7_PASSED'` و `verified: true` حرفيًا دون أي تحقق — الإيصال يدّعي ما لم يجرِ | `src/security/hunter/nexa-evidence-bridge.js:46-47` |
| **A02** | بوابة بقرار ثابت: `GATE_7_SAFE_TESTING_COMPLIANCE` تكتب `pass: true` حرفيًا — لا تُحسب أبدًا | `src/security/hunter/seven-gate-validator.js:56` |
| **A03** | `GATE_2_REPRODUCIBILITY` إرشادية ضعيفة: تمر بمجرد وجود locator نصي (`endpoint \|\| file \|\| parameter`) دون أي دليل إعادة إنتاج | `src/security/hunter/seven-gate-validator.js:31` |
| **A04** | لا يوجد «قارئ artifacts» إطلاقًا: لا مكوّن يقرأ دليل الإعادة إنتاج ويتحقق منه؛ `GATE_4_POC_EVIDENCE` يمر بوصف نصي + تصنيف فقط | `seven-gate-validator.js:40` (غياب كامل للمكوّن) |
| **A05** | اقتران الكواشف بالمنسِّق: ثلاثة كواشف inline داخل `_inspectFile` تدفع نتائجها إلى حالة المنسِّق `this.findings` | `src/security/agentic-hunter.js:81-116` |
| **A06** | منطق كشف أعمى للنطاق: شرط `UNHANDLED_ASYNC_ERROR` يُقيَّم على `content` الملف كاملًا لا نطاق الدالة → كشف حقيقي يُفقَد بسبب `try` في دالة أخرى | `src/security/agentic-hunter.js:81` (وكذلك :104) |
| **A07** | إيصالات غير حتمية: `findingId` من `Date.now()`، والـ digest يُحقن فيه `timestamp` لحظي عند غيابه → نفس الـ finding ينتج معرفًا وdigest مختلفين | `src/security/hunter/nexa-evidence-bridge.js:33,40` |
| **A08** | توقيع غير مربوط بالحمولة: `verifyReceipt` يتحقق من التوقيع على digest مُقدَّم دون إعادة حسابه من الـ finding → إيصال «صالح» مع حمولة مستبدلة | `src/security/hunter/nexa-evidence-bridge.js:59-73` |
| **A09** | انهيار بوابتين في مسند واحد: `GATE_3` و `GATE_6` يحملان نفس الشرط الدلالي (severity ∈ {CRITICAL, HIGH, MEDIUM}) — «الأسئلة السبعة» فعليًا خمسة مساند | `src/security/hunter/seven-gate-validator.js:36,55-57` |
| **A10** | خلط الأصناف: `signFinding` يوقّع أي payload عام (بيانات إصدار مثلًا) بنفس ختم `7/7_PASSED` | `src/security/hunter/nexa-evidence-bridge.js:52-55` |
| **A11** | ذاكرة fail-open: `HuntMemory._load` يبتلع فساد JSON بصمت (`catch` فارغ) ويُرجع ذاكرة فارغة؛ و`save()` يبتلع أخطاء الكتابة | `src/security/hunter/hunt-memory.js:20-23,37-40` |
| **A12** | ثقة بسياق المتصل في قرار النطاق: `autopilot` يمرر `{ inScope: true }` حرفيًا، و`GATE_1` يعتمد سياق المتصل لا مصدرًا مستقلًا (بيانات recon) | `src/security/hunter/autopilot.js:55` + `seven-gate-validator.js:26` |
| **A13** | ادعاءات تقرير بلا تحقق: `bug-report.json` يُصدَّر ومعه إيصالات تدّعي 7/7 دائمًا و`verified: true` تسويقية | `src/security/agentic-hunter.js:119-125` |

**ملاحظة منهجية:** `tests/agentic-hunter.test.js` (سطر ~150) يؤكد حاليًا السلوك المعيب
نفسه (توقيع finding بلا artifact/bypass مع ختم 7/7_PASSED) — أي أن السلوك المعيب
**مُختبر ومطلوب** في الفرع الحالي. هذا الاختبار سيُحدَّث ضمن تذكرة D1.2 تحديثًا موثقًا،
لا صمتًا.

## 5. فهرس الفجوات (يُدار في `self-model/gaps.json`)

| الفجوة | العنوان | المصادر | الحالة عند إعادة البناء |
|:---|:---|:---|:---|
| **D1.1** | طبقة منهجية الجلسة (تقرير + assertions + عقد + gaps + حراس) | — (منهجية) | **enforced** عند إعادة البناء (الحراس أنفسهم) |
| **D1.2** | Artifact Reader + GATE_2 (§5.1) + certifyFinding (§6.1/§6.3) — **أول تذكرة src/** | A01, A03, A04, A07, A08, A10, A13(الجوهر) | **أُغلقت 2026-09-22**: أحمر موثق (`self-model/evidence/d1.2-red.tap`) ثم أخضر (`d1.2-green.tap`)؛ enforced في `gaps.json` بتحقق حي `tests/artifact-reader.test.js`؛ القياس الكامل بعدها 584/584 |
| **D1.3** | GATE_7 بقرار ثابت | A02 | مفتوحة |
| **D1.4** | انهيار GATE_3/GATE_6 في مسند واحد | A09 | مفتوحة |
| **D1.5** | اشتقاق قرار النطاق (GATE_1) من مصدر مستقل | A12 | مفتوحة |
| **D1.6** | HuntMemory fail-closed | A11 | مفتوحة |
| **D1.7** | فصل الكواشف inline عن المنسِّق | A05, A06 | مفتوحة |
| **D1.8** | اتساق bug-report مع الإيصالات الفعلية | A13 (المتبقي) | مفتوحة — محجوبة بـ D1.2 |

ترتيب العمل: **D1.2 أولًا** (هي التذكرة المتفق عليها: تُغلق باختبار انعكاس في `tests/`
خارج known-gaps، ثم `enforced:true` + `verification` + `closed_at` في نفس التغيير،
بعد إثبات الفشل قبل الإصلاح). ما بعدها بترتيب الفجوات أعلاه.

## 6. المجمَّد والمحمي (لا يُمس)

1. `docs/evidence/**` — 45 ملفًا بقائمة hashes مجمّدة داخل `tests/guards/evidence-frozen.test.js`؛ أي تعديل/إضافة/حذف يكسر الـ guard عمدًا.
2. الأرقام المجمدة (§2): 545 (مُتحقق)، 13 probe (غير قابل للتحقق — يُنقل كما هو ولا يُدَّعى)، 557 (ملغى).
3. اختبارات المجموعة الكاملة تبقى خضراء؛ التحديثات الوحيدة المسموح بها هي الموثقة داخل تذكرة (مثل تحديث كتلة certifyFinding في D1.2).
4. `dashboard/data/hunt-memory.json` يُستعاد من HEAD بعد كل تشغيل كامل.

## 7. قواعد الجلسة (مُفعَّلة بالحراس، لا بالتذكر)

1. لا تعديل على كود المنتج قبل فتح التذكرة صراحةً (D1.2 مفتوحة في commit مستقل يسبق كود التنفيذ).
2. اختبارات `tests/known-gaps/` نجاحها = إعادة إنتاج الفشل — لا تُحسب دليل سلامة، وتُزال عند إغلاق فجوتها في نفس تغيير الإغلاق.
3. `enforced:true` بلا `verification` في `tests/` خارج known-gaps = مرفوض (يُختبر آليًا في `tests/guards/gaps-consistency.test.js`).
4. فحص الصياغة السريع: `node --test tests/guards/*.test.js tests/known-gaps/*.test.js` (لا يُمرَّر مجلد مباشرة إلى `--test` على Node 22).
5. التشغيل الكامل فقط عند الحاجة، وبعده استعادة `hunt-memory.json` من HEAD، وتسجيل الرقم في `self-model/baseline.json`.

---
*نُقل هذا التقرير إلى الفرع `arena/01a0cb16-nexa` ضمن commit إعادة البناء. المراجع التعاقدية: `docs/Artifact_Reader_Contract.md` (v0.3-rebuild)، `docs/Detector_Independence_Assertions.md` (17 assertion).*

---

## ملحق O — نتائج حدود التشغيل (إضافة 2026-09-22، فرع `arena/01a0cb5b-nexa`)

> **طبيعة هذا الملحق:** إضافة (append-only) — لا تعديل على §§0–7 أعلاه ولا على
> الأرقام المجمدة. يوثق نتائج مراجعة الحدود التشغيلية (خارج خط الأنابيب الأمني):
> الخادم HTTP، عزل المخرجات، المزامنة التوثيقية، الـ CI. كل نتيجة مسندة إلى
> `ملف:سطر`، ومسجلة في `self-model/gaps.json` كتذاكر D1.9–D1.16 بعائلة مصادر
> جديدة `O01..O08` (الحرف O = operational، لتمييزها عن عائلة A الخاصة بخط الصيد).

### O1. سجل القرار: حالة النشر على Render (سؤال P0-3 الأول)

* `render.yaml` موجود (blueprint باسم `nexa-dashboard`، `autoDeploy: true`)، لكن
  **لا يوجد أي مرجع لمنشور فعلي** في المستودع (لا `onrender.com`، لا tags، لا URLs).
* فحص حي بتاريخ 2026-09-22 للـ URL الافتراضي `https://nexa-dashboard.onrender.com/`
  و`/api/celia/state` أعاد نص `Not Found` — وهو **ليس** رد خادم NEXA (الذي يخدم
  HTML في `/` وJSON في `/api/celia/state`)، بل رد موجّه المنصة لخدمة غير موجودة.
* **القرار:** الحالة = **غير منشور** على الـ URL الافتراضي. لا طوارئ نشر؛ الترتيب
  المعتمد (P0-A → P0-B → P0-C…) يبقى كما هو. إن رُبط الريبو بـ Render لاحقًا،
  فـ `autoDeploy: true` سينشر تلقائيًا — لذا تبقى P0-B مبكرة احترازيًا.

### O2. خريطة التغطية بالمصرّحات (سؤال P0-3 الثاني — من الكود مباشرة)

| المسار | الحماية الفعلية | الحكم |
|:---|:---|:---|
| `POST /api/v1/workspace/write` | `authorizeWorkspaceWrite` (توقيع/قدرة/سياسة، رفض افتراضي) `tools/celia-dashboard-server.mjs:1177` | ✅ مقفل |
| `POST /api/v1/workspace/commit` | `commitWorkspace` (هوية→قدرة→سياسة→منفذ) `:1216` | ✅ مقفل |
| `POST /api/v1/terminal/execute` | `approvalLedger.consume` — لكن الـ approval نفسه مفتوح (أدناه) | ⚠️ مفتوح عبر سلسلة |
| `POST /api/v1/authorizations/request` | لا شيء — يُسجَّل الطلب باسم `dashboardOperator.kid` لأي متصل `:1362` | ❌ مفتوح |
| `POST /api/v1/authorizations/{id}/approve` | `approverKid ?? dashboardOperator.kid` + فحص سلسلة نصية بلا توقيع (`packages/policy/src/approval.js:399-402`) | ❌ مفتوح — **لا يوجد `CELIA_TERMINAL_AUTH` أصلًا** |
| `POST /api/v1/workspace/rollback` | لا شيء سوى `workspaceId` `:1245` | ❌ مفتوح (تغيير حالة) |
| `POST /api/v1/workspace/create` | لا شيء سوى `taskId` `:1131` | ❌ مفتوح (إنشاء) |
| `POST /api/v1/missions/create` + `/run` | لا شيء `:1582` | ❌ مفتوح |

سلسلة التجاوز عن بُعد (بلا أي سر): `request` → `approve {}` (يُقبل كهوية المشغّل
افتراضيًا) → `terminal/execute` (تنفيذ حقيقي داخل الـ jail). التخفيفات الباقية
(jail + قائمة برامج + ربط الهدف) دفاع أخير، لا حدّ مصادقة.

**علة عقدية ملازمة (اكتُشفت أثناء كتابة مُعيد D1.10):** مسار
`authorizations/{id}/approve|deny|consume` يستخرج المعرف بـ `split('/')` خامًا
بلا `decodeURIComponent`، بينما الواجهة (`NexaDashboard.jsx:371,386,400`) ترمّز
المعرف دائمًا — فنداء الواجهة الحقيقي يفشل 400. لا اختبار HTTP يغطي `approve`
أصلًا. تُعالج ضمن إغلاق D1.10 (فك الترميز + تثبيت العقد raw/encoded باختبار).

### O3. سجل عملاء الخادم (سؤال P0-3 الثالث + بوابة ما قبل الـ strangler)

| العميل | النوع | الدليل |
|:---|:---|:---|
| Dashboard SPA | `fetch` نسبي (~30 موقعًا) | `dashboard/src/**/*.jsx` |
| اختبارات HTTP | تنسخ السيرفر إلى tmpdir وتشغّله كابن (env لا يرث الأسرار) | `tests/celia-workspace-auth-helpers.mjs` (`PORT: '0'`) |
| لا عملاء آخرون | `bughunter.mjs` و`autopilot.js` لا يخاطبان الخادم عبر HTTP إطلاقًا (لا `fetch` ولا `http.request` إليه) | بحث شامل في `src/` و`tools/` |

أي تغيير على المحيط (مصادقة/حد معدل) يجب أن يبقى مفتوحًا عند غياب الـ env حتى
لا ينكسر العميلان أعلاه — وهذا قيد تصميم P0-B، لا خيار.

### O4. مصادر التشغيل O01–O08

| الرمز | مصدر التشغيل | الإسناد |
|:---|:---|:---|
| **O01** | ملفات tracked تُعدَّل من التشغيل: `HuntMemory` الافتراضي + `bug-report.json` المتصلب + سكربت اختبار بلا عزل | `src/security/hunter/hunt-memory.js:9`، `src/security/agentic-hunter.js:143-149`، `package.json` |
| **O02** | محيط HTTP بلا مصادقة عامة: سلسلة request→approve→execute مفتوحة + rollback/create/missions بلا مصرّح | `tools/celia-dashboard-server.mjs:1131,1245,1357,1431,1582` + `packages/policy/src/approval.js:399-402` |
| **O03** | الإنتاج يعمل مع `mock://memory` بصمت بلا حارس بدء | `tools/celia-dashboard-server.mjs:104-105` |
| **O04** | ادعاءات أعداد متقادمة في ثلاثة أماكن (501 مقابل 545 مقابل 314) | `README.md:66,504,512`، `pub-verifier.sh:29`، `publish-v0.1.plan.json` |
| **O05** | متغيرات env بلا مرجع مركزي ولا `.env.example` | `CELIA_*`/`SUPABASE_*`/`PORT` مبعثرة في `tools/` |
| **O06** | توثيق بلا فهرس/مالك (30+ ملفًا) | غياب `docs/README.md` |
| **O07** | ازدواج ملفات بلا حارس مزامنة (7 نسخ edge-rag متطابقة + workspace.html مكرر + index.html متباينان) | `adapters/edge-rag/` مقابل `dashboard/public/` |
| **O08** | بناء الداشبورد غير مُختبر في PRs | `.github/workflows/ci.yml` بلا خطوة dashboard (فقط `deploy-pages.yml` على main) |

### O5. التذاكر التشغيلية (تُدار في `self-model/gaps.json`)

| الفجوة | المسار | الأولوية | المصدر | الحالة |
|:---|:---|:---|:---|:---|
| **D1.9** | P0-A عزل مخرجات الاختبار (bootstrap إلزامي) | high | O01 | مفتوحة |
| **D1.10** | P0-B مصادقة محيط + حد معدل (env-gated) | critical | O02 | مفتوحة |
| **D1.11** | P0-C حارس بدء الإنتاج (fail-fast مع mock) | high | O03 | مفتوحة |
| **D1.12** | P1-A مزامنة أعداد الاختبارات | medium | O04 | مفتوحة |
| **D1.13** | P1-B ملف `.env.example` | low | O05 | مفتوحة |
| **D1.14** | P1-C فهرس `docs/` | low | O06 | مفتوحة |
| **D1.15** | P1-D حارس الملفات المكررة | medium | O07 | مفتوحة |
| **D1.16** | P2 بناء الداشبورد في CI | medium | O08 | مفتوحة |

قواعد ملزمة لهذه التذاكر (نفس نمط D1.x): إغلاق = اختبار انعكاس في `tests/`
خارج known-gaps + `enforced:true` + `verification` + `closed_at` في التغيير نفسه؛
مُعيد الإنتاج يُزال في تغيير الإغلاق نفسه؛ أي حارس يُعدَّل يُوثَّق سبب تعديله هنا.
