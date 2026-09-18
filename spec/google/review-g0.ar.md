# G0 — سجل المراجعة والأحكام (Review Record)

> **الحالة: مُغلق بالأحكام.** راجع المالك النقاط الأربع وأصدر **CHANGE REQUIRED** في الأربعة،
> والنصوص البديلة الملزمة صارت جزءًا من العقد في [`identity-cell.md`](identity-cell.md)
> وفي التمثيل العربي [`README.ar.md`](README.ar.md).
>
> هذا الملف يبقى **سجلًا**: ما كان معروضًا، وما حُكم فيه، وما صار إليه. المقترحات أدناه
> **مُستبدَلة** بالنصوص المعتمدة، ولا تُقرأ كنص سارٍ.

---

## 0. الأحكام الأربعة (منفَّذة)

| البند | الحكم | النص الملزم الآن في |
| --- | --- | --- |
| A مقابل B | **CHANGE REQUIRED** | `identity-cell.md` § A.2 (+ A.2.1، A.2.2) |
| جدول النطاقات | **CHANGE REQUIRED** | `identity-cell.md` § B.1 (+ B.5) |
| الفئة D | **CHANGE REQUIRED** | `identity-cell.md` § G0-E / E.0 |
| الإلغاء وbreak-glass | **CHANGE REQUIRED** | `identity-cell.md` § C.1 و C.2 القاعدة 6 |

الحكم النهائي كما ورد:

```text
A vs B                     → CHANGE REQUIRED
Scope Table                → CHANGE REQUIRED
Class D                    → CHANGE REQUIRED
Revocation / Break-glass   → CHANGE REQUIRED

الغرض من التعديل كله: تحويل النوايا الصحيحة الموجودة بالفعل
إلى invariants قابلة للاختبار.
```

### النصوص البديلة المعتمدة (حرفيًا)

**1) المسار A مقابل B**

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

**2) جدول النطاقات**

```text
GOOGLE_SCOPE_TABLE is a canonical specification constant.

Every scope row MUST contain:
- cell
- action
- question_answered
- full OAuth scope URI
- Google sensitivity/restriction classification
- v1_required
- approval_class

A scope MUST NOT be requested unless an enabled Cell has a documented
action whose contract requires that scope.

Scopes MUST be requested incrementally and in the narrowest form that
satisfies the Cell's contract.

Expiration of a Testing authorization MUST be represented as an expected
reauthorization condition, not as an integrity or security incident.
```

**3) الفئة D**

```text
Risk class is a property of the triple:

(resource, action, scope/effect)

and MUST NOT be inherited solely from Cell identity.

Each Cell manifest MAY declare a maximum permitted class (`max_class`).

An operation whose required class exceeds `max_class` MUST fail during
authorization and MUST NOT mint a capability.

Class D operations additionally require:
1. an explicit capability;
2. policy authorization;
3. an explicit owner approval;
4. pre-call intent evidence;
5. single-use approval bound to the exact operation;
6. post-call evidence.

The approval is consumed as part of the invocation and MUST NOT be reusable.
```

مع قرار التسمية: **`OMEGA_E_BINDING_EXISTS` أوكِد** بدلًا من توسيع `OMEGA_E_DUPLICATE`، التي
تبقى بمعناها الحالي (تكرار declaration) حفاظًا على حسم التشخيص والاختبارات.

**4) break-glass**

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

مع المبدأ الذي أضافه المالك: **break-glass ليس قدرة جديدة واسعة؛ هو حالة استرداد محدودة زمنيًا
ولا يستطيع تحويل نفسه إلى Authority.**

### قرار الـcommit (كما ورد)

```text
بعد إدخال النصوص الأربعة في: identity-cell.md · README.ar.md · review-g0.ar.md
        ↓
DESIGN ONLY · NO CODE · NO DEPENDENCIES · NO CI MUTATION
        ↓
git commit → design-only G0 commit → PR #2
        ↓
G0-H: 5 test groups · 8 identity-forgery attacks · spec/vectors/google.json
```

ولا `OMEGA_E_*` جديد أثناء التصميم: كل رمز يُسجَّل في نفس الـcommit الذي يضيف السلوك الذي
يستعمله. وG0 **لا يُعلن APPROVED** قبل أن تصبح التعديلات الأربعة جزءًا من النص الملزم — وهذا
ما تحقّق في v1.1.

---

## 0.1 ما تبقّى من هذه الوثيقة

الأقسام من 1 إلى 10 أدناه هي **سجل المراجعة** كما قُدّمت: النص الحرفي لِv1، والفجوات، والمقترحات،
والأسئلة. المقترحات فيها (PA/PB/PD/PR) قابلة للمقارنة مع النصوص المعتمدة أعلاه — وقد أُخذ بمعظمها،
مع ثلاثة فروق يُسجَّلها التاريخ بصراحة:

| المقترح في الحزمة | ما اعتُمد | الفرق |
| --- | --- | --- |
| `max_class` يُفحص عند **التعريف** | يُفحص عند **التفويض** ولا يسكّ قدرة (ونص المالك: `MAY declare`) | أوسع قليلًا لكنه صريح: الفشل عند التفويض لا عند التسجيل |
| رمز جديد `OMEGA_E_BREAKGLASS_UNBOUNDED` | لم يُسمَّ رمز؛ القاعدة «انتهاء منتهٍ إلزامي» بلا تسمية رمز الآن | الالتزام بقاعدة «لا رمز أثناء التصميم» |
| تصنيف كل نطاق + أهلية النطاقات المقيّدة | معتمَد، مع إضافة `(confirm)` للأصناف التي تُراجَع من قائمة المزوّد وقت التنفيذ | أدقّ من الادّعاء من الذاكرة |

---

## 1. البند الأول — مسارا التحقق A و B

### 1.1 النص الحرفي

**§ A.1 (مقتطف):**

> **`sub`** — Google ID token `sub` claim — **the identity key** — stable, never reused by Google
> `email` — token `email` + `email_verified` — **display only**; never a key, never a permission,
> never matched for access

```text
sub_hash   = sha256("NEXA/google1 subject\0" || sub)      // 32-byte digest, hex
email_hash = sha256("NEXA/google1 email\0"   || email)    // only when policy allows storage at all
```

**§ A.2 — الجدول كما هو:**

| Path | Token | Issuer check (`iss`) | Audience check (`aud`) | Identity key |
| --- | --- | --- | --- | --- |
| **A — Google Identity Services (preferred)** | Google ID token (JWT, RS256) | `accounts.google.com` or `https://accounts.google.com` | our web client id | token `sub` |
| **B — Firebase Auth (transport only)** | Firebase ID token (JWT, RS256) | `https://securetoken.google.com/<project-id>` | `<project-id>` | `firebase.identities["google.com"][0]` |

> Path B is accepted **only** when it carries a linked Google provider identity. A Firebase token
> whose Google provider identity is absent is refused (`OMEGA_E_IDENTITY`): a Firebase UID is not a
> Google subject, and v1 does not silently substitute one.

**§ A.3 — الترتيب الملزم:**

```text
1. shape      — three base64url segments, JOSE header alg = RS256, kid present
2. signature  — JWKS of the issuer, cached by kid; unknown kid ⇒ one refresh, then refuse
3. issuer     — exact match against the table in § A.2 (no suffix or prefix matching)
4. audience   — exact match; azp (when present) must equal the same client id
5. window     — now within [iat - 60s, exp]; exp and iat must be present and integer seconds
6. nonce      — the challenge this session issued, matched exactly, and never seen before
7. subject    — extract sub per path; refuse when absent, empty, or longer than 255 bytes
8. email      — email_verified must be true for the email to be displayed at all
```

> Every step is *fail-closed*: a missing claim is a refusal, not a default.

**§ A.4 — الناتج الوحيد الذي يعبر الغشاء:** `Principal { kind: 'google', sub_hash, email_display,
method: 'gsi' | 'firebase', verified_at, nonce_id, claims }` — «A `Principal` carries **no
capability** and no role by itself.»

### 1.2 ما يقرره النص، وما لا يقرره

| # | نقطة | الحكم |
| --- | --- | --- |
| 1 | مصدر مفتاح الهوية في A هو `sub` مباشرة، وفي B هو claim داخل رمز من مشروعنا | مصدرا حقيقة مختلفان — والنص لا يمنع تشغيل المسارين معًا في نفس النشر |
| 2 | عنوان مصدر المفاتيح (JWKS) غير مذكور لأي مسار | فجوة تنفيذية: A يستخدم `oauth2/v3/certs`، أما B في Firebase فينشر **شهادات x509** أو JWKS على مسار مختلف — يجب تثبيته بالاسم |
| 3 | «our web client id» غير مسمّى، ولا قاعدة «عميل واحد لكل بيئة» في § A.2 (توجد في § B.4 كتوصية) | يجب رفعه إلى قاعدة في A.2 |
| 4 | `azp` اختياري في النص | ثغرة جمهور محتملة إذا كان `aud` مصفوفة |
| 5 | الخطوة 6 تطلب `nonce` لِ**كل** مسار | غير مؤكد أن رمز Firebase يحمل `nonce` بنفس دلالة GSI. إن لم يحمل، فمسار B لا يستطيع الوفاء بالعقد ولا ينبغي تشغيله في v1 |
| 6 | لا `nbf` ولا انحراف ساعة مُعلن | مقبول: المساران لا يستخدمان `nbf`، والانحراف مُغطّى بـ`iat - 60s` |
| 7 | لا نص يمنع تشغيل المسارين في نفس الوقت | خطر تشغيلي: مصدران للهوية يعني مسارين للتحقق واختبارين لكل شيء |

**حقيقة تشغيلية تدعم القرار (تحقّقتُ منها الآن):**

- نطاقات Gmail/Calendar/Drive الحسّاسة أو المقيّدة تتطلب تحقّق Google، وCASA Tier 2 للمقيّدة.
- تطبيق في وضع **Testing** (External): سقف **100 مستخدم اختبار**، و**رموز التجديد تنتهي بعد 7
  أيام** — حتى للحساب موضوع العرض — وحدّ لعدد رموز التجديد لكل حساب/عميل، وتغيير كلمة مرور
  الحساب يُبطل رموز نطاقات Gmail.
- النطاقات الأساسية فقط (`openid` `email` `profile`) لا تخضع للـ7 أيام ولا للسقف.

**الأثر على القرار:** مسار A (رمز هوية فقط) **لا يحتاج refresh token ولا خزينة ولا موافقة نطاقات**
⇒ G0 يبقى بصفر رموز تجديد، وبصفر نطاقات حسّاسة، ومسألة الـ7 أيام لا تدخل في G0 إطلاقًا.

### 1.3 مقترح الحسم (مسودّة — يحتاج حكمك)

| # | المقترح |
| --- | --- |
| PA1 | **المسار A هو الملزم الوحيد في v1.** مسار B يُنقل إلى G2 كبند مستقل باسم `firebase-transport`، ويُعطَّل افتراضيًا |
| PA2 | تشغيل B لاحقًا مشروط بأربعة: (a) `firebase.identities["google.com"][0]` إلزامي وإلا `OMEGA_E_IDENTITY`؛ (b) تثبيت مصدر مفاتيح `securetoken@system.gserviceaccount.com` بالاسم؛ (c) إثبات أن `nonce` المُلزَم في A.3 يعمل في رمز Firebase — وإلا فلا B؛ (d) إعداد صريح، والإعداد **شرط** لا سلطة |
| PA3 | عميل واحد لكل بيئة: `aud` يجب أن يساوي معرّف عميل مثبّتًا في البوابة، ويُسجَّل في posture كـ`aud_hash` لا كنص |
| PA4 | إذا كان `aud` مصفوفة ⇒ `azp` **إلزامي** ويساوي نفس العميل (تعديل على الخطوة 4) |
| PA5 | مصدرا المفاتيح مثبتان بالاسم في المواصفة: A ← `https://www.googleapis.com/oauth2/v3/certs`، B ← JWKS الخاص بـ`securetoken@system.gserviceaccount.com`، وكيل معلوم ⇒ تحديث واحد ثم رفض |

### 1.4 أسئلة تحتاج حكمًا

```text
Q-A1  هل v1 = المسار A وحده (وقرار B مؤجّل إلى G2)؟            [APPROVED | CHANGE REQUIRED]
Q-A2  هل تُثبَّت عناوين JWKS/x509 بالاسم داخل المواصفة؟          [APPROVED | CHANGE REQUIRED]
Q-A3  هل يصبح azp إلزاميًا عند تعدد الجمهور؟                     [APPROVED | CHANGE REQUIRED]
Q-A4  هل تبقى الخطوة 6 (nonce) شرطًا قاطعًا لكل مسار مستقبلي؟    [APPROVED | CHANGE REQUIRED]
```

---

## 2. البند الثاني — جدول نطاقات OAuth

### 2.1 النص الحرفي

> Each service cell gets the **smallest scope that lets it answer one question**, and one consent
> set per cell. A scope that is not in this table cannot be requested by any cell in v1; widening is
> a new consent, a new evidence record and a review.

| Phase | Service cell | Scope(s) | Class |
| --- | --- | --- | --- |
| **G0** | `google.identity` | none beyond the ID token (`openid email profile` via GSI/Firebase) | — |
| **G1** | `google.gemini` | **no OAuth** — API key in the vault, restricted in the Google console to the Generative Language API | B |
| **G2** | `google.drive` | `drive.metadata.readonly` → `drive.readonly` (read-only first) | A → B |
| **G2** | `google.sheets` | `spreadsheets.readonly` | B |
| **G3** | `google.gmail` | `gmail.readonly`; `gmail.send` only with class D controls | B / **D** |
| **G3** | `google.calendar` | `calendar.readonly`; `calendar.events` only with class D controls | B / D |
| **G4** | write paths | `drive.file`, `spreadsheets`, `calendar.events` | C |

> Class **D** (irreversible or egress: `gmail.send`) requires, in addition to a capability: policy
> approval and, in v1, **explicit owner approval** — the same `requiresApproval` gate the Ω authority
> already enforces. `gmail.modify` is not in v1 at all: sending is more reviewable than mutating a
> mailbox.

**§ B.2 (مقتطف):** PKCE (S256) إلزامي · `state` لمرّة واحدة · مطابقة دقيقة لـ`redirect_uri` بلا
بدائل ولا `localhost` في بيئة منشورة · `access_type=offline` و`prompt=consent` **فقط** عند الحاجة
الفعلية إلى رمز تجديد، والسبب يُسجَّل في الأدلة · أسرار العميل في بيئة البوابة فقط · **موافقة
تدريجية**: كل خلية تطلب نطاقها، ولا خلية تُفعّل موافقة خلية أخرى.

**§ B.3 (مقتطف):** مُحدِّد معدّل لكل خلية · `429` ⇒ تراجع أُسّي مع عشوائية + single-flight لكل مورد ·
أرقام الحصص تُقرأ وقت التشغيل **لا تُثبَّت** · النفاد فشل مُحتوى: `OMEGA_E_QUOTA` ثم التوازن ·
Gemini ليست مجانية بالافتراض، والكلفة من `usage_metadata`.

**§ B.4 (مقتطف):** مفتاح Gemini مقيّد في Console على API واحد وعلى أصل/عنوان العبور · عميل OAuth
منفصل لكل بيئة · تغيير حد مشروع Drive يُعالج كمُحدِّد لا كتاريخ.

### 2.2 ما يقوله الجدول، وما ينقصه

| # | ملاحظة | الأثر |
| --- | --- | --- |
| 1 | الأسماء مختصرة (`gmail.readonly`) | التنفيذ يحتاج **العنوان الكامل** (`https://www.googleapis.com/auth/gmail.readonly`)؛ بلا جدول ربط مثبّت سيظهر الخطأ وقت التشغيل لا وقت التعريف |
| 2 | «أصغر نطاق» معيار صحيح لكنه **غير قابل للاختبار** كما هو | يحتاج عمود "السؤال الذي تجيبه الخلية"؛ نطاق بلا سؤال = يُحذف |
| 3 | الجدول لا يصنّف النطاقات بحسب سياسة Google | `gmail.*` و`calendar.*` حسّاسة/مقيّدة: تحتاج تحقّقًا؛ وفي Testing: 100 مستخدم + رموز تجديد 7 أيام |
| 4 | `spreadsheets.readonly` هو الأصغر فعلًا لقراءة ورقة يملكها المستخدم | لا يوجد بديل أضيق عبر OAuth (نطاق الملف الواحد `drive.file` لا يمنح قراءة ملفات المستخدم) — فيبقى مع غطاء الفئة B والحصص |
| 5 | `drive.metadata.readonly → drive.readonly` تصاعد مُبرَّر | جيد: الخطوة الأولى لا تكشف محتوى |
| 6 | استبعاد `gmail.modify` مُعلَّل | جيد، والعلّة قابلة للاختبار: الإرسال يترك أثرًا خارجيًا مرئيًا |
| 7 | G0 = صفر نطاق OAuth | **هذا هو أهم سطر في الجدول**: G0 لا يجرّ شيئًا من فخ الـ7 أيام |
| 8 | لا نص عن *ماذا يحدث عند انتهاء refresh المتوقع* | يجب أن يصبح إعادة موافقة مُخطَّطة (`CONSENT` جديد) لا حادثة ولا محاولة صامتة |

### 2.3 مقترح (مسودّة)

| # | المقترح |
| --- | --- |
| PB1 | جدول النطاقات يصبح ثابتًا مُجمَّدًا `GOOGLE_SCOPE_TABLE` في البوابة: أي نطاق خارج الجدول ⇒ `OMEGA_E_SCOPE`، ولا إعداد قادر على توسيعه |
| PB2 | كل صف يضيف ثلاثة أعمدة: **السؤال** · **النطاق الكامل** · **تصنيف Google (أساسي/حسّاس/مقيّد)** |
| PB3 | قاعدة «لا نطاق قبل خلية تجيبه»: أي نطاق يُطلب دون خلية مُعلَنة وسؤال مكتوب = مرفوض في المراجعة |
| PB4 | G0 يبقى **صفر نطاق OAuth** (ID token فقط)، وكل نطاق آخر يُفعَّل في مرحلته مع `CONSENT` مستقل |
| PB5 | سياسة وضع Testing تُكتب في العقد: انتهاء رمز التجديد كل 7 أيام = **إعادة موافقة مُتوقَّعة** تُسجَّل `CONSENT`، وخروج آمن (`OMEGA_E_TOKEN` + عزل) بلا محاولات صامتة؛ والإنتاج يتطلب نشر التطبيق/التحقق |
| PB6 | مفتاح Gemini يبقى بلا OAuth، مع تسجيل الكلفة لكل نداء من `usage_metadata` |

### 2.4 أسئلة تحتاج حكمًا

```text
Q-B1  هل يُجمَّد الجدول كثابت (نطاق خارج الجدول = رفض)؟             [APPROVED | CHANGE REQUIRED]
Q-B2  هل تُضاف أعمدة السؤال/النطاق الكامل/تصنيف Google؟              [APPROVED | CHANGE REQUIRED]
Q-B3  هل تقبل قاعدة "انتهاء 7 أيام = إعادة موافقة مُتوقَّعة" في G3؟    [APPROVED | CHANGE REQUIRED]
Q-B4  هل يبقى `spreadsheets.readonly` مع غطاء B والحصص؟              [APPROVED | CHANGE REQUIRED]
Q-B5  هل تُحذف `calendar.events` من G4 إلى مراجعة لاحقة؟             [APPROVED | CHANGE REQUIRED]
```

---

## 3. البند الثالث — الفئة D

### 3.1 كل ما تقوله الوثيقة عن D

| الموضع | النص الحرفي |
| --- | --- |
| § B.1 | «Class **D** (irreversible or egress: `gmail.send`) requires, in addition to a capability: policy approval and, in v1, **explicit owner approval**» |
| § G0-E الجدول | `send a message` / `net:google.gmail` / `send` / `net.send(scope "gmail.send")` **+ approval** / **D** |
| § G0-E #2 | «**Budgets are per cell**: calls/minute, payload bytes, token cost, and a class-D ceiling that is lower still» |
| § G0-E #3 | «**Class D requires approval** (`OMEGA_E_APPROVAL_REQUIRED` when missing) and writes an evidence record *before* the call and after it» |
| § G0-E #4 | «**Owner identity is never a capability subject.**» |

**الحقيقة التي يجب أن تعرفها بوضوح:** الحروف `A / B / C / D` **تُستخدم** في جدولين ولا
**تُعرَّف** في أي مكان من المواصفة، ولا توجد **قواعد انتقال** بينها. هذا نقص في الوثيقة، لا في
الملخص. ما فوق هو كل ما يوجد عن D.

### 3.2 مقترح تعريف السلّم (مسودّة)

التعريف **بالمعيار** (الأثر) لا بالمثال، وإلا فكل خدمة جديدة تحتاج اجتهادًا جديدًا:

| الفئة | المعيار (الأثر الخارجي) | مثال | الحد الأدنى المطلوب |
| --- | --- | --- | --- |
| **A** | قراءة بيانات وصفية؛ لا محتوى، لا إخراج | `drive.metadata` | قدرة + حصة |
| **B** | قراءة محتوى، أو استدعاء نموذج بكلفة | `gmail.messages`, `sheets.values`, `model:gemini` | قدرة + حصة + كلفة محسوبة |
| **C** | كتابة محدّدة النطاق قابلة للتصحيح داخل كائن | `drive.file`, `spreadsheets` (G4) | قدرة + سياسة + دليل قبل/بعد |
| **D** | إخراج خارجي أو لا رجعة | `gmail.send`, حذف، مشاركة، تغيير صلاحية | قدرة + سياسة + **موافقة مالك** + دليل نيّة قبل النداء |

**قواعد الانتقال (مسودّة):**

| # | القاعدة |
| --- | --- |
| PD1 | الفئة خاصية للثلاثي `(resource, action, scope)` — **لا** للخلية. الخلية تعلن `max_class` |
| PD2 | `max_class` يُعلن في النواة عند التعريف؛ قدرة تتجاوز السقف = **خطأ زمن-تعريف/تسجيل لا زمن-نداء** |
| PD3 | **توسيع** (A→…→D): يتطلب `CONSENT` جديدًا + قدرة جديدة **تُسكّ** (لا تُمدَّد) + إعادة مراجعة الفئة. خلية لا توسّع نفسها أبدًا |
| PD4 | **تقليص** مسموح فوريًا ويُسجَّل (`CONSENT` + `decision`) — التقليص لا يحتاج موافقة |
| PD5 | لا تغيّر فئة بغير سجل؛ الفئة الفعلية تُقرأ من السجل لا من إعداد |
| PD6 | كل نداء فئة D يحمل **موافقة لكل نداء** (أو دفعة بحدّ عدد + سقف زمني قصير)؛ الموافقة **تُستهلك** كالـnonce، وإعادة استخدامها رفض |
| PD7 | الدليل سبق: شهادة **نيّة** قبل النداء، و**نتيجة** بعده؛ فشل كتابة دليل النيّة = لا نداء |
| PD8 | تحرير حاسم: **مؤلِّف الموافقة ≠ موضوع القدرة**. الموافقة يوقّعها ربط المالك، والقدرة موضوعها مفتاح خلية الخدمة — فلا تناقض مع `Owner identity ≠ capability subject` |

### 3.3 أسئلة تحتاج حكمًا

```text
Q-D1  هل يُعتمد السلّم بالمعيار (الأثر) لا بالمثال؟                  [APPROVED | CHANGE REQUIRED]
Q-D2  هل `max_class` يُعلن في النواة ويكون تجاوزه خطأ تعريف؟         [APPROVED | CHANGE REQUIRED]
Q-D3  هل الموافقة لكل نداء (لا لكل جلسة) وتُستهلك؟                   [APPROVED | CHANGE REQUIRED]
Q-D4  هل "دليل النيّة قبل النداء" شرط قاطع (فشله = لا نداء)؟          [APPROVED | CHANGE REQUIRED]
Q-D5  هل يبقى `gmail.send` خارج v1 تمامًا (يُنفَّذ في G3 بما فوق)؟     [APPROVED | CHANGE REQUIRED]
```

---

## 4. البند الرابع — الإلغاء و break-glass

### 4.1 النص الحرفي

**§ C.1 — سجل الربط:**

```js
{ binding: 'owner', sub_hash: 'sha256:…', nexa_kid: 'nexa:key:ed25519:z…', role: 'owner',
  created_by: 'nexa:key:ed25519:z…', created_at: '…', expires_at: null | '…',
  method: 'invitation' | 'break-glass', sig: { kind: 'ed25519', kid: '…', val: '…' } }
```

**§ C.2 — القواعد السبع (حرفيًا):**

> 1. **One authority to bind.** Only a key the operator layer trusts may create a binding
>    (`OMEGA_E_NOT_ACTIVATOR` otherwise). Google never creates a binding.
> 2. **Subject uniqueness.** One `sub_hash` has at most one active binding; a second is
>    `OMEGA_E_DUPLICATE`.
> 3. **Bootstrap.** The first binding is created by an invitation signed with the local operator key
>    … There is no path in which a successful Google login creates its own binding.
> 4. **`email` never binds.** Changing the display email changes nothing; only `sub_hash` does.
> 5. **Revocation is evidence.** Revoking a binding records `OWNER_BINDING` with `decision: DENY`
>    and the reason, and revokes the capabilities minted under that role in the same transaction
>    shape used by `@nexa/capability`'s `RevocationSet`.
> 6. **Break-glass.** If the Google account is lost, a local operator key may create a new binding
>    with `method: 'break-glass'`. That record is loud by design: it is the only path that binds
>    without a successful login.
> 7. **Role is data.** `owner` maps to a capability policy (§ G0-E); nothing in the identity cell may
>    grant a capability because a role says "owner".

**§ D.2 (مقتطف):** «**Deletion:** revoking a binding deletes the vault entries for that `sub_hash`
first, then revokes capabilities. A token that survives a revocation is a defect.»

**§ G0-G/T11:** «owner lockout (lost account) — break-glass binding by the local operator key, loudly
recorded — `OMEGA_E_NOT_ACTIVATOR`».

### 4.2 مطابقة النص بشرطك

| شرطك | ما يقوله النص الآن | الحكم |
| --- | --- | --- |
| **استثنائي** | مسار واحد فقط يُربط دون تسجيل دخول، و«loud by design» | ✅ موجود |
| **محدود الزمن** | `expires_at: null \| '…'` — **`null` مسموح**، فلا سقف زمني | ❌ **لا وفاء** |
| **محدود النطاق** | `role: 'owner'` مسموح، ولا سقف فئة ولا حصر قدرات | ❌ **لا وفاء** |
| **قابل للتدقيق** | وصف «loud» لا قاعدة؛ لا `reason` إلزامي، ولا دليل قبل أن يصبح الربط صالحًا | ⚠️ **جزئي** |
| **قابل للإلغاء** | الإلغاء = `OWNER_BINDING` + `DENY` + إلغاء القدرات (موجود) | ⚠️ **ناقص**: لا قاعدة إنهاء فوري عند عودة الربط الشرعي |
| **لا يتجاوز Authority** | لا نص يُبطل القدرة، لكن **لا نص يمنع** منح قدرة فئة D تحت break-glass | ⚠️ **ناقص** |
| **لا يتجاوز Evidence** | لا نص «لا ربط بلا سجل» (فشل السجل = فشل الربط) | ❌ **ناقص** |

### 4.3 مقترح (مسودّة — عشر قواعد)

| # | القاعدة |
| --- | --- |
| PR1 | `method: 'break-glass'` ⇒ `expires_at` **إلزامي غير فارغ**؛ سقف افتراضي 24 ساعة؛ `null` ⇒ رفض برمز صريح (`OMEGA_E_BREAKGLASS_UNBOUNDED`) يُسجَّل في نفس الـcommit الذي يرميه |
| PR2 | الدور الممنوح: **`recovery`** فقط — لا `owner`، ولا `admin` |
| PR3 | **لا سلاسل**: لا يجوز وجود break-glass نشط ثانٍ |
| PR4 | **صفر فئة D** ولا توسيع نطاق تحت `recovery`؛ القدرات المسموحة محصورة في `identity.verify` + `binding.invite` + `key.rotate`، وأي غيرها `OMEGA_E_CAP_MISSING` |
| PR5 | **سقف الفئة لا يرتفع**: break-glass لا يعدّل `max_class` لأي خلية، ولا سقف أي قدرة |
| PR6 | **الدليل أولًا (fail-closed)**: إن لم تُكتب شهادة `OWNER_BINDING` بسبب فشل، لا يُنشأ الربط. فشل السجل = فشل العملية |
| PR7 | `reason` غير فارغ إلزامي، والتوقيع بمفتاح المشغّل المحلي **خارج المستودع** |
| PR8 | **الاستبدال فوري**: أول ربط شرعي جديد يُنهي break-glass في الحال، لا عند انتهائه |
| PR9 | **القدرات لا تُحيا**: المسحوب يبقى مسحوبًا، ويُعاد سكّ قدرات جديدة تحت الربط الجديد؛ لا إعادة استخدام معرّفات |
| PR10 | **تأكيد وتحقّق**: posture يعلن (عدد break-glass النشط ≤ 1، وكلها بلا انتهاء = خطأ)، وCI يرفض: break-glass مفتوحًا · ثانيًا · بفئة D · لم يُنهَ بعد ربط شرعي |

**زيادة مقترحة على مجموعات الاختبار:** `google-binding` من `≥ 7` إلى `≥ 11`، بإضافة الأربعة أعلاه.

### 4.4 أسئلة تحتاج حكمًا

```text
Q-R1  سقف الزمن: 24 ساعة؟ رقم آخر؟ مَن يحدّده (النواة أم المشغّل)؟     [APPROVED | CHANGE REQUIRED]
Q-R2  هل `recovery` دور جديد محدود، أم تفضّل منع break-glass في v1 كليًا؟ [APPROVED | CHANGE REQUIRED]
Q-R3  هل "دليل قبل الربط" شرط قاطع (fail-closed)؟                       [APPROVED | CHANGE REQUIRED]
Q-R4  هل الربط الشرعي الجديد يُنهي break-glass فورًا؟                    [APPROVED | CHANGE REQUIRED]
Q-R5  هل تقبل رمز خطأ جديدًا `OMEGA_E_BREAKGLASS_UNBOUNDED`؟            [APPROVED | CHANGE REQUIRED]
```

---

## 5. ثلاث توضيحات تعبُر البنود الأربعة

1. **مؤلِّف الموافقة ≠ موضوع القدرة.** الموافقة (فئة D) يوقّعها ربط المالك؛ والقدرة موضوعها
   مفتاح خلية الخدمة. بهذا لا تتعارض الموافقة البشرية مع `Owner identity ≠ capability subject`.
2. **الفئة خاصية للثلاثي لا للخلية**، والسقف يُعلن في النواة؛ فتجاوز السقف يُكتشف عند التعريف،
   لا عند النداء.
3. **لا مسار «اختراق ⇒ سلطة».** أقصى ما يمنحه break-glass هو دور `recovery` مؤقت لا فئة D له ولا
   سقف يرفعه، وكل أثره في الدليل. واختراق حساب Google نفسه يبقى مخاطرة مالك (موثّقة في § G0-G)
   ولا يلمس النواة ولا يوسّع السلطة ولا يمحو الأدلة.

---

## 6. دقّة رموز الخطأ (تحقّقتُ منها الآن في الشيفرة)

| الرمز | الحالة الفعلية | المعنى المسجَّل |
| --- | --- | --- |
| `OMEGA_E_IDENTITY` | **موجود** | «the sender identity is missing or malformed» |
| `OMEGA_E_SECRET_EGRESS` | **موجود** | «a secret value reached a public sink» |
| `OMEGA_E_EVIDENCE_UNTRUSTED` | **موجود** | «only verified values may be promoted to evidence» |
| `OMEGA_E_APPROVAL_REQUIRED` | **موجود** | «the grant requires an approval that was not supplied» |
| `OMEGA_E_CAP_MISSING` | **موجود** | «the acting agent does not cover this call» |
| `OMEGA_E_NOT_ACTIVATOR` | **موجود** | «the calling identity is not allowed to activate versions» |
| `OMEGA_E_DUPLICATE` | **موجود** | «two declarations share a name» ⚠️ توسيع معنى مقترح |
| `NEXA_E_CAP_AUDIENCE` | **موجود وفعّال** | «capability is not addressed to this endpoint» — مُطبَّق عبر presenter binding (مُختبَر في endpoint/mcp/cellular) |
| `OMEGA_E_IDENTITY_TOKEN` · `OMEGA_E_NONCE` · `OMEGA_E_SCOPE` · `OMEGA_E_QUOTA` · `OMEGA_E_TOKEN` | **غير موجودة** (من 72) | تُضاف في نفس الـcommit الذي يرميها |

**ملاحظتان دقيقتان:**

- `OMEGA_E_DUPLICATE` معناها اليوم «إعلانان بنفس الاسم» — استخدامها لِـ«ربط ثانٍ لنفس `sub_hash`»
  توسيعًا للمعنى. البديل الأنظف: رمز جديد `OMEGA_E_BINDING_EXISTS`.
- `OMEGA_E_NOT_ACTIVATOR` تخصّ التنشيط/النسخ، والاستخدام في «منشئ ربط غير مخوَّل» مقبول لكنه
  توسيع معنى خفيف؛ يمكن قبوله أو تخصيص رمز `OMEGA_E_BINDING_FORBIDDEN`.

---

## 7. جدول الحكم — مُغلق

الحكم النهائي الصادر: البنود الأربعة **CHANGE REQUIRED**، وبقية البنود كما كُتبت. الجدول أدناه
مُثبَّت للسجل:

| البند | الحكم | ملاحظة |
| --- | --- | --- |
| G0-A مسار A | ☐ APPROVED ☐ CHANGE REQUIRED | |
| G0-A مسار B | ☐ APPROVED ☐ CHANGE REQUIRED | |
| G0-B جدول النطاقات | ☐ APPROVED ☐ CHANGE REQUIRED | |
| G0-B سياسة الحصص | ☐ APPROVED ☐ CHANGE REQUIRED | |
| G0-C قواعد الربط | ☐ APPROVED ☐ CHANGE REQUIRED | |
| G0-D عقد الخزينة | ☐ APPROVED ☐ CHANGE REQUIRED | |
| G0-D الإلغاء | ☐ APPROVED ☐ CHANGE REQUIRED | |
| G0-D break-glass | ☐ APPROVED ☐ CHANGE REQUIRED | |
| G0-E جدول القدرات | ☐ APPROVED ☐ CHANGE REQUIRED | |
| **الفئة D (تعريف + انتقالات)** | ☐ APPROVED ☐ CHANGE REQUIRED | جديد: غير موجود في v1 من المواصفة |
| G0-F عقد الأدلة | ☐ APPROVED ☐ CHANGE REQUIRED | |
| G0-G نموذج التهديد | ☐ APPROVED ☐ CHANGE REQUIRED | |
| G0-H الاختبارات وشرط القبول | ☐ APPROVED ☐ CHANGE REQUIRED | |

---

## 8. بعد إغلاق البنود الأربعة — حالة التنفيذ

```text
1. تعديل identity-cell.md وفق الأحكام (A/B · النطاقات · D · الإلغاء/break-glass)   ✅ تم (v1.1)
2. تحديث README.ar.md ليتبع النص المعدّل                                          ✅ تم
3. تحديث review-g0.ar.md بهذا السجل                                              ✅ تم
4. commit تصميم واحد: spec only — بلا شيفرة، بلا حزمة، بلا CI                      ⟵ الخطوة التالية
5. push إلى arena/01a0b637-nexa → PR #2 يتحدّث                                    ⟵ بعد الـcommit
6. G0-H: التنفيذ على البار نفسه (207/207 + الفئة الثانية عشرة + المتجهات)          ⟵ بعد اعتماد النص المثبَّت
```

ولا يبدأ أي عمل في البند 6 قبل أن يقرّ المالك النص المثبَّت في الـcommit التصميمي.

---

## 9. ما لم أتحقّق منه بعد (أصرّح به بدل افتراضه)

- دعم Firebase ID token لِـ`nonce` بنفس دلالة GSI — يحتاج تحقّقًا موثَّقًا قبل تشغيل مسار B.
- العدد النهائي لرموز التجديد لكل حساب/عميل (تُذكر 50 في التوثيق الشائع، و100 في مصادر
  تشغيلية) — لن يُثبَّت في الشيفرة بأي حال؛ يُقرأ الخطأ ويتصرّف النظام.
- تغييرات حد مشروع Drive بتاريخ 2026-05-01 (تفاصيلها النهائية) — لذلك العقد يقرأ الأرقام وقت
  التشغيل لا وقت التعريف.

## 10. مراجع تحقّقتُ منها هذه الجلسة

- Google OAuth testing: انتهاء رمز التجديد بعد 7 أيام لِـExternal/Testing، وسقف 100 مستخدم اختبار،
  والتحقق المطلوب للنطاقات الحسّاسة/المقيّدة وCASA Tier 2 —
  <https://developers.google.com/identity/protocols/oauth2> ·
  <https://developers.google.com/health/setup> ·
  <https://developers.google.com/workspace/drive/api/guides/limits> ·
  <https://developers.google.com/workspace/sheets/api/limits> ·
  <https://ai.google.dev/gemini-api/docs/billing> ·
  <https://developers.google.com/identity/gsi/web/reference/js-reference>
