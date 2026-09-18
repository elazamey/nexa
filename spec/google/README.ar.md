# GOOGLE IDENTITY CELL — G0 (v1.1) — الملخّص العربي الملزم

> **الحالة: تصميم فقط، ومسودّة تصميم لا أكثر.** لم تُلمس شيفرة، ولا حزمة، ولا تبعية، ولا CI،
> **ولم يُضَف أي رمز خطأ جديد** أثناء التصميم. كل رمز جديد يُسجَّل في نفس الـcommit الذي يضيف
> السلوك الذي يستعمله.
>
> المواصفة الكاملة (إنجليزية، ملزمة): [`identity-cell.md`](identity-cell.md)
> سجل المراجعة والأحكام الأربعة: [`review-g0.ar.md`](review-g0.ar.md)

القاعدة الحاكمة:

> **Google تُثبت مَن أنت، وNEXA تقرّر ما تستطيع فعله.**
> Google مزوّد هوية، وليست سلطة. لا شيء في هذه المرحلة يمنح أو يوسّع أو يفوّض قدرة في NEXA.

المالك داخل النطاق: `canyoudfg@gmail.com` — **للعرض فقط**: ليس مفتاحًا، ولا صلاحية، ولا شرطًا
للوصول، ولا وسيلة ربط.

## سجل المراجعة (v1 → v1.1)

| البند المراجَع | الحكم | أين صار النص الملزم |
| --- | --- | --- |
| المسار A مقابل B | **CHANGE REQUIRED** | § A.2 — A هو المسار الوحيد في v1، وB مؤجَّل إلى G2 ومُعطَّل افتراضيًا |
| جدول نطاقات OAuth | **CHANGE REQUIRED** | § B.1 — `GOOGLE_SCOPE_TABLE` بسبعة حقول إلزامية وثلاث قواعد منع |
| الفئة D | **CHANGE REQUIRED** | § G0-E — الفئة دالة للثلاثي `(resource, action, scope/effect)`، و`max_class` ثابت نواة |
| الإلغاء / break-glass | **CHANGE REQUIRED** | § C.2 القاعدتان 5 و6 — استرداد فقط، محدود زمنًا، الدليل أولًا |

## الثوابت التي تُثبّتها هذه المرحلة

```text
Google proves identity.            NEXA decides authority.
Owner identity ≠ capability subject.
email = display metadata.          sub = identity anchor.
stored identity = sha256("NEXA/google1 subject\0" || sub)
gmail.send = privileged operation + capability + policy + owner approval + pre/post evidence
No write before evidence.
Break-glass = time-bounded recovery state, never Authority.
```

---

## G0-A — عقد الهوية (v1.1)

### المفتاح

- **`sub` هو مفتاح الهوية**، ويُخزَّن فقط مُجزَّأً:
  `sub_hash = sha256("NEXA/google1 subject\0" || sub)`.
- **البريد بيانات عرض**، ويُجزَّأ عند السماح بتخزينه:
  `email_hash = sha256("NEXA/google1 email\0" || email)`.
- **البريد لا ينشئ ملكية ولا سلطة ولا قدرة ولا ربطًا** — لا في v1 ولا في أي مسار لاحق.

### قرار المسار (ملزم)

```text
G0-A is the sole identity-verification path for v1.

G0-A MUST:
- validate the Google ID token signature against an explicitly configured
  Google JWKS source;
- validate issuer;
- validate audience against the exact configured NEXA web client ID;
- validate azp whenever the token semantics require it;
- validate nonce according to the authentication flow;
- validate exp and iat;
- reject any mismatch fail-closed.

The NEXA owner identity MUST be derived from Google `sub`.
Email MUST be presentation metadata only and MUST NOT establish ownership,
authority, capability, or account binding.

G0-B is deferred to G2 and MUST remain disabled by default.
No G2 activation is permitted until its own identity, token, scope,
revocation, evidence, and adversarial contracts are separately approved.
```

والقيم المهيّأة التي تُحقّق كل بند — وقيمة غير مهيّأة = رفض، لا افتراضي:

| المتطلب | القيمة المهيّأة | القاعدة |
| --- | --- | --- |
| مصدر المفاتيح | `https://www.googleapis.com/oauth2/v3/certs` مثبّتًا بالمُصدِر | تخزين بالمفتاح `kid`؛ مفتاح مجهول ⇒ تحديث واحد ثم رفض |
| المُصدِر | `accounts.google.com` أو `https://accounts.google.com` | مطابقة تامة، بلا بادئة أو لاحقة أو بدائل |
| الجمهور | معرّف عميل NEXA الوحيد لهذه البيئة (`GCLIENT_ID`) | مطابقة تامة؛ عميل واحد لكل بيئة؛ يُسجَّل في posture كـ`aud_hash` لا كنص |
| `azp` | إلزامي متى ما اقتضته دلالة الرمز — أي إذا كان `aud` مصفوفة أو اختلف الطرف المصرَّح له عن الجمهور — ويساوي `GCLIENT_ID` | غيابه عند اللزوم ⇒ رفض |
| `nonce` | تحدي هذه الجلسة، بحسب المسار الفعلي | مطابقة تامة، ولا يُرى مرّتين؛ ومسار لا يستطيع حمل nonce لمرّة واحدة **ليس مسار هوية مقبولًا** |
| `exp` / `iat` | حقول الرمز | إلزاميان وبثوانٍ صحيحة؛ الآن ضمن `[iat − 60s, exp]`؛ منتهٍ أو غير ناضج ⇒ رفض |
| أي تعارض | — | رفض؛ لا قبول جزئي ولا مسار بديل |

### لماذا G0 هوية فقط — بحسب توثيق Google نفسه

- **وضع Testing**: حتى **100 مستخدم اختبار**، و«تفويضات مستخدم الاختبار تنتهي بعد سبعة أيام من
  لحظة الموافقة»، **بما في ذلك رمز التجديد** إذا طُلب `access_type=offline`.
- **الاستثناء هو هذه المرحلة بالضبط**: طلب مجموعة فرعية من الاسم والبريد والملف الشخصي
  (`userinfo.email`, `userinfo.profile`, `openid`) يُخرج التطبيق من ذلك الشرط — والمستخدمون لا
  يحتاجون أن يكونوا في قائمة الاختبار، **والتفويض لا ينتهي بعد 7 أيام**، وينطبق هذا على
  Sign in with Google.
- أي نطاق آخر يُخرجك من الاستثناء، والنطاقات الحسّاسة/المقيّدة تحتاج تحقّقًا (والمقيّدة تحتاج
  تقييم CASA).

⇒ **v1 لا يطلب أي نطاق OAuth بعد رمز الهوية**، ولا يحمل رمز تجديد، ولا يحتاج خزينة لأجل الهوية.
شرط السبعة أيام لا يدخل G0 إطلاقًا؛ ويصير **إعادة تفويض مُخطَّطة** في مراحل الخدمات (§ B.5).

### مسار Firebase — مؤجَّل لا مقبول

يُقبل لاحقًا كنقل فقط، وبأربعة شروط: وجود `firebase.identities["google.com"][0]` (معرّف Firebase
ليس `sub` ولا يُستبدل به صامتًا)، وتثبيت مصدر مفاتيح `securetoken@system.gserviceaccount.com`
بالاسم، وإثبات أن المسار يحمل الـ`nonce` المطلوب في الخطوة 6، وتفعيل صريح بالإعداد — **والإعداد
شرط لا سلطة**. إلى أن يتحقق ذلك: رمز Firebase مرفوض (`OMEGA_E_IDENTITY`).

### ترتيب التحقق (ملزم)

```text
1. shape      — ثلاثة مقاطع، alg = RS256، وجود kid
2. signature  — مصدر المفاتيح المهيّأ، بالمفتاح kid؛ مجهول ⇒ تحديث واحد ثم رفض
3. issuer     — مطابقة تامة
4. audience   — مطابقة تامة؛ وعند مصفوفة aud أو اختلاف azp: وجوده وإلزامية مساواته
5. window     — exp و iat موجودان وبثوانٍ؛ الآن ضمن [iat - 60s, exp]
6. nonce      — تحدي الجلسة، مطابقة تامة، ولا يُرى مرّتين
7. subject    — sub؛ غائب أو فارغ أو أطول من 255 بايت ⇒ رفض
8. email      — email_verified إلزامي لعرض البريد
```

فشل أي خطوة = نهاية التحقق لهذا الرمز؛ **لا إعادة محاولة بقواعد مخفّفة**، ولا إعادة ترتيب، ولا
تطبيق جزئي. والناتج الوحيد الذي يعبر الغشاء هو `Principal` بلا أي قدرة وبلا أي دور.

---

## G0-B — نطاقات الموافقة (ملزم)

### الثابت القانوني

```text
GOOGLE_SCOPE_TABLE is a canonical specification constant.

Every scope row MUST contain:
- cell / action / question_answered / full OAuth scope URI
- Google sensitivity/restriction classification
- v1_required / approval_class

A scope MUST NOT be requested unless an enabled Cell has a documented
action whose contract requires that scope.

Scopes MUST be requested incrementally and in the narrowest form that
satisfies the Cell's contract.
```

قواعد القبول الثلاث:

```text
No Cell → No Scope
No Action → No Scope
No documented question → No Scope
```

الجدول ثابت مُجمَّد في البوابة؛ أي نطاق خارجه مرفوض، **ولا إعداد يوسّعه** — التوسيع موافقة جديدة
وسجل دليل ومراجعة جديدة.

| الخلية | الفعل | السؤال الذي تجيبه | النطاق الكامل | تصنيف Google | v1 | الفئة |
| --- | --- | --- | --- | --- | --- | --- |
| `google.identity` | `verify` | مَن هذا الموضوع؟ | `openid` + `…/userinfo.email` + `…/userinfo.profile` | غير حسّاس | **نعم** | — |
| `google.gemini` | `invoke` | ماذا يجيب النموذج؟ | **بلا OAuth** — مفتاح في الخزينة مقيّد في Console على API واحد | لا ينطبق | لا | B |
| `google.drive` | `read.metadata` | ما الملفات الموجودة؟ | `…/auth/drive.file` مع Google Picker (الأضيق)؛ و`drive.metadata.readonly` فقط إن احتاج السؤال فهرسة الحساب كله | `drive.file` غير حسّاس · `drive.metadata.readonly` **مقيّد** | لا | A |
| `google.drive` | `read.content` | ما داخل هذا الملف المختار؟ | `…/auth/drive.file` (لكل ملف) قبل `drive.readonly` (كل الملفات) | `drive.file` غير حسّاس · `drive.readonly` **مقيّد** | لا | B |
| `google.sheets` | `read.range` | ما قيمة هذا النطاق في الورقة المختارة؟ | `…/auth/drive.file` قبل `spreadsheets.readonly` (كل الجداول) | `drive.file` غير حسّاس · `spreadsheets.readonly` حسّاس (يُراجَع) | لا | B |
| `google.gmail` | `read.message` | ماذا تقول هذه الرسالة؟ | `…/auth/gmail.metadata` (ترويسات فقط) قبل `gmail.readonly` (المحتوى) | كلاهما **مقيّد** | لا | B |
| `google.gmail` | `send` | أي رسالة تخرج من الحساب؟ | `…/auth/gmail.send` | حسّاس | لا | **D** |
| `google.calendar` | `read.events` | ما الموجود في التقويم؟ | `…/auth/calendar.events.readonly` قبل `calendar.readonly` | حسّاس (يُراجَع) | لا | B |
| `google.calendar` | `write.event` | ما الذي يُكتب في التقويم؟ | `…/auth/calendar.events` | حسّاس (يُراجَع) | لا | C→D |

**قاعدتان تجعلان الجدول عقدًا لا زينة:**

1. **أدنى درجة سُلَّم.** يُطلب النطاق الأضيق الذي يجيب السؤال الموثّق. `drive.file` مع Picker هو
   الأضيق للأعمال لكل ملف؛ وقراءة الحساب كله مقيّدة فلا تُطلب إلا إذا احتاجها السؤال فعلًا.
2. **تصنيفان، وكلاهما ملزم.** تصنيف Google وفئة NEXA متعامدان، **ولا يمرّ النداء إلا بهما معًا**.
   وقد لا يتفقان في الاتجاه أصلًا: قراءة البريد **مقيّدة** عند Google والإرسال **حسّاس** فقط —
   وهو عكس سلّم NEXA حيث الإرسال فئة **D**. NEXA لا ترث حكم Google، وتصنيفه المنخفض ليس سببًا
   لتخفيف سلّم NEXA.

**أهلية يجب قولها قبل أن تكون مفاجأة:** Google تقصر النطاقات المقيّدة على فئات تطبيقات محددة
(نسخ ومزامنة · إنتاجية وتعليم · تقارير وأمن)، وتطلب تقييمًا أمنيًا عند تخزين بيانات النطاقات
المقيّدة على خادم — وهذا بالضبط ما تفعله خلية خدمة. لذلك قراءة Drive/Gmail مشروطة بتلك الأهلية،
وخيارات الدرجة الأضيق هي الآلية التي تُصغّر المتطلب لا وعد بتخطّيه.

### B.5 انتهاء تفويض الاختبار حالة متوقَّعة

```text
Expiration of a Testing authorization MUST be represented as an expected
reauthorization condition, not as an integrity or security incident.
```

عمليًا: عند إنهاء المزوّد للتفويض بجدوله، يُسجَّل `CONSENT`، وتُخفَّض الخلية المعنية، وتُنتظر موافقة
جديدة — بلا اعتبار الحدث خرقًا، وبلا حادثة، وبلا إعادة محاولة في حلقة، وبلا محاولة تمديد ذاتية.

### B.2 / B.3 / B.4 (كما هي)

PKCE (S256) إلزامي، `state` لمرّة واحدة، مطابقة دقيقة لـ`redirect_uri`، تبادل الرمز على الخادم
فقط، موافقة تدريجية لكل خلية، ومُحدِّد معدّل وتراجع أُسّي مع single-flight، والحصص تُقرأ وقت
التشغيل لا تُثبَّت، وGemini ليست مجانية بالافتراض (الكلفة من `usage_metadata`)، ومفتاح Gemini
مقيّد في Console، وعميل OAuth منفصل لكل بيئة.

---

## G0-C — ربط المالك (v1.1)

- **جهة واحدة تُنشئ الربط**: مفتاح يثق به المشغّل، وإلا `OMEGA_E_NOT_ACTIVATOR`. **Google لا
  تُنشئ ربطًا أبدًا.**
- **تفرّد الموضوع**: `sub_hash` واحد = ربط واحد نشط، والثاني `OMEGA_E_BINDING_EXISTS` (يُسجَّل عند
  التنفيذ). و`OMEGA_E_DUPLICATE` تبقى بمعناها الحالي (تكرار إعلان) ولا يُوسَّع معناها.
- **التمهيد بالدعوة** من المفتاح المحلي؛ ولا مسار يُنشئ فيه تسجيل دخول ناجح ربطًا لنفسه.
- **البريد لا يربط.**
- **الإلغاء دليل وفوري**: `OWNER_BINDING` بقرار `DENY` وسبب، وإلغاء القدرات بشكل معاملة
  `RevocationSet` نفسها، **وحذف مواد الخزينة لـ`sub_hash` أولًا**؛ والقدرة الملغاة لا تُحيا لاحقًا.
- **الدور بيانات لا سلطة.**

### القاعدة 6 — break-glass (ملزمة)

```text
Break-glass MUST be a recovery-only mechanism.

Rules:
1. Only the `recovery` role may invoke break-glass.
2. Break-glass MUST have a finite expiry.
3. Maximum lifetime MUST NOT exceed 24 hours.
4. A shorter per-operation lifetime SHOULD be used where possible.
5. Break-glass MUST NOT grant, mint, amplify, or proxy Class D capability.
6. Break-glass MUST NOT modify the immutable kernel, verifier,
   policy engine, capability authority, or evidence ledger.
7. A mandatory `reason` MUST exist.
8. Pre-grant evidence MUST be committed before the recovery binding is active.
9. Break-glass bindings MUST NOT be chained or delegated.
10. Any legitimate new owner binding MUST immediately revoke the
    break-glass binding.
11. Revocation MUST itself produce evidence.
12. All break-glass operations MUST be fail-closed and auditable.
```

وأربع نتائج تُقال صراحةً في السجل نفسه:

- **القاعدة 8**: فشل كتابة الدليل = **فشل الربط**؛ لا حالة استرداد بلا سجلها.
- **القاعدة 10**: الحالة لا تبقى بعد عودة المسار الشرعي؛ فسقف 24 ساعة هو **أسوأ حالة** لا نافذة
  تُستهلك.
- **القاعدة 5**: لا تصل الحالة إلى البريد ولا الملفات ولا النموذج بدلًا عن المالك.
- **القاعدة 6**: لا تلمس النواة ولا المدقّق ولا محرّك السياسة ولا سلطة القدرات ولا سجل الأدلة.

و`recovery` ليست دورًا ثانيًا للمالك: هي حالة مؤقتة بقدرات مغلقة. وفي سجل الربط:
`method: 'break-glass'` مع `expires_at: null` أو انتهاء يتجاوز 24 ساعة أو دور غير `recovery` أو
`reason` فارغ = **سجل مرفوض**، لا ربط يُنظَّف لاحقًا.

---

## G0-D — الرمز والخزينة (كما هي، مع ربط B.5)

مادة الهوية تعيش لحظة التحقق فقط · رمز الوصول في الخزينة والخلية ترى handle · رمز التجديد لا
يُحلّ إلا في البوابة · سرّ العميل في بيئة البوابة · مفتاح Gemini في الخزينة · مفتاح الختم في
KMS/سلسلة مفاتيح النظام. الـhandle مرتبط بمفتاح خلية الخدمة (presenter). التجديد في البوابة قبل
الانتهاء بخمس دقائق مع single-flight؛ وفشله `OMEGA_E_TOKEN` + عزل + موافقة جديدة. وإن كان الفشل
لأن المزوّد أنهى التفويض بجدوله فهو حالة § B.5 المتوقَّعة لا حادثة. **الحذف قبل الإلغاء دائمًا.**

---

## G0-E — خريطة القدرات والفئات (v1.1)

### الثابت

```text
Risk class is a property of the triple: (resource, action, scope/effect)
and MUST NOT be inherited solely from Cell identity.

Each Cell manifest MAY declare a maximum permitted class (`max_class`).

An operation whose required class exceeds `max_class` MUST fail during
authorization and MUST NOT mint a capability.
```

السلّم **بالأثر لا بالمثال**: **A** قراءة بيانات وصفية · **B** قراءة محتوى أو استدعاء نموذج بكلفة ·
**C** كتابة داخل كائن مسمّى قابلة للتصحيح · **D** إخراج خارجي أو لا رجعة (إرسال، مشاركة، حذف،
تغيير صلاحية).

- الفئة تتبع العملية لا الخلية؛ فالخلية قد تحمل قراءة منخفضة الأثر وإرسالًا عالي الأثر.
- `max_class` **ثابت نواة**: يُعلن في نواة الخلية، ولا تعدّله الخلية ولا الاقتراح ولا مسار الهوية.
- لأن السقف يُفحص **لحظة سكّ القدرة**، فالعملية الأعلى من السقف تفشل عند التفويض ولا تصل الشبكة أبدًا.

### الفئة D

```text
D capability   ≠   D approval
```

كلاهما مطلوب، والنداء يحتاج الستة معًا:

```text
1. an explicit capability;
2. policy authorization;
3. an explicit owner approval;
4. pre-call intent evidence;
5. single-use approval bound to the exact operation;
6. post-call evidence.

The approval is consumed as part of the invocation and MUST NOT be reusable.
```

**مؤلِّف الموافقة** هو ربط المالك، و**موضوع القدرة** هو مفتاح خلية الخدمة — دوران مختلفان في السجل
نفسه، وهذا ما يجعل «إنسان وافق» و«هوية المالك ليست موضوع قدرة» يتعايشان. وموضوع القدرة في كل
عمليات Google هو **خلية الخدمة دائمًا**، فصار هجوم الوكيل المُلبَّس مستحيلًا بالبنية.

| العملية | المورد | الفعل | القدرة | الفئة |
| --- | --- | --- | --- | --- |
| التحقق من رمز هوية | `cell:google.identity` | `verify` | `identity.verify` | — |
| قراءة بيانات وصفية | `net:google.drive` | `read` | `net.read(scope "drive.metadata")` | A |
| قراءة محتوى | `net:google.drive` | `read` | `net.read(scope "drive.content")` | B |
| قراءة نطاق ورقة | `net:google.sheets` | `read` | `net.read(scope "sheets.values")` | B |
| قراءة رسالة | `net:google.gmail` | `read` | `net.read(scope "gmail.messages")` | B |
| **إرسال رسالة** | `net:google.gmail` | `send` | `net.send(scope "gmail.send")` **+ موافقة** | **D** |
| قراءة أحداث | `net:google.calendar` | `read` | `net.read(scope "calendar.events")` | B |
| توليد نموذج | `model:gemini` | `invoke` | `model.invoke(provider: "gemini")` + handle | B |

بلا منح ⇒ `OMEGA_E_CAP_MISSING` قبل أي عمل شبكي. الميزانيات لكل خلية، وسقف الفئة D أخفض. والقدرة
والـhandle كلاهما مرتبط بمفتاح الخلية: **غير قابلين للنقل**.

---

## G0-F — الأدلة (v1.1)

| النوع | يُكتب عند | أهم الحقول |
| --- | --- | --- |
| `IDENTITY_VERIFIED` | تحقق رمز (أو رفضه) | `sub_hash` · `method` · `issuer` · `aud_hash` · `nonce_id` · `decision` · `code` |
| `OWNER_BINDING` | إنشاء/إلغاء/استبدال ربط — **وقبل تفعيل ربط break-glass** | `binding` · `sub_hash` · `nexa_kid` · `role` · `by` · `method` · `reason` · `expires_at` |
| `CONSENT` | منح/تغيير/رفض نطاقات | `service` · `scopes[]` · `reason` · `decision` |
| `QUOTA` | تقييد أو نفاد حصة | `service` · `retry_after_ms` · `remaining` · `code` |
| `APPROVAL` | منح موافقة فئة D واستهلاكها | `operation` · `approver` · `subject_cell` · `consumed_at` · `evidence_id` |

**لا يدخل الدليل أبدًا**: `sub` خام، البريد خام، رموز الوصول/التجديد، مفاتيح API، محتوى ملفات،
نصوص رسائل، مُدخلات النموذج، أجسام الاستجابات. الحمولة `payload_digest`، واستجابة Google
`UntrustedData` لا تُرقّى إلى دليل بلا تحقق.

---

## G0-G — نموذج التهديد (v1.1)

| # | التهديد | الضابط | رمز الرفض |
| --- | --- | --- | --- |
| T1 | سرقة رمز من الذاكرة/السجلات | خزينة + handle + أدلة مُجزَّأة + أنواع الأسرار | `OMEGA_E_SECRET_EGRESS` |
| T2 | إعادة استخدام nonce | تحدٍّ لمرّة واحدة + نافذة زمنية | `OMEGA_E_NONCE` |
| T3 | خلط الجمهور | `aud` تام + `azp` عند اللزوم | `OMEGA_E_IDENTITY_TOKEN` |
| T4 | انتحال بالبريد | `sub_hash` وحده المفتاح | `OMEGA_E_IDENTITY` |
| T5 | موافقة أوسع من اللازم | `GOOGLE_SCOPE_TABLE` + أدنى درجة + قواعد المنع الثلاث | `OMEGA_E_SCOPE` |
| T6 | استنزاف الحصص | مُحدِّد + تراجع + single-flight + عزل | `OMEGA_E_QUOTA` |
| T7 | الوكيل المُلبَّس | القدرة تسمّي خلية الخدمة + presenter binding | `NEXA_E_CAP_AUDIENCE` |
| T8 | تسريب رمز التجديد | التجديد في البوابة فقط + تدوير | `OMEGA_E_TOKEN` |
| T9 | استجابة خبيثة | `UntrustedData` + شرط التحقق | `OMEGA_E_EVIDENCE_UNTRUSTED` |
| T10 | كذب المتصفح | تحقق خادمي فقط + مفاتيح مثبّتة بالمُصدِر | `OMEGA_E_IDENTITY_TOKEN` |
| T11 | فقدان حساب المالك | break-glass كحالة استرداد ≤ 24 ساعة، ويمحوها ربط شرعي | `OMEGA_E_NOT_ACTIVATOR` |
| T12 | إعادة استخدام هوية جلسة سابقة | `Principal` لكل جلسة فقط | `OMEGA_E_IDENTITY` |
| T13 | استغلال break-glass كتجاوز سلطة | دور `recovery` فقط · ≤ 24 ساعة · لا يلمس النواة/المدقّق/السياسة/السلطة/السجل · الدليل أولًا وفشل-مغلق | `NEXA_E_CAP_AUDIENCE` + `OMEGA_E_CAP_MISSING` |

**خطر متبقٍّ بصراحة**: حساب Google مالك مخترَق = مالك مخترَق؛ لا تصميم يزيل هذا. المضمون أن
الاختراق **لا يوسّع** سلطة NEXA صامتًا، ولا يلمس النواة، ولا يمحو أدلته.

---

## G0-H — شرط القبول للتنفيذ (v1.1)

| المجموعة | المحتوى | العدد |
| --- | --- | --- |
| `google-identity` | متجهات § A.3: صالح · منتهٍ · غير ناضج · مُصدِر خاطئ · جمهور خاطئ · توقيع سيئ · `kid` مجهول · `azp` غائب مع `aud` مصفوفة · nonce مفقود · nonce مُعاد · `sub` مفقود · رمز Firebase مرفوض · تبديل البريد مع ثبات `sub` | ≥ 13 |
| `google-binding` | ربط · تكرار (`OMEGA_E_BINDING_EXISTS`) · توقيع مزوَّر · منشئ غير مخوَّل · ربط منتهٍ · الإلغاء ينتج دليلًا · **تأكيد لكل قاعدة من قواعد break-glass الاثنتي عشرة** | ≥ 16 |
| `google-vault` | لا handle يُحلّ في خلية · لا نمط `ya29.`/`AIza` في أي سجل · single-flight · فشل التجديد يعزل | ≥ 6 |
| `google-capability` | كل عملية بلا قدرتها تُرفض · D بلا موافقة · D بموافقة **مُعاد استخدامها** · تجاوز `max_class` يفشل عند التفويض ولا يسكّ شيئًا · فشل دليل النيّة يرفض النداء · هوية المالك ليست موضوعًا | ≥ 10 |
| `google-quota` | `429` → تراجع · `OMEGA_E_QUOTA` · لا إعادة محاولة عنيفة | ≥ 4 |

- **بلا شبكة**: JWKS ومفاتيح اختبار محلية؛ المسار الحيّ `npm run google:smoke` اختياري وخارج CI.
- **الفئة العدائية الثانية عشرة** `identity-forgery` بثماني هجمات: توقيع مزوَّر · رمز منتهٍ ·
  جمهور خاطئ · إعادة nonce · تصعيد بالبريد · موافقة أوسع من اللازم · وكيل مُلبَّس · وجود مادة رمز في
  الأدلة/السجلات. (استغلال الفئة D وbreak-glass يُؤكَّد قاعدةً قاعدةً في المجموعات أعلاه، فلا يتغيّر
  عدد الهجمات المعتمد.)
- **متجهات مثبّتة**: `spec/vectors/google.json` مع `--check`.

**تعريف الإنجاز**:

```text
0. الـcommit التصميمي تصميم-فقط: بلا شيفرة، بلا تبعية، بلا تغيير CI، وبلا أي OMEGA_E_* جديد
1. اعتماد هذه المواصفة بندًا بندًا مع البنود الأربعة المعدَّلة
2. كل رمز خطأ جديد يُسجَّل في نفس الـcommit الذي يرميه
3. أنواع السجلات الجديدة تُسجَّل في نفس الـcommit
4. npm test ≥ 207 + مجموعات G0 بلا فشل
5. npm run attacks ≥ 31 في 12 فئة، كلها محجوبة
6. node tools/google-vectors.mjs --check متزامن
7. npm run verify يخرج 0، ومسار الهوية يعبر غشاء خلية لا نداء دالة
8. لا شبكة في أي اختبار
```

**رموز تُسجَّل عند التنفيذ فقط (لا شيء منها الآن)**: `OMEGA_E_IDENTITY_TOKEN` ·
`OMEGA_E_NONCE` · `OMEGA_E_SCOPE` · `OMEGA_E_QUOTA` · `OMEGA_E_TOKEN` ·
`OMEGA_E_BINDING_EXISTS`. وموجودة ومُعاد استخدامها كما هي: `OMEGA_E_IDENTITY` ·
`OMEGA_E_SECRET_EGRESS` · `OMEGA_E_EVIDENCE_UNTRUSTED` · `OMEGA_E_APPROVAL_REQUIRED` ·
`OMEGA_E_CAP_MISSING` · `OMEGA_E_NOT_ACTIVATOR` · `NEXA_E_CAP_AUDIENCE` (مربوطة بـpresenter
ومُختبرة فعلًا) · `OMEGA_E_ROUTE` · `OMEGA_E_ISOLATED`.

---

## المراحل بعد G0 (كل مرحلة ببوابتها)

| المرحلة | تضيف | شرط الخروج |
| --- | --- | --- |
| G1 | `google.gemini` (مفتاح في الخزينة، حصص وكلفة) | إجابة عبر عبور غشاء بقدرة؛ لا رمز في الأدلة |
| G2 | `google.drive` · `google.sheets` (بأدنى درجة) **+ مسار Firebase المؤجَّل** | قراءة حقيقية عبر خلية + دليل نطاق وحصة + أهلية النطاقات المقيّدة |
| G3 | `google.gmail` · `google.calendar` (`gmail.send` خلف الفئة D) | الستة كاملة في الأدلة |
| G4 | مسارات الكتابة، تعدّد الروابط، البوابة كنسيج بعقود | عضو Google عضوٌ أول في الكائن بتوازنه |

كل من G2 وG3 يبدأ بمرور تصميم مستقل بعقوده الستة (هوية، رمز، نطاق، إلغاء، أدلة، عدائي) كما بدأ
G0. ولا يُطلب نطاق قبل اعتماد عقود مرحلته؛ و`v1: no` في الجدول هو الصيغة الآلية لهذه القاعدة.

## ما سيُضاف للمستودع بعد الاعتماد فقط

```text
spec/google/identity-cell.md            هذه المواصفة (تصميم فقط، ملزمة)
spec/google/README.ar.md                التمثيل العربي للعقد نفسه
spec/google/review-g0.ar.md             سجل المراجعة والأحكام
spec/vectors/google.json                المتجهات المثبّتة
packages/cells/google/identity/         خلية الهوية (عضو خارجي)
packages/cells/google/gateway/          JWKS + OAuth + الخزينة + المُحدِّد (مزوّد موثوق)
adapters/google/jwks.js                 منفذ الشبكة المُحقَن (اختياري)
tools/google-vectors.mjs                مولد المتجهات
tools/google-smoke.mjs                  حيّ، اختياري، خارج CI
tests/google-*.test.js                  مجموعات H.1
```

لا شيء من هذه القائمة موجود الآن. الوثائق الثلاث أعلاه هي كل منتج G0 حتى هذه اللحظة.
