# مرجع متغيرات البيئة (D1.13 / O05)

> **القاعدة**: كل `process.env.X` يقرأه الكود يجب أن يكون صفًا هنا، **في نفس التغيير** الذي يضيف
> القراءة. الحارس `tests/env-reference-sync.test.js` يكسر عند قراءة غير موثَّقة، وعند صفّ جامد
> (متغير موثَّق لا يقرأه أحد)، وعند موقع قراءة غير مباشرة (محفوظة في متغيّر وسطي) غير مُعلَن أدناه.

> **لماذا لا `.env.example` في هذا المستودع** (قرار مُجمَّد في سجل الحدود، §3 — ولا يُنقض بالوثائق
> ولا بالقوالب): القالب المودَع يستدعي أن يكتب أحدٌ قيمة سرّية فيه ثم يرفعها، والسِرّ الذي يصل إلى
> حزمة أمامية أو ملف إعداد مرئي لم يعد سِرًّا. فالمرجع إذن **وثيقة** تسمّي وتتصلف وتشرح الأثر،
> لا قالب يحمل قيمًا. القيم الحقيقية تأتي من بيئة التشغيل (Render dashboard، أسرار CI، أو
> صدفة المطور) ولا تُودَع.

## مصفوفة المتغيرات

| المتغير | القارئ | الافتراضي | الأثر | الصنف |
|:---|:---|:---|:---|:---|
| `PORT` | `tools/celia-dashboard-server.mjs` | `3001` | منفذ الاستماع للسيرفر اللوحي؛ `0` = منفذ حر (تستعمله الاختبارات). | تشغيل |
| `NODE_ENV` | `tools/celia-perimeter-auth.mjs`, `tools/celia-startup-guard.mjs` | — | `production` تُفعِّل fail-fast للإقلاع و`Secure` على كوكي الجلسة. | وضع |
| `NEXA_ENV` | `tools/celia-perimeter-auth.mjs` | — | موازٍ لـ`NODE_ENV` لوضع `production`؛ حارس fail-fast يرتكز على هذين فقط (قرار D1.11). | وضع |
| `NEXA_API_KEY` | `tools/celia-perimeter-auth.mjs`, `tools/celia-startup-guard.mjs` | — | سرّ المحيط (يُقدَّم كـ`Authorization: Bearer` أو `X-Nexa-Api-Key`)؛ غيابه في `production` يمنع الإقلاع. مقارنته sha256 ثم `timingSafeEqual`، ومفتاح في query string مرفوض. **لا يُطبع ولا يصل إلى JS المتصفح.** | سرّ |
| `NEXA_TRUST_PROXY` | `tools/celia-perimeter-auth.mjs` | مُطفأ | `1`/`true`: الثقة بـ`x-forwarded-for` في عنوان العميل (وراء بروكسي موثوق) — وإلا يُهمَل الترويسة. | تشغيل |
| `NEXA_RATE_LIMIT_WINDOW_MS` | `tools/celia-rate-limit.mjs` | `60000` | طول النافذة الثابتة بالمللي ثانية. | تشغيل |
| `NEXA_RATE_LIMIT_MAX` | `tools/celia-rate-limit.mjs` | `120` | سقف الطلبات في النافذة لكل مفتاح؛ القيمة `0` **تُطفئ** الحد صراحةً (لا تُقرأ «بلا سقف»). | تشغيل |
| `NEXA_RATE_LIMIT_LOGIN_MAX` | `tools/celia-rate-limit.mjs` | `20` | سقف محاولات الدخول في النافذة (أشدّ من السقف العام). | تشغيل |
| `NEXA_RATE_LIMIT_KEY_MODE` | `tools/celia-rate-limit.mjs` | `identity` | مفتاح العدّ: حسب الهوية أو حسب عنوان العميل (`ip`). | تشغيل |
| `NEXA_PRODUCTION_PERSISTENCE` | `tools/celia-startup-guard.mjs` | — | إقرار صريح وحيد بالقبول بتخزين مؤقّت في `production`: القيمة `ack-mock-ephemeral` فقط؛ أي قيمة أخرى = إقلاع مرفوض. الوضوح موسوم لا ادّعاء. | إقرار |
| `NEXA_OPERATOR_SEED` | `tools/celia-operator.mjs`, `tools/celia-startup-guard.mjs` | بذرة تجريبية منشورة | بذر هوية توقيع المشغّل. الافتراضي عامٌّ بالتعريف ولا يُجبَر الدوران؛ في `production` يُحذَّر الإقلاع من تركه، لأن البذر هو ما يجعل معرّف القرار خاصًّا — لا ما يجعل `approve {}` مقبولًا (ذاكر القرار تُغلق بعقد التوقيع لا بالسِرّ). | سرّ |
| `SUPABASE_URL` | `tools/celia-vector-port.mjs`, `tools/celia-memory-port.mjs`, `tools/celia-startup-guard.mjs` | `mock://memory` / `https://demo.supabase.co` | عنوان مخزن المتجهات والذاكرة. في الاختبارات `mock://integration-test...`؛ `mock://memory` = مشغّر محاكى معلَن. | تشغيل |
| `SUPABASE_ANON_KEY` | `tools/celia-vector-port.mjs`, `tools/celia-startup-guard.mjs` | `mock-key` | مفتاح مجهّز للعميل. **لا يُقرأ في الواجهة الأمامية** — يمرّ عبر السيرفر فقط. | سرّ |
| `SUPABASE_SERVICE_KEY` | `tools/celia-vector-port.mjs`, `tools/celia-memory-port.mjs`, `tools/celia-startup-guard.mjs` | `mock-key` / `demo-key` | مفتاح خدمة يتجاوز RLS؛ لا يصلح أن يكون مفتاح عميل. | سرّ |
| `CELIA_WORKSPACE_WRITE_AUTH` | `tools/celia-dashboard-server.mjs` | `{}` | JSON لإعداد تفويض الكتابة في الـ workspace؛ `{}` ليس تفويضًا ولا يفتح مسارًا. | إعداد |
| `CELIA_WORKSPACE_COMMIT_AUTH` | `tools/celia-dashboard-server.mjs` | `{}` | JSON لإعداد تفويض `commit` (قائمة قرارات/سياسة) — يُفكّ الترميز ثم يُبحث ثم يُتحقَّق، لا `split(raw)`. | إعداد |
| `CELIA_COMMIT_STATE_DIR` | `tools/celia-workspace-commit-port.mjs` | — | جذر حالة `commit` خارجي خاص؛ لازمٌ في وضع `commit`، ولا يُحذف ولا تُمسح أقفاله لاستعادة الإتاحة (الفشل المُغلق حالةٌ مقصودة). | تخزين |
| `NEXA_HUNT_MEMORY` | `src/security/hunter/hunt-memory.js` | `dashboard/data/hunt-memory.json` | مسار ذاكرة الصيد. تُحوَّل في `tests/bootstrap.mjs` إلى مجلد مؤقّت لعزل مخرجات الاختبار عن الشجرة. | عزل اختبار |
| `NEXA_BUG_REPORT` | `src/security/agentic-hunter.js` | `dashboard/data/bug-report.json` | مسار `bug-report.json` (الحالة المكتوبة تُبلَّغ ولا تُزفَّف — D1.8). يُحوَّل في bootstrap للسبب نفسه. | عزل اختبار |
| `XAI_API_KEY` | `tools/celia-grok-port.mjs`, `tools/celia-demo.mjs`, `tools/celia-rag-demo.mjs` (عبر حافظة تجريبية) | `mock-key` | مفتاح مزوّد الخطة (Grok). **لا يُستدعى منه تفويض**: كونه مضبوطًا لا يفتح مسارًا ولا يشتري موافقة. | سرّ |
| `GITHUB_REF_NAME` | `.github/workflows/release.yml` | `v1.0.0` | اسم Ref المُطلَق لتسمية نسخة الإصدار في السجل. | CI |

## قراءات غير مباشرة (معلَنة عمدًا)

لا يمكن لحارس أن يستنفد ما يُقرأ عبر مفتاح ديناميكي (`process.env[key]`)، فالقراءات الموزَّعة عبر
حافظة تجريبية تُعلَن هنا بالملف، وأي ملف جديد يضيف `process.env[` بلا إعلان يكسر الحارس:

- `tools/celia-demo.mjs` — حافظة وهمية تُرجع `mock-key` لأي اسم تطلبه (عرض تعليمي).
- `tools/celia-grok-port.mjs` — فكّ مفتاح المزوّد عبر دالة `vault.get`.
- `tools/celia-rag-demo.mjs` — خريطة أسماء → `process.env[key]` مع `mock-key` كبديل.

ملاحظة صراحةً: هذه المواضع قد تقرأ أسماءً لا تظهر في المصفوفة أعلاه (مثل `XAI_API_KEY` الذي وُصف
لأن الاعتماد عليه حقيقي)، لذلك تُراجَع يدويًا عند كل تغيير فيها — الحارس يضمن ألا يتكاثر الصمت.

## ما ليس متغيّر بيئة

`NODE_VERSION` في `render.yaml` (**`envVars`** للناشر) و`node-version: '22.x'` في
`.github/workflows/release.yml` مفاتيحُ إعداد للبيئة تُوفَّر قبل التشغيل، لا قراءات `process.env`
في كودنا — فلا صفّ لهما في المصفوفة أعلاه، ولو أُضيفا لكسَرهما الحارس بوصفهما جمودًا. و`GITHUB_REF_NAME`
صفٌّ هناك لأنه يُقرأ فعلًا في سكربت الإصدار.

`SUPABASE_KEY` يُستعمل **مفتاحَ حمولة** في مُكيِّفَي المتجهات والذاكرة (يُملأ من `SUPABASE_URL`/
`SUPABASE_SERVICE_KEY`)، ولا يقرأه الكود من البيئة — فلا صفّ له أعلاه، ولو أُضيف صفٌ له لكسره الحارس
بوصفه جمودًا.

## قواعد ثابتة تُمرَّر عبر البيئة ولا تُخزَّن

1. **مفتاح المحيط سياجٌ لا تفويض**: وجود `NEXA_API_KEY` لا يُمرّر سياسة ولا يشتري موافقة (قرار
   مُجمَّد: `identity HTTP ≠ تفويض ≠ موافقة ≠ تنفيذ`).
2. **لا سرّ في الواجهة**: ممنوع أن يظهر اسم متغير سرّي (`*KEY*`, `*TOKEN*`, `*SECRET*`,
   `*SEED*`) في مصدر أمامة أو في `import.meta.env.VITE_*` — يفحصه الحارس.
3. **fail-fast على الوضع فقط**: قرار «هل نحن إنتاج؟» يُقرأ من `NODE_ENV`/`NEXA_ENV` لا من توافر سرّ.
4. **الاتفاق على `ack-mock-ephemeral`**: القبول بالتخزين المؤقّت لفظٌ واحد لا ترجمة له؛ لا يوجد
   «نعم/1/true».
