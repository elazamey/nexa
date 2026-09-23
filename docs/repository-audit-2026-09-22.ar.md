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

---

### O6. سجل إغلاق D1.10 (P0-B) — أربع طبقات على حدود الخادم (2026-09-23)

جدول O5 أعلاه **لقطة تسجيل** لا لوحة حالة؛ الفهرس الحي هو `self-model/gaps.json`.
لذلك لم تُعدَّل خلايا «الحالة» في O5 (ملحق append-only، و§§0–7 خارج النطاق)،
ولا يُعَدّ ذلك فجوة موثقة معلّقة: كل صف يُقارن بـ `ticket_status` في الفهرس.

**ما أُغلق** — سلسلة O02 كانت مفتوحة من طرفين في آن: لا هوية على النقل، ولا قرار
موقَّع في الموافقة. الفاصل بينهما هو ما منع الخلط:

| # | الطبقة | التنفيذ | الاختبار |
|:--|:--|:--|:--|
| 1 | هوية المحيط + جلسة SPA + CSRF | `tools/celia-perimeter-auth.mjs` | `tests/server-perimeter.test.js` (9) |
| 2 | حد معدل (نافذة ثابتة) | `tools/celia-rate-limit.mjs` | `tests/server-rate-limit.test.js` (7) |
| 3 | fail-fast إنتاجي + عقد Render | `tools/celia-startup-guard.mjs` + `render.yaml` | `tests/server-production-failfast.test.js` (6) |
| 4 | عقد قرار الموافقة | `tools/celia-approval-http.mjs` + `tools/celia-operator.mjs` | `tests/server-approval-contract.test.js` (6) |

**القرارات الحدودية الستة** (المسجَّلة هنا لأنها ما يجعل الإغلاق قابلًا للمراجعة):

1. **حدود الجلسة**: `login → session id → Set-Cookie → middleware → req.nexaIdentity`.
   الكوكي `HttpOnly; SameSite=Strict; Path=/` و`Secure` تحت `NODE_ENV=production`
   أو `x-forwarded-proto=https`. لا سر قابل للوصول من JavaScript: المفتاح يُرسَل
   مرة واحدة فقط، ولا استجابة (ولا HTML) تعيده. الجلسات مخزَّنة كبصمات sha256 بسقف
   و TTL، لا كرموز خام.
2. **CSRF**: `HttpOnly` ليس دفاع CSRF. كل `POST/PUT/PATCH/DELETE` بمصادقة كوكي
   يستلزم إعادة رمـز `x-nexa-csrf` (double-submit؛ الرمز في كوكي مقروء للصفحة).
   عميل الترويسة (المفتاح) معفى من فحص CSRF وحده، لا من الجدار. الواجهة تركّب
   الرفيق في موضع واحد بدل 18 موضع استدعاء حتى لا يُنسى في أحدها.
3. **حدود مفتاح المشغّل**: `Authorization: Bearer` أو `X-Nexa-Api-Key` فقط؛
   المفتاح في query string مرفوض أصلًا (لا referer/سجل/history)، والمقارنة
   sha256 ثم `timingSafeEqual` (زمن ثابت، لا وحي طول). لا `.env.example` هنا
   (تذكرة D1.13)، ولا المفتاح في حزمة أمامية أو إعدادها.
4. **حدود التفويض**: الترتيب تعاقدي —
   `Authentication → Rate Limit → Authorization/CSRF → Policy → Approval → Execution`.
   `authenticated ≠ authorized` و`approved ≠ authenticated`: لا مسار يقرأ وجود
   الهوية كتفويض، ولا توقيع يشتري هوية. الدفتر (`packages/policy`) يبقى جذر ثقة
   الموافقة؛ الطبقات الأربع لا تقرر شيئًا بدلًا منه.
5. **عقد الموافقة**: `approve`/`deny` يستلزمان `approverKid` مصرَّحًا و`scope`
   مصرَّحًا وتوقيعًا على `nexa:approval-decision:v1\n` + `canonicalBytes` لكل
   الحقول؛ `consume` يفك الترميز فقط؛ `/sign` يوقّع ولا يمس الدفتر. الانعكاس
   مُثبَّت: `approve {}` = 400 `NEXA_E_SCHEMA`، توقيع مفقود/موسَّع = 400
   `NEXA_E_SIG`، kid أجنبي بتوقيع صحيح = 400 `NEXA_E_UNTRUSTED`، معرف مرمَّز صالح
   = 200، ترميز مشوّه = 400.
6. **الحد كدفاع لا كتفويض**: 429 مع `Retry-After` بعد المصادقة وقبل التنفيذ، مفتاح
   الدلو قابل للضبط (`identity|ip|forwarded`) لأن عنوان الـ peer خلف proxy إجابة
   خاطئة في الاتجاهين؛ `/healthz` والمسارات الساكنة خارج الحد (probe مقفول =
   إعادة تدوير خدمة سليمة). لا اعتمادية جديدة، ولا اعتماد عليه لتأمين
   `terminal/execute` — واختبار يثبّت أن الرفض تحت الميزانية يأتي من العقد لا من
   الحد.

**بوابة الإغلاق** (نجاح 622/622 وحده لا يُغلق شيئًا):

- `npm test` 622/622، `npm run verify` أخضر، `git status` نظيف بلا استعادة يدوية.
- أحمر قبل الإصلاح ثم أخضر بعده: `self-model/evidence/d1.10-red.tap`
  (5/6 فشل — `approve {}` يعيد 200، `/sign` غير موجود، و`NEXA_E_APPROVAL_MISSING`
  بدل فك الترميز) مقابل `d1.10-green.tap` (6/6). الاختبار الوحيد الأخضر في
  الأحمر هو اختبار الوحدة للنقي الجديد — طبيعي: الحارس كان غائبًا.
- إزالة كل حاجز تُثبت فعاليتها: تعطيل الجدار ⇒ 4 من 9 حمراء؛ تعطيل الحد ⇒ 4 من 7؛
  تعطيل الحارس ⇒ 2 من 6. لا اختبار «زخرف».
- `production` بلا مفتاح (أو فارغ/مسافات) = exit 1 قبل `listen`؛ بمفتاح خاطئ/مفقود
  = 401؛ الإغراق = 429؛ `request → approve {} → terminal/execute` = **قرار DENY**
  مسجَّل في `/api/v1/timeline` كـ `AUTHORIZATION_RESULT`، لا 401 مخبَّأ خلف الجدار.
- بلا مفتاح (local/dev/test): كل اختبارات HTTP السابقة خضراء بلا تعديل، ومُعيد
  D1.11 بقي أخضر المتوقَّع (إنتاج + mock يقلع ويخدم) بعد تمرير مفتاح تجريبي له.
- النواة سليمة: لا سطر تغيَّر في `packages/{protocol,capability,policy,crypto,
  evidence}` ولا في الـ vectors؛ عقد الموافقة أُصلح في السيرفر. الإصلاحات أربع
  commits منفصلة قابلة للعكس، وكل طبقة «hook مضاف» لا تفكيك لـ
  `celia-dashboard-server.mjs`.

**ما لم يُفعَل عمدًا**: تفكيك `celia-dashboard-server.mjs` وتعريف الـ API العام
يبقيان بوابةً قبل Phase 1 (انظر O3)؛ `creative/approve` خارج النطاق؛ سياسة أصل
CORS لم تُمَس (`*` + same-origin عبر البروكسي، والكوكيز المقرونة بـ`*` ترفضها
المتصفحات أصلًا)؛ حد حجم الجسم لمواضع `req.on('data')` القديمة والـ fingerprint
المتاح في `/api/v1/authorizations/stats` مُسجَّلان كمتابعة في `gaps.json` تحت
D1.10 (`follow_ups`)؛ ودوران `NEXA_OPERATOR_SEED` تحذير عند الإقلاع لا فشل —
لأن البذرة المعلنة تجعل kid قابلًا للاشتقاق لأي مستنسخ، وهي مسؤولية المشغّل لا
هذه التذكرة.

---

### O7. سجل إغلاق D1.11 (P0-C) — منع ادعاء الاستمرارية الكاذب (2026-09-23)

**العقد المُغلق** ليس «mock://memory غير مرغوب»، بل:

```text
NODE_ENV=production ∧ NEXA persistence = mock://memory ∧ startup
  → NON-ZERO EXIT  ∧  NO LISTEN  ∧  رمز محدد (NEXA_E_PERSISTENCE_MOCK)
```

بالمقابل: `development + mock` يقلع كما كان حرفيًا، و`production + خلفية حقيقية`
يحفظ العقد ويقلع بلا أي علامة.

**الحارس يقرر من حكم البورت، لا من شكل الإعداد.** في هذه الشجرة
`tools/celia-vector-port.mjs:272-281` يُرجع `{createClient:null}` دائمًا، فأي
`SUPABASE_URL` «حقيقي» يسقط بصمت إلى mock. حارسٌ يفحص النص كان سيُصدق نشرًا
يكتب كل شيء في عملية ستُقتل عند أول إعادة تشغيل — أي انه يغطي الادعاء بدل أن
يمنعه. لذلك الترتيب: ما يقرره البورت (`_isMock`) حجة، وما ادعاه الإعداد يُستخدم
لتسمية السبب فقط (`unconfigured | mock-url | no-driver`)، وما يعلنه الإنتاج قرار
حتمي.

**لا listen — مُثبَت بطريقتين مستقلتين** (لأن «خرج بعد أن خدم» لا يشفي شيئًا):
غياب رسالة `{type:'ready'}` من ناقل الإقلاع (تُرسل من داخل `listen()` نفسها)،
واستطراق TCP متواصل لمنفذ محجوز مسبقًا طوال عمر العملية: صفر اتصال ناجح، ثم
قابلية ربط نفس المنفذ بعد الخروج. الاختبار الأحمر أثبت العكس قبل الإصلاح:
`listened: true` و«المنفذ قُبل أثناء حياة العملية».

**المخرج الوحيد إقرار صريح بحرفه**: `NEXA_PRODUCTION_PERSISTENCE=ack-mock-ephemeral`
— وليس مفتاح إيقاف:
- حارس المحيط (D1.10): تقديم مسارات مُغيِّرة بلا مصادقة *غير آمن*، ولا جملة مشغّل
  تجعله آمنًا ⇒ لا override إطلاقًا.
- حارس الاستمرارية (D1.11): التشغيل بحالة مؤقتة *ليس ادعاءً* ما دام أحد لا يقول
  «دائم» ⇒ الإقرار مسموح، لكنه مطبوع تحذيرًا عند الإقلاع، و`/api/v1/system/status`
  يظل يصرّح `memory: DEMO`، وأي قيمة أخرى (`1`، `yes`، فارغة، بأحرف كبيرة، أو
  بمسافة ذيل) ليست إقرارًا — غياب القرار ليس قرارًا، نفس البديهية التي أغلقت
  `approve({})`.

**ما لم يُمَس عمدًا** (نطاق التذكرة حرفيًا): لا Supabase refactor، لا تنفيذ تخزين
دائم، لا Render migration (عقد `render.yaml` وُثِّق وأُضيفت متغيرات الاستمرارية
`sync: false` دون أي سر في git)، لا تفكيك لـ`celia-dashboard-server.mjs`، ولا سطر
في النواة. مُعيد known-gaps حُذف في نفس التغيير بعد أن صار مضمونه معكوسًا
(«إنتاج + mock يقلع»)؛ ومنطوق الحارس يبدأ بالرمز قبل السرد ليكون قابلًا للتفتيش
في CI (`[nexa] NEXA_E_…: startup refused`).

**متابعات مسجلة في `gaps.json` تحت D1.11** (لا تُغلق بالخطأ): `CELIA_COMMIT_STATE_DIR`
قد يشير إلى مسار مؤقت في الإنتاج — نفس فئة الادعاء؛ و`NexaGovernedMemoryEngine`
والمهمات وأحداث event-sourcing في الذاكرة وحدها، فإما خلفية دائمة أو لافتة DEMO
مطردة.

**بوابة الإغلاق**: `npm test` أخضر، `npm run verify` أخضر، `git diff --check` نظيف،
`git status` نظيف؛ أحمر→أخضر في `self-model/evidence/d1.11-red.tap` (7 فشل من 8)
مقابل `d1.11-green.tap` (8/8)؛ وتعطيل الحارس وحده يقلب اختباري الإقلاع (3 و4)
إلى أحمر.

### O8. سجل إغلاق D1.12 (P1-A / O04) — الأعداد تُقاس، ولا تُروى (2026-09-23)

**ما ظنّه التقرير «أرقامًا نسيها أحد» تبيّن، عند القراءة من الكود الحالي، أنه ختمٌ بعدد
لم يُقرأ.** النص القديم ذكر ثلاثة أرقام متقادمة (`README.md:66,504,512` مقابل
`pub-verifier.sh:29` مقابل `publish-v0.1.plan.json`)؛ الفحص الحالي أظهر أن الأرقام كانت
العَرَض، وأن الداء في السطر نفسه — وفي رسالة النجاح التي تليه:

```bash
if npm test 2>&1 | tail -30 | grep -q "314" || npm test 2>&1 | grep -q "pass"; then
```

بوابة النشر تُطبِق `set -o pipefail`، فمقياسها الحقيقي للون لم يكن العدد بل رمز خروج
`npm test`؛ أما العدد المطبوع فهو نصّ ثابت: مع مجموعة مُصطنعة من اختبارين أخضر (2/2)
طبع الفحص القديم `✅ tests_green: 314/314` ومضى — ختمٌ بعدد لم يُقرأ أصلًا، ولا ذكر لـ
`# fail` ولا أي أرضية تمنع انكماش المجموعة أو استبدالها. الفحص الجديد يقرأ
`# tests/# pass/# fail` ويرفض: `❌ suite shrank below the recorded floor: 2 < 633`.
و`tools/check-metrics.mjs` — السنَد الحقيقي الوحيد — كان خارج هذا المحقق، فبقي «501/501»
في الوثائق حرفيًا لا يربطه بالقياس شيء. القول إن الحراسة موجودة لأن `pub-verifier.sh`
«يفحص الاختبارات» كان خطأً بنيويًا، لا إهمالًا في التحديث.

**العقد المُغلق**:

```text
عددٌ في وثيقة أو في بوابة نشر  ⇔  يُقرأ من قياس، أو يُرفض
  pub-verifier [2/5]: تشغيل واحد → # tests / # pass / # fail
      fail > 0            → REFUSE
      pass ≠ tests        → REFUSE  (TAP غير متسق)
      tests < floor       → REFUSE  (الأرضية = self-model/baseline.json → live_measurement)
  publish plan: record_status يذكر timestamp الخطة  → وإلا REFUSE
  README/SECURITY: لا «N PASS / M FAIL of K»، لا «Latest verification: <رقم>»،
                   وكتلة NEXA_METRICS = live_measurement (وفقط هناك)
```

**سجل واحد، باتجاهَي الفحص.** `self-model/baseline.json` صار يحمل قياسين متمايزين:
`measured` (قياس التقرير المجمّد عند `085a9c7`) و`live_measurement` (القياس الجاري،
بتاريخه ولحظته وأداته). الوثائق تُحال إلى الثاني؛ والأول يبقى كما هو لأن التقرير المجمّد
يجب أن يظل قابلًا للتكذيب. حارس `tests/guards/docs-consistency.test.js` كان يثبّت `545`
حرفيًا في `assert.equal` — أي أن كل إعادة قياس كانت تُكسر بدل أن تُصحَّح — فصار يقرأ رقم
التقرير من نص التقرير نفسه ويقارنه بالسجل.

**توسيع معلن في نفس النطاق**: `tools/check-metrics.mjs` صار يقيس `Ω error codes` و
`Gated namespaces` و`Attack categories` أيضًا. السبب أن README كان يعلن «72 Ω error codes»
بينما `npm run posture` يطبع 86 منذ إغلاق D1.10 — أي أن عددًا آخر كان حرفيًا بلا سَنَد؛
تركه كان سيعني إغلاق التذكرة مع إبقاء نفس الفئة من الكذب في نفس الملف.

**في نفس السطر، بوابة البوابات.** `[1/5] gates_closed` كان `grep -q "6 gates CLOSED"` — عدد
حرفي آخر داخل قرار نشر: تُرفض ستة أبواب مفتوحة لأن النص يقول «7»؟ لا: تُحكم البوابة بصيغة سطر
يطبعه الفاحص. صارت تسأل `tools/check-posture.mjs` نفسه (رمز الخروج هو صاحب القاعدة) وتطبع العدد
الذي قاسه من `NEXA_METRIC closed_gates`. الدليل مُسجَّل في `d1.12-gate-bypass.txt`: الفحص القديم
يمنح `✅ tests_green: 314/314` لمجموعة من اختبارين (2/2)، والفحص الجديد يرفض
`suite shrank below the recorded floor: 2 < 633`، وعلى حمولة حمراء (`# fail 2` مع `# pass 98`)
يرفض `2 failing test(s) of 100`. لا استنتاج من نص: القياس جرى بـ`npm` وهمي على `PATH`.

**الأدلة** (`self-model/evidence/`): `d1.12-red.tap` — الحارس الجديد `tests/count-claims-sync.test.js`
على شجرة ما قبل الإصلاح (5 من 6 حمراء؛ والاختبار السادس يحمي الآلية القائمة فلا ينجبه الإصلاح)،
مع مُعيد known-gaps أخضر 5/5 (أي أن الفشل مُعاد إنتاجه قبل أي تغيير)؛
`d1.12-metrics-red.txt` — `npm run metrics`: «Measured: 632, Documented: 545» في الوثيقتين،
`exit 1`. ثم `d1.12-green.tap` (6/6) و`d1.12-metrics-green.txt` (docs match measured reality،
`exit 0`)، والمجموعة 633/633 (629 − 5 حُذفت + 6 أُضيفت).

**اختبار الانقلاب** (كل تغيير وحده يُحمرّ اختبارًا واحدًا فقط، ثم 6/6 بالاستعادة):
إعادة «501 PASS / 0 FAIL of 501» إلى README ⇒ اختبار الوثائق؛ تحريك `Total tests` في
README دون SECURITY.md ⇒ اختبار التطابق مع السجل؛ نزع `record_status` من خطة v0.1 ⇒
اختبار الخطط؛ شلّ شرط `-ne 0` ⇒ لا شيء (الدفاع متراكم: `pass ≠ tests` والأرضية تمسكانه)،
لذلك قِيست البوابة نفسها بمُخرَج مُصطنع: الفحص القديم يمرّ على 2/2 مختومًا «314/314»،
والجديد يرفض «below the recorded floor: 2 < 633». لا شيء من هذا يحتاج تشغيل المجموعة كاملة.

**ما لم يُمَس عمدًا**: لا rewrite للخطط الموقّعة (لا تصحيح لأرقامها التاريخية — الخطة سجل
موقّع بتاريخه، والوسم يحوّلها من ادعاء راهنية إلى سجل)، لا إزالة لـ`_padding` (يغيّر بايتات
ملف موقّع ولا يُثبِت شيئًا)، لا نقل لـ`npm run metrics` إلى داخل `npm run verify` (يعني تشغيل
المجموعة ثلاث مرات لكل بوابة؛ البوابة الحقيقية CI، و`count-claims-sync` هو الحارس السريع).
النواة (`packages/`, `spec/`) لم تُمَس بسطر؛ التغيير كله وثائق وأدوات وحارس.

**بوابة الإغلاق**: `npm test` 633/633، `npm run metrics` أخضر بـ`exit 0`، `npm run verify`
أخضر، `git diff --check` نظيف، `git status --short` نظيف بعد Commit، وفجوة واحدة مغلقة
بـ`enforced:true` و`verification: tests/count-claims-sync.test.js` وحذف مُعيدها في نفس التغيير.
