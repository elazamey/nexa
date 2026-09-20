# Celia — تعلّم ترتيب خطط إصلاح الكود

**التاريخ:** 20 سبتمبر 2026.  
**اختيار المستخدم:** اختيار خطط إصلاح الكود، والبدء **بجمع تقييمات حقيقية** بدل صناعة بيانات تدريب.  
**الحالة:** وحدة محلية تجريبية مستقلة، advisory-only؛ لا تشغيل إصلاحات، ولا HTTP endpoint جديد، ولا تغيير صلاحيات أو سياسات الأمان. **لم يُدرّب نموذج مستخدم حتى الآن.**

## 1. ما أُضيف بالفعل

- [وحدة البيانات](../packages/cells/celia/learning/src/data.js): تعريف الخطة قبل الاختبار، قراءة تقرير Node TAP مكتمل، اشتقاق label من النتائج والمراجعة، منع تكرار المحاولة، وفحص كفاية البيانات.
- [نماذج ML وDL](../packages/cells/celia/learning/src/models.js): logistic regression للمقارنة، وشبكة dense بطبقتين مخفيتين **12 ثم 6 وحدات**، وخرج sigmoid. تحديث أوزان حقيقي بـbackpropagation وgradient descent، لا mock prediction.
- [جامع البيانات](../tools/celia-learning-store.mjs): خطط ونتائج ومراجعات منفصلة في دليل خاص خارج المستودع، دون overwrite تلقائي. النتيجة غير المراجعة **لا تدخل التدريب**.
- [CLI](../tools/celia-learning.mjs): `init / plan / result / review / status / train / rank / research`.
- [قارئ الأبحاث](../tools/celia-learning-research.mjs): طلب صريح إلى arXiv لجلب metadata والملخصات، لا ملفات PDF أو تنزيل وتشغيل أكواد.
- [18 اختبارًا جديدًا](../tests/celia-learning.test.js)، دون تعديل اختبارات WRITE أو COMMIT أو وحدات H1.

التنفيذ بـJavaScript على CPU ومن دون اعتماديات تشغيل جديدة. الـDL هنا شبكة صغيرة لبيانات خصائص الخطط، **ليس LLM أو AGI أو محاكاة دماغ بشري**. لا يعدل أوزان نموذج خارجي عبر API. الأوزان العشرية تخص وحدة التعلم فقط؛ صيغة NEXA canonical وبوابات النواة لم تتغير.

المحركات القديمة ذات أسماء neural/mock لم تُحوّل ضمنيًا إلى نماذج حقيقية ولم يُجر تبديلها في dashboard؛ الوحدة الجديدة مستقلة وصريحة في حدودها.

## 2. حلقة التعلّم والهدف القابل للقياس

```text
تحديد taskGroup ثابت للمشكلة
  → تسجيل candidate plan وخصائصه قبل تقرير الاختبار
  → تشغيل اختبارات مصرح بها خارج هذه الوحدة
  → تسجيل التقرير الفعلي + exitCode
  → مراجعة بشرية صريحة
  → إضافة observation إلى بيانات التدريب
  → عندما تكفي البيانات: تدريب candidate جديد وتقييمه
  → عرض ترتيب استشاري للخطط، لا تنفيذها
```

الهدف الحالي binary: **كل الاختبارات المطلوبة نجحت، دون skipped/todo/cancelled، وعددها يطابق العدد المسجل قبل التجربة، وexitCode=0، والمراجع وافق**. غير ذلك label=0. موافقة المراجع لا تحوّل اختبارات فاشلة إلى نجاح. لا تكفي رسالة «تم الإصلاح» أو إجابة LLM لتكوين label ناجح.

المدخلات هي خصائص متاحة قبل النتيجة: عدد الملفات والأسطر المتغيرة، تغييرات الاعتماديات، إخفاقات baseline، ملفات الاختبارات المتغيرة، وهل تمس الخطة حدًا أمنيًا. strategy تدخل كـone-hot. لا يدخل نجاح التجربة نفسه كميزة لتجنب تسريب label.

هذه labels مبنية على تقارير ومراجعة **يقدمها مشغّل موثوق**. البصمات تربط السجلات وتكشف التعديل غير المتسق، لكنها ليست توقيعات أو إثباتًا مستقلًا بأن التقرير صدر من العملية المعلنة أو أن الاختبارات لم تُضعف. `reviewer` اسم مسجل، لا هوية NEXA موثقة. يلزم أن يتحقق المراجع من patch وbase وtest suite والمجموعات الصحيحة، وألا يقبل إصلاحًا يخفي اختبارات الفشل. هذه الوحدة لا تُستخدم كقرار أمني أو بديل لـcapability.

## 3. كيف تتغير الأوزان دون ادعاء تحسن وهمي؟

- حد بداية التدريب: **120 observation مراجعة**، و**15 taskGroup** على الأقل، و2–16 استراتيجية، و20 مثالًا على الأقل لكل استراتيجية.
- تقسيم ثابت ببصمة taskGroup: نحو 60% train و20% validation و20% test. كل محاولات المشكلة الواحدة تبقى في قسم واحد.
- كل قسم يحتاج بيانات من الفئتين ومن الاستراتيجيات المدروسة؛ train يحتاج 60 سجلًا على الأقل وكل قسم تقييم 20 على الأقل. اجتياز حد 120 وحده قد لا يكفي.
- التطبيع ثابت، والتدريب محدود بـ160 epoch، مع L2 وحدود gradient. اختيار checkpoint يكون على **validation فقط**، ثم يُحسب test بعد الاختيار.
- التقرير يتضمن log loss مقابل baseline ثابت مأخوذ من معدل نجاح train، وBrier score وaccuracy، وبصمات النموذج وبيانات التدريب.
- حفظ النموذج عبارة عن JSON بالأوزان وبنية محدودة؛ التحميل يفحص البنية والقيم المحدودة والبصمة. لا pickle أو eval أو كود داخل النموذج.
- وصول تقييمات جديدة يتيح إعادة تدريب candidate جديد يغير الأوزان؛ النموذج السابق لا يُعدل. **لا توجد حلقة online ذاتية التنفيذ أو جدولة daemon أو auto-promotion**. أمر `train` صريح، ونتيجته `CANDIDATE_ONLY`.
- ترتيب استراتيجية لم تُر في التدريب يعيد `score: null`، لا ثقة مختلقة. كل نتيجة ترتيب `executionAllowed: false` و`calibrated: false`.

حدود مهمة: 120 و15 حدود تشغيل أولية وليستا برهانًا إحصائيًا على كفاية البيانات. log loss الجيد لا يثبت جودة ترتيب الإصلاحات أو زيادة معدل إنجاز مهام جديدة. البيانات رصدية وليست تجربة سببية؛ اختيار الخطط السابقة يسبب selection bias، وقد ينتقل أثر مشكلة مكررة إذا أخطأ المشغّل في taskGroup. تكرار التعديل بناءً على test نفسه يلوث holdout؛ يلزم تقييم جديد مستقل قبل أي اعتماد فعلي. لا ضمان للوصول إلى كل هدف أو لتحسن الأداء مع كل تدريب.

## 4. الحالة المحلية وطريقة الاستخدام

هُيئ في هذه الجلسة دليل خاص خارج المستودع:

```text
/home/user/nexa-learning-data
```

الحالة الفعلية: **COLLECTING، صفر خطط، صفر observations، ولا نموذج مدرّب أو فعّال**. لم ننسخ البيانات الاصطناعية من الاختبارات إلى هذه المجموعة، ولم نحول نتائج اختبارات الجولة السابقة إلى أمثلة بأثر رجعي. البيانات خارج Git ويجب وضعها في تخزين مناسب عند الانتقال إلى بيئة أخرى.

```bash
node tools/celia-learning.mjs status --state /home/user/nexa-learning-data
# أو
npm run learning -- status --state /home/user/nexa-learning-data
```

عند إعداد مجموعة أخرى، جهّز دليلًا فارغًا موجودًا بصلاحية `0700` وخارج المستودع، ثم نفّذ `init --state <directory>`. لا تعِد init للدليل الحالي؛ العملية ترفض الكتابة فوق مجموعة موجودة.

### أ. تسجيل خطة قبل تقييمها

ملف `plan.json`، مع استبدال placeholders ببصمات SHA-256 hex حقيقية، وليس أصفارًا أو قيمًا مخترعة:

```json
{
  "id": "repo-issue-123-attempt-1",
  "taskGroup": "repo:issue-123",
  "strategy": "minimal-fix",
  "features": {
    "changedFiles": 2,
    "changedLines": 25,
    "dependencyChanges": 0,
    "baselineFailures": 1,
    "testFilesChanged": 0,
    "touchesSecurityBoundary": 0
  },
  "baseHash": "<64-hex SHA256 of the relevant base snapshot>",
  "patchHash": "<64-hex SHA256 of the actual candidate patch>",
  "suiteHash": "<64-hex SHA256 of the fixed required test-suite definition>",
  "expectedTests": 25,
  "researchIds": ["2310.06770"]
}
```

ثبت تعريف البصمات والخصائص عبر المجموعة، واحسبها من الملفات الفعلية؛ الـCLI لا يستنتج patch من `git diff` تلقائيًا ولا ينفذه. الحدود: files وtestFiles ≤128، lines ≤10000، dependencyChanges ≤32، baselineFailures ≤1024، touchesSecurityBoundary إما 0 أو1. `researchIds` مجرد provenance يربط الخطة بأبحاث راجعها الإنسان، وليس قناة أوامر.

```bash
node tools/celia-learning.mjs plan --state /home/user/nexa-learning-data --input /path/to/plan.json
```

### ب. تسجيل نتيجة الاختبارات الفعلية

شغّل الاختبارات المصرح بها بوسيلة الاختبار المعتادة مع `--test-reporter=tap`، واحفظ تقريرها الكامل وexitCode الفعلي. الوحدة **لا تشغل هذا الأمر نيابة عنك** ولا تنفذ خططًا.

ملف result:

```json
{
  "planId": "repo-issue-123-attempt-1",
  "reportPath": "/path/to/actual-run.tap",
  "exitCode": 0
}
```

```bash
node tools/celia-learning.mjs result --state /home/user/nexa-learning-data --input /path/to/result.json
```

يُرفض تقرير أقدم من تسجيل الخطة أو ناقص/ملتبس. هذا فحص workflow لا attestation؛ تبديل timestamps أو تركيب تقرير ممكن لمن يملك الملفات. يُحفظ hash التقرير والعدّادات فقط، لا محتوى التقرير أو الشفرة. الحالة تصبح `AWAITING_HUMAN_REVIEW`.

### ج. المراجعة ثم التدريب لاحقًا

```json
{ "planId": "repo-issue-123-attempt-1", "reviewer": "reviewer-name", "accepted": true }
```

```bash
node tools/celia-learning.mjs review --state /home/user/nexa-learning-data --input /path/to/review.json
node tools/celia-learning.mjs status --state /home/user/nexa-learning-data

# بعد توافر البيانات واجتياز checks فقط؛ المجموعة الحالية الفارغة لا تنتج نموذجًا:
node tools/celia-learning.mjs train --state /home/user/nexa-learning-data --family ml > /home/user/nexa-learning-data/candidate-ml-001.json
node tools/celia-learning.mjs train --state /home/user/nexa-learning-data --family dl > /home/user/nexa-learning-data/candidate-dl-001.json
node tools/celia-learning.mjs rank --model /home/user/nexa-learning-data/candidate-ml-001.json --input /path/to/plans-array.json
```

عند حفظ stdout كـJSON استخدم `node` مباشرة أو `npm run --silent`؛ npm العادي يضيف banner. تحقق من exitCode، ولا تعتبر ملف redirect فارغًا نموذجًا ناجحًا. استخدم اسمًا جديدًا لكل دورة ولا تستبدل checkpoint السابق؛ الحفظ والاختيار والتراجع عن النموذج خطوات مشغّل يدوية. اختُبر أمر DL على المجموعة الحقيقية الفارغة فعاد exit 1 دون نموذج، كما هو مطلوب. لا يوجد active-model pointer أو أمر promote؛ هذه ملفات مرشحة يراجعها المشغّل. لا يوجد overwriting للمراجعات أو reset تلقائي؛ الإجراءات التصحيحية/الأرشفة تحتاج تصميمًا منفصلًا بدل حذف السجلات لإجبار نجاح التدريب.

## 5. الأبحاث: ما جُلب وما لم يعمل

قراءة تأسيسية موثقة، لا ادعاء بمسح شامل لأحدث أبحاث 2026:

- **SWE-bench:** تقييم إصلاح مشاكل مستودعات حقيقية بالاختبارات؛ استُفيد من مبدأ أن نجاح الإصلاح يحتاج تحققًا عمليًا، لا وصفًا لغويًا. لم نشغل SWE-bench ولم ننقل درجاته إلى مشروعنا. [2](https://arxiv.org/abs/2310.06770)
- **Deep Reinforcement Learning from Human Preferences:** تعلم إشارة تفضيل من feedback بشري ثم تحسين السلوك عليها. استفدنا من ضرورة ربط الهدف بتقييم بشري؛ الوحدة الحالية supervised binary classification وليست تطبيقًا لخوارزمية RL في الورقة. [3](https://arxiv.org/html/1706.03741v2)
- **LoRA:** تكييف نموذج كبير مع تجميد الأوزان الأساسية وتدريب مصفوفات إضافية صغيرة. مرجع لمسار fine-tuning مستقبلي مستقل؛ **LoRA وfine-tuning للـLLM غير منفذين هنا**. [3](https://export.arxiv.org/abs/2106.09685)

أداة الجلب:

```bash
node tools/celia-learning.mjs research --query "software repair"
node tools/celia-learning.mjs research --query "deep learning"
```

تستخدم endpoint HTTPS ثابتًا `export.arxiv.org/api/query`، خمسة نتائج مطلوبة، timeout عشر ثوانٍ، ومنع redirects وحد 256 KiB، وترفض DOCTYPE/ENTITY والروابط خارج arxiv.org. لا تزور الروابط المسترجعة. الملخصات بيانات غير موثوقة، لا تعليمات ولا بيانات تدريب تلقائية؛ يجب عرضها كنص لا HTML. الجلب يدوي فقط، دون polling؛ احترم حدود arXiv ولا تنفذ طلبات متوازية أو متكررة بسرعة.

**دليل التشغيل:** نجحت اختبارات parsing والحدود والـfetch contract باستخدام responses اختبارية. لكن الجلب الحي من CLI في هذه البيئة فشل بـ`fetch failed` وسبب `ECONNRESET`. لذلك لا ندعي نجاح اتصال runtime بـarXiv هنا. المراجع أعلاه تحققت بواسطة أداة البحث المتاحة للجلسة، وهي دليل منفصل عن عمل موصل المشروع. عند تعذر المصدر تعود الأداة بخطأ ولا تولد أبحاثًا وهمية. لا تنزيل datasets أو تبعيات أو نماذج أو تدريب عليها دون خطوة مستقلة.

## 6. أدلة الاختبارات والحالة الأمنية

| الفحص | النتيجة |
|---|---:|
| اختبارات الوحدة الجديدة | **18/18 PASS** |
| WRITE/COMMIT السابقة + persistence | **59/59 PASS** =39+20 |
| `npm run verify` | **392 PASS / 2 FAIL من 394، exit 1** |
| posture | **6 gates CLOSED** |

لا skipped أو cancelled أو todo في الجولة الكاملة. الفشلان الوحيدان هما **H2-ATOMICITY وH3-CONCURRENCY** القائمان. H1 الأصلي ما يزال PASS. verify توقف عند tests ولم يصل إلى مراحل audit/demo/attacks/report اللاحقة. لم تُشغّل metrics؛ 353 في block القديم baseline تاريخي فقط.

اختبارات ML/DL تقارن المشتقات كلها بفروق عددية، تثبت تغيّر الأوزان وانخفاض held-out loss على fixtures **اصطناعية معلنة**، والتحول مع feedback إضافي دون تغيير النموذج السابق. هذا ليس نجاحًا على بيانات إصلاح حقيقية. اختبار collector يشغّل عملية Node tests فعلية، يسجل تقريرها، ثم يقرأ المجموعة من CLI في عملية جديدة؛ سجلات ذلك الاختبار مؤقتة ولا تدخل مجموعة المستخدم.

فشل integration جديد أولًا لأن child ورث سياق Node test runner بدل إخراج TAP؛ أُصلحت بيئة child في **الاختبار الجديد فقط** مع تحديد reporter صراحة. لم تُخفف شروط قراءة التقرير للحصول على GREEN.

تحققت SHA-256 لملفات COMMIT authorizer/committer/consumption-store واختبار hardening: جميعها مطابقة لما قبل هذه الحزمة. لا تغييرات في بوابات البروتوكول أو WRITE أو COMMIT أو اختبارات القبول السابقة.

السجلات المحلية: `/tmp/nexa-learning-targeted.log`، `/tmp/nexa-learning-security-regression.log`، `/tmp/nexa-learning-verify.log`، و`/tmp/nexa-learning-research-live.err`. مخزن البيانات خارج Git؛ لا checkpoint مدرّب أو dataset كبير أضيف إلى المستودع.

## 7. الحدود والخطوة التالية

هذه خطوة جمع وتدريب استشاري معزولة بطلب المستخدم، **وليست نقل الأولوية إلى تنفيذ ذاتي قبل إغلاق H2/H3**. لا create أو Supabase أو migration أو نشر أو merge. بيانات collector خاصة بمستخدم OS الموثوق، وليست authorization ledger؛ لا ادعاء بـcrash recovery أو حماية ضد مسؤول يعيد كتابة المجموعة. الحد 2000 خطة/سجل، ولا إدارة distributed writers أو recovery أو retention تلقائية.

الخطوة العملية التالية: تسجيل محاولات الإصلاح القادمة قبل قياسها، بأكثر من استراتيجية، ثم مراجعة النتائج الحقيقية. لا نطلب من المستخدم اختلاق نجاحات لبلوغ حد التدريب. بعد كفاية البيانات، تُقارن النماذج على مهام مستقلة وتُراجع مخاطر overfitting والتسميم والـreward gaming. ربط الاختيار بمنفذ فعلي أو تدريب LLM أو جلب دوري للأبحاث يتطلب نطاقًا وصلاحيات ومعايير قبول مستقلة؛ لا يستطيع التعلم منح هذه الصلاحيات لنفسه.
