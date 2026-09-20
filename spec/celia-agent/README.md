# Celia Agent — Next Phase after v0.1

> Built on NEXA v0.1 baseline: 6 gates CLOSED, 314 tests, 31 attacks blocked, 5/5 promotion ceremony.

Celia is an autonomous agent that composes as a **cellular organism** on top of NEXA Ω∞:

```
Planner (Grok/xAI) → proposes → NEXA compiler → IR → runtime → authority → capability → kernel
                                      ↓
                              evidence ledger + memory (Supabase/MongoDB via port)
```

## Core Principles (inherited from NEXA)

1. **AI ≠ Authority** — Grok can propose steps, never mint capabilities
2. **No secret in language** — API keys behind `vault://` handles
3. **Six gates stay CLOSED** — no fs write, no child_process, no deploy from protocol
4. **Evidence-first** — every decision, every DB write, every LLM call is evidence

## Three Pillars

### 1. هندسة البيانات — Database Layer

**Goal:** Store agent state, memory tiers, evidence chain, and conversation history.

**NEXA-compliant design:**
- **No direct DB import in `packages/`** — DB is an injected port (`world` / `memory` / custom `store` port)
- **Cell:** `celia.memory` cell with nucleus `memory@1`, receptors: `remember`, `recall`, `forget`
- **Tissue:** `celia.tissue` with contract that only allows `memory.read`, `memory.write` via capabilities
- **Implementation options:**
  - **Supabase (recommended for MVP):** Postgres + Row Level Security + realtime. Fits NEXA's evidence model (hash chain can be stored as JSONB)
  - **MongoDB Atlas:** Flexible schema for episodic/semantic memory tiers, TTL for observations

**Evidence mapping:**
- `remember` → `CELL_MESSAGE` + `EVIDENCE` record with `payload_digest`
- DB write is *not* a filesystem write — it's a capability-gated call to `tool:supabase` or `tool:mongodb`
- The DB port itself is verified by `tools/check-posture.mjs` — no `node:fs` inside

**MVP Schema:**
```sql
-- Supabase
table celia_memory (
  id uuid primary key,
  tier text check (tier in ('episodic','semantic','working','longterm')),
  digest text not null, -- sha256 of content, content itself in vault or encrypted
  owner_kid text not null,
  created_at timestamptz,
  evidence_ref text -- hash of NEXA evidence record that authorized this write
);
table celia_evidence (
  hash text primary key,
  prev_hash text,
  kind text,
  payload jsonb,
  sig jsonb
);
```

### 2. المنطق الأساسي — Backend / Agent Logic

**Goal:** Grok/xAI as planner port, with autonomous decision loop.

**NEXA runtime already has:**
```js
agent coder { model provider.auto }
```
`provider.auto` is a declaration, not a network call. Runtime may be given `planner` port.

**Celia planner design:**
```js
// packages/cells/celia/planner/src/grok.js
export function createGrokPlanner({ apiKeyHandle, model = 'grok-beta' }) {
  return {
    async plan({ ir, memoryRefs, world }) {
      // 1. Check capability: does agent allow llm.call?
      // 2. Call xAI API via injected fetch port (not direct import)
      // 3. Return { steps } or { refuse: reason }
      // 4. Never return capabilities, never introduce new caprefs
      // 5. Refusal is recorded as evidence
    }
  }
}
```

**Autonomy loop (observe → reflect → hypothesize → propose):**
- Uses `packages/learning` — observation, patterns, hypotheses
- Celia's `observe` reads world + memory via `recall`
- `reflect` uses Grok to summarize
- `hypothesize` forms falsifiable hypothesis with `baseline`, `expected_change`
- `propose` goes through Evolution Gate (8 stages) — never self-authorizing

**xAI/Grok integration points:**
- `instrument grok { resource "tool:grok" }` — local tool bound to kernel resource
- `grant llm.call { for agent celia, max_uses 100, budget { cost 1000 } }`
- Secret: `vault://xai-api-key` handle, never in source

### 3. أتمتة النشر — Deployment Automation

**Goal:** Automated releases that *preserve* the 5/5 ceremony.

**Current (v0.1):**
- Manual: `publish-v0.1.plan.json` (4892 bytes) + `ceremony.sh --execute` + `pub-verifier.sh` 5/5 + `git tag v0.1`

**Next (v0.2+):**
- **CI job `release`:**
  - Runs `npm run verify` (posture, tests, attacks, demos)
  - Runs `node tools/preview-baseline.mjs`
  - Runs `node tools/permission-probe.mjs --run-proof`
  - Generates `publish-vX.Y.plan.json` automatically (with digests)
  - Requires owner approval via GitHub Environment protection + Ed25519 signature
  - Creates tag and GitHub Release with evidence bundle

**Workflow:**
```yaml
# .github/workflows/release.yml
name: Automated Release
on:
  workflow_dispatch:
    inputs:
      version: { required: true }
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm run verify
      - run: ./pub-verifier.sh  # must be 5/5
  ceremony:
    needs: verify
    environment: release # requires owner approval
    steps:
      - run: ./ceremony.sh --plan publish-${{ inputs.version }}.plan.json --execute
  release:
    needs: ceremony
    steps:
      - run: git tag -a ${{ inputs.version }} -m "Release ${{ inputs.version }}"
      - run: git push origin ${{ inputs.version }}
```

**Safety:** The gate is still the publish — no auto-deploy, no `AUTO_DEPLOY` gate opened. Release only publishes tag + plan + approval, never opens gates.

## Roadmap

### G1 — Database Foundation (Week 1-2)
- [ ] `packages/cells/celia/memory` cell + tissue
- [ ] `tools/celia-memory-port.mjs` — Supabase adapter as injected port (no fs import)
- [ ] `spec/celia-agent/memory.md` — memory tiers, digest-only storage
- [ ] `npm run demo:celia-memory` — remember/recall with evidence

### G2 — LLM Planner (Week 3-4)
- [ ] `packages/cells/celia/planner` — Grok/xAI planner port
- [ ] `spec/celia-agent/planner.md` — planner contract, refusal as evidence
- [ ] `tools/celia-demo.mjs` — observe → grok → propose → evidence
- [ ] 5 new attacks: `llm-mint-attempt`, `llm-secret-egress`, etc.

### G3 — Deployment Automation (Week 5)
- [ ] `.github/workflows/release.yml` with environment protection
- [ ] `tools/generate-publish-plan.mjs` — auto-generates 4892-byte plan with digests
- [ ] Update `pub-verifier.sh` to support auto mode
- [ ] `v0.2` release via automated ceremony

## Security Invariants for Celia

| Invariant | Enforced by |
| --- | --- |
| Grok never mints | `packages/cells/celia/planner` never calls `mintCapability` (posture check) |
| API key never in source | `vault://` handle only, `process.env` scan in posture |
| DB write is capability-gated | `celia.memory` membrane: identity → capability → policy → evidence |
| Memory stores digests, not raw secrets | `SecretString` type, `payload_digest` in transcript |
| No fs write | `FILESYSTEM_WRITE` gate CLOSED, `tools/celia-*` is only place that touches DB port |

## Next Action

Choose one to start:
1. **Supabase** — I can scaffold `supabase/migrations` + memory cell + port
2. **Grok** — I can scaffold planner port with mock xAI API + evidence
3. **Release automation** — I can scaffold `release.yml` + plan generator

All three respect NEXA's "AI proposes, deterministic system decides".
