# NEXA — خطة الفجوات والتوسعة للبنود الـ200

**التاريخ:** 20 سبتمبر 2026.  
**النطاق:** مراجعة المستودع وخطة تنفيذ فقط؛ ليست إضافة وظائف أو تفويض نشر.  
**ترقيم التتبع:** A001–A100 = القائمة الأولى، B001–B100 = الثانية، بالترتيب نفسه الذي طلبه المستخدم.

## 1. الخلاصة التنفيذية

لا نحتاج إلى بناء 200 خدمة مستقلة. القائمة تجمع تقنيات استدلال، ومكونات برمجية، وضوابط أمان، وخصائص نماذج، وتكاملات تحتاج بنية تحتية. الخطة الصحيحة هي **إعادة استخدام الأسس الحقيقية، وإكمال الجزئي، واستبدال المحاكاة عند الحاجة، وإضافة المفقود باختبارات قبول**.

| التصنيف | العدد | ماذا يعني؟ |
|---|---:|---|
| M — موجود محليًا ضمن نطاق محدود | 16 | تنفيذ فعلي محدد مع أساس اختباري؛ لا يعني اكتمال المنتج أو إثبات كل استخداماته |
| P — جزئي / أساس قريب موجود | 116 | جزء من التقنية أو primitive يصلح أساسًا لها؛ التكامل أو المتانة أو التقييم غير مكتمل |
| D — محاكاة / ديمو لا يحقق الادعاء كاملًا | 16 | اسم أو خوارزمية مبسطة موجودة؛ لا يحتسب تنفيذًا تشغيليًا للتقنية المطلوبة |
| N — لم يظهر تنفيذ صريح في نطاق الفحص | 52 | إضافة مرشحة بعد discovery قصير؛ ليس إثباتًا رياضيًا لغيابها من كل سطر |
| **المجموع** | **200** | **هذه أعداد تصنيف، وليست نسبة إنجاز أو شهادة جاهزية** |

لكل بند حالته، ودليله، والفجوة، ومرحلة التنفيذ، والأولوية، والتبعيات، والمالك الوظيفي، واختبار قبول في:

- [المصفوفة الكاملة المقروءة — 200 بند](nexa-capability-matrix.ar.md).
- [نسخة CSV قابلة للفرز والاستيراد — 200 صف](nexa-capability-matrix.csv).

**القرار الأهم:** لا نفعّل الاستقلالية التنفيذية قبل إغلاق H2 وH3 وحدود التطبيق. ويمكن تصميم المكونات وجمع تقييمات مصرح بها دون منح النموذج صلاحيات جديدة. التعلم لا يمنح نفسه سلطة، واتفاق عدة وكلاء لا يتجاوز السياسة.

## 2. أساس المراجعة وحدود الأدلة

- جرد أسماء **313 ملف JavaScript/ESM/package ضمن packages/adapters/tools/tests**، مع تثبيت بصمات هذه الملفات و`package.json` الجذري: 314 ملفًا إجمالًا. ليست هذه أعداد اختبارات.
- قراءة exports ومقاطع التنفيذ والاختبارات المرتبطة بالمكونات المهمة، وبحث نصي عبر تلك المصادر عن التقنيات ومرادفاتها ومواضع mock/simulation. لم تنفذ مراجعة سطرية شاملة لكل الملفات، ولا اختبار نشر أو عتاد أو اتصال مزود مدفوع.
- روجعت تقارير الجولات السابقة: **آخر verify مقاس: 392 PASS / 2 FAIL من 394**. الفشلان H2 وH3. اختبارات التعلم 18/18 والانحدار WRITE/COMMIT + persistence عددها 59/59 في تلك الجولة. **لم أعد تشغيل verify في جولة التخطيط هذه**؛ ليست الأرقام قياسًا جديدًا.
- استُعلمت مجموعة التعلم الحالية بأمر status للقراءة فقط: **COLLECTING، صفر observations، لا نموذج مستخدم مدرّب**.
- استنتاجات source inspection مميزة عن runtime proof. فشل arXiv السابق بـECONNRESET لا يثبت تعذر الاتصال في كل البيئات. SQL متساهلة لا تثبت نشر قاعدة بيانات مكشوفة. لم تُنشأ قضايا GitHub أو PR أو migration أو deployment.

### فروق تمنع التخطيط على إنجاز غير حقيقي

1. Policy وcapability وEd25519 وMCP bridge وreflection وlifecycle **ليست كلها محاكاة**؛ أعد استخدامها، ولا تنشئ نسخة منافسة لكل منها.
2. `formal-z3-verification.js` و`z3-verifier.js` يستخدمان heuristics/mock؛ لا يوجد بذلك إثبات SMT. في الصيغة المعتادة للبحث عن انتهاك `assumptions ∧ ¬property`: **SAT يعطي counterexample، وUNSAT يثبت غياب انتهاك داخل النموذج والفرضيات، وUNKNOWN ليس PASS**.
3. `wasm-sandbox.js` لا يشغّل WASM معزولًا فعليًا؛ وجود blacklist أو حقول limits لا يفرض OS isolation.
4. `kv-cache-dedup.js` يدير صفحات tokens في Maps، لا K/V tensors لمحرك Transformer. KV cache وquantization وMoE ليست إضافات يمكن فرضها على API مغلق من جانب العميل.
5. `federated-noospheric.js` يجمع مقتطفات معرفة؛ ليس تدريب FedAvg على أوزان. قيم causal engine العشوائية ليست causal inference.
6. تعلم Celia الجديد **ML/DL فعليان صغيران على CPU**، لكن بيانات المستخدم فارغة، ولا RLHF أو LoRA أو auto-promotion. `calibrated:false` لا يتحول إلى confidence موثوقة بتغيير الاسم.
7. provider registry فيه اختيار حقيقي بين adapters، لكن adapters الافتراضية تعيد نصوصًا اصطناعية. منفذ Grok فيه مسار شبكة، دون دليل تشغيل حي في هذه المراجعة. موصلا Supabase ما زالا يعيدان `createClient: null` في loader الحالي.

## 3. ما الذي يُبنى معًا وما الذي لا يُخلط؟

| المكون المشترك المقترح | البنود التي يخدمها — أمثلة لا حصر |
|---|---|
| Identity + Policy + Capability + Approval Gateway | A043–A059، B042–B044، B082، B093 |
| Transactional Workspace + Recovery | A059، A065–A069، B081، مع H1/H2/H3 |
| Workflow + State + Queue + Budgets | A070–A082، B074–B080، B087–B090 |
| Provider/Model/Tool Registry + Router | A012–A021، B028، B062–B063 |
| Context/Prompt Service + Caches | A022–A024، A035–A043 |
| Governed Memory + Retrieval | A026–A034، B078، B083–B085 |
| Planner + Critic + Verifier | A001–A011، B029–B033، B086–B090، B095 |
| Evidence + Telemetry | A060–A064، A083–A085، B045، B099–B100 |
| Evaluation + Software Quality + Supply Chain | A088–A097، B025–B041 |
| Knowledge/Rules/Constraints | B002–B024، B096–B099 |
| Offline Learning + Model Lifecycle | A041، A086–A087، B009، B017، B051–B068، B084، B092–B094 |
| Multi-Agent / Simulation / Specialized Infrastructure | A018–A019، A098–A100، B001، B069–B079، B045–B050 |

**فروق لازمة:** Tool Calling/Function Calling واجهتان فوق عقود التنفيذ، لا محركا صلاحيات منفصلان. ReAct وReflection وSelf-Correction سياسات orchestration مختلفة فوق الحلقة نفسها. Mixture of Experts بنية نموذج، وMixture-of-Agents تنسيق وكلاء. replay protection يرفض الإعادة غير المسموحة؛ idempotency قد يعيد النتيجة القديمة دون تكرار الأثر. rollback لسجل إصدارات لا يعني atomic apply لملفات فعلية. State Machine لا تعني State Persistence.

بالنسبة إلى Chain/Tree/Graph of Thoughts: نخزن **خططًا وفرضيات وملخصات تبرير وأدلة قابلة للتدقيق**، لا نجعل تخزين أو عرض سلسلة التفكير الداخلية شرطًا للعمل أو مصدرًا للتفويض.

## 4. المعمارية المستهدفة

```text
Goal + trusted principal
  → Context builder / source trust labels
  → Planner → candidate Plan (data only)
  → schema + constraints + independent evaluation
  → explicit approval when required
  → Execution Gateway
       identity → capability → policy → authorization
       → freshness/state verification → durable consume → guarded execution
       → evidence + verified result
  → reflection / learning observations (no authority)
```

- تظل packages الأساسية pure؛ أي filesystem/network/process I/O في ports محكومة في `tools/` أو خدمة منفصلة بعقد واضح. لا تخفيف لفحص posture لجعل التكامل يمر.
- النموذج يخرج اقتراحًا، وليس `verified:true` أو capability موثوقة. المتحقق والمنفذ يحسبان القرار من الأدلة الفعلية.
- موارد المخزن الدائم للسلطة، وworkspace/staging، وبيانات التعلم، وذاكرة المستخدم **منفصلة**. rollback للملفات لا يعيد grants المستهلكة.
- قبل backend متعدد المستخدمين: تعريف ثابت `principal → owner_kid/subject → row ownership`. لا ربط تلقائي بالصلاحية اعتمادًا على email أو tenant يرسله العميل.
- عقود versioned موحدة: `Goal`, `Plan`, `ToolSpec`, `Approval`, `ExecutionResult`, `EvidenceRef`, `ContextEnvelope`, `Observation`, `ModelCandidate`. كل عقد يحدد المصدر، الهوية، الإصدار، الحدود والحقول المرفوضة. ليس مقصودًا تعديل wire schema للنواة دون عقد منفصل.
- عقد الخطة يشمل الهدف وإصداره، التبعيات، tool/resource/action، hashes للحالة المعنية، budget وdeadline. تغيير الأثر يوجب إعادة التحقق وربما موافقة جديدة.

## 5. المراحل والتبعيات وبوابات الخروج

الأولوية P0 = مانع أمان، P1 = أساس المنتج، P2 = تحسين مقاس، P3 = تخصص/بحث مشروط. لكل بند مرحلة أساسية واحدة في المصفوفة، وقد يُصان عبر مراحل لاحقة.

| المرحلة | الأولوية / المالك المقترح | التبعيات | التسليم وبوابة الخروج |
|---|---|---|---|
| **R0 — إغلاق حدود الملفات** | P0 / Systems + Security | baseline الحالي | H1 وH2 وH3 GREEN، والاختبارات السابقة دون تغيير، وfull verify كامل ثم اختبار crash/concurrent commits |
| **R1 — بوابة التنفيذ والعزل والهوية** | P0 / Security + Platform | R0 | كل route/port مؤثر له contract وصلاحية وعزل؛ deny بلا أثر؛ approvals محددة ومنتهية ومستهلكة |
| **R2 — الحالة والذاكرة والتشغيل الدائم** | P1 / Backend + Data + SRE | R1 | resume/retry/idempotency/audit/backup وownership؛ اختبارات قتل worker وعزل مستخدمين وتشغيل observability حقيقية |
| **R3 — موصلات وسياق وتوجيه** | P1 / Integrations + Platform | R1، R2 | مزود واحد وأداة واحدة فعليان أولًا؛ schema/deadline/budget/egress؛ لا mock fallback ناجح صامت |
| **R4 — وكيل إصلاح محدود النطاق** | P1 / Agent + QA | R2، R3 | planner/critic/verifier وpatch proposals؛ إصلاحات حقيقية مقاسة، تطبيق فقط بعد موافقة وتحقق منفصلين |
| **R5 — الجودة والمعرفة والتحقق** | P1 / QA + Security + Knowledge | R1، R2؛ يتوازى جزئيًا مع R3/R4 | benchmarks وfuzz/mutation/SBOM، ومجموعة خصائص formal محددة؛ كل claim بمصدر ونطاق تحقق |
| **R6 — تعلم من بيانات فعلية** | P2 / ML + Evaluation | R2، R4، R5 | بيانات مرخصة ومراجعة، calibration/drift وholdout مستقل؛ candidate ثم shadow ثم اعتماد صريح عند نجاح عقده |
| **R7 — بحث متعدد المسارات والوكلاء** | P2 / Agent + Evaluation | R4، R5؛ R6 إذا استُخدم scorer متعلم | baseline أحادي الوكيل أولًا؛ قيمة إضافية مقاسة ضمن نفس الميزانية، لا زيادة صلاحيات أو اتفاق دائري |
| **R8 — تقنيات متخصصة وبنية نموذج/عتاد** | P3 / ML أو Formal أو Infrastructure حسب البند | R1، R2 + ADR خاص؛ تدريب يحتاج R5/R6 | spike لكل استخدام: فرضية فائدة، بيانات/ترخيص، عتاد/مزود، تكلفة، threat model، benchmark؛ no-go عند غياب الجدوى |

### R0 بالتفصيل — هذه ليست مجرد إضافة Transaction Manager بالاسم

1. **H1:** المحافظة على نجاح persistence وfresh-grant control؛ لا reset للمخزن أو fallback للذاكرة. لا نعيد إنجاز الحزمة باسم جديد.
2. **H2:** RED الأصلي → تحديد atomicity المطلوبة → أصغر إصلاح → الاختبار نفسه GREEN → regression → evidence. نفرق بين استعادة root بعد خطأ وبين عدم مشاهدة القراء لحالة جزئية أثناء التطبيق.
3. **H3:** RED الأصلي → تحديد من يستطيع الكتابة خارج العملية → آلية تربط التحقق بالتطبيق فعليًا. قفل تعاوني أو hash check إضافي لا يمنع كاتب OS غير متعاون. إن لم يمكن فرض عقد الملكية أو compare/apply المناسب، يبقى COMMIT غير معتمد؛ لا نخفي الفشل بتغيير التوقعات أو عدم الوصول إلى hook.
4. بوابة القبول تحافظ على **H1+H2+H3، الـ39 السابقة، الـ20 persistence، الـ18 learning، وكل baseline في full verify**. العدد المستقبلي قد يزيد؛ لا يثبت على 394 عند إضافة اختبارات جديدة.
5. بعد ذلك فقط: crash matrix عند نقاط consume/apply/evidence، أخطاء fsync، وتزامن COMMIT من عمليات متعددة. يتبعها اختبار الاستعادة وإلغاء المهام مع بقاء الأذونات المستهلكة مستهلكة.

### R1 بالتفصيل — لا تنفيذ خارج البوابة

جرد كل mutations ومنها create وrollback وAST ports والعمليات الداخلية؛ لكل واحدة عقد مستقل. لا نعتبر taskId أو path containment تفويضًا. الفصل بين signed approval وcapability والتحقق من الحالة يظل صريحًا. اختيار sandbox حقيقي بحدود filesystem/network/CPU/RAM/PIDs، وdeny-by-default للشبكة. لا تفعّل أداة ديمو بإشارة ثقة boolean من العميل.

### R2 بالتفصيل — ليس ضروريًا إضافة خمس قواعد بيانات وطوابير

ابدأ بمخزن واحد يناسب عدد المستخدمين والحمل: SQLite لنطاق عملية/مضيف محدود أو PostgreSQL عند الحاجة لتعدد العمال. هذا اختيار معماري مقترح لا تبعية مثبتة أو migration مصرح بها. outbox/leases/idempotency قد تخدم النسخة الأولى قبل وسيط رسائل منفصل؛ لا Redis/Kafka لمجرد إكمال أسماء القائمة. إذا اختير Supabase: **RLS correctness gate** باختبارات A/B فعلية مع USING/WITH CHECK، ثم **real connector gate** مستقلة؛ نجاح mock لا يجتاز أيًا منهما.

### R3–R4: أول منتج قابل للقياس

مستخدم مصرح له يحدد مشكلة؛ يُنتج النظام خطة محدودة، يختار أداة/نموذجًا بعقد، يقترح patch داخل staging، يشغّل اختبارات معزولة مصرحًا بها، ويعرض الأدلة. لا COMMIT تلقائي من درجة ML. تغيير provider لا يغير consent أو region أو budget. cache hit لا يعيد تفويضًا قديمًا؛ لا تخزن آثار mutations كأنها إجابات قابلة لإعادة التنفيذ.

### R5–R8: لا تربط الميزات التجريبية بخط السلامة

- ابدأ بخاصية صغيرة لـmodel checking وSMT، لا «إثبات كل البرنامج». ثبت اللغة والنظريات وحدود البحث والـtrusted computing base.
- المعرفة والمصادر: فصل observation/hypothesis/verified، زمن صلاحية، تعارض وأصل للمصدر. تكرار اقتباس نفس الورقة ليس أدلة مستقلة.
- عتبات ML الحالية بداية لجمع البيانات، وليست كفاية إحصائية. لا تخفضها كي يظهر نموذج مدرب. RL/DPO/LoRA تحتاج بيانات ونموذجًا قابلًا للتعديل وبيئة تدريب، وليست أسماء إضافية للـMLP الحالي.
- TEE/enclave/confidential computing تحتاج منصة فعلية وattestation. التوقيع وsandbox لا يعاد تسميتهما TEE.
- spatial/fuzzy/causal/Bayesian/meta-learning لها مسارات في المصفوفة، لكن لا تدخل المنتج قبل إثبات حالة استخدام تفوق الحل الأبسط. تشمل الخطة كل البنود دون إلزام بنشر تقنية لا حاجة لها.

## 6. أول backlog قابل للتحويل إلى حزم تنفيذ

| الحزمة | المحتوى | التبعيات | القبول |
|---|---|---|---|
| W01 H2-ATOMICITY | عقد واضح + fault matrix + إصلاح التطبيق الجزئي | لا تغيير H1 | اختبار H2 نفسه GREEN وroot فعلية صحيحة |
| W02 H3-CONCURRENCY | ADR ملكية الكتابة + race harness + guard فعلي | تنسيق تصميم W01 | الكاتب الخارجي الحقيقي لا تضيع كتابته؛ لا PASS بسبب عدم تشغيله |
| W03 RECOVERY | crash points وتزامن عمليتين وثبات الاستهلاك | W01/W02 | لا partial recovery أو منح تعود للحياة |
| W04 MUTATION INVENTORY | حصر routes/ports وعقود create/rollback/AST وغيرها | إغلاق R0 | كل boundary لها negative/positive tests وصلاحية مستقلة |
| W05 IDENTITY + APPROVAL | principal/owner mapping وموافقة plan-bound | W04 | لا cross-user أو stale/replayed approval |
| W06 SANDBOX + EGRESS | runner معزول، أدوات موثقة، secrets broker | W04/W05 | escape/egress/resource tests ضمن بيئة فعلية |
| W07 DURABLE WORKFLOW | events/checkpoints/idempotency/leases/queue | W06 | kill/resume/retry وإلغاء دون آثار مكررة |
| W08 DATA OWNERSHIP | memory schema وRLS/ACL وحذف/retention | W05/W07 | فحوص A/B على DB فعلية، والموصل يُختبر منفصلًا |
| W09 CONNECTOR BASELINE | مزود وأداة فعليان، schemas/budgets/rate limits | W06/W07 | failure injection وقياس تكلفة حقيقي بلا mock fallback |
| W10 REPAIR PILOT | planner/critic/verifier + corpus إصلاح صغير مستقل | W08/W09 | RED→patch→GREEN مع موافقة وحماية الاختبارات الأصلية |
| W11 QUALITY + EVAL | static/dynamic/fuzz/mutation/SBOM/holdout | W06؛ يكبر مع W10 | أدلة عيوب حقيقية ومعيار قبول ثابت قبل التجربة |
| W12 LEARNING SHADOW | جمع outcomes الحقيقي ثم تدريب ومعايرة مرشح | W10/W11 + بيانات كافية | تحسن مقاس بلا تراجع أمني؛ الاعتماد الصريح منفصل |

هذه backlog مقترحة في الوثيقة، **لم تُنشأ كـGitHub issues ولم تُنفذ في هذه الجولة**. كل حزمة أصغر يمكن تقسيمها إلى PRs بعد تحديد عقدها، دون تغيير branch هذه الجلسة أو دمج غير مصرح.

## 7. الوقت والموارد والحد الأدنى القابل للإطلاق

**افتراض تخطيطي قابل للتعديل:** فريق 3–4 أشخاص: Systems/Security، Backend/Integrations، Agent/ML، وQA/SRE جزئي أو كامل. لا توجد ميزانية أو مواعيد ملزمة من المستخدم، لذلك هذه نوافذ استكشافية وليست وعود تسليم:

- أول أسبوعين: حسم ADRs لـH2/H3 والعزل ونموذج الهوية وتقدير أدق. قد يكشف H3 ضرورة تغيير بيئة التشغيل؛ لا تاريخ إغلاق مضمون قبله.
- بعد R0: نحو 3–5 أسابيع لتغطية gateway/identity/sandbox الأساسية، بحسب عدد المنافذ والثغرات المكتشفة.
- نحو 3–5 أسابيع لطبقة durable workflow/ownership/observability؛ بعض أعمال التصميم والاختبارات يمكن توازيها.
- نحو 4–7 أسابيع لموصل فعلي وrepair pilot وeval أساسية بعد عبور بوابات الأمان.
- التعلم المتقدم والوكلاء المتعددون: لا موعد قبل كفاية البيانات وbaseline جودة واضح. R8 لها تقدير منفصل بعد spike لكل مسار، وقد يكون القرار تأجيلًا أو عدم تبنٍ.

**MVP المقترح:** R0–R4 مع الحد الأدنى اللازم من R5، لا كل الـ200. معيار النجاح ليس عدد المحركات: تجربة إصلاح محدودة حقيقية، عزل، تفويض، دليل، استعادة، تكلفة معلومة وموافقة صحيحة. فريق أصغر أو غياب بيئة اختبار/بيانات يطيل المدة. لا نجمع هذه النوافذ كالتزام زمني بسبب التبعيات وعدم اليقين.

قبل اعتماد أي تبعية ثقيلة أو خدمة مدفوعة: ADR يحدد build vs integrate، الترخيص، SBOM، الإصدار المثبت، البيانات الخارجة، سقف الإنفاق وخطة الانسحاب. لا شراء GPU أو إضافة PyTorch/DB/queue لمجرد ورود اسم تقنية في القائمة.

## 8. معيار قبول موحد لكل بند

1. وظيفة واضحة وغير متداخلة بلا داعٍ مع مكون موجود.
2. threat model ونطاق الثقة وحدود inputs/resources.
3. مصدر حالة التنفيذ: code inspection، unit، integration، live test؛ لا تُخلط درجات الدليل.
4. اختبار فشل حقيقي ثم إصلاح ثم الاختبار نفسه؛ لا تعديل قبول قديم للحصول على GREEN.
5. اختبار إيجابي يثبت أن المنع ليس تعطيلًا مطلقًا للوظيفة الصحيحة.
6. حدود المخرجات وتوثيق source/model/data/schema versions وprovenance.
7. قياس task success وfalse accepts وlatency p50/p95 وتكلفة المهمة حسب الوظيفة؛ تعريف عتبات الجودة مسبقًا مع فواصل عدم يقين عندما تكون مناسبة.
8. regression للمكوّن ثم كل المشروع؛ `npm run verify` يجب أن يصل إلى نهايته. تحديث metrics فقط بعد دليل كامل، لا إزالة RED من discovery.
9. rollback/disable لا يعيد أذونات مستهلكة ولا يطمس أدلة ولا يفتح مسارًا قديمًا غير محمي.
10. لا production claim قبل اختبارات البيئة المقصودة. «اجتازت الفحوص الحالية» لا تعني انعدام الأخطاء.

## 9. المخاطر والقرارات التي تحتاج موافقة لاحقة

| القرار | لماذا لا يُفترض الآن؟ |
|---|---|
| من يملك حق الكتابة في root؟ | أساس ضمان H3؛ كاتب بامتيازات إدارية مختلف عن worker محدود |
| عدد المستخدمين والعمال والتوزيع | يحدد DB/queue/locking واحتياجات idempotency الفعلية |
| أي provider/model وأي بيانات يجوز إرسالها؟ | تكلفة وخصوصية وتوافر وترخيص وretention |
| حدود الاستقلالية | توصية فقط، staging، test runner، COMMIT: صلاحيات مختلفة لا مستوى واحد |
| معيار جودة الإصلاح | baseline ومجموعة مهام ومقدار تحسن متفق عليه، لا رقم نجاح مُختلق |
| سياسة التعلم والمراجعة | هوية reviewer، حقوق البيانات، سحب الموافقة، poisoning والتسرب |
| الحاجة لتقنيات R8 | use case وعتاد وميزانية وقياس فائدة قبل التكامل |

حتى حسمها، الافتراضي: تشغيل محلي محدود، لا نشر عام، لا ترقية نموذج تلقائية، لا تدريب من بيانات حساسة أو نتائج أبحاث غير مراجعة، ولا تجاوز create/Supabase/COMMIT لبواباتها المنفصلة.

## 10. سجل الأدلة البرمجية

المعرفات E00–E27 في المصفوفة تشير إلى النطاقات أدناه. مرجع قريب في صف P أو N **لا يعني أنه ينفذ التقنية كاملة**. E00 يعني نتيجة discovery محدودة ويستلزم إعادة تحقق قبل التنفيذ. تُضاف قائمة الملفات في القسم التالي آليًا من سجل المراجع مع التحقق من وجودها.

<a id="e00"></a>

### E00 — Discovery محدود، لا برهان غياب شامل

جرد المصادر، exports، والبحث في أسماء التقنيات وصيغها ومؤشرات mock؛ راجع منهجية القسم 2. لا package أو service مستقلة تُنشأ قبل التحقق من عدم وجود implementation باسم آخر.

<a id="e01"></a>

### E01 — الهوية والتوقيع والقدرات والسياسة والبروتوكول

أسس فعلية: signature/issuer/scope/attenuation/default-deny. Validators محددة لا دعم عام لكل JSON Schema؛ حالة التطبيق خارج النواة لها فحوص منفصلة.

[packages/identity/index.js](../packages/identity/index.js) | [packages/crypto/index.js](../packages/crypto/index.js) | [packages/capability/index.js](../packages/capability/index.js) | [packages/policy/src/rules.js](../packages/policy/src/rules.js) | [packages/protocol/index.js](../packages/protocol/index.js) | [packages/ast/index.js](../packages/ast/index.js) | [tests/capability.test.js](../tests/capability.test.js) | [tests/endpoint.test.js](../tests/endpoint.test.js) | [tests/security.test.js](../tests/security.test.js)

<a id="e02"></a>

### E02 — MCP bridge

JSON-RPC/tools pipeline مع اختبارات receipts وdenials؛ ليس دليل نشر ecosystem خارجي كامل.

[adapters/mcp/src/bridge.js](../adapters/mcp/src/bridge.js) | [tests/mcp.test.js](../tests/mcp.test.js)

<a id="e03"></a>

### E03 — مزودون ومنفذ نموذج

select/invoke وvault handles موجودة. DEFAULT_ADAPTERS تعيد نصوصًا deterministic؛ Grok له مسار fetch وmock fallback، بلا إثبات اتصال حي في هذه الجولة.

[packages/runtime/src/providers.js](../packages/runtime/src/providers.js) | [tools/celia-grok-port.mjs](../tools/celia-grok-port.mjs)

<a id="e04"></a>

### E04 — Planner وDAG والأدوات

خطط وترتيب أدوات وDAG حقيقية جزئيًا؛ توجد fallbacks وهمية وتمرير capability.verified في demo. يلزم boundary مستقل لا الثقة بهذا العلم.

[packages/cells/celia/planner/src/grok.js](../packages/cells/celia/planner/src/grok.js) | [packages/cells/celia/executor/src/executor.js](../packages/cells/celia/executor/src/executor.js) | [packages/cells/celia/executor/src/tool-registry.js](../packages/cells/celia/executor/src/tool-registry.js) | [packages/cells/celia/executor/src/adaptive-dag.js](../packages/cells/celia/executor/src/adaptive-dag.js) | [tools/dag-executor.mjs](../tools/dag-executor.mjs)

<a id="e05"></a>

### E05 — Runtime وauthority وhealing

mission/budget/approvals/retry classification/breaker محلية بports محقونة؛ لا تعني تشغيل خدمات دائمًا أو إصلاح ملفات تلقائيًا آمنًا.

[packages/runtime/src/machine.js](../packages/runtime/src/machine.js) | [packages/runtime/src/authority.js](../packages/runtime/src/authority.js) | [packages/runtime/src/session.js](../packages/runtime/src/session.js) | [packages/runtime/src/healer.js](../packages/runtime/src/healer.js) | [packages/runtime/src/breaker.js](../packages/runtime/src/breaker.js) | [tests/omega-runtime.test.js](../tests/omega-runtime.test.js)

<a id="e06"></a>

### E06 — التأمل والمعرفة والتقييم الحالي

Reflection وتحليل observations وKnowledgeStore وbenchmarks فعلية pure. Learner ينتج مقترحات ولا يطبقها؛ المعرفة ليست KG/ontology شاملة.

[packages/learning/src/reflection.js](../packages/learning/src/reflection.js) | [packages/learning/src/knowledge.js](../packages/learning/src/knowledge.js) | [packages/learning/src/hypothesis.js](../packages/learning/src/hypothesis.js) | [packages/learning/src/benchmark.js](../packages/learning/src/benchmark.js) | [packages/learning/src/learner.js](../packages/learning/src/learner.js) | [tests/omega-learning.test.js](../tests/omega-learning.test.js)

<a id="e07"></a>

### E07 — طبقات الذاكرة والوصفات

tiers وrecipes وbelief lifecycle وretrieval primitives؛ Maps محلية، والـembedding الافتراضي hash/TF وليس نموذج semantic مدربًا.

[packages/runtime/src/memory.js](../packages/runtime/src/memory.js) | [packages/cells/celia/memory/src/lifecycle.js](../packages/cells/celia/memory/src/lifecycle.js) | [packages/cells/celia/memory/src/procedural-store.js](../packages/cells/celia/memory/src/procedural-store.js) | [packages/cells/celia/memory/src/belief-engine.js](../packages/cells/celia/memory/src/belief-engine.js) | [packages/cells/celia/memory/src/governed-engine.js](../packages/cells/celia/memory/src/governed-engine.js) | [packages/cells/celia/memory/src/vector-store.js](../packages/cells/celia/memory/src/vector-store.js)

<a id="e08"></a>

### E08 — موصلات الذاكرة وSupabase

loader يعيد createClient:null؛ لا إثبات live DB. ownership وRLS والموصل الفعلي بوابات قبول مستقلة.

[tools/celia-memory-port.mjs](../tools/celia-memory-port.mjs) | [tools/celia-vector-port.mjs](../tools/celia-vector-port.mjs) | [supabase/migrations/20260920_celia_memory_init.sql](../supabase/migrations/20260920_celia_memory_init.sql) | [supabase/migrations/20260921_pgvector.sql](../supabase/migrations/20260921_pgvector.sql)

<a id="e09"></a>

### E09 — WRITE وCOMMIT وH1/H2/H3

H1 نجح في restart/ABA وحفظ الاستهلاك. H2/H3 RED مقاسان. لا transaction/TOCTOU protection كاملة، ولا حماية تلقائية لكل منفذ قديم.

[tools/celia-workspace-write-auth.mjs](../tools/celia-workspace-write-auth.mjs) | [tools/celia-workspace-commit-auth.mjs](../tools/celia-workspace-commit-auth.mjs) | [tools/celia-workspace-commit-port.mjs](../tools/celia-workspace-commit-port.mjs) | [tools/celia-commit-consumption-store.mjs](../tools/celia-commit-consumption-store.mjs) | [tools/celia-workspace-port.mjs](../tools/celia-workspace-port.mjs) | [tests/celia-workspace-commit-hardening.test.js](../tests/celia-workspace-commit-hardening.test.js) | [tests/celia-workspace-commit-persistence.test.js](../tests/celia-workspace-commit-persistence.test.js) | [docs/celia-workspace-commit-h1-persistence.ar.md](../docs/celia-workspace-commit-h1-persistence.ar.md)

<a id="e10"></a>

### E10 — الأدلة والأحداث

hash chains/receipts موجودة؛ EventSourcingEngine في الذاكرة وcheckpoints ليست ضمان durability مستقلًا. توقيع receipt لا يثبت حالة منصة التشغيل.

[packages/evidence/index.js](../packages/evidence/index.js) | [packages/runtime/src/ledger.js](../packages/runtime/src/ledger.js) | [packages/cells/celia/executor/src/event-sourcing.js](../packages/cells/celia/executor/src/event-sourcing.js) | [tests/evidence.test.js](../tests/evidence.test.js)

<a id="e11"></a>

### E11 — التعلّم الجديد والجامع المحلي

logistic/MLP/backprop فعلي، split بحسب المهمة وreviewed labels. المجموعة الحالية صفر؛ candidate-only وغير معاير؛ لا online/promotion/RLHF/LoRA.

[packages/cells/celia/learning/src/data.js](../packages/cells/celia/learning/src/data.js) | [packages/cells/celia/learning/src/models.js](../packages/cells/celia/learning/src/models.js) | [tools/celia-learning-store.mjs](../tools/celia-learning-store.mjs) | [tools/celia-learning.mjs](../tools/celia-learning.mjs) | [tests/celia-learning.test.js](../tests/celia-learning.test.js) | [docs/celia-adaptive-learning.ar.md](../docs/celia-adaptive-learning.ar.md)

<a id="e12"></a>

### E12 — Evolution Gate والإصدارات

signed manifests وإصدارات وcanary/rollback/quarantine محلية؛ ليست rollback متعددة الملفات أو runtime attestation.

[packages/evolution/src/manifest.js](../packages/evolution/src/manifest.js) | [packages/evolution/src/gate.js](../packages/evolution/src/gate.js) | [packages/evolution/src/registry.js](../packages/evolution/src/registry.js) | [packages/cellular-evolution/index.js](../packages/cellular-evolution/index.js) | [tests/omega-evolution.test.js](../tests/omega-evolution.test.js)

<a id="e13"></a>

### E13 — الخلايا والحالة والصحة

transition/membrane/budgets/health primitives مختبرة محليًا. لا تعني موارد OS أو orchestration موزعة جاهزة.

[packages/cell/src/lifecycle.js](../packages/cell/src/lifecycle.js) | [packages/cell/src/health.js](../packages/cell/src/health.js) | [packages/cell/src/homeostasis.js](../packages/cell/src/homeostasis.js) | [packages/cell/src/membrane.js](../packages/cell/src/membrane.js) | [packages/cell/src/tissue.js](../packages/cell/src/tissue.js) | [packages/cell/src/organism.js](../packages/cell/src/organism.js) | [tests/cellular.test.js](../tests/cellular.test.js)

<a id="e14"></a>

### E14 — Google identity/gateway

تحقق token وربط roles وموافقات/quota/secret scans حقيقية محدودة. لا تعمم تلقائيًا على كل Celia أو DB ولا تثبت live federation deployment.

[packages/cells/google/identity/src/verify.js](../packages/cells/google/identity/src/verify.js) | [packages/cells/google/identity/src/bindings.js](../packages/cells/google/identity/src/bindings.js) | [packages/cells/google/gateway/src/approvals.js](../packages/cells/google/gateway/src/approvals.js) | [packages/cells/google/gateway/src/limiter.js](../packages/cells/google/gateway/src/limiter.js) | [packages/cells/google/gateway/src/vault.js](../packages/cells/google/gateway/src/vault.js) | [packages/cells/google/gateway/src/scan.js](../packages/cells/google/gateway/src/scan.js) | [packages/cells/google/gateway/src/classes.js](../packages/cells/google/gateway/src/classes.js) | [tests/google-gateway.test.js](../tests/google-gateway.test.js) | [tests/google-binding.test.js](../tests/google-binding.test.js)

<a id="e15"></a>

### E15 — فحوص الأمان والجودة الحالية

unit/negative cases وattack harness وinvariants؛ ليست corpus كاملة لفحص كل المنتجات أو fuzz/mutation engine متكاملة.

[tests/security.test.js](../tests/security.test.js) | [tests/omega-security.test.js](../tests/omega-security.test.js) | [tests/omega-invariants.test.js](../tests/omega-invariants.test.js) | [tests/canonical.test.js](../tests/canonical.test.js) | [tests/google-attacks.test.js](../tests/google-attacks.test.js) | [tools/omega-attacks.mjs](../tools/omega-attacks.mjs) | [tools/check-posture.mjs](../tools/check-posture.mjs) | [package.json](../package.json)

<a id="e16"></a>

### E16 — Compiler وAST port

تحليل NEXA الحقيقي منفصل عن port JS الذي يستخدم regex/bracket matching وvm.Script لفحص syntax؛ لا parser JS/TS كامل أو symbolic execution.

[packages/compiler/src/analyzer.js](../packages/compiler/src/analyzer.js) | [packages/compiler/index.js](../packages/compiler/index.js) | [tests/omega-compiler.test.js](../tests/omega-compiler.test.js) | [tools/celia-ast-port.mjs](../tools/celia-ast-port.mjs)

<a id="e17"></a>

### E17 — Dashboard والقياس وegress التجريبي

يوجد mockState وقياس CI وmasking نصي؛ ليست observability/egress boundary كاملة، ولا دليل منع كل تسريب.

[tools/celia-dashboard-server.mjs](../tools/celia-dashboard-server.mjs) | [tools/check-metrics.mjs](../tools/check-metrics.mjs) | [packages/cells/celia/ultimate/src/egress-proxy.js](../packages/cells/celia/ultimate/src/egress-proxy.js)

<a id="e18"></a>

### E18 — World

World يصف snapshot يوفره host ويتيح observations محكومة؛ لا model ديناميكي متعلم أو digital twin مطابق.

[packages/runtime/src/world.js](../packages/runtime/src/world.js) | [packages/runtime/src/machine.js](../packages/runtime/src/machine.js)

<a id="e19"></a>

### E19 — Z3 وNeuro-Symbolic التجريبيان

mock/heuristics ومخرجات tokens اصطناعية؛ لا backend Z3 أو إثبات عام أو شبكة عصبية فعلية في تلك المحركات.

[packages/cells/celia/omega/src/formal-z3-verification.js](../packages/cells/celia/omega/src/formal-z3-verification.js) | [packages/cells/celia/ultimate/src/z3-verifier.js](../packages/cells/celia/ultimate/src/z3-verifier.js) | [packages/cells/celia/infinite/src/neural-symbolic-engine.js](../packages/cells/celia/infinite/src/neural-symbolic-engine.js)

<a id="e20"></a>

### E20 — Sandbox التجريبي

WASM engine يعيد mock output؛ permission probe أداة محدودة مستقلة ولا يجعل ذلك sandbox خدمة إنتاج.

[packages/cells/celia/ultimate/src/wasm-sandbox.js](../packages/cells/celia/ultimate/src/wasm-sandbox.js) | [tools/permission-proof.mjs](../tools/permission-proof.mjs) | [tools/permission-probe.mjs](../tools/permission-probe.mjs)

<a id="e21"></a>

### E21 — KV cache التجريبي

صفحات tokens/hash/refcounts ووصف DSL، لا K/V tensors مدارة في inference runtime.

[packages/cells/celia/infinite/src/kv-cache-dedup.js](../packages/cells/celia/infinite/src/kv-cache-dedup.js) | [packages/cells/celia/dsl/src/pmplspec.js](../packages/cells/celia/dsl/src/pmplspec.js)

<a id="e22"></a>

### E22 — Actor/mailbox

queue/priority/dead-letter في Maps محلية؛ لا durability أو delivery عبر عمليات مستقلة.

[packages/cells/celia/infinite/src/actor-mailbox.js](../packages/cells/celia/infinite/src/actor-mailbox.js)

<a id="e23"></a>

### E23 — جلب الأبحاث المقيد

مصدر ثابت وmetadata غير موثوقة دون auto-training؛ اختبار الموصل محلي، الاتصال الحي السابق فشل ECONNRESET.

[tools/celia-learning-research.mjs](../tools/celia-learning-research.mjs) | [tests/celia-learning.test.js](../tests/celia-learning.test.js) | [docs/celia-adaptive-learning.ar.md](../docs/celia-adaptive-learning.ar.md)

<a id="e24"></a>

### E24 — المسارات والوكلاء والمحاكاة

variant filtering وpheromone/consensus demos ليست ToT/GoT أو تحسين جودة جماعية مثبتًا.

[packages/cells/celia/infinite/src/multiverse-engine.js](../packages/cells/celia/infinite/src/multiverse-engine.js) | [packages/cells/celia/infinite/src/swarm-pheromone.js](../packages/cells/celia/infinite/src/swarm-pheromone.js) | [packages/cells/celia/dsl/src/consensus-dsl.js](../packages/cells/celia/dsl/src/consensus-dsl.js)

<a id="e25"></a>

### E25 — لغات السياق والـworkflow

parsers/وصف خطة وحدود مقترحة؛ parser لسياسة موارد لا يعني enforcement من OS.

[packages/cells/celia/dsl/src/ctxql.js](../packages/cells/celia/dsl/src/ctxql.js) | [packages/cells/celia/dsl/src/flow-dsl.js](../packages/cells/celia/dsl/src/flow-dsl.js) | [packages/cells/celia/dsl/src/caplang.js](../packages/cells/celia/dsl/src/caplang.js) | [packages/cells/celia/dsl/src/replay-dsl.js](../packages/cells/celia/dsl/src/replay-dsl.js)

<a id="e26"></a>

### E26 — السببية التجريبية

graph structure موجودة؛ observe/intervene/counterfactual تستخدم قيمًا عشوائية، لا identification أو causal estimation.

[packages/cells/celia/singularity/src/causal-do-calculus.js](../packages/cells/celia/singularity/src/causal-do-calculus.js)

<a id="e27"></a>

### E27 — Federated/dreaming/synthesis demos

تجميع نصوص وديمو احتمالات وتركيب شكلي؛ لا تدريب FedAvg أو self-play مقاس أو program synthesis موثقة بالتحقق.

[packages/cells/celia/singularity/src/federated-noospheric.js](../packages/cells/celia/singularity/src/federated-noospheric.js) | [packages/cells/celia/singularity/src/synthetic-dreaming.js](../packages/cells/celia/singularity/src/synthetic-dreaming.js) | [packages/cells/celia/singularity/src/monadic-synthesis.js](../packages/cells/celia/singularity/src/monadic-synthesis.js)


## 11. التسليم وحدود هذه الجولة

أُضيفت هذه الخطة ومصفوفتا Markdown/CSV، ورابط من roadmap فقط. لم تتغير مصادر النظام أو اختباراته أو package configuration. تحققت تغطية **100+100**، وفرادة IDs، ووجود المراجع، وتطابق أسماء وترتيب الصفوف بين Markdown وCSV، وبقاء بصمات مصادر/اختبارات الجرد كما كانت. التقارير السابقة تبقى سجلًا تاريخيًا ولا تُعاد تسميتها نجاحًا لهذه الميزات الجديدة.
