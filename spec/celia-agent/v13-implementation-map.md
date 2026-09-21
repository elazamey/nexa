# v1.3 — Implementation Map: Live Agent Desktop → real repo state

> Companion to `v13-live-desktop.md` (architecture reference). Date: 2026-09-21.
> Purpose: map every document section to what this repo **actually provides** (verified by
> inspection, not by assumption), state the real gaps, and order the work the way repo
> culture demands: **security vectors first, deterministic mock first, zero fs/net in
> `packages/`, ports live in `tools/`, no kernel bloat.**

## 1. The document's P0 ("Contract before any UI") is ~70% already built

| Doc § | Requirement | Repo reality (verified) | Verdict |
|---|---|---|---|
| §34 | NEXA Envelope | `packages/protocol/src/envelope.js` — `buildEnvelope`/`verifyEnvelope`, TTL 60–300s, 64KB body cap, signature, nonce | ✅ real, tested |
| — | Replay protection | `packages/protocol/src/replay.js` — `ReplayGuard` (dual fresh keys: id + nonce, bounded window) | ✅ real (note: this is replay-**attack** defense, not mission replay) |
| §46 | typed capabilities | `packages/capability` — `mintCapability`/`attenuate`/`verifyCapability`, caveats (`max_uses`, `exp`), `constraints`, `UsageLedger` | ✅ real, tested |
| §11 | policy engine | `packages/policy/src/gates.js` — per namespace/action gates, 6 CLOSED, resource+action+constraint matching | ✅ core (gap A: no `REQUIRE_APPROVAL` state) |
| §12 | evidence ledger | `packages/evidence/{chain,receipt}` + hash-chained `EventSourcingEngine` + `verifyReceipt` | ✅ real, tested |
| §13 | live event bus | SSE `/api/v1/dag-stream` + `emitDagEvent` — **and time-travel API already exists**: `GET /api/v1/events`, `POST /api/v1/events/replay`, `GET /api/v1/events/state`, `GET /api/v1/events/verify` | ✅ SSE (gap: no WebSocket control channel) |
| §2 | intent → plan | `packages/cells/celia/planner` + `tools/celia-grok-port.mjs` (LLM proposes steps `{kind, capref, args, as}`; sanitizer strips mints + `vault://` egress) | ✅ real |
| — | execution → DAG | omega kernel `executeTask` + adaptive DAG (56 engines) | ✅ real |
| §9 | files, split capabilities | `tools/celia-workspace-port.mjs` — CoW read/create/write/move/commit/rollback, atomic, evidence-bound | ✅ at tool layer (gap: invoked directly, not through the capability-gated envelope) |
| §35/§41 | mission state machine (PLANNED / AUTHORIZED / EXECUTED / VERIFIED) | DAG kernel has node states; **no mission-level machine with the 4-layers rule** | ❌ missing |
| §14–15 | Cloudflare control plane (DO / D1 / R2 / KV) | deployment is Render; NEXA state is already local-first (in-memory hash chain + CoW files under gitignored `.nexa/`) | ⏸ optional future layer — **not a blocker**; local-first is the repo's existing posture |

**Conclusion:** the governance contract the document demands as P0 exists and is tested
(324/324). The document's own ordering puts "P1 — Real Local Runtime" next — that is where
the actual new work starts.

## 2. The real gaps (ordered by what the vertical slice needs)

### A. Approval protocol — THE heart (doc §10, §11, §33, §46)

Today: gates are CLOSED and there is **no API to open one** (deliberate, v12 §2.2).
The document's `REQUIRE_APPROVAL` policy state does not exist in `packages/policy`.

Build (pure module, same package family, zero deps — proposed: `packages/policy/src/approval.js`):

- New policy decision state: **`REQUIRE_APPROVAL`** alongside ALLOW / DENY — a policy rule
  can require approval for a specific (action, target pattern) pair.
- Approval state machine:
  `REQUESTED → APPROVED_ONCE | APPROVED_MISSION | DENIED | EXPIRED`
  - `APPROVED_ONCE` = consumed exactly once (ledger), `APPROVED_MISSION` = scoped to one mission id.
- **The approval itself is an evidence event** (hash-chained, signed) — doc §10:
  "الموافقة نفسها Event موثّق".
- §33 encoded as law: an approval can **never ungate the policy root** (root policy, gates,
  keys, verifier, rollback). It only authorizes one gated action on one target class, once.
- Approver identity is bound (trusted operator key) — an untrusted approver is refused.

**Vectors first (repo culture) — `tests/approval-security.test.js`:**
1. once-approval consumed exactly once → second use `NEXA_E_APPROVAL_USED`
2. approval for target A cannot execute target B → `NEXA_E_APPROVAL_TARGET`
3. expired approval → `NEXA_E_APPROVAL_EXPIRED`
4. approval cannot open a gate or mutate policy → `NEXA_E_POLICY_IMMUTABLE` (root untouched)
5. `publish` (AUTO_DEPLOY) is NOT unlockable through the approval center — still requires a
   deliberate human-governed gate decision (v12 creative phase 6 stays out of scope)
6. approval events are verifiable: chain tamper → `verifyReceipt`/chain verify fails
7. untrusted approver → `NEXA_E_UNTRUSTED`
8. approve-mission approval cannot escape the mission scope (id bound in caveat)

### B. Terminal execution port (doc §8) — first real execution NEXA ever runs

`tools/celia-terminal-port.mjs`:

- **real** command execution with sandbox: allowed-cwd jail, timeout,
  `stdout`/`stderr`/`exitCode` capture, output hashes, duration, filesystem diff vs CoW.
- shell is a **swappable adapter** (Free-First mesh, doc §20): `bash` in this deployment,
  `powershell` on the Windows host — same interface, zero protocol change.
- capability `terminal.execute` lives in gated namespace `REAL_EXECUTION` (already exists in
  `GATED_ACTIONS`: exec/spawn/shell) → flows through the approval protocol from gap A.

### C. Mission API + state machine (doc §35, §41, §44)

- `POST /api/v1/missions { intent }` → planner → plan (capref steps) → per-step pipeline:
  capability → policy → [approval if REQUIRE_APPROVAL] → execution → observation → evidence → event.
- Mission machine with the **4 independent layers** (§41): PLANNED / AUTHORIZED / EXECUTED /
  VERIFIED + terminal states FAILED / DENIED / TIMEOUT / CANCELLED / QUARANTINED (§35).
  No "probably completed".
- Event names per doc §45 (`mission.created`, `capability.requested`, `policy.checked`,
  `authorization.approved`, `terminal.stdout`, `evidence.signed`, …) on the existing SSE bus.
- `GET /api/v1/missions/:id/replay` = ordered events + state snapshots (reconstruct, never
  record video — §26/§16).

### D. Dashboard (doc §36 — 7 modes)

Already present: live canvas (`AgentCanvasEmulator`, event-driven), workspace commit view,
planner thinking, evidence chain (small), live logs.
Missing: **Approval Center** (the critical piece — the human seat in the loop), mission
timeline view with per-event drawer (§25), LIVE/DEMO badge (§40), cost meter (§37).

### E. Provider broker + cost policy (doc §20, §37, §38)

- Lightweight `tools/celia-provider-port.mjs` with provider status
  `{FREE_FOREVER, FREE_QUOTA, TRIAL, PAID, BLOCKED}`.
- Router rules: local first → free quota → **DENY if predicted cost > 0** (§38: `MAX_COST = 0`).
  No automatic escalation to paid, ever.
- Cost meter endpoint + dashboard line (today: only demo logs mention cost).

### F. Browser (doc §6–7) — the heavy optional piece

- Playwright headless (works in this sandbox, ~300MB install): navigate/click/type +
  observation bundle (URL, title, screenshot, DOM digest) + verifier (§7).
- Capabilities `browser.navigate` / `browser.click` / `browser.type` — gated → approval flow.
- Browser Use stays an **optional planner layer above the adapter**, never the authority (§6).
- Recommended as slice phase 2 — after terminal + approval are live — to keep the first
  slice slim and fully verified.

### G. Windows local plane (doc §3, §21–23, §47, §48) — user's machine, not this sandbox

- noVNC + websockify, PowerShell adapter, Ollama, cloudflared quick tunnel.
- What this repo delivers now: the **`DesktopAdapter` interface + event contract** (doc §23)
  as a documented schema, so the Windows host implements adapters without any protocol change.
- Layering rule (doc §48, adopted): **NEXA decides / executes / proves; noVNC-RustDesk is
  only how we see/reach** — remote access is an optional layer, never execution authority.

## 3. Environment reality (this sandbox vs user's machine)

| Piece | This sandbox (Linux) | User's machine (Windows) |
|---|---|---|
| Terminal | **real bash** ✅ | PowerShell (same adapter interface) |
| Files | real CoW ✅ | real CoW |
| Browser | headless Playwright ✅ (installable) | headed Playwright (visible) |
| Desktop stream | ❌ no VNC — the canvas is the live window (labeled DEMO) | ✅ noVNC real |
| Local AI | ❌ no Ollama — deterministic mock planner/provider | ✅ Ollama |
| Tunnel / cloud plane | ❌ (Render + live preview) | ✅ cloudflared quick tunnel |

**Honesty rule (doc §40):** everything shipped here is LIVE + VERIFIED (real bash, real
files, real test runs, real evidence). The only simulated layer is the desktop *video* —
the canvas already carries its DEMO label.

## 4. Phases (repo culture: vectors first in every phase)

| Phase | Work | Acceptance | Status |
|---|---|---|---|
| v13-1 | Approval protocol (pure `packages/policy`) + 8 vectors | vectors green; suite grows from 324; `packages/` still zero fs/net (posture clean) | ✅ 9/9 green (V0+V1..V8); 333/333; endpoints live + curl round-trip verified |
| v13-2 | Terminal port + sandbox (real execution) + vectors (path escape, injection, timeout, jail) | `terminal.execute` runs live behind approval; refused without; jail can't escape cwd | ✅ 9/9 green; live curl round-trip: os-mode kernel jail (unshare+busybox chroot), fs-diff, SSE `TERMINAL_EXECUTED/TIMED_OUT`, terminal box in dashboard |
| v13-3 | Mission API + 4-layer state machine + §45 events + replay endpoint | one mission end-to-end; replay reconstructs the same final state; evidence verifies | ✅ 8/8 green (V0..V7); live round-trip: create → run → WAITING_APPROVAL → approve → auto-resume → COMPLETED → replay VALID; mission panel in dashboard |
| v13-4 | Dashboard: Approval Center + mission timeline + evidence drawer + LIVE/DEMO badge + cost meter | a human approves on screen; every step visible in the timeline with evidence |
| v13-5 | Browser port (headless Playwright) + observation + verifier | browser steps stream live to canvas + timeline; screenshots attached as evidence |
| v13-6 | Provider broker + `MAX_COST = 0` policy + meter | paid providers denied by default; meter shows $0.00 total |
| v13-7 | DesktopAdapter interface + event contract (doc) for the Windows host | schema + doc reviewed; implementation on the machine is a separate deliverable |
| AdForge | creative phase 3 (planner wiring) folds into the mission demo | "اعمل لي حملة…" becomes a real mission step, budget 4, mock provider |

## 5. First vertical slice (adapted from doc NEXT — runnable live in this sandbox)

```text
Mission: "فحص المشروع وتشخيصه"
  1. terminal: diagnose (real bash)                        → event + exit 0 + stdout hash
  2. terminal: npm test (real)                             → 324+ passed
  3. file write: CoW patch                                 → REQUIRE_APPROVAL → human approves on screen
  4. creative: generate campaign (budget 4, mock)          → CREATIVE_GENERATED (v12 port)
  5. verify: re-run tests against the patch                → VERIFIED layer
  6. evidence: hash chain complete, signed                 → /events/verify green
  7. replay: reconstruct mission from events               → identical final state
  8. live: every step streams on dashboard timeline + canvas
```

Acceptance: every step = an event; the file write without approval is refused (vector);
replay is deterministic; all security vectors green; UI shows only
**Intent / Plan / Next Action / Result / Evidence** — never chain-of-thought.

## 6. Implementation record (v13-1, 2026-09-21)

**Files:** `packages/policy/src/approval.js` (pure `ApprovalLedger` + `isApprovalEligible`),
`packages/ast/src/errors.js` (8 new codes: `NEXA_E_POLICY_IMMUTABLE`,
`NEXA_E_APPROVAL_{MISSING,STATE,USED,TARGET,SCOPE,EXPIRED,TAMPERED}`),
`tests/approval-security.test.js` (V0 + V1..V8, written red before the module existed),
`tools/celia-dashboard-server.mjs` (`/api/v1/authorizations/{stats,eligibility,request,
:id/approve|deny|consume}` + `AUTHORIZATION_{REQUESTED,APPROVED,DENIED,CONSUMED}` on the
DAG stream), `dashboard/src/components/NexaDashboard.jsx` (authorization log lines).

**Verified behavior (curl, live server):** fs-write request → approve(once) → consume →
second consume `400 NEXA_E_APPROVAL_USED`; `rm -rf /` against an `ls -R` grant →
`NEXA_E_APPROVAL_TARGET`; `tool:creative.publish/publish` request →
`NEXA_E_POLICY_IMMUTABLE` (AUTO_DEPLOY is root-governed, matching the v12 ruling);
stats expose the verified chain head.

**Lessons encoded:**
- Error codes are a **closed registry** (`packages/ast/src/errors.js`) — `NexaError`
  throws on any unregistered code; new protocols must register there first.
- The time API is **ISO-string based** (`parseInstant` → ms, `addSeconds` → string);
  injected clocks return `Date` and are converted at the boundary via `formatInstant`.
- This Node build rejects implicitly-declared private fields — declare class fields
  explicitly (matches the existing `#handlers`/`#seenIds` convention).
- A consumed approval is a **terminal state** and beats expiry (`USED` before `EXPIRED`).
- Truncation incident (this turn): the working-tree dashboard server lost ~435 tail lines
  (partial-write artifact across the turn boundary). Restored from `HEAD` (which held the
  complete file) and re-applied the v13-1 hunks; the running process still had the full
  code in memory, which is how the regression was caught before a restart.

## 7. Implementation record (v13-2, 2026-09-21)

**Files:** `tools/celia-terminal-port.mjs` (the port), `tests/terminal-security.test.js`
(T0..T8, test-first — first test file that performs real, hermetic process execution),
`packages/ast/src/errors.js` (`NEXA_E_TERMINAL_JAIL`, `NEXA_E_TERMINAL_UNALLOWED`),
`tools/celia-dashboard-server.mjs` (`POST /api/v1/terminal/execute` + `TERMINAL_EXECUTED` /
`TERMINAL_TIMED_OUT` on the DAG stream, jail under gitignored `.nexa/terminal`),
`dashboard/src/components/NexaDashboard.jsx` (live terminal box in the System Stdout card:
command, exit/TIMEOUT, stdout/stderr tails, fs-diff summary).

**The port (two sandbox modes, one contract):**
- `os` (auto-detected: userns works + busybox present — true here):
  `unshare -U -r -m` + `busybox chroot` with the jail root as the only filesystem. The
  wrapper is a **constant** script; user input enters only as positional parameters, so
  there is no injection surface into the wrapper itself. Escape attempts ENOENT at the
  kernel, not merely "refused by policy".
- `policy` (hosts without userns/busybox): no-shell direct spawn + allowlist + argument
  validation + cwd pinning + minimal env.
- Both modes: bare-name allowlist (default = busybox applets; +node/npm in policy mode),
  relative paths only (`..` and `/…` → `NEXA_E_TERMINAL_JAIL`), no control characters,
  minimal env (PATH/HOME/LANG — secrets never cross), process-group kill on timeout
  (`detached` spawn, `kill(-PGID, SIGKILL)`), output caps, per-run `evidenceRef`,
  stdout/stderr sha256, and a hash-committed filesystem diff of the jail.
- `expectedTarget` (the approval token) must equal the canonical command — the executed
  command is the approved command, byte for byte (ledger AND port enforce it).

**Verified behavior (curl, live server, os mode):** request → approve → execute:
`ls work` exit 0 in 7ms; write produces `diff.added ['work/live.txt']` with committed
digest + evidenceRef; missing approval → 400 `NEXA_E_APPROVAL_MISSING`; approve `ls work`
then execute `ls -R` → 400 `NEXA_E_APPROVAL_TARGET`; human approving a literal
`cat /etc/passwd` escape is still refused by the port with `NEXA_E_TERMINAL_JAIL`
(defense in depth); `bash` → `NEXA_E_TERMINAL_UNALLOWED`; `TERMINAL_EXECUTED` observed
on the SSE stream with the exact target.

**Lessons encoded:**
- dash `sh -c`: `shift` does NOT touch `$0` — it drops `$1`. Capture the program before
  the single shift (cost one full debug cycle; the wrapper comment now documents it).
- busybox has no `exec` applet; `busybox chroot DIR /busybox APPLET ARGS` is the form.
- A mount point must exist: `touch $JAIL/busybox` before the file bind mount.
- Port option is `timeoutMs` (matches the doc's `timeout_ms`); a silent name mismatch
  once let a 30s default mask a 400ms kill.
- The terminal port is **async** (real processes); it runs in the server/mission layer,
  never in a sync envelope handler.

## 8. Implementation record (v13-3, 2026-09-21)

Mission API + event-sourced replay: for the first time the three governed
components (Approval Ledger + Terminal Port + Creative Assets) run in concert
under one directed, cryptographically-sealed, replay-computed mission.

**Vectors first (repo culture) — `tests/mission-security.test.js` (8/8):**
V0 mixed protected/unprotected round-trip to VERIFIED + replay reproduces
identical state and head; V1 layer order (no skip, double, or out-of-order
authorize); V2 approval binding (protected needs exactly one id, swaps and
strays refused); V3 completion gate (VERIFIED only at all-verified; FAILED /
DENIED / VERIFIED all terminal); V4 field tamper → `NEXA_E_MISSION_TAMPERED`;
V5 deletion/truncation (prev break; short chain vs persisted head; honest
prefix restores); V6 determinism (same inputs + frozen clock → identical
chains; pure reducer equals live state); V7 unknown steps (`MISSING`),
malformed plans (`SCHEMA`), forged first events (`TAMPERED`).

**The module — `packages/protocol/src/mission.js` (pure, zero fs/net):**
- state is never mutated — `reduceMissionEvents(events)` derives it
  deterministically; the `MissionLog` class only validates-then-appends;
- per-step layers `PLANNED → AUTHORIZED → EXECUTED → VERIFIED` + mission
  terminal states `FAILED / DENIED / CANCELLED` (doc §35/§41);
- sequential frontier: step N cannot authorize while step N-1 is unverified;
- hash-chained log (same construction as evidence/approval chains);
  `MISSION_COMPLETED` carries `verificationHash`, which IS the chain head
  (checked by the reducer, never asserted);
- `verifyChain()`, `replay()`, `importEvents(events, {head})` restore path.
- 3 new codes in the central taxonomy (`NEXA_E_MISSION_MISSING/STATE/TAMPERED`).

**The engine — `tools/celia-dashboard-server.mjs`:**
- `POST /api/v1/missions/create {name, plan}` → plan of `terminal`
  (always protected) + `creative` (always auto) steps, validated eagerly;
- `POST /api/v1/missions/:id/run` → runs/resumes: auto steps execute,
  protected steps open an approval and stop at `WAITING_APPROVAL` with
  `AUTHORIZATION_REQUIRED` on SSE (expired pendings are re-requested);
- `POST /api/v1/authorizations/:id/approve|deny` → auto-resume: authorize +
  continue, or `MISSION_DENIED` (terminal). `consume` failures fail the step
  honestly (`MISSION_FAILED`) — no retry loops, no silent skips;
- `GET /api/v1/missions/:id` (status + progress + pending) and
  `GET /api/v1/missions/:id/replay` (200 with `integrity: VALID|TAMPERED`,
  head, length, state, ordered events) + `GET /api/v1/missions` (list);
- terminal results reuse `TERMINAL_EXECUTED/TIMED_OUT` (dashboard box shows
  mission runs); non-zero exit / timeout → `STEP_FAILED` with the exit code;
- mission SSE vocabulary: `MISSION_CREATED / STEP_AUTHORIZED / STEP_EXECUTED /
  STEP_VERIFIED / COMPLETED / FAILED / DENIED` + `AUTHORIZATION_REQUIRED`.

**Dashboard — `dashboard/src/components/NexaDashboard.jsx`:** mission panel
with status chip, progress bar, per-step layer chips + targets, pending
approval box (approve-once / deny — a minimal precursor to the v13-4
Approval Center, just enough to complete the round-trip on screen), replay
button with integrity + head, and a one-click mission demo
(creative → terminal → creative). `vite build` clean (363.02 KB / 100.44 KB gzip).

**Verified behavior (curl, live server):** create → run → `WAITING_APPROVAL`
(1/3 verified, pending approvalId) → approve → auto-resume (no second call) →
`COMPLETED`, `VERIFIED`, 3/3 → replay `VALID`, 11 ordered events, head ==
verificationHash; deny → `DENIED` (idempotent re-run); unknown id → 404
`NEXA_E_MISSION_MISSING`; bad plans → 400 `NEXA_E_SCHEMA`; exit-1 step →
`FAILED` with a `VALID` replay of the honest trail.

**Lessons encoded:**
- completion seal: `verificationHash` cannot be hashed *into* the record that
  carries it (self-reference) — it is *defined as* the record's own hash and
  the reducer checks `seal === hash`, so the head commits to everything;
- `EXECUTED` is transient inside the engine (execute+verify pair atomically);
  a persisted `EXECUTED` step means an external writer — there is none, so the
  engine fails loud instead of guessing a verification digest (never fabricate
  evidence);
- deep-copy event logs with nested payloads (`structuredClone`): the mission
  genesis carries a plan array, so a shallow `events()` copy would let a
  reader mutate the log's own history (the flat approval records were immune);
- tooling: parallel same-file edits race (last write wins) — one edit per
  file per step; multi-anchor file surgery goes through a single atomic
  script with count assertions (this record exists because a port splice
  silently dropped two blocks and the smoke test caught it).

## 9. Implementation record (v13-4, 2026-09-21)

Unified Governance & Observability Suite: every governed action in the
system now lands in one Approval Center, one sequential event timeline, and
one per-mission usage meter — surfaced in the dashboard with LIVE/DEMO
honesty badges bound to real runtime state (doc §1 "window onto the
executing mind").

**Vectors first (repo culture) — `tests/governance-security.test.js` (8/8):**
U0 aggregation (runs/bytes/ms/tokens≈bytes/4/cost 0 across missions and
kinds); U1 failed runs counted (`failed`, `ok:false` entries); U2 unknown
mission summarizes to zeros (observational reads never throw); U3 eight
malformed records → `NEXA_E_SCHEMA` (empty missionId, negative stepIndex,
bad kind, fractional/negative/huge counters, non-boolean ok); U4
determinism (frozen clock → identical entries/summaries); A0 `requests()`
view (scope/decision/gate/expired per row, defensive copies); A1
consume+expiry lifecycle through the view; A2 `stats()` regression
(requested/approved/denied/consumed/pending intact).

**The modules (pure, zero fs/net):**
- `packages/protocol/src/usage.js` — `UsageMeter`: strict-boundary writes
  (`record({missionId, stepIndex, kind, inputBytes, outputBytes, durationMs,
  ok})`, all counters safe-int validated), forgiving reads (`summary()`,
  `summaryAll()`, `entries()`); tokens are `ceil(bytes/4)` labeled as a
  heuristic, cost is `0` micros with the local-first note;
- `packages/policy/src/approval.js` gains `requests()` — the Approval
  Center view over live ledger state (scope is `null` until the human
  decides `once`|`mission`; `expired` computed against the injected clock).

**The server splice — `tools/celia-dashboard-server.mjs`:**
- `usageMeter` records every mission step: terminal input = real command-line
  bytes, output = real stdout+stderr bytes, duration = real wall ms; creative
  input/output = real JSON payload bytes; failures record with `ok:false`
  (fail is data, not absence);
- `missionStatus` carries `usage`; new routes `GET /api/v1/authorizations`
  (rows + chain verification), `GET /api/v1/timeline?since&limit&type`
  (prefix filter, incremental cursor), `GET /api/v1/system/status` (honesty
  table + global usage + chain heads + all mission statuses);
- timeline ring (200 max, 4000-char buffer caps with `*Truncated` flags)
  hooked into `emitDagEvent`, so the timeline IS the SSE stream's memory —
  no second source of truth.

**Dashboard — `dashboard/src/components/NexaDashboard.jsx`:** Approval
Center (all requests with scope chips + per-row approve-once / approve-mission
/ deny), unified Event Timeline (live incremental feed with prefix filter,
click any event), Evidence Drawer (full payload, hashes, buffers, mission
replay link), LIVE/DEMO badges in the header (terminal/missions/approvals/
evidence LIVE, creative/desktop DEMO), and a real usage line on every
mission (runs, in/out bytes, ms, tokens heuristic, $0.00). `vite build`
clean (372.33 KB / 102.16 KB gzip).

**Verified behavior (curl, live server):** fresh status shows 6 honesty rows
+ zero usage; create → run → `WAITING_APPROVAL` → Approval Center shows 1
REQUESTED row (chain len 1) → approve scope=mission → auto-resume →
`VERIFIED` 2/2 → usage `terminal {in 21, out 17, 8ms}` (= `echo
hello-governance` command/stdout bytes exactly) + `creative {in 71, out
714}` → timeline 14 ordered events create→complete with the real stdout in
`TERMINAL_EXECUTED` → chain len 3, decision `APPROVED_MISSION`.

**Lessons encoded:**
- session summaries paraphrase APIs — the file is truth: the splice first
  called `forMission`/`stats`/`{bytes}`, all of which never existed; the
  real API is `summary(missionId)` / `record({inputBytes, outputBytes,
  stepIndex, ...})`. Read the module before splicing its callers;
- `scope: null` on REQUESTED rows is correct, not a bug — scope is a
  property of the human's decision (`once`|`mission`), set at approve time;
- approval route shape is v13-1 (`POST /api/v1/authorizations/:id/approve`,
  auto-resume via `maybeResumeMissions`) — there is no
  `/api/v1/missions/:id/approve`; grep the router, don't trust the record;
- missing-method errors surface as runtime `NEXA_E_INTERNAL` on first hit,
  invisible to `node --check` and the unit suite — the live smoke loop is
  the gate that catches them.
