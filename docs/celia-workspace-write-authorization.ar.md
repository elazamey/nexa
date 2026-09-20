# Celia workspace/write — إصلاح محدود ودليل RED → GREEN

**التاريخ:** 20 سبتمبر 2026  
**البيئة المقاسة:** Node v22.22.3 / npm 10.9.8  
**النطاق:** `POST /api/v1/workspace/write` فقط؛ لا نشر أو merge أو تعديل Supabase أو فتح لبوابات النواة.

> **تحديث لاحق مستقل:** أضيفت ثلاث حالات [COMMIT RED](celia-workspace-commit-red.ar.md) وأثبتت تطبيق ملفات دون تفويض commit. أُصلح COMMIT لاحقًا وفق عقد مستقل، ونجحت المجموعة كاملة **353/353**؛ راجع [دليل COMMIT GREEN](celia-workspace-commit-green.ar.md). اختبارات WRITE ما تزال 17/17 دون تعديلها؛ نتيجة 331/331 أدناه تخص جولة WRITE السابقة.

## 1. نقطة الدخول والتغيير

المسار الفعلي في [خادم Celia](../tools/celia-dashboard-server.mjs) كان ينفذ:

```text
JSON body → workspacePort.writeFile → writeFileSync داخل staging
```

أصبح ينفذ:

```text
JSON body محدود الحجم
    → توقيع هوية صحيح وصلاحية زمنية
    → audience مطابق لإعداد الخادم
    → ربط الطلب بالطريقة والمسار وworkspace والملف والمحتوى
    → capability موقعة من مُصدر موثوق ومطابقة لحاملها ونطاقها
    → سياسة خادم تسمح بالفعل
    → منع replay وحجز ميزانية الاستخدام
    → workspacePort.writeFile الحقيقي
```

البوابة الجديدة في [celia-workspace-write-auth.mjs](../tools/celia-workspace-write-auth.mjs) لا تستخدم filesystem. استدعاء منفذ الملفات وتسجيل أحداث نجاح الكتابة يأتيان بعدها فقط. بقي تنفيذ منفذ الملفات نفسه دون تعديل.

**تمييز أمني مهم:** هذه بوابة خاصة بمنفذ HTTP موجود أصلًا في `tools/`، تعيد استخدام `verifyEnvelope` و`verifyCapability` و`Policy` و`ReplayGuard` و`UsageLedger`. ليست استدعاءً عبر NEXA `Endpoint`، ولا تصريحًا بأن النواة سمحت بالكتابة؛ النواة ما تزال ترفض فعل `write` وتبقى بواباتها الست مغلقة.

## 2. عقد التفويض

### إعداد موثوق يملكه مشغّل الخادم

يقرأ الخادم `CELIA_WORKSPACE_WRITE_AUTH` مرة عند بدء التشغيل كـ JSON:

```json
{
  "audience": "<server public key id>",
  "capabilityIssuers": ["<trusted operator public key id>"],
  "rules": [
    {
      "id": "allow-staging-write",
      "effect": "ALLOW",
      "resource": "workspace:*",
      "actions": ["write"],
      "subjects": ["<authorized caller public key id>"]
    }
  ]
}
```

القيم بين `<...>` توضيحية، ويجب أن تكون key IDs صحيحة عند الاستخدام. ليست هنا مفاتيح خاصة أو أسرار جاهزة للتشغيل. يستخدم fixture مفاتيح عشوائية محلية، ويضع الإعداد في بيئة الخادم الفرعي بالطريقة نفسها التي يقرأها تنفيذ الإنتاج؛ لا يحقن قرار ALLOW ولا يستبدل verifier.

- غياب الإعداد يعني غياب audience والمُصدرين والقواعد: **لا كتابة مسموحة**.
- JSON غير صالح أو إعداد بنيوي غير صالح يوقف بدء التشغيل، وليس fallback يسمح بالكتابة.
- الطلب لا يستطيع إضافة issuer موثوق أو تعديل سياسة الخادم.
- حتى قاعدة ALLOW لا تتجاوز التحقق الإلزامي من التوقيع وcapability.
- قاعدة policy يمكن أن تطابق `workspace:*`، لكن capability المطلوبة تربط **workspace وملفًا محددين** عبر resource مشتق من SHA-256 للتمثيل القانوني `{workspaceId, path}`.

### الطلب

```text
{
  workspaceId,
  path,
  content,
  authorization: <signed NEXA CALL envelope>
}
```

داخل envelope:

- `from`: هوية حامل capability، مثبتة بتوقيع Ed25519 لا بمجرد اسم.
- `to`: audience الذي ضبطه المشغّل.
- `body.resource`: ناتج `workspaceWriteResource(workspaceId, path)`.
- `body.action`: `write`.
- `body.args`: ناتج `workspaceWriteIntent({workspaceId, path, content})`، ويتضمن طريقة HTTP ومسار endpoint.
- `body.capability`: grant موقعة، و`cap` يطابق معرفها.

لا تُقبل قيمة `evidenceRef` نصية بدل هذا العقد، ولا تُولد قيمة `evidence:workspace-write-api` بديلة. تنشأ `authorizationRef` من بصمة **الطلب الموقع الذي جرى التحقق منه**، وترافق حدث التنفيذ والاستجابة. هذه البصمة مرجع تفويض، **وليست إيصال evidence مستقلًا أو سجل تدقيق دائمًا**.

المرجع العملي لتكوين الطلب وتوقيعه وإرساله هو [اختبارات التفويض](../tests/celia-workspace-write-auth.test.js)، باستخدام `mintCapability` و`buildEnvelope` الحقيقيتين.

### الرفض

| الحالة | النتيجة |
|---|---|
| غياب إثبات الهوية | 401 |
| توقيع غير صالح أو envelope منتهية | 401 |
| هوية مثبتة لكن capability غائبة أو غير موثوقة أو غير مطابقة | 403 |
| audience أو العملية أو السياسة غير مطابقة | 403 |
| replay أو ميزانية استخدام مستنفدة | 403 |
| JSON أو حقول أو مسار نسبي غير صالح | 400 |
| جسم HTTP أكبر من 128 KiB | 413 |

السقف ينطبق على الطلب الكامل؛ verifier الأصلي يفرض أيضًا سقفه على جسم envelope. تُرفض القيود غير المدعومة بدل تجاهلها؛ القيد الإضافي المدعوم هنا هو `max_args_bytes`. تُرفض المسارات الغامضة مثل `..` و`/absolute` والشرطات الخلفية؛ هذه ليست معالجة شاملة للروابط الرمزية أو سباقات filesystem.

## 3. اختبار RED الأصلي لم يتغير

ملف [celia-workspace-http.test.js](../tests/celia-workspace-http.test.js) بقي مطابقًا بايتًا ببايت. SHA-256 قبل الإصلاح وبعده:

```text
066e835a35410e20c4e500dd6317d72d4a3554d58bb1b4f4c4476a7080ecf8b8
```

ومشغّل الخادم الأصلي `tests/fixtures/celia-http-child.mjs` بقي دون تعديل أيضًا.

أعيد تشغيل RED **قبل تعديل الإنتاج**: HTTP 200 وتغير ملف staging، مع exit code 1. وبعد الإصلاح، الاختبار نفسه أعاد **HTTP 401** و`changed paths: []` مع exit code 0. لا تبديل لتوقعه ولا `skip` أو `todo`.

## 4. الدليل الإضافي من filesystem

أُضيفت **16 حالة اختبار HTTP**، فصار مجموع اختبارات هذه الحزمة **17** مع الاختبار الأصلي.

### حالات الرفض

هوية غائبة/مزورة/قديمة، هوية صحيحة دون capability، إعداد غائب، سياسة فارغة، مُصدر غير موثوق أو قائمة مُصدرين فارغة، capability مزورة، حامل أو audience مختلف، تغيير workspace أو الملف أو المحتوى خارج التوقيع، فعل أو scope خاطئ، capability منتهية، مستخدم خارج السياسة، قيد غير مدعوم، replay، نفاد الميزانية، ومسارات غير صالحة وحجم زائد.

### إثبات عدم الأثر

[fixture إضافي مستقل](../tests/celia-workspace-auth-helpers.mjs) يأخذ snapshot للجذر المؤقت كاملًا قبل الطلب وبعده، ويقارن:

- أسماء الملفات والمجلدات والروابط، لكشف الإنشاء والحذف.
- SHA-256 للمحتوى، لكشف التعديل.
- `mode` و`uid` و`gid` و`size` و`ino` و`nlink` و`mtimeNs` و`ctimeNs`.
- حالة workspace وعداد الكتابات قبل الطلب وبعده.

يُستثنى `atime` عمدًا لأن قراءات snapshot نفسها قد تغيره. هذا لا يدّعي فحص كل أنواع metadata على كل أنظمة الملفات.

### إثبات المسار المصرح

تستخدم الاختبارات خادم HTTP ومنفذ filesystem حقيقيين في نسخة مؤقتة:

1. إعداد مشغّل بمُصدر موثوق وسياسة محددة.
2. capability موقعة وطلب موقع من حاملها.
3. HTTP 200، وقراءة محتوى الملف المكتوب فعليًا؛ يتضمن الاختبار محتوى عربيًا.
4. اختبار استبدال ملف موجود وإنشاء ملف جديد داخل staging.
5. عدم تغيير الملف المقابل في جذر المستودع المؤقت أو الملفات غير المستهدفة.
6. فشل السياسة يمنع الكتابة حتى مع توقيع وcapability صحيحين.
7. طلبان متزامنان بميزانية استعمال واحدة ينتجان 200 و403، وعداد كتابة واحد فقط.

التهيئة ما تزال تستخدم create القديم للحصول على workspace موجود، كما يقتضي إبقاء الاختبار الأصلي دون تعديل. لا يُحسب نجاح create هذا دليلًا على أمانه.

## 5. نتائج regression

```bash
node --test tests/celia-workspace-http.test.js tests/celia-workspace-write-auth.test.js
npm run verify
npm run metrics
npm run proof:permission:auto
node tools/omega-vectors.mjs --check
node tools/cellular-vectors.mjs --check
node tools/google-vectors.mjs --check
```

| الفحص | النتيجة المحلية |
|---|---|
| حزمة workspace HTTP | 17/17 ناجحًا |
| المجموعة كاملة داخل verify | **331/331 ناجحًا = 314 اختبارًا سابقًا + 17 اختبارًا لهذه الحزمة** |
| audit داخل verify | 16/16 ناجحًا؛ مجموعة فرعية من الاختبارات وليست إضافة إلى العدد |
| attacks داخل verify | 31/31 ممنوعة |
| posture | 6 بوابات CLOSED |
| metrics | نجح؛ README وSECURITY مطابقان للقياسات |
| proof:permission:auto | نجح؛ البرهان خاص بمسار النواة المختبر وليس عزل خادم Celia |
| omega/cellular/google vectors --check | الثلاثة متزامنة |
| git diff --check | نجح |

تم تحديث العدد الحالي في كتل metrics داخل README وSECURITY إلى 331؛ أرقام الإصدارات والتقارير التاريخية لا تُعاد كتابتها كأنها نتائج جديدة.

## 6. الحدود وخطة التراجع الآمن

- **لا نشر عام للخادم بهذا الإصلاح وحده.** لم تُؤمّن create أو commit أو rollback أو DSL ومسارات التعديل الأخرى؛ إغلاق write لا يؤمّن API كله.
- لا تعديل لسياسات Supabase RLS أو migrations أو الواجهة أو النواة.
- لا إصلاح للذرية أو symlinks أو عزل العمليات أو الاحتفاظ الدائم بالأدلة في هذه الحزمة.
- replay وعدادات الاستخدام في ذاكرة عملية الخادم؛ لا ضمان عبر restart أو أكثر من instance. يلزم تصميم تخزين/تنسيق قبل الاستخدام الإنتاجي. في تجارب التشغيل المحدودة لا تعِد استخدام audience السابقة بعد restart كي لا تقبل منحًا وطلبات قديمة تحت حالة استخدام فارغة.
- حجز الميزانية يسبق I/O ويُحسب حتى إذا فشلت الكتابة لاحقًا؛ هذا اختيار fail-closed يمنع تجاوز الميزانية بالتزامن، وليس بروتوكول retry مكتملًا.
- لا واجهة لإبطال grants أثناء التشغيل في هذه الحزمة؛ تتطلب دورة مفاتيح وإبطالًا موثقًا لاحقًا.
- العملاء القدماء الذين يرسلون `evidenceRef` فقط لن يتمكنوا من الكتابة. التوافق غير الآمن ليس fallback مقبولًا.

**تراجع آمن:** تعطيل إعداد الكتابة وإعادة تشغيل الخادم يعيدان default-deny؛ إيقاف الخادم يمنع الوصول لبقية المسارات أيضًا. لا تعكس الإصلاح بإعادة route غير المفوض، ولا تفترض أن تعطيل التفويض يعكس كتابة سبق إتمامها. لم تُنفّذ كتابة أو ترحيل بيانات على بيئة حقيقية أثناء العمل.
