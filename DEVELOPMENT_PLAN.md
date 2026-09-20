# خطة تطوير وتحسين NEXA التنفيذية (مؤتمتة بالكامل)

> المستهدف: الوصول إلى **v1.0 production-ready** على فرع `main`، مع CI يمنع أي تراجع،
> واختبارات تغطي كل سطر، وأدوات قياس، ونشر آلي موقّع.
>
> تُنفَّذ كل مرحلة عبر `node tools/dev/run-phase.mjs <phase>` بدون تدخل يدوي.
> كل مرحلة تُبقي الشجرة خضراء: `npm run verify` must pass قبل الانتقال للمرحلة التالية.

---

## 📊 الوضع الحالي (Baseline)

| المقياس | القيمة | الهدف لـ v1.0 |
|---|---|---|
| إصدار | 0.1.0 | 1.0.0 |
| الاختبارات | 314/314 ✅ | ≥ 600 |
| التغطية | غير مقاسة | ≥ 95% |
| البوابات الأمنية (gates) | 6 CLOSED | 6 CLOSED (ثابت) |
| الهجمات المحظورة | 31/31 + 8 Google | ≥ 40 دون كسر أي منها |
| الاعتماديات runtime | **0** ✅ | **0** (ثابت) |
| الاعتماديات dev | 0 | 4 فقط (c8, eslint, prettier) — dev-only |
| مهام CI الخضراء | 2/2 | 5/5 (coverage, lint, release) |
| سجلات CHANGELOG | يدوية | آلية من Conventional Commits |
| Dashboard dev server | غير مُهيّأ | مُشغَّل ومُختَبَر |
| MCP adapter smoke test | غير موجود | مُغطَّى باختبار end-to-end |
| Benchmarks | غير موجودة | لكل hot path، رفض تراجع > 10% |
| Vectors | ثابتة لـ 5 مجالات | + DSL, Celia, Learning |
| Release automation | يدوي (`ceremony.sh`) | GitHub Release موقّع آلياً |

---

## 🗺️ خريطة المراحل الـ 8

### 🟢 المرحلة 0 — الأتمتة الأساسية (Bootstrapping)
**الهدف**: جعل المشروع قابلًا للعمل بنقرة واحدة من حالة clone نظيف.

المهام:
1. إضافة `node_modules/` فقط لـ `dashboard/` (workspaces dashboard منفصل) — لا تبعيات في الـ packages.
2. إنشاء أدوات مساعدة في `tools/dev/`:
   - `run-phase.mjs` — مشغّل المراحل.
   - `smoke.mjs` — يُشغّل كل السكربتات المُعرَّفة في `package.json` ويتأكد أنها نجحت.
   - `measure-coverage.mjs` — يُشغّل `node --test --experimental-test-coverage` ويُنتج تقريرًا.
3. توحيد الـ scripts في `package.json`:
   - `verify:ci` — مجموعة CI الكاملة (كما في workflow).
   - `verify:quick` — سريع للـ dev loop (tests + posture).
   - `lint` + `format` + `format:check` عبر Biome/ESLint (dev-only، لن يُضاف لـ runtime).
4. إضافة `.editorconfig` وإعدادات تنسيق موحدة.
5. Hook pre-commit (عبر husky أو سكربت بسيط) يُشغّل `verify:quick`.
6. إنشاء **Makefile** اختصار: `make test`, `make ci`, `make demo`, `make cover`, `make dashboard`.

**معايير القبول**: على جهاز نظيف، `git clone && npm run setup && npm run verify:ci` ينجز بالكامل في < 60 ثانية.

---

### 🟡 المرحلة 1 — تقوية الأمان (Hardening)
**الهدف**: ألا يفتح إصلاح مشابه لإصلاح `exec(` مرة أخرى؛ تحويل البوابة النصّية إلى فحص AST.

المهام:
1. استبدال الماسح النصّي في `check-posture.mjs` بمحلّل AST حقيقي (بدون تبعيات — باستخدام parser الموجود بالمشروع إن أمكن، أو بفحص بسيط للـ AST عبر `vm.Script` + parser داخلي، أو عبر acorn كـ dev-dep مقصور على tools).
   - يُميّز استدعاءات `RegExp.prototype.exec` عن `child_process.exec`.
   - يمنع النمط الخطأ من الوصول.
2. إضافة فحص FORBIDDEN لـ:
   - `eval(`, `new Function(` في packages runtime.
   - `require( لمكالمات ديناميكية غير مقيّدة.
   - استيراد `node:worker_threads`, `node:cluster` خارج المسارات المسموح بها.
3. **Capability budgets**: حد أقصى لعمق التوهين (attenuation depth) وعدد الاستخدامات مُتحقَّق منه في الـ posture.
4. إضافة اختبارات fuzzing خفيفة لـ `canonicalize()` (10,000 إدخال عشوائي) تضمن:
   - لا استثناءات غير متوقعة.
   - round-trip `JSON.parse(canonicalize(x))` يعادل بنيوياً `x`.
5. فحص عدم وجود `console.log` في packages/ (يسمح في tools/ وexamples/ فقط).
6. إضافة بوابة "لا نصوص مطوّلة" — تمنع رفع `debugger;` و `TODO: remove`.
7. توسيع عائلة الهجمات:
   - 4 هجمات جديدة في فئات قائمة (مثل: capability replay after revocation، envelope forgery via added unknown field، evidence chain truncation).
   - **35/35** محظورة.

**معايير القبول**: posture مُشغَّل على AST، 35 هجمة محظورة، اختبارات fuzz خضراء، لا تزال صفر تبعيات runtime.

---

### 🟢 المرحلة 2 — زيادة التغطية الاختبارية (Coverage Ramp-up)
**الهدف**: ≥ 90% تغطية على `packages/`، مع اختبارات لكل محرك من محركات Celia.

المهام:
1. إضافة `c8` كـ dev-dep في dashboard فقط (workspaces منفصلة) أو عبر `node --test --experimental-test-coverage` المدمج في Node 20+ (أفضل — لا تبعيات إضافية!).
2. إنشاء اختبارات للملفات التي لا تملك تغطية حالياً:
   - `packages/cells/celia/dsl/*.js` (18 DSL) — parser round-trip tests لكل واحد.
   - `packages/cells/celia/executor/*` (5) — اختبار DAG تنفيذ، contract engine، event sourcing، tool registry، transactional workspace.
   - `packages/cells/celia/infinite/*` (20) — اختبارات مدعكة بالثوابت الرياضية لكل محرك (zk, chaos, fork, cost-circuit, time-dilation، ...).
   - `packages/cells/celia/memory/*` (6) — belief engine, governed memory, vector store, procedural store, ledger, lifecycle.
   - `packages/cells/celia/omega/*` (12) — اختبار كل ادعاء كوني باختبار يُثبت العكس (Popperian).
   - `packages/cells/celia/singularity/*` (13) — نفس النهج.
   - `packages/cli/*`, `packages/learning/*`, `packages/cellular-evolution/*`.
3. **Property-based tests** لـ canonicalization: لأي قيمة JSON شرعية، `canonicalize(x) === canonicalize(JSON.parse(canonicalize(x)))`.
4. **Mutation testing** خفيف: script يقلب كل شرط في البوابات ويتأكد أن اختباراً ما يفشل.
5. جعل التغطية بوابة CI: إذا هبطت التغطية عن العتبة، يفشل الـ build.

**معايير القبول**: ≥ 600 اختبار، تغطية ≥ 90% على packages/، فشل CI إذا نقصت التغطية أو مرّت طفرة غير مكتشفة.

---

### 🟡 المرحلة 3 — التوثيق وتجربة المطوّر (Documentation & DX)
**الهدف**: أي مطوّر جديد يفهم النظام خلال 15 دقيقة ويربط أداة خلال 30 دقيقة.

المهام:
1. **JSDoc/TSDoc** لجميع الـ APIs العامة (الدوال المُصدَّرة من `index.js` في كل package) — نوع، معاملات، رموز خطأ محتملة.
2. إنشاء `docs/` منظمة:
   - `docs/quickstart.md` — من الصفر إلى إرسال رسالة موقّعة.
   - `docs/capabilities.md` — دليل مفصّل للقدرات والتوهين.
   - `docs/cells.md` — شرح نموذج الخلايا/الأنسجة/الأعضاء.
   - `docs/mcp.md` — كيف تربط MCP client؟
   - `docs/google-identity.md` — دليل استخدام خلية Google.
   - `docs/security-model.md` — شرح البوابات والهجمات.
3. **أمثلة تفاعلية** في `examples/`:
   - `examples/tool-call.mjs` — نداء أداة موقّع من البداية للنهاية.
   - `examples/attenuation.mjs` — توهين قدرة وإعادة تمريرها.
   - `examples/cell.mjs` — إنشاء خلية وتمرير رسالة عبر الغشاء.
   - `examples/mcp-server.mjs` — خادم MCP كامل.
4. **Badges** في README: CI status، coverage، attacks blocked، gates closed.
5. فحص آلي في CI أن كل رابط في README و SECURITY يعمل (link-check).
6. إنشاء `CONTRIBUTING.ar.md` مترجماً للعربية.

**معايير القبول**: كل API العامة موثّقة، 5+ أمثلة runnable، الروابط كلها سليمة، CI يفشل إذا كانت الوثائق تشير لرمز غير موجود.

---

### 🟢 المرحلة 4 — Dashboard وتجربة المستخدم التفاعلية
**الهدف**: Dashboard قابل للبناء والعرض، يُظهر التخطيط والذاكرة والأدلة في الوقت الفعلي.

المهام:
1. تثبيت تبعيات dashboard في `dashboard/` (workspace منفصل — لا يلمس packages/).
2. إصلاح مسارات Vite/React (تأكد أن `npm run build` تنجح).
3. **Build smoke test في CI**: يُبني Dashboard ويتأكد أن ملف HTML الناتج يحوي حاويات React.
4. ربط Dashboard بـ runtime عبر WebSocket بسيط (server في `tools/celia-dashboard-server.mjs` يبث الأحداث).
5. تفعيل `npm run dashboard` على منفذ 5173 بمعاينة حية عبر الـ Arena preview.
6. إضافة اختبار end-to-end للوحة باستخدام Playwright (dev-dep في dashboard فقط) — يتحقق أن كل Panel يُحمَّل بدون أخطاء.

**معايير القبول**: `npm run dashboard:dev` يعمل، build CI ينجح، Playwright smoke test أخضر.

---

### 🟡 المرحلة 5 — الأداء والقياس (Performance & Benchmarks)
**الهدف**: منع تراجّع الأداء عبر قياس مُثبَّت في CI.

المهام:
1. إنشاء `tools/bench/` بمعايير قياس لـ:
   - `canonicalize` لعنصر كبير (1000 مفتاح).
   - `mintCapability` + `verifyCapability`.
   - `buildEnvelope` + توقيع.
   - DSL parser لملف 10KB.
   - Cell membrane crossing.
2. تسجيل baseline (med, p95) في `spec/vectors/benchmarks.json`.
3. فحص CI: إذا زاد أي مقياس بأكثر من **10%** عن البيزلاين، يفشل البناء (مع عتبة التسامح).
4. Memory leak smoke: تشغيل 10,000 رسالة، التأكد أن الذاكرة لا تنمو خطياً.
5. تسجيل النتائج في كل PR كتعليق آلي عبر bot.

**معايير القبول**: مجموعة benchmarks مستقرة، CI يرفض التراجع، لا تسرب ذاكرة في الحلقة الضيقة.

---

### 🟢 المرحلة 6 — المزيد من المحولات والعضويات (Adapters & Organs)
**الهدف**: جعل NEXA متصلاً فعلاً بالعالم، مع نفس ضمانات خلية Google.

المهام:
1. **MCP adapter مكتمل**: `adapters/mcp/` حالياً يحتوي على bridge — إضافة:
   - اختبار round-trip.
   - تحويل أدوات MCP إلى capabilities مع caveats تلقائية (max_args_bytes, ttl).
   - فحص أن الـ adapter لا يملك سلطة مباشرة (لا mint).
2. **GitHub organ** (خلية ثالثة):
   - التحقق من توقيعات webhook GitHub.
   - نطاقات capabilities محدودة: `github.issues.comment`, `github.prs.review`.
   - نفس بنية Google: gateway + identity cell + scope table + class ladder.
3. **Filesystem organ** (مُقاد بالصلاحيات):
   - لا وصول مباشر لـ `node:fs` من الخلايا.
   - كل وصول يمر عبر capability مع caveats للـ paths المسموح بها.
4. **HTTP fetch organ**: طلبات صادرة عبر capability محدودة بـ host وطريقة وحجم استجابة.
5. **CLI قابل للتثبيت** (`packages/cli`):
   - أمر `nexa send`, `nexa verify`, `nexa capability-mint`.
   - `npm i -g @nexa/cli` لاحقاً.

**معايير القبول**: كل adapter/organ جديد لديه فئة هجمات خاصة به +8 هجمات كلها محظورة، ولا يملك mint مباشر.

---

### 🟡 المرحلة 7 — الأتمتة الكاملة للإصدار (Release Automation)
**الهدف**: من `git tag v1.0.0` إلى GitHub Release موقّع بسلسلة إثبات دون تدخل بشري.

المهام:
1. **Conventional Commits** — فرض تنسيق الرسائل عبر commit-msg hook.
2. توليد CHANGELOG آلياً من العناوين:
   - `feat:` ← قسم Added.
   - `fix:` ← قسم Fixed.
   - `refactor:`, `docs:`, `test:` ← أقسام مناسبة.
   - `BREAKING CHANGE:` ← ترقية النسخة الرئيسية.
3. Workflow `release.yml` مُفَعَّل على الوسوم:
   - يُشغّل `npm run verify`.
   - يولد changelog.
   - يُنشئ GitHub Release مع Provenance (SLSA level 2).
   - يرفع موازين `spec/vectors/` كأصول Release.
   - يوقّع الأصول بمفتاح الإصدار (Ed25519) وينشر الشهادة.
4. **Vectors provenance**: كل vector file يحتوي hash موقّع؛ فحص `npm run vectors` يتحقق من السلسلة.
5. **Ceremony script 2.0** يُشغَّل آلياً في CI، لا يحتاج تدخلاً يدوياً.

**معايير القبول**: دفع وسم `v0.5.0-beta` يُنتج Release موقّعاً خلال 5 دقائق، مع جميع المتجهات والشهادات.

---

### 🔴 المرحلة 8 — إطلاق v1.0 (GA)
**الهدف**: نسخة 1.0 مستقرة.

المهام (قبل الإطلاق):
1. مراجعة أمنية خارجية (بروتوكول فقط — لا حاجة لكود 56 engine لأنها خارج البروتوكول).
2. تثبيت الـ public API: أي تغيير لاحق يحتاج نسخة رئيسية.
3. كتابة ورقة المواصفات النهائية (`spec/NEXA-v1.0.md`) مع متجهات مرجعية موقّعة.
4. تثبيت سلسلة المفاتيح (root of trust) ونشرها عبر `.well-known/nexa-keys.json`.
5. إطلاق MCP server عامل كتطبيق مثال يمكن للناس الاتصال به.
6. الإعلان في README: **"NEXA is production-ready"**.

**معايير القبول**: نسخة v1.0.0 منشورة، CI أخضر 5/5، ≥ 600 اختبار، ≥ 90% تغطية، 6 بوابات مغلقة، ≥ 40 هجمة محظورة، صفر تبعيات runtime، Release آلي.

---

## 🚀 كيف تُنفِّذ؟

من الجذع:

```bash
# تشغيل مرحلة (تُعيد التشغيل متكررة حتى تنجح مع معايير القبول):
node tools/dev/run-phase.mjs 0

# أو كل المراحل متتابعة (تحذير: طويل):
node tools/dev/run-phase.mjs all

# فحص سريع:
npm run verify:quick

# فحص كامل مثل CI:
npm run verify:ci
```

كل مرحلة تُسجِّل نتيجتها في `.phase/<number>.result.json` وتعرض تقريراً نهائياً.
