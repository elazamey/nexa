# عقد Celia COMMIT v1 — مستقل عن WRITE

> **حزمة H1-PERSISTENCE — قياس مرحلتها:** [الدليل والحدود التشغيلية](celia-workspace-commit-h1-persistence.ar.md). H1 الأصلي و20 اختبار استمرارية و39 اختبارًا سابقًا نجحت. H2 وH3 ما يزالان RED. verify في تلك الحزمة: **374 PASS / 2 FAIL من 376**. يلزم مخزن استهلاك دائم خارج root؛ التفاصيل التاريخية أدناه لا تعني اجتياز الحدود الثلاثة الآن.

**التاريخ:** 20 سبتمبر 2026. هذا عقد لحد HTTP في `tools/`، وليس فتحًا لبوابات NEXA `Endpoint` أو صلاحية Git commit.

**حالة التنفيذ:** طُبق العقد واختُبر محليًا؛ [دليل RED → GREEN و353/353 السابق](celia-workspace-commit-green.ar.md). الحدود المذكورة في القسم 7 ما تزال قائمة، وأصبحت لها [ثلاث حالات hardening RED مثبتة تشغيليًا](celia-workspace-commit-hardening-red.ar.md). لا يُستنتج من GREEN السابق اجتياز هذه الضمانات الإضافية.

## 1. الحد والنطاق

`POST /api/v1/workspace/commit` يطبّق محتوى staging على الجذر المحلي. وجود workspace أو `evidenceRef` أو WRITE grant ليس تفويضًا لهذه العملية. الإعداد المستقل `CELIA_WORKSPACE_COMMIT_AUTH` يتضمن `audience` و`capabilityIssuers` و`rules`، ويكون default-deny عند غيابه.

تتطابق بنية إعداد القواعد مع WRITE، لكن resource يبدأ بـ`workspace_commit:` والفعل هو **`commit`**. لا توريث لإعداد WRITE ولا fallback إليه. لا مفاتيح خاصة في الإعداد؛ يحدد المشغّل الهويات والمُصدرين الموثوقين، وتظل مفاتيح توقيع العميل والمُصدر خارجه.

## 2. الطلب الموقع

الجسم الخارجي:

```text
{ workspaceId, targetRoot, changeSetHash, expectedBaseHash, authorization }
```

`authorization` هي NEXA CALL envelope:

- `from`: principal مثبت بالتوقيع؛ يطابق subject الـcapability.
- `to`: audience الموثوقة في إعداد COMMIT.
- `body.action`: `commit`.
- `body.resource`: `workspace_commit:` ثم SHA-256 hex للتمثيل القانوني `{workspaceId, targetRoot}`.
- `body.args`: الحقول الأربعة مضافًا إليها `method: POST` و`route: /api/v1/workspace/commit`.
- `body.capability`: grant من مُصدر موثوق للفعل `commit` والمورد المطابق تمامًا؛ `cap` يطابق معرفها.
- صلاحية زمنية لكل من envelope وcapability؛ grant أحادية الاستخدام `max_uses: 1` وغير قابلة للتفويض لاحقًا `max_depth: 0`.

قيود grant إلزامية ومتطابقة، كي لا يستطيع حاملها إعادة توقيع محتوى مستقبلي مختلف:

```text
workspace_id       = workspaceId
target_root        = targetRoot
change_set_hash    = changeSetHash
expected_base_hash = expectedBaseHash
```

تُرفض القيود الإضافية غير المدعومة. السياسة يجب أن تسمح للـprincipal بالفعل والمورد؛ لا تمنح capability ذاتيًا، ولا يُقبل WRITE token ولو كانت envelope موقعة للعملية commit.

## 3. تعريف البصمات

جميع البصمات كاملة SHA-256؛ ليست البصمات المقتطعة في منفذ workspace القديم.

- **targetRoot:** `sha256Multihash` للبايتات UTF-8 للنص `CELIA/commit/root/v1\0` متبوعًا بالمسار المطلق المحلول للجذر. يتحقق الخادم أنه يخص جذره، لا جذرًا يختاره العميل.
- **changeSetHash:** بصمة canonicalBytes للكائن `{ domain: 'CELIA/commit/changes/v1', files }`؛ `files` مصفوفة مرتبة حسب المسار النسبي ASCII، وكل عنصر `{path, hash, size}` يصف ملف staging عاديًا وبايتاته كاملة. تغطي القائمة جميع ملفات staging، لا قائمة يرسلها العميل. حتى إضافة/حذف ملف غير مستهدف سابقًا تغيّر البصمة.
- **expectedBaseHash:** بصمة canonicalBytes للكائن `{ domain: 'CELIA/commit/base/v1', files }`؛ لكل مسار في staging عنصر `{path, exists, hash, mode}` يصف حالة ملف الجذر قبل التطبيق. الغائب يُمثّل بـ`exists: false, hash: null, mode: null`، والموجود ببصمة بايتاته و`mode & 0o7777`.

**حد expectedBaseHash:** يغطي ملفات الجذر المقابلة لقائمة staging، وليس كل المستودع أو Git HEAD. تغيير ملف جذري غير مستهدف لا يبطل الإذن ولا يجيز تعديله. لا تُنقل صلاحيات staging إلى الجذر، ولا تنفذ هذه النسخة حذف ملفات أو إنشاء روابط.

تُحسب البصمات للموافقة من أداة محلية موثوقة؛ لا تُضاف API عامة غير مفوضة لاستصدار موافقات. الدالة `inspectWorkspaceCommit` للقراءة فقط لا تصدر صلاحيات.

## 4. ترتيب التنفيذ

```text
Identity signature/freshness
  → server audience
  → signed intent binding
  → trusted capability + exact constraints
  → policy ALLOW
  → workspace lookup + target/root scope
  → current staging/base snapshot
  → both hashes match
  → reserve single use + replay protection
  → execute captured bytes synchronously
  → record commit evidence metadata
```

لا mutation قبل مرور التفويض والتحقق من الحالتين. تُفحص كل الملفات المستهدفة قبل أول كتابة. تُنفذ البايتات التي حُسبت بصمتها، وليس إعادة نسخ staging قد تكون تغيرت بعد القراءة. لا `await` بين قراءة الحالة والتحقق والحجز والتنفيذ، فلا تتداخل معها طلبات WRITE داخل عملية Node نفسها.

المنفذ المقيد يرفض المسارات الغامضة أو المخفية، والروابط الرمزية في staging أو مسار الهدف، والملفات غير العادية والروابط الصلبة المتعددة. المعرف ومسارات الملفات محدودة الطول؛ حد 128 ملفًا وعمق 16 مجلدًا و8 MiB إجمالي محتوى staging، وكذلك 8 MiB إجمالي محتوى ملفات base المقروءة. لا يصبح تفويض صحيح تصريحًا بالكتابة إلى `.git` أو خارج الجذر.

## 5. أكواد النتيجة

| الحالة | HTTP |
|---|---|
| غياب إثبات الهوية أو توقيع/نافذة envelope غير صالحين | 401 |
| غياب/بطلان capability، ومنها انتهاء صلاحيتها، أو اختلاف المورد/العملية/السياسة | 403 |
| اختلاف workspace أو targetRoot أو changeSetHash أو expectedBaseHash | 403 |
| إعادة استخدام الطلب أو grant | 403 |
| مدخلات JSON/شكل الطلب غير صالحة | 400 |
| جسم HTTP أكبر من 128 KiB | 413 |
| فشل I/O بعد السماح | 500؛ لا يُعرض كرفض تفويض بلا أثر |

نجاح COMMIT يعيد الملفات المطبقة وبصماتها، و`authorizationRef` كبصمة الطلب الموقع. يسجل الخادم principal وcapabilityId وpolicy rule والبصمات في حدث `WORKSPACE_COMMIT`. السجل الحالي داخل الذاكرة وغير موقع: ليس سجل أدلة دائمًا أو إيصال NEXA مستقلًا.

## 6. شروط القبول

- الاختبارات الثلاثة الأصلية لـCOMMIT RED تصبح خضراء دون تعديلها.
- anonymous = 401، signed/no capability = 403، WRITE-only = 403.
- COMMIT grant صالحة لـA مع محاولة B = 403.
- انتهاء grant، replay، اختلاف staging أو base أو root أو مورد/فعل = 403 دون mutation.
- حالة ALLOW تنفذ على filesystem حقيقي وتغير الملفات المعتمدة فقط، مع بقاء staging والملفات الأخرى كما كانت.
- بقاء اختبارات WRITE الأصلية دون تعديل، ثم regression كامل وقياسات موثقة.

## 7. حدود لا يُدّعى حلها

- لا ذرية متعددة الملفات أو rollback عند عطل القرص؛ فشل التطبيق قد يترك كتابة جزئية، وتظل grant مستهلكة fail-closed.
- هذا تنفيذ محلي في عملية واحدة، مع جذر تملكه العملية ولا يغيره كاتب خارجي متزامن. فحص الروابط وغياب `await` ليسا ضمانًا ضد سباق filesystem من عملية خارجية؛ يلزم عزل/قفل على مستوى النظام لتلك الحالة.
- replay والاستخدام في الذاكرة، لا عبر restart أو عدة instances. يلزم audience جديدة بعد restart في التجارب المحلية وعدم إعادة استخدام grants القديمة؛ التخزين الدائم والتنسيق لاحقًا.
- لا إصلاح لـcreate أو rollback أو مسارات التعديل الأخرى أو Supabase. منع النشر العام ما يزال قائمًا.
