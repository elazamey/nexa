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

| Phase | Work | Acceptance |
|---|---|---|
| v13-1 | Approval protocol (pure `packages/policy`) + 8 vectors | vectors green; suite grows from 324; `packages/` still zero fs/net (posture clean) |
| v13-2 | Terminal port + sandbox (real bash) + vectors (path escape, injection, timeout, jail) | `terminal.execute` runs live behind approval; refused without; jail can't escape cwd |
| v13-3 | Mission API + 4-layer state machine + §45 events + replay endpoint | one mission end-to-end; replay reconstructs the same final state; evidence verifies |
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
