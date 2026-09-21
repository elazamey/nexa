# v1.3 — Live Agent Desktop 2026 (architecture reference)

> **Status:** architecture reference (owner-supplied, 2026-09-21) — **Free-First / Local-First / No-Card-First.**
> **Companion:** `v13-implementation-map.md` maps every section below to the real repo state
> (branch `arena/01a0bf1b-nexa`) and orders the work per repo culture: vectors first, deterministic mock first, no kernel bloat.
> **Progress:** v13-1 (Approval Protocol) + v13-2 (Terminal Port, §8) + v13-3 (Mission API +
> Event-Sourced Replay, §35/§41) + v13-4 (Unified Governance & Observability, §1/§8)
> COMPLETE 2026-09-21 — 34/34 vectors; live round-trip: create → run → WAITING_APPROVAL →
> approve → auto-resume → COMPLETED → replay VALID, with Approval Center + unified timeline +
> Evidence Drawer + LIVE/DEMO honesty badges + real per-mission usage in the dashboard.
> Next: v13-5 (Desktop/Browser plane per §1 — Cloudflare Free control plane + local execution).
> **Supersedes:** — (v12-creative stays in force: creative phases 3–6 interleave into the mission demo)

## STATUS

**جاهز كتصميم معماري لـ Live Agent Desktop 2026 — Free-First / Local-First / No-Card-First.**

الفكرة التي أنصح بها ليست أن نبني «شاشة VNC جميلة» فقط، بل أن نجعلها **نافذة حية على عقل التنفيذ**: كل نقرة، أمر، ملف، متصفح، موافقة، نتيجة، ودليل يظهر كحدث موثّق.

والنقطة المهمة: **لا يمكن الاعتماد على Cloudflare أو أي استضافة مجانية لتشغيل Desktop/Browser ثقيل 24/7 بلا حدود**. لذلك التصميم الصحيح هو:

> **Cloud Control Plane مجاني + Local Execution Plane مجاني + Tunnel اختياري + AI Mesh متعدد المصادر.**

Cloudflare Free يعطي حاليًا Workers بحد 100,000 طلب/يوم، وWorkers Logs بحد 200,000 حدث/يوم، وKV بحدود مجانية، بينما Durable Objects على الخطة المجانية تدعم WebSockets وSQLite مع حدود يومية؛ وR2 يعطي 10GB-month مع 1M عمليات كتابة و10M قراءة شهريًا مجانًا. ([Cloudflare Docs][1])

---

# 1. الشكل النهائي الذي نبنيه

```text
                         ┌─────────────────────────────┐
                         │       CELIA / NEXA UI       │
                         │                             │
                         │ Chat │ Desktop │ Browser    │
                         │ Files│ Terminal│ Timeline   │
                         │ Policy│ Evidence│ Agents   │
                         └──────────────┬──────────────┘
                                        │
                         HTTPS / SSE / WebSocket
                                        │
                         ┌──────────────▼──────────────┐
                         │      CLOUDFLARE CONTROL      │
                         │                              │
                         │ Worker API                   │
                         │ Durable Object Session       │
                         │ D1 metadata                  │
                         │ R2 artifacts                 │
                         │ KV cache/config              │
                         │ AI Router                    │
                         └──────────────┬───────────────┘
                                        │
                                 Secure Tunnel
                                        │
                 ┌──────────────────────▼──────────────────────┐
                 │              LOCAL AGENT HOST               │
                 │                                              │
                 │ NEXA Execution Authority                     │
                 │ ├─ Policy Engine                             │
                 │ ├─ Capability Resolver                       │
                 │ ├─ Authorization Gate                        │
                 │ ├─ Verifier                                  │
                 │ └─ Evidence Ledger                           │
                 │                                              │
                 │ Adapters                                     │
                 │ ├─ Windows Desktop                           │
                 │ ├─ PowerShell                                │
                 │ ├─ Filesystem                                │
                 │ ├─ Playwright Browser                        │
                 │ ├─ Browser Agent                             │
                 │ └─ Screenshot / VNC                          │
                 │                                              │
                 │ Local AI                                     │
                 │ └─ Ollama                                    │
                 └──────────────────────────────────────────────┘
```

هذه البنية تعطيك شيئًا أهم من Claude/Manus-style UI:

**الواجهة لا تدّعي أن الوكيل نفّذ شيئًا.**

كل شيء يمر:

```text
Intent
  ↓
Plan
  ↓
Capability
  ↓
Policy
  ↓
Authorization
  ↓
Execution
  ↓
Observation
  ↓
Verification
  ↓
Evidence
  ↓
UI
```

---

# 2. الـ Live Desktop نفسه

عند الضغط على:

> `Desktop`

يظهر **Desktop حقيقي** وليس animation.

المستخدم يرى:

```text
┌────────────────────────────────────────────────────────────────┐
│ CELIA LIVE DESKTOP                         ● CONNECTED  14:32:08│
├───────────────┬──────────────────────────────┬─────────────────┤
│ Mission       │                              │ Agent           │
│               │                              │                 │
│ ● Research    │      LIVE DESKTOP            │ PLAN            │
│ ● Browser     │                              │                 │
│ ● Terminal    │      ┌─────────────────┐     │ Step 03         │
│ ● Files       │      │ Chrome          │     │                 │
│               │      │                 │     │ ACTION          │
│               │      │   Search...     │     │ click()         │
│               │      │                 │     │                 │
│               │      └─────────────────┘     │ POLICY          │
│               │                              │ ALLOWED         │
├───────────────┴──────────────────────────────┴─────────────────┤
│ Timeline                                                       │
│ 11:42:01 PLAN                                                  │
│ 11:42:03 CAPABILITY browser.navigate                           │
│ 11:42:04 POLICY ALLOW                                          │
│ 11:42:06 BROWSER NAVIGATED                                     │
│ 11:42:07 SCREENSHOT                                            │
│ 11:42:08 VERIFIED                                              │
└────────────────────────────────────────────────────────────────┘
```

ولا نعرض Chain-of-Thought الداخلي للنموذج؛ نعرض فقط **Intent / Plan / Next Action / Result / Evidence**.

---

# 3. طبقة الـ Desktop Streaming

## الخيار الأول: noVNC

noVNC مشروع مفتوح المصدر يتيح تشغيل VNC داخل المتصفح، ويستخدم WebSockets، مع websockify كجسر WebSocket→TCP عند الحاجة. ([GitHub][2])

المسار:

```text
Windows/Linux Desktop
       ↓
VNC Server
       ↓
websockify
       ↓
WebSocket
       ↓
noVNC
       ↓
Celia UI
```

ميزة هذا الخيار:

**بسيط جدًا للتنفيذ الأول.**

---

# 4. الخيار المتقدم: WebRTC Desktop Stream

بعد نجاح V1:

```text
Screen Capture
      ↓
Encoder
      ↓
WebRTC
      ↓
Browser
```

هنا يصبح العرض أقرب إلى:

> «شاهد الوكيل يعمل لحظيًا»

بدل إحساس VNC التقليدي.

ونعمل:

```text
WebRTC Video
+
DataChannel
+
Event Stream
```

فيصبح لدينا:

```text
video frame
mouse position
keyboard event
agent action
policy event
verification event
```

كلها متزامنة.

---

# 5. مؤشر الماوس الذكي

هذه ستكون واحدة من الأشياء التي تجعل العرض مذهلًا.

بدل:

> Cursor يتحرك فقط.

نجعل الماوس يحمل **هوية العملية**:

```text
● Agent Cursor

Intent:
"Open GitHub"

Action:
mouse.move(x=712,y=184)
mouse.click()

Capability:
browser.interact

Policy:
ALLOW

Evidence:
event#8f31...
```

وعلى الشاشة:

```text
        ╭──────────────╮
        │ Agent Cursor │
        ╰──────────────╯
                ↓
            [Search]
```

---

# 6. Browser Engine

لا تجعل Browser Use هو القلب الوحيد.

القلب يجب أن يكون:

> **Playwright Adapter**

Playwright مفتوح المصدر ويدعم Chromium وFirefox وWebKit، ويمكن تشغيله محليًا وheadless أو headed. ([Playwright][3])

البنية:

```text
NEXA
 ↓
Browser Capability
 ↓
Playwright Adapter
 ↓
Chromium
```

ثم نضيف:

```text
Browser Agent
```

كطبقة تخطيط اختيارية:

```text
LLM
 ↓
Browser Planner
 ↓
NEXA Capability
 ↓
Playwright
```

وليس:

```text
LLM
 ↓
browser.execute-anything()
```

---

# 7. Browser Observation Engine

بعد كل عملية:

```text
Screenshot
DOM snapshot
URL
Title
Active element
Visible text
Network state
Console errors
```

ثم:

```text
Observation
     ↓
Verifier
```

مثلاً:

```json
{
  "action": "click_submit",
  "expected": "form submitted",
  "observed": {
    "url_changed": true,
    "toast": "Success",
    "status": 200
  },
  "verified": true
}
```

وهنا يتحول النظام من:

**Agent that acts**

إلى:

**Agent that proves.**

---

# 8. Terminal

## Windows

```text
NEXA
 ↓
Terminal Capability
 ↓
PowerShell Sandbox
 ↓
Job / Process Isolation
 ↓
stdout
stderr
exitCode
timeout
filesystem diff
```

مثال:

```json
{
  "capability": "terminal.execute",
  "shell": "powershell",
  "command": "Get-ChildItem",
  "timeout_ms": 10000
}
```

بعد التنفيذ:

```json
{
  "exit_code": 0,
  "stdout_hash": "...",
  "stderr_hash": "...",
  "duration_ms": 192,
  "verified": true
}
```

---

# 9. Files

نقسم العمليات:

```text
FILES
├── read
├── inspect
├── create
├── write
├── move
├── delete
└── commit
```

ثم capabilities منفصلة:

```text
fs.read
fs.inspect
fs.write
fs.delete
fs.commit
```

وهذا مهم جدًا.

لا تعطِ:

```text
filesystem.full_access
```

للوكيل.

---

# 10. Approval Center

كل عملية حساسة تظهر هكذا:

```text
╔══════════════════════════════════════════════╗
║          APPROVAL REQUIRED                   ║
╠══════════════════════════════════════════════╣
║ Capability: filesystem.write                 ║
║ Target: C:\project\src\app.ts                ║
║                                              ║
║ Reason: Apply generated patch                ║
║                                              ║
║ Files: 2                                     ║
║ Risk: Medium                                 ║
║                                              ║
║ [ APPROVE ONCE ] [ APPROVE MISSION ]         ║
║ [ DENY ]                                     ║
╚══════════════════════════════════════════════╝
```

والأهم:

**الموافقة نفسها Event موثّق.**

---

# 11. Policy Engine

هذا هو قلب NEXA.

مثال:

```text
REQUEST
  ↓
Capability Resolver
  ↓
Policy Match
  ↓
Context Evaluation
  ↓
Authorization Decision
```

مثلاً:

```json
{
  "actor": "agent-01",
  "capability": "fs.write",
  "target": "src/app.ts",
  "workspace": "project-a"
}
```

Policy:

```text
ALLOW:
src/**

DENY:
.git/**
secrets/**
.env

REQUIRE_APPROVAL:
deployment/**
production/**
```

---

# 12. Evidence Ledger

كل شيء يولد Evidence.

مثال:

```json
{
  "event_id": "evt_0188",
  "mission_id": "mis_001",
  "actor": "agent-01",
  "capability": "browser.click",
  "target_hash": "...",
  "input_hash": "...",
  "result_hash": "...",
  "previous_event_hash": "...",
  "timestamp": "...",
  "policy": "ALLOW",
  "signature": "..."
}
```

ثم:

```text
evt1
 ↓ hash
evt2
 ↓ hash
evt3
 ↓ hash
evt4
```

فيصبح عندك:

> **Tamper-evident execution history**

ويمكن لاحقًا توقيع الأحداث بمفاتيح NEXA.

---

# 13. Live Event Bus

أنا أفضل:

### SSE

لأحداث التنفيذ:

```text
GET /v1/missions/{id}/events
```

ثم:

```text
event: plan
event: capability
event: policy
event: action
event: stdout
event: screenshot
event: result
event: evidence
event: verification
event: completed
```

وللتحكم ثنائي الاتجاه:

### WebSocket

```text
/ws/session/{id}
```

Cloudflare Workers على الخطة المجانية تدعم WebSockets، وتذكر وثائق التسعير أن رسالة WebSocket بعد إنشاء الاتصال لا تُحسب كطلب Worker إضافي بالطريقة نفسها التي تُحسب بها عملية Upgrade. ([Cloudflare Docs][1])

---

# 14. Durable Object = غرفة الوكيل

هذه فكرة مهمة جدًا.

اجعل:

```text
MissionSessionDO
```

هو «عقل الجلسة الحية».

كل Mission لها:

```text
Session DO
├── state
├── subscribers
├── active capabilities
├── approvals
├── event sequence
├── heartbeat
├── leases
└── recovery state
```

على الخطة المجانية، Durable Objects مع SQLite لها حاليًا حدود مجانية تشمل 100,000 طلب يوميًا و13,000 GB-s/day، و5GB تخزين SQLite للحساب مع حدود يومية للقراءة والكتابة. ([Cloudflare Docs][4])

---

# 15. التخزين

## D1

للبيانات المنظمة:

```text
users
missions
agents
capabilities
policies
approvals
runs
providers
```

D1 على Workers Free يعطي حاليًا 5M صف قراءة/يوم و100k صف كتابة/يوم. ([Cloudflare Docs][1])

## R2

للملفات الثقيلة:

```text
screenshots
artifacts
logs
videos
patches
reports
```

والـR2 لديه حاليًا Free Tier قدره 10GB-month، و1M Class A، و10M Class B، مع عدم وجود رسوم Egress. ([Cloudflare Docs][5])

## KV

لـ:

```text
cache
provider config
feature flags
UI preferences
small metadata
```

والـFree يعطي 100k reads/day و1k writes/day و1GB storage. ([Cloudflare Docs][6])

---

# 16. لا تخزن الفيديو بالكامل

هذه حيلة مهمة لتبقى Free-First.

بدل:

```text
60 FPS recording × hours
```

نستخدم:

```text
Live stream
     ↓
Ephemeral

وعند:
important event
error
approval
failure
completion
```

نحفظ:

```text
screenshot
event
DOM
stdout
diff
evidence
```

وعند طلب المستخدم:

```text
Record Mission
```

نفعّل recording.

---

# 17. AI Mesh

لن يكون النظام مربوطًا بموديل واحد.

## Tier 0 — Local

```text
Ollama
 ├── coding model
 ├── reasoning model
 └── lightweight model
```

هذا هو الضمان الحقيقي ضد التكلفة.

---

## Tier 1 — Gemini

Gemini Developer API لديها نماذج ضمن Free Tier حاليًا؛ Google تعرض مثلًا Gemini 2.5 Flash-Lite بإدخال وإخراج مجانيين ضمن الخطة المجانية، مع حدود معدل استخدام تُطبق حسب النموذج والمشروع. ([Google AI for Developers][7])

نستخدمه في:

```text
planning
summarization
vision
tool selection
code reasoning
```

لكن لا نجعل النظام معتمدًا عليه.

---

# 18. Cloudflare Workers AI

مفيد كطبقة إضافية.

Workers AI على Free يعطي حاليًا:

```text
10,000 Neurons / day
```

وبعض النماذج ما زالت متاحة على Workers Free، بينما نماذج أخرى أصبحت تتطلب Paid منذ يوليو 2026. ([Cloudflare Docs][8])

مثلاً الوثائق الحالية تشير إلى توفر نماذج مثل:

```text
GLM-4.7-Flash
Gemma 4 26B
Nemotron 3 120B
```

على الخطة المجانية. ([Cloudflare Docs][9])

---

# 19. Hugging Face

استخدم HF باعتباره:

```text
Model Registry
+
Optional Inference Provider
+
Static Demo
```

لكن لا أجعله العمود الفقري للـruntime المجاني.

حاليًا Free users يحصلون على **$0.10 شهريًا** من أرصدة Inference Providers، مع إمكانية دفع استخدام إضافي عند توفر الدفع. ([Hugging Face][10])

لذلك:

```text
HF = optional
Local = primary
Gemini = secondary
Cloudflare AI = secondary
```

---

# 20. Provider Router

لا نكتب:

```javascript
if (provider === "gemini")
```

في كل النظام.

بل:

```text
ProviderBroker
```

ويستقبل:

```json
{
  "task": "planning",
  "quality": "medium",
  "latency": "low",
  "cost": "zero",
  "vision": false,
  "context": 100000
}
```

ثم:

```text
Provider Router
       ↓
Local Ollama
       ↓
Gemini
       ↓
Workers AI
       ↓
HF
```

والقاعدة:

```text
NO-COST FIRST
LOCAL FIRST
FAILOVER
NO BILLING ESCALATION
```

---

# 21. الوضع الأفضل لجهازك

مع جهازك الحالي لا أنصح أن تجعل:

```text
Desktop
+
Browser
+
LLM
+
Video encoder
+
Docker swarm
```

كلها تعمل بكامل طاقتها.

الأفضل:

```text
Windows
│
├── Celia Agent Host
│
├── PowerShell
│
├── Playwright
│
├── noVNC/VNC
│
└── Ollama
```

والمعالجة الثقيلة:

```text
Cloud AI
```

عند الحاجة فقط.

---

# 22. Remote Access بدون شراء سيرفر

Cloudflare Tunnel مناسب جدًا لهذه النقطة؛ هو يربط جهازك المحلي بشبكة Cloudflare عبر اتصال outbound، ويمكنه نشر تطبيق محلي، وحتى خدمات Remote Desktop. ([Cloudflare Docs][11])

للاختبار توجد Quick Tunnels مجانية تنشئ عنوان `trycloudflare.com` عشوائيًا. ([Cloudflare Docs][12])

المسار:

```text
Browser
  ↓
Cloudflare
  ↓
Tunnel
  ↓
localhost:8765
  ↓
NEXA Agent Host
```

---

# 23. طبقة Desktop Adapter

لا تربط الواجهة مباشرة بـPowerShell أو Windows API.

اعمل:

```text
DesktopAdapter
```

واجهة موحدة:

```typescript
interface DesktopAdapter {
  screenshot(): Promise<Image>;
  move(x: number, y: number): Promise<Result>;
  click(button: MouseButton): Promise<Result>;
  doubleClick(): Promise<Result>;
  type(text: string): Promise<Result>;
  keyPress(key: string): Promise<Result>;
  scroll(delta: number): Promise<Result>;
  getWindows(): Promise<WindowInfo[]>;
  focusWindow(id: string): Promise<Result>;
}
```

لكن كل method تمر عبر:

```text
Capability
Policy
Authorization
Evidence
```

---

# 24. النتيجة المبهرة: Action Overlay

عندما الوكيل ينفذ:

```text
Click Google Search
```

على الشاشة تظهر:

```text
╭─────────────────────────────╮
│ NEXA ACTION                 │
│ browser.click               │
│ Target: Search box          │
│ Policy: ALLOW               │
│ Verified: ✓                 │
╰─────────────────────────────╯
```

ثم تختفي.

وهذا يجعل المشاهد **يفهم ماذا يحدث دون قراءة logs**.

---

# 25. Mission Timeline

بدل مجرد Chat:

```text
Mission
│
├── PLAN
│
├── BROWSER.OPEN
│
├── POLICY.ALLOW
│
├── MOUSE.MOVE
│
├── MOUSE.CLICK
│
├── DOM.CHANGE
│
├── SCREENSHOT
│
├── VERIFY
│
├── EVIDENCE.SIGN
│
└── RESULT
```

ويمكن الضغط على أي event.

فيعرض:

```text
Action
Input
Policy
Observation
Result
Evidence
```

---

# 26. Replay Mode

هذه من أقوى خصائص المنتج.

بعد انتهاء Mission:

```text
[ LIVE ] [ REPLAY ] [ EVIDENCE ]
```

REPLAY:

```text
00:00 PLAN
00:03 OPEN BROWSER
00:04 MOVE
00:05 CLICK
00:07 TYPE
00:11 VERIFY
```

والـDesktop يتحرك مجددًا.

لكن بدل فيديو عادي، نعيد بناء الحالة من:

```text
events
screenshots
actions
DOM states
evidence
```

وهذا أقوى بكثير من screen recording.

---

# 27. Time Travel Debugging

اختر:

```text
Event #31
```

فتعود الشاشة إلى:

```text
Desktop State #31
```

ثم:

```text
Why did agent do this?
```

فيعرض:

```text
Intent
Available capabilities
Policy decision
Observed state
Selected action
Result
```

وليس chain-of-thought السري.

---

# 28. Multi-Agent Mode

بعد نجاح Single Agent:

```text
                Mission
                   │
        ┌──────────┼──────────┐
        │          │          │
    Planner     Browser     Coder
        │          │          │
        └──────────┼──────────┘
                   │
              Verifier
                   │
                Evidence
```

لكن **Execution Authority واحدة**.

هذه نقطة جوهرية:

> كثرة الوكلاء لا تعني كثرة سلطات التنفيذ.

كلهم يطلبون capability.

---

# 29. Agent Roles

مثلاً:

```text
Planner
Researcher
BrowserAgent
Coder
TerminalAgent
FileAgent
Reviewer
Verifier
SecurityAgent
```

وكل Agent:

```json
{
  "agent_id": "browser-01",
  "role": "browser",
  "capabilities": [
    "browser.read",
    "browser.navigate",
    "browser.click"
  ]
}
```

وليس:

```json
{
  "administrator": true
}
```

---

# 30. Self-Healing

عندما يفشل:

```text
click(selector)
```

لا يقوم الوكيل مباشرة بتجربة عشوائية.

نستخدم:

```text
Failure
 ↓
Observation
 ↓
Diagnosis
 ↓
Candidate Recovery
 ↓
Policy
 ↓
Retry
 ↓
Verify
```

مثلاً:

```text
selector not found
```

قد يجرب:

```text
DOM role
text locator
accessible name
visual target
```

وكل محاولة Event منفصل.

---

# 31. Self-Improving NEXA

وهنا الجزء الذي سيحوّل المشروع إلى مشروع كبير فعلًا.

لا نجعل:

> AI يكتب كود النظام ويعدل نفسه.

بل:

```text
Telemetry
 ↓
Failure Miner
 ↓
Pattern Detection
 ↓
Improvement Proposal
 ↓
Patch Candidate
 ↓
Generated Tests
 ↓
Sandbox Evaluation
 ↓
Differential Verification
 ↓
Policy Gate
 ↓
Human Approval
 ↓
Signed Release
 ↓
Canary
 ↓
Monitoring
 ↓
Rollback
```

أي:

> **Self-improving ≠ self-authorizing**

وهذه قاعدة ينبغي أن تبقى ثابتة.

---

# 32. Improvement Proposal

مثال:

```json
{
  "proposal_id": "imp_0019",
  "problem": "Browser selector recovery failed",
  "evidence": [
    "evt_88",
    "evt_91",
    "evt_92"
  ],
  "hypothesis": "role-based recovery should precede visual recovery",
  "patch": "adapter/browser/recovery.ts",
  "tests_added": 7,
  "risk": "medium"
}
```

ثم:

```text
REVIEW
```

وليس:

```text
AUTO MERGE
```

---

# 33. Policy Root

هناك جزء لا يسمح للـAI بتغييره ذاتيًا:

```text
Root Policy
Root Capabilities
Root Signing Keys
Authorization Kernel
Evidence Verifier
Rollback Mechanism
```

هذه:

```text
IMMUTABLE / HUMAN-GOVERNED
```

بينما:

```text
plugins
adapters
prompts
heuristics
optimizers
skills
recovery logic
```

يمكن تحسينها.

---

# 34. NEXA Envelope

اجعل كل عملية داخل Envelope موحد:

```json
{
  "nexa": "1.0",
  "id": "evt_01",
  "parent": "evt_00",
  "timestamp": "2026-09-21T08:20:00Z",

  "actor": {
    "id": "agent-01",
    "role": "browser"
  },

  "intent": {
    "type": "browser.navigate",
    "target_hash": "..."
  },

  "capability": "browser.navigate",

  "policy": {
    "decision": "ALLOW",
    "policy_id": "browser.default.v3"
  },

  "execution": {
    "status": "SUCCESS"
  },

  "evidence": {
    "observation_hash": "...",
    "result_hash": "..."
  },

  "signature": "..."
}
```

---

# 35. الحالة State Machine

كل عملية لها:

```text
REQUESTED
   ↓
RESOLVED
   ↓
POLICY_CHECKED
   ↓
AUTHORIZED
   ↓
EXECUTING
   ↓
OBSERVED
   ↓
VERIFIED
   ↓
EVIDENCED
   ↓
COMPLETED
```

والفشل:

```text
FAILED
DENIED
TIMEOUT
CANCELLED
QUARANTINED
```

ولا توجد:

```text
"probably completed"
```

---

# 36. واجهة المستخدم النهائية

أقترح 7 أوضاع:

```text
CHAT
DESKTOP
BROWSER
TERMINAL
FILES
TIMELINE
EVIDENCE
```

وفوقها:

```text
Mission
Agent
Policy
Network
Provider
Cost
Security
```

---

# 37. Cost Meter

حتى لو كل شيء مجاني، اعرض:

```text
AI COST
────────────
Local       $0
Gemini      $0
Workers AI  $0
HF          $0

TOTAL       $0.00
```

لكن **لا تعتمد على كلمة Free فقط**.

النظام نفسه يتحقق:

```text
FREE_FOREVER
FREE_QUOTA
TRIAL
PAID
BLOCKED
```

مثلاً:

```text
Provider:
Gemini

Status:
FREE_QUOTA

Remaining:
X

Billing Required:
NO / UNKNOWN
```

وعندما ينتهي:

```text
Provider exhausted
      ↓
Fallback Local
```

ولا يتحول تلقائيًا إلى Paid.

---

# 38. Provider Policy

القانون:

```text
MAX_COST = 0
```

ثم:

```text
if predicted_cost > 0:
    DENY
```

وبالتالي حتى لو API provider حاول تطبيق دفع:

```text
NEXA → DENY
```

---

# 39. Offline Mode

ميزة مهمة جدًا:

```text
OFFLINE
```

يعمل:

```text
Chat
Terminal
Files
Browser
Desktop
Policy
Evidence
Local AI
```

بدون إنترنت، باستثناء العمليات التي تحتاج شبكة فعلًا.

---

# 40. Demo Mode

للعرض العام:

```text
DEMO MODE
```

والنظام يستطيع العمل ببيانات آمنة:

```text
Synthetic Files
Synthetic Browser
Synthetic Mission
```

لكن **يجب أن تحمل الشاشة بوضوح**:

```text
DEMO / SIMULATED
```

حتى لا يصبح الـdemo ادعاءً كاذبًا.

وعند التشغيل الحقيقي:

```text
LIVE / VERIFIED
```

---

# 41. أربع طبقات للحالة

وهذه أريد تثبيتها في NEXA:

```text
PLANNED
```

الموديل اقترح.

```text
AUTHORIZED
```

السياسة سمحت.

```text
EXECUTED
```

العملية حدثت فعليًا.

```text
VERIFIED
```

الدليل أثبت النتيجة.

لا نخلط بينهم.

---

# 42. GitHub / Dev Workspace

ميزة قوية:

```text
Files
 ↓
Git
 ↓
Branch
 ↓
Patch
 ↓
Tests
 ↓
Review
 ↓
Commit
```

وفي الـDesktop:

```text
Mission: Fix login bug

Changed:
3 files

Tests:
28 passed

Policy:
ALLOW

Evidence:
23 events

Commit:
PENDING APPROVAL
```

ولا يوجد:

```text
AI auto-push
```

إلا بصلاحية مستقلة وصريحة.

---

# 43. بنية المستودع المقترحة

```text
nexa/
│
├── apps/
│   ├── console/
│   ├── desktop-ui/
│   └── demo/
│
├── packages/
│   ├── protocol/
│   ├── capabilities/
│   ├── policy/
│   ├── authorization/
│   ├── execution/
│   ├── evidence/
│   ├── verifier/
│   ├── provider-broker/
│   ├── browser/
│   ├── terminal/
│   ├── filesystem/
│   ├── desktop/
│   ├── events/
│   └── recovery/
│
├── services/
│   ├── control-plane/
│   ├── session-do/
│   └── artifact-store/
│
├── local/
│   ├── agent-host/
│   ├── powershell/
│   ├── browser/
│   ├── desktop/
│   └── bridge/
│
├── schemas/
│   ├── envelope/
│   ├── events/
│   ├── capabilities/
│   └── evidence/
│
├── tests/
│   ├── contract/
│   ├── security/
│   ├── adversarial/
│   ├── integration/
│   └── e2e/
│
└── docs/
    ├── architecture/
    ├── security/
    ├── protocol/
    └── operations/
```

(ملاحظة mapping: المستودع الحالي يستخدم `packages/cells/celia/*` للـ agents/engines و`tools/celia-*-port.mjs`
لطبقة الإدخال/الإخراج — لا نكسر هذا النمط، نمتد عليه. انظر `v13-implementation-map.md`.)

---

# 44. API الأساسية

```text
POST /v1/missions
GET  /v1/missions/:id

POST /v1/missions/:id/start
POST /v1/missions/:id/cancel

GET  /v1/missions/:id/events

POST /v1/capabilities/resolve
POST /v1/authorizations/request
POST /v1/authorizations/:id/approve

GET  /v1/evidence/:id
GET  /v1/missions/:id/replay

POST /v1/providers/route
GET  /v1/providers/status

POST /v1/improvements/proposals
GET  /v1/improvements/:id

WS /v1/sessions/:id
WS /v1/sessions/:id/desktop
```

---

# 45. أهم Events

```text
mission.created
mission.started

plan.created
capability.requested
capability.resolved

policy.checked
authorization.requested
authorization.approved
authorization.denied

desktop.connected
desktop.screenshot
desktop.mouse
desktop.keyboard

browser.opened
browser.navigated
browser.clicked
browser.typed

terminal.started
terminal.stdout
terminal.stderr
terminal.exit

file.read
file.write
file.changed

execution.started
execution.completed
execution.failed

verification.started
verification.passed
verification.failed

evidence.created
evidence.signed

mission.completed
mission.failed
mission.cancelled
```

---

# 46. Security Architecture

```text
             UNTRUSTED
                 │
                 ▼
             LLM OUTPUT
                 │
                 ▼
          Capability Resolver
                 │
                 ▼
             Policy
                 │
                 ▼
        Authorization Gate
                 │
                 ▼
          Execution Sandbox
                 │
                 ▼
              Verifier
                 │
                 ▼
              Evidence
```

الموديل لا يحصل على:

```text
raw shell
raw filesystem
raw desktop
raw network
```

بل يحصل على:

```text
typed capabilities
```

مثل:

```text
browser.click
browser.navigate
fs.read
fs.write
terminal.execute.safe
desktop.click
```

---

# 47. Network Security

الـLocal Host لا يفتح:

```text
0.0.0.0:8765
```

للعالم.

بل:

```text
localhost
     ↓
cloudflared
     ↓
Cloudflare
```

ويمكن نشر التطبيق المحلي خلف Tunnel، دون فتح IP عام؛ Cloudflare توضح أن Tunnel ينشئ اتصالًا outbound من `cloudflared` ويمكنه توصيل خدمات مثل HTTP وSSH وRemote Desktop. ([Cloudflare Docs][11])

---

# 48. لماذا لا أجعل RustDesk هو الـCore؟

RustDesk ممتاز كطبقة Remote Desktop مستقلة ومفتوحة المصدر، وله خادم OSS مجاني self-hosted، ويدعم Windows/Linux/macOS وغيرها. ([RustDesk][13])

لكن في NEXA أراه:

```text
OPTIONAL REMOTE ACCESS LAYER
```

وليس:

```text
Execution Authority
```

أي:

```text
NEXA = من يقرر وينفذ ويثبت
RustDesk/noVNC = كيف نرى/نصل
```

---

# 49. wow factor الحقيقي

لا تحاول منافسة Manus بعدد animations.

اجعل التجربة:

### المستخدم:

```text
"افتح المشروع، شخّص المشكلة، أصلحها واختبرها."
```

### الشاشة:

```text
MISSION STARTED

[1] Inspect repository
      ✓ policy
      ✓ evidence

[2] Run diagnostics
      ✓ PowerShell
      ✓ exit 0

[3] Browser reproduction
      ● LIVE

[4] Root cause
      detected

[5] Proposed patch
      2 files

[6] Approval required
      WAITING

[7] Apply patch
      LIVE DESKTOP

[8] Test
      34 PASS

[9] Verification
      PASS

[10] Evidence
      SIGNED
```

ثم في Desktop:

**المستخدم يرى الماوس يتحرك، المتصفح يفتح، Terminal يعمل، الملفات تتغير، ثم يعود Timeline ويثبت النتيجة.**

هنا تظهر قوة النظام فعلًا.

---

# 50. مراحل التنفيذ الصحيحة

## P0 — Contract

قبل أي UI:

```text
NEXA Envelope
Capability schema
Policy schema
Event schema
Evidence schema
Mission state machine
```

## P1 — Real Local Runtime

```text
Execution Authority
PowerShell
Files
Verifier
Evidence
```

## P2 — Live Event Stream

```text
SSE
WebSocket
Durable Object
```

## P3 — Desktop

```text
VNC
websockify
noVNC
cursor overlay
screenshots
```

## P4 — Browser

```text
Playwright
headed Chromium
screenshots
DOM observation
verification
```

## P5 — Cloud Free Control Plane

```text
Pages
Workers
DO
D1
R2
KV
Tunnel
```

## P6 — AI Mesh

```text
Ollama
Gemini
Workers AI
HF
ProviderBroker
```

## P7 — Replay

```text
event reconstruction
state snapshots
timeline
```

## P8 — Self-Improvement

```text
failure miner
patch proposals
test synthesis
sandbox
differential verification
approval
canary
rollback
```

---

# 51. Free Stack — النسخة التي أعتمدها

| الجزء             | التقنية                           |
| ----------------- | --------------------------------- |
| UI                | React + Vite                      |
| Hosting           | Cloudflare Pages                  |
| API               | Cloudflare Workers                |
| Live Session      | Durable Objects                   |
| SQL               | D1                                |
| Cache             | KV                                |
| Artifacts         | R2                                |
| Tunnel            | Cloudflare Tunnel                 |
| Desktop View      | noVNC                             |
| VNC Bridge        | websockify                        |
| Browser           | Playwright                        |
| Browser Agent     | optional Browser Use              |
| Windows execution | PowerShell                        |
| Local AI          | Ollama                            |
| Cloud AI          | Gemini Free Tier                  |
| Secondary AI      | Workers AI                        |
| Model registry    | Hugging Face                      |
| Protocol          | NEXA                              |
| Auth              | NEXA capability + policy          |
| Evidence          | hash-chain + signatures           |
| Self improvement  | proposal → sandbox → verification |

Browser Use نفسه ما زال يوفر مسارًا مفتوح المصدر محليًا عبر Python، لكنه يجب أن يبقى Adapter اختياريًا فوق طبقة التنفيذ وليس مصدر السلطة. ([GitHub][15])

---

# EVIDENCE

المعلومات التي تحققت منها الآن لـ2026 تشمل:

**Cloudflare**

* Workers Free: 100k requests/day. ([Cloudflare Docs][16])
* Workers AI: 10k Neurons/day مجانًا. ([Cloudflare Docs][8])
* KV: 100k read/day، 1k write/day، 1GB. ([Cloudflare Docs][6])
* Durable Objects Free + SQLite/WebSockets ضمن حدود مجانية محددة. ([Cloudflare Docs][4])
* R2 Free: 10GB-month، 1M A، 10M B، وEgress مجاني. ([Cloudflare Docs][5])
* Tunnel يمكنه نشر الخدمات المحلية، والـQuick Tunnel مجاني للاختبار. ([Cloudflare Docs][17])

**Google**

* Gemini 2.5 Flash-Lite لديه Free Tier حاليًا. ([Google AI for Developers][7])
* حدود Gemini تعتمد على RPM/TPM/RPD والموديل والمشروع. ([Google AI for Developers][18])

**Open Source**

* Playwright يدعم Chromium/Firefox/WebKit. ([Playwright][3])
* noVNC يعمل من المتصفح ويدعم VNC عبر WebSockets. ([GitHub][2])
* websockify يعمل كجسر WebSocket↔TCP. ([GitHub][14])
* RustDesk OSS مناسب كطبقة Remote Desktop اختيارية. ([RustDesk][19])

---

# NEXT

**أقوى ترتيب عملي للمشروع الآن هو:**

```text
NEXA Kernel
   ↓
Execution Authority
   ↓
PowerShell + Files
   ↓
Event Stream
   ↓
Live Desktop / noVNC
   ↓
Playwright Browser
   ↓
Evidence + Replay
   ↓
AI Mesh
   ↓
Self-Improvement
```

وأقترح أن يكون **أول Vertical Slice حقيقي** هو:

> **"Mission: افتح المشروع → افتح Terminal → نفّذ تشخيصًا → افتح Browser → نفّذ مهمة → غيّر ملفًا بعد Approval → شغّل Tests → اعرض Desktop حيًا → أنشئ Evidence موقّعًا → اعمل Replay كامل للمهمة."**

هذه الوحدة وحدها، إذا كانت **LIVE + VERIFIED وليست Fixture/Mock**، ستكون أساسًا قويًا جدًا لبقية Celia/AOK/NEXA.

[1]: https://developers.cloudflare.com/workers/platform/pricing/?utm_source=chatgpt.com "Pricing · Cloudflare Workers docs"
[2]: https://github.com/novnc/noVNC?utm_source=chatgpt.com "GitHub - novnc/noVNC: VNC client web application · GitHub"
[3]: https://playwright.dev/docs/intro?utm_source=chatgpt.com "Installation | Playwright"
[4]: https://developers.cloudflare.com/durable-objects/platform/pricing/?utm_source=chatgpt.com "Pricing · Cloudflare Durable Objects docs"
[5]: https://developers.cloudflare.com/r2/pricing/?utm_source=chatgpt.com "Pricing · Cloudflare R2 docs"
[6]: https://developers.cloudflare.com/kv/platform/limits/?utm_source=chatgpt.com "Limits · Cloudflare Workers KV docs"
[7]: https://ai.google.dev/gemini-api/docs/pricing?authuser=451499271&utm_source=chatgpt.com "Gemini Developer API pricing  | Gemini API  | Google AI for Developers"
[8]: https://developers.cloudflare.com/workers-ai/platform/pricing/?utm_source=chatgpt.com "Pricing · Cloudflare Workers AI docs"
[9]: https://developers.cloudflare.com/changelog/post/2026-07-28-models-require-workers-paid/?utm_source=chatgpt.com "Select models now require the Workers Paid plan · Changelog"
[10]: https://huggingface.co/docs/inference-providers/en/pricing?utm_source=chatgpt.com "Pricing and Billing · Hugging Face"
[11]: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/?utm_source=chatgpt.com "Cloudflare Tunnel · Cloudflare One docs"
[12]: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/?utm_source=chatgpt.com "Quick Tunnels · Cloudflare One docs"
[13]: https://www.rustdesk.com/?utm_source=chatgpt.com "RustDesk: Open-Source Remote Desktop with Self-Hosted Server Solutions"
[14]: https://github.com/novnc/websockify?utm_source=chatgpt.com "GitHub - novnc/websockify: Websockify is a WebSocket to TCP proxy/bridge. This allows a browser to connect to any application/server/service. · GitHub"
[15]: https://github.com/browser-use?utm_source=chatgpt.com "Browser Use · GitHub"
[16]: https://developers.cloudflare.com/workers/platform/limits/?utm_source=chatgpt.com "Limits · Cloudflare Workers docs"
[17]: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/?utm_source=chatgpt.com "Published applications · Cloudflare One docs"
[18]: https://ai.google.dev/gemini-api/docs/rate-limits?utm_source=chatgpt.com "Rate limits  | Gemini API  | Google AI for Developers"
[19]: https://rustdesk.com/docs/en/self-host/index.html?utm_source=chatgpt.com "Self-host – RustDesk Documentation"
