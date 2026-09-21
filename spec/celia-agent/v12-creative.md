# Celia v12 — Creative Generation Capability (`creative.generate`)

> Integration plan for **AdForge AI** as a governed creative capability inside NEXA/Celia.
> Status: **§9 DECIDED (2026-09-21) — Phases 0–2 COMPLETE.** 10/10 security vectors green,
> 324/324 tests, curl round-trip verified (see §10). Phases 3–4 next (planner/DAG, dashboard panel).
> Plan references point at the real repo state (branch `main` @ `04b80fa`, as inspected 2026-09-21).

## 1. Positioning (agreed architecture)

```
NEXA     = Governance / Protocol / Policy / Evidence   (never trusts AdForge directly)
Celia    = Agent / Orchestration (planner → executor → DAG)
AdForge  = Creative Capability (a port + provider broker, NOT the governor)
AI Mesh  = Model Layer (Gemini / OpenRouter / HF / Cloudflare / local — swappable)
```

`creative.generate` enters the system as a **capability-gated call** on the exact same
pipeline every other tool already uses — no new trust relationship, no new gates, no
weakening of the 6 CLOSED gates.

## 2. Current-state findings (where the seam is)

| Layer | Real location | What it gives us |
|---|---|---|
| Capability mint/verify | `packages/capability/index.js` (`mintCapability`, `attenuate`, `verifyCapability`, `RevocationSet`) | Tokens with caveats + constraints (budget, ttl, max_calls, scope) |
| Gates & policy | `packages/policy/src/gates.js` | 6 gates CLOSED, **no API to open one**. Gated namespaces: `exec/shell/process/terminal/tty/fs/file/vcs/git/push/remote/deploy/release/infra`. Gated actions incl. **`publish` → AUTO_DEPLOY** |
| Planner (AI ≠ Authority) | `packages/cells/celia/planner/src/grok.js` | LLM proposes steps `{kind, capref, args, as}`; sanitizer already strips `mintCapability`/`mint` steps and secret egress (`vault://`, API key names) |
| Planner step shape | dashboard `thinking.steps` | `{kind:'do', capref:'github.repository.read', args:{...}, as:'repo'}` — **`capref` is the entry point** |
| MCP bridge (first-class) | `adapters/mcp/src/bridge.js` + `spec/omega/mcp.md` | JSON-RPC ↔ NEXA envelopes; `tools/list` advertises exactly the declared (`expose`), ungated, registered tools — the declared set is the policy surface; name map `tool:echo → nexa_tool_echo`; denials carry NEXA error code + signed receipt |
| Ports pattern (the convention) | `tools/celia-*-port.mjs` (vector, workspace, ast, dsl, grok, memory) | `packages/` never touch fs/net; tools inject ports; secrets behind `vault://` handles |
| SSE event bus | `packages/cells/celia/api/server.js` (`emitDagEvent`, `updateNodeState`) → `tools/celia-dashboard-server.mjs` (`/api/v1/dag-stream`) | Any new event type reaches the live dashboard with zero frontend protocol changes |
| Evidence | `packages/evidence/` + `EventSourcingEngine` (hash-chained) + governed memory | `CREATIVE_GENERATED` records + artifact digests, audit-trail ready |
| Artifact staging | `tools/celia-workspace-port.mjs` (CoW, atomic commit/rollback) | Creative artifacts can be staged + committed through the **existing** workspace, visualized on the live desktop |
| Kernel delegation | `packages/cells/celia/omega/src/celia-omega-kernel.js` (`executeTask`) | Dashboard `POST /api/v1/omega/execute {id, userPrompt}` can route creative intents |
| Namespace rule | `resourceNamespace()` in gates.js | Prefix match on `ns:rest`. **`tool:` and `mcp:` are NOT gated** — free to use. A `creative:` namespace would also pass gates (not in `GATED_RESOURCES`) but adds no policy benefit over `tool:` |

### Conclusions

1. **The entry point is the planner's `capref`.** A plan step
   `{kind:'do', capref:'tool:creative.generate', args:{...}, as:'creative'}` is all the
   planner side needs — the existing sanitizer already validates it (it's not a mint,
   carries no secrets).
2. **Publishing is already blocked by design.** `publish` is in `GATED_ACTIONS`
   (AUTO_DEPLOY, CLOSED, no API to open). AdForge can *generate*; it can never *publish*
   through NEXA without a future, deliberately-built human-approval channel. The
   "no auto-publish without explicit authorization" requirement is satisfied **for free**
   by the existing gate posture — this is a verification target, not a feature.
3. **Two viable capability spellings** (pick one in Phase 0):
   - `tool:creative.generate` — in-process AdForge (recommended first; same family as
     `tool:echo`, `tool:supabase`). MCP bridge maps it to `nexa_tool_creative_generate`.
   - `mcp:creative.generate` — AdForge as an external MCP tool server (Phase 4; the
     bridge + spec already exist, nothing new to build on the protocol side).

## 3. Capability & policy definition

```
CAPABILITY (minted by the operator authority, never by the LLM):
  resource:  tool:creative.generate
  action:    call
  caveats:
    subject:         agent:celia
    scope:           { channels: [meta, instagram, tiktok, google] }
    max_calls:       4            // = max variants budget per mint
    ttl:             15m
  constraints:
    requires_evidence: true

GRANT (policy doc / .nexa module when using the compiler path):
  grant tool:creative.generate {
    subject celia
    scope "channels=meta,instagram,tiktok,google"
    ttl 15m
    max_calls 4
  }
```

Planner step it will drive:

```json
{
  "kind": "do",
  "capref": "tool:creative.generate",
  "args": {
    "brand": "أبو رُفيدة",
    "product": "عسل سدر",
    "audience": "أمهات، 25-45",
    "offer": "خصم 20% لأول طلب",
    "channel": "instagram",
    "tone": "دافئ، عائلي",
    "variants": 4
  },
  "as": "creative"
}
```

## 4. Data flow (end-to-end, all real seams)

```
User intent (Celia console / dashboard)
   ↓
Grok planner (tools/celia-grok-port + packages/cells/celia/planner/src/grok.js)
   ↓  step with capref tool:creative.generate (sanitized: no mint, no secrets)
Capability check (packages/capability) — token verified, budget/scope enforced
   ↓
Execution (dashboard server, tools/celia-dashboard-server.mjs)
   ↓
tools/celia-creative-port.mjs            ← NEW (ports convention)
   ├─ provider broker: mock | openrouter | gemini | local (vault:// key handles)
   └─ deterministic mock provider for tests (same pattern as mock pgvector adapter)
   ↓
Evidence: CREATIVE_GENERATED { creativeId, provider, model, channel, variants,
                               artifactDigests[], evidenceRef }  → hash-chained ledger
   ↓
emitDagEvent('CREATIVE_GENERATED', …) → /api/v1/dag-stream (SSE)
   ↓
Dashboard: CreativePanel (stats + variants + evidence) + artifacts staged into the
           transactional workspace (existing CoW) → visible on the Live Agent Desktop
```

Artifact rule (inherited): **digests in memory/evidence, full content only in the
CoW workspace** — consistent with the digest-only memory principle.

## 5. API surface (mirrors existing endpoint style)

```
GET  /api/v1/creative/stats                     — engine + budget + last run
POST /api/v1/creative/generate                  — { brand, product, audience, offer,
                                                   channel, tone, variants }
POST /api/v1/creative/variants                  — { creativeId, count } (budget-capped)
GET  /api/v1/creative/:id                       — artifact digests + evidence
POST /api/v1/creative/approve                   — human review state (no publish)
```

SSE events added: `CREATIVE_GENERATED`, `CREATIVE_BUDGET_EXCEEDED`, `CREATIVE_APPROVED`.

## 6. Security vectors (repo culture: tests/attacks first)

Must be added to `tests/` / `tools/vectors*.mjs` **before** the port ships:

| # | Attack | Expected outcome |
|---|---|---|
| # | Attack | Expected outcome — **VERIFIED in `tests/creative-security.test.js`** |
|---|---|---|
| V1 | LLM planner emits a step trying to mint `tool:creative.generate` (or `creative:publish`) | sanitized away (existing filter) — mint step dropped, args scrubbed, `creative:publish` capref rewritten to gated `tool:creative.publish` |
| V2 | `tools/call` for creative without a capability token | top-level `NEXA_E_POLICY` (default-deny; `NEXA_E_CAP_MISSING` = INFO evidence detail on the receipt), `verifyReceipt(data.receipt) === true` |
| V3 | 5th variant call after budget 4 | envelope path: `NEXA_E_CAP_USES` (ledger spends only after handler success); port path: `NEXA_E_BUDGET_EXCEEDED`; both enforced, denials never consume budget |
| V4 | `channel: "whatsapp"` (outside scope) / channel outside capability `constraints.channels` | unknown enum → `NEXA_E_SCHEMA`; out-of-scope channel → `NEXA_E_CAP_SCOPE` |
| V5 | Any path to publish an ad (`action: publish`, attenuate-to-add-publish, port surface) | `checkGates` → AUTO_DEPLOY refuse (no API to open); `attenuate` adding `publish` → `NEXA_E_CAP_AMPLIFY` (can only narrow); port exposes no publish |
| V6 | `product` field containing prompt-injection text (incl. faked tool-call instructions) | treated as data only; output deterministic per input; zero side effects |
| V7 | Planner context carries provider key names / `vault://` handles | sanitizer strips them; port independently rejects `vault://` values with `NEXA_E_SECRET_EGRESS` (defense in depth — no egress capability exists) |
| V8 | MCP `tools/list` must not advertise creative beyond declared surface | advertised set === declared-and-ungated-and-registered; undeclared name → `METHOD_NOT_FOUND`; gated name → `NEXA_E_GATE` (receipt shows `gated` decision) |

Plus **V0** (success path): a budgeted creative call flows through the full pipeline
(policy allow → capability verify → handler → evidence + receipt) and returns the creative.

## 7. Provider broker (Free-First AI Mesh)

```
createCreativeProviderPort({ kind: 'mock' | 'openrouter' | 'gemini' | 'local', vault })
  - mock:     deterministic copy/variants (seeded), no network — used by tests & demo
  - others:   HTTP via injected fetch port, key ONLY as vault:// handle (celia-demo.mjs pattern)
```

Swapping providers never touches capability/policy/evidence — only the port factory.

## 8. Phases & acceptance criteria

| Phase | Work | Acceptance | Status |
|---|---|---|---|
| **0 — Decide** | namespace, in-process first, provider list, code home | sign-off on this doc | ✅ DECIDED (2026-09-21, §9) |
| **1 — Vectors** | security vectors as tests (test-first, before port code) | all green, baseline holds | ✅ 10/10 green — `tests/creative-security.test.js`; full suite 324/324 |
| **2 — Port + evidence** | `tools/celia-creative-port.mjs` (deterministic mock provider), `CREATIVE_GENERATED`/`CREATIVE_APPROVED`/`CREATIVE_BUDGET_EXCEEDED` SSE events, API endpoints §5 | curl round-trip: generate → evidence ref → SSE event observed | ✅ curl round-trip verified (Arabic variants, per-campaign budget 4 with 5th→400, approve, stats) |
| **3 — Planner + DAG** | grok port prompt extension (propose creative steps), creative node in adaptive DAG, kernel routing from `omega/execute` | "اعمل لي حملة…" intent produces a plan containing the capref, execution streams live | ⏳ next |
| **4 — Dashboard** | `CreativePanel.jsx` + canvas artifact view; artifacts committed via existing CoW workspace | variants visible on live desktop with digests + evidence | ⏳ |
| **5 — MCP mode** | AdForge as external MCP server; `mcp creative { tools generate, variants, list }` declaration; grant + bridge exposure | `tools/list` advertises only policy-allowed creative tools; denial receipts verifiable | ⏳ |
| **6 — Human publish gate (future, separate design)** | explicit approval capability + out-of-band human action; still behind AUTO_DEPLOY until a gate decision is made **deliberately** | out of scope for this PR | ⏳ |

## 9. Decisions (rendered by owner, 2026-09-21 — binding)

1. **Namespace**: `tool:creative.generate` **in-process for phases 1–4**; `mcp:creative.*` reserved for phase 5 only.
2. **Code home**: lightweight port `tools/celia-creative-port.mjs` matching the existing port pattern — **no new cell, no kernel bloat**.
3. **Budget**: `max_calls 4` (implemented as caveat `max_uses: 4` — the real caveat name in `packages/capability`) + **ttl 15m** (`caveats.exp`).
4. **Channel enum**: `['meta', 'instagram', 'tiktok', 'google']` — exact spelling, enforced as capability `constraints.channels`.
5. **Provider day-one**: **deterministic mock** (hash-seeded, mock-pgvector precedent); real providers later behind `vault://` key handles.

## 10. Implementation record (phases 1–2, 2026-09-21)

**Files:** `tools/celia-creative-port.mjs` (port), `tests/creative-security.test.js` (10 vectors),
`tools/celia-dashboard-server.mjs` (`/api/v1/creative/*` + SSE events),
`dashboard/src/components/NexaDashboard.jsx` (creative event log lines).

**Verified behavior (curl, live dashboard server):**
- `POST /api/v1/creative/generate` → Arabic variants (brand/product/audience/offer/tone),
  `creativeId`, `evidenceRef`, artifact digests; SSE `CREATIVE_GENERATED` observed.
- Budget per campaign: 4 generations OK, 5th → `400 NEXA_E_BUDGET_EXCEEDED`.
- `channel: whatsapp` → `400 NEXA_E_SCHEMA`; `approve` records review (publish not implemented — AUTO_DEPLOY CLOSED).

**Lessons encoded (why the vectors assert the codes they do):**
- Endpoint handlers are **synchronous** in the protocol core — a `Promise` result is not
  canonicalizable (`NEXA_E_C14N_TYPE`). The port's `generate` is therefore sync; async real
  providers attach through the dashboard API path, not the envelope handler.
- Missing-capability denial is top-level `NEXA_E_POLICY` (default-deny); `NEXA_E_CAP_MISSING`
  only appears as the INFO detail inside the receipt.
- Budget exhaustion is `NEXA_E_CAP_USES` on the envelope path (ledger), `NEXA_E_BUDGET_EXCEEDED`
  on the direct port path — one counter concept, two enforcement layers, both tested.
- Attenuation can only **narrow**: adding `publish` to a creative grant → `NEXA_E_CAP_AMPLIFY`.
- Pre-existing (not introduced here): `npm run posture` exits 1 on 9 ambient-authority hits in
  v1.1 DSL files (baseline `04b80fa`); creative files are clean.
