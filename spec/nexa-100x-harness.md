# NEXA 100× Harness — Agent Power = Model × Tools × Context × Memory × Routing × Parallelism × Verification × Execution

> **لا توجد إضافة واحدة تجعل النموذج نفسه أذكى 100× مجاناً.**
> الذي يصبح أكبر بمئات المرات هو **القدرة التشغيلية الفعلية للوكيل**.

This document translates the 20+25 techniques into NEXA OS architecture.

## Core Equation

```
Agent Power ≈ Model × Tools × Context × Memory × Routing × Parallelism × Verification × Execution
```

NEXA v0.1 proved: AI proposes → deterministic system decides. v0.3 adds the harness that multiplies power without bigger LLM.

## The 100× Stack (Priority Ordered)

| Layer | Impact | NEXA Implementation | Status in v0.3 |
|-------|--------|---------------------|----------------|
| **Tools / Computer Use** | ★★★★★ | `Files + Shell + Browser + Git + HTTP + Python + DB + APIs` as capability-gated ports | ✅ Supabase port, Grok port, Tool Registry scaffold |
| **Memory + Retrieval** | ★★★★★ | 4 types: Semantic, Episodic, Procedural, Working State — digest-only, evidence-bound | ✅ Memory cell with tiers, RLS, JSONB |
| **Model Mesh / Routing** | ★★★★★ | Classification→cheap, Coding→coder, Reasoning→reasoner, Verification→independent | ✅ Grok planner + mock, vault:// pattern |
| **Parallel DAG Agents** | ★★★★★ | Researcher, Coder, Analyst, Tester, Verifier in parallel → Merge → Judge | 🔲 Next: Task Compiler → DAG |
| **Verification** | ★★★★★ | AI Proposal → Policy → Execution → Evidence → Verifier → PASS/FAIL | ✅ pub-verifier 5/5, posture 6 CLOSED, 314 tests |
| **Policy / Capability** | ★★★★★ | Every skill declares capabilities, default deny, inputs/outputs/evidence | ✅ Capability system, gates.js, membrane 7 steps |
| **Self-Repair** | ★★★★☆ | write → test → fail → diagnose → patch → retest → verify, max_attempts=3 | ✅ Self-healer, homeostasis |
| **Skill Compiler** | ★★★★☆ | Skill = Intent + Preconditions + Capabilities + Tools + Policy + Execution + Tests + Evidence | 🔲 Next: .nexa skill compiler |
| **Caching** | ★★★★☆ | repo index, AST, embeddings, tool schemas, previous test results, stable context | 🔲 Next: Context Caching + KV Cache |
| **Prompt Engineering** | ★★☆☆☆ | Structured output, not giant prompt | ✅ Typed IR, not string prompts |

## NEXA OS Architecture (The Real Secret)

```
                 ┌─────────────────────┐
                 │       NEXA OS        │
                 └──────────┬──────────┘
                            │
             ┌──────────────┼──────────────┐
             ↓              ↓              ↓
          Memory         Skills          MCP
  ┌────────┴─────┐  ┌─────┴──────┐  ┌───┴────┐
  │ Semantic     │  │ Intent     │  │ Tools  │
  │ Episodic     │  │ Precond    │  │ Resources│
  │ Procedural   │  │ Capability │  │ Services │
  │ Working      │  │ Policy     │  └───┬────┘
  └────────┬─────┘  └─────┬──────┘      │
           │              │             │
           └──────────────┼─────────────┘
                          ↓
                     Task Compiler
                          ↓
                    Dynamic Planner
                          ↓
                 ┌────────┴────────┐
                 │                 │
           Strategy Memory     Failure Memory
                 │                 │
                 └────────┬────────┘
                          ↓
                    Execution DAG
                          │
            ┌─────────────┼─────────────┐
            ↓             ↓             ↓
         Local LLM     Free API       Tools
          Ollama      Gemini/GR      Supabase
            │         OpenRouter     Git/FS (port)
            │             │             │
            └─────────────┼─────────────┘
                          ↓
                   Speculative Layer
                          ↓
                  Capability Resolver
                          ↓
                       Policy
                          ↓
                   Authorization
                          ↓
                     Executor (Sandbox)
                       │
         ┌─────────────┼─────────────┐
         ↓             ↓             ↓
      Read-only    Network (port)  Write (gated)
         │             │             │
         └─────────────┼─────────────┘
                       ↓
                    Evidence
                       ↓
                 Agentic Verifier
                    ↙          ↘
                PASS          REPAIR
                                 │
                            Checkpoint
                                 │
                              Resume
                                 ↓
                           Memory Update
```

## 20 Techniques → NEXA Modules

### 1. Computer Use (Files + Shell + Browser + Git + HTTP + Python + DB + APIs)
**NEXA:** Tool Registry — each tool declares capabilities, requires evidence_ref
```yaml
skill:
  id: repo.patch
  capabilities: [filesystem.read, git.diff]
  policy: { default: deny }
  inputs: [path, patch]
  outputs: [diff, evidence]
```
**Status:** `tools/celia-memory-port.mjs` + `tools/celia-grok-port.mjs` as ports, next: `tools/celia-tool-registry.mjs`

### 2. Memory is NOT Chat History
**NEXA:** 4 tiers already: episodic, semantic, working, longterm — plus procedural as skill compiler
```js
// Instead of 10,000 messages → huge prompt
Task → Retrieve 12 relevant facts → execute
```
**Status:** ✅ `packages/cells/celia/memory` with tiers, digest-only

### 3. Context Engineering > Prompt Engineering
```
GOAL → RELEVANT FILES → RELEVANT MEMORY → AVAILABLE TOOLS → POLICIES → CURRENT STATE → EXPECTED OUTPUT
```
Plus **context caching** (Google AI docs: reuse processed inputs)
**Next:** `tools/context-builder.mjs` that builds context deterministically

### 4. Model Routing / AI Mesh
```
Classification → cheap model
Extraction → cheap model
Coding → coding model
Reasoning → reasoning model
Vision → vision model
Verification → independent model
```
**NEXA:** `createGrokPlanner` + `createMockPlanner` + router
**Status:** ✅ Grok port, next: `tools/model-router.mjs` with health/quota/latency tracking

### 5. Parallelism 100×
```
Task ──┬─ Researcher
       ├─ Coder
       ├─ Analyst
       ├─ Tester
       └─ Verifier
       → Merge → Judge → Final
```
**Next:** `packages/cell` already has Organism with parallel cells, need `tools/dag-executor.mjs`

### 6. DAG not Linear
```
MISSION
 ├── discover
 ├── inspect (repo, docs, runtime)
 ├── implement
 ├── test
 ├── security
 └── verify
```
**NEXA:** Task Compiler → DAG → deterministic runtime
**Next:** `spec/omega/execution.md` already describes declared-operations channel, need implementation

### 7. Independent Verifier
```
AI says PASS → PASS (weak)
AI Proposal → Policy → Execution → Evidence → Verifier → PASS/FAIL (strong)
```
**Status:** ✅ `pub-verifier.sh` 5/5, `tools/check-posture.mjs`, `tools/permission-probe.mjs --security`

### 8. Evidence as Thinking
```json
{
  "action": "...",
  "input": "...",
  "result": "...",
  "exit_code": 0,
  "timestamp": "...",
  "artifacts": [],
  "proof": "..."
}
```
**Status:** ✅ Evidence ledger hash-chained, receipts, `CELL_MESSAGE`

### 9. Capability Registry
Every skill declares capabilities, AI requests, system decides
**Status:** ✅ `packages/capability`, `packages/policy/src/gates.js`, membrane 7 steps

### 10. Policy Engine before Executor
```
Intent → Planner → Capability Resolver → Policy Engine → Authorization → Executor → Evidence → Verifier
```
**Status:** ✅ Implemented, gates checked before policy

### 11. MCP as Universal Tool Bus
```
NEXA → Policy → Capability → MCP → Tools
```
MCP spec 2026-07-28: stateless core, multi round-trip, routing via headers, cacheable results
**Status:** ✅ `adapters/mcp`, next: expand to Celia tools

### 12. Self-Healing Loop
```
write → test → fail → diagnose → patch → retest → compare → verify (max_attempts: 3)
```
**Status:** ✅ `packages/runtime/src/self-healer.js`, homeostasis

### 13. Self-Improvement without Self-Authority
```
discover weakness → propose patch → generate test → run test → produce evidence
BUT NOT: self-approve, self-grant, self-disable-policy, self-merge (requires Gates)
```
**Status:** ✅ Evolution Gate 8 stages, `learner.apply()` throws

### 14. Skill Compiler
```yaml
SKILL
 ├── Intent
 ├── Preconditions
 ├── Capabilities
 ├── Tools
 ├── Policy
 ├── Execution
 ├── Tests
 └── Evidence
```
**Next:** Compile .nexa skills to IR, load only needed part

### 15. Cache Everything Reusable
repo index, AST, embeddings, tool schemas, docs, dependency graph, previous test results
**Next:** `tools/cache-layer.mjs` + context caching

## 25 Advanced Techniques → NEXA 100× Harness

### Test-Time Intelligence
1. **Test-Time Search** — try multiple paths
2. **Beam/Branch Search** — keep multiple candidates
3. **Counterexample Search** — actively search for breaking example
4. **Backward Verification** — start from result, go to premises
5. **Rubric-Guided Verification** — verify against rubric, not "looks correct?"
6. **Verifier Interruption** — stop thinking on first error
7. **Adaptive Test-Time Compute** — hard tasks more time, easy less
8. **Sequential/Parallel Budgeting** — decide when to repeat vs parallelize

**NEXA:** Evolution Gate already re-counts adversarial reports, need `packages/learning/src/search.js`

### Tool Intelligence
9. **Speculative Tool Execution** — start B tools while A runs (Microsoft PASTE: 48.5% latency reduction, 1.8× throughput)
10. **Programmatic Tool Calling** — small code orchestrates dozens of tool calls (Anthropic: 20-40% token saving)
11. **Tool Search / Deferred Tools** — don't load all tools in context, search and load only relevant
12. **Tool Result Projection** — transform huge result to needed part only
13. **Tool Output Compression** — compress tool results before returning to model

**Next:** `tools/tool-orchestrator.mjs` with speculative layer

### Cache Intelligence (Below Prompt Level)
14. **Persistent KV Cache** — save attention state, reuse later (2026 research: 136× TTF improvement in some setups)
15. **Quantized KV Cache** — store KV with lower precision for more sessions
16. **Prefix Cache Sharing** — share same prefix between multiple agents
17. **Hidden-State Checkpoints** — resume from intermediate states
18. **Adaptive Speculative Decoding** — speculation size changes with load (Nightjar 2026)
19. **Early Exit** — model stops early when confidence enough
20. **Expert/Route Caching** — keep repeated MoE routes

**Next:** Local Ollama with KV cache, `tools/kv-cache-manager.mjs`

### State Intelligence
21. **Environment Checkpointing** — save workspace state, resume later
22. **Failure Replay** — replay from failure point only
23. **Experience Replay** — reuse similar past experiences
24. **Strategy Memory** — save "which strategy worked" not just info
```json
{
  "task": "fix-typescript-build",
  "strategy": "inspect-types -> patch -> typecheck",
  "provider": "local-coder",
  "verifier": "tsc",
  "success_rate": 0.94
}
```
25. **Dynamic Tool Policy** — allow/deny tool based on current task, not static permission

**NEXA:** `packages/learning` already has observation, patterns, hypotheses, replay, benchmarks — need to extend to strategy memory

## The 7 Most Dangerous Secrets

### 1. Agent Compiler
```
Natural Language → Task Compiler → DAG/Workflow → Deterministic Runtime → LLM only where judgment needed
```
Programmatic tool calling: code handles loops/branching, returns only needed output

### 2. Tool Shadowing / Speculative Actions
```
Tool A → likely Tool B → likely Tool C (start preparing B during A)
```
If prediction correct → time saved, if wrong → cancel

### 3. Verifier Stronger Than Generator
```
Generator = 1x, Verifier = 3x
candidate 1,2,3 → verifier → winner
```
DeepVerifier 2026: 8-11% gains on hard sets with rubric-guided verification

### 4. Agent Learns Routing Decision, Not Just Info
Policy Memory that retrieves successful strategy

### 5. Failure-Driven Intelligence
Store failure, cause, context, attempt, fix, verification — then retrieve similar failures to avoid

### 6. Context as Graph, Not Just Text
```
Entity
 ├── depends_on
 ├── modified_by
 ├── tested_by
 ├── failed_in
 ├── solved_by
 └── belongs_to
```
Answer "why file X changed?" not just "where X appears?"

### 7. Persistent Agent State
```
MISSION, STATE, PLAN, DAG, CAPABILITIES, TOOL STATE, FILES, CHECKPOINT, EVIDENCE, LAST ERROR, NEXT ACTION
→ process killed → resume → continue from checkpoint
```
Long-lived worker, not chatbot session

## NEXA 100× Harness — 10 New Modules

| Module | Spec | Interface | Policy | Evidence | Adversarial Tests |
|--------|------|-----------|--------|----------|-------------------|
| Task Compiler | `spec/harness/task-compiler.md` | `compileTask(nl) → DAG` | No new capabilities | DAG hash | Test: invalid NL → refuse |
| DAG Executor | `spec/harness/dag-executor.md` | `executeDAG(dag) → evidence` | Requires capability per node | Each node evidence | Test: cycle → refuse |
| Model Router | `spec/harness/model-router.md` | `route(task) → model` | Vault only | Routing decision | Test: quota exceeded → fallback |
| Tool Orchestrator | `spec/harness/tool-orchestrator.md` | `orchestrate(tools) → results` | Capability per tool | Tool outputs digest | Test: speculative cancel |
| KV Cache Manager | `spec/harness/kv-cache.md` | `getCache(prefix) → kv` | No authority | Cache hit/miss | Test: quantization loss |
| Strategy Memory | `spec/harness/strategy-memory.md` | `retrieveStrategy(task) → strategy` | Digest-only | Strategy success_rate | Test: stale strategy → STALE |
| Failure Memory | `spec/harness/failure-memory.md` | `retrieveFailures(task) → failures` | Digest-only | Failure cause | Test: similar failure → preventive |
| Context Builder | `spec/harness/context-builder.md` | `buildContext(goal) → context` | No secrets | Context hash | Test: secret egress → refuse |
| Checkpoint Manager | `spec/harness/checkpoint.md` | `checkpoint() → id, resume(id)` | Capability-gated | Checkpoint hash | Test: resume from checkpoint |
| Verifier Mesh | `spec/harness/verifier.md` | `verify(proposal) → PASS/FAIL` | Independent | Verdict + rubric | Test: generator 1x, verifier 3x |

## Implementation Priority for Celia v0.3 → v0.4

### v0.3 (Current — Frontend Dashboard) — DONE
- [x] Memory cell (digest-only, RLS, JSONB)
- [x] Grok planner (vault://, sanitization, 2/2 vectors BLOCKED)
- [x] Dashboard (React + Vite, real-time thinking, evidence, memory)
- [x] API server (port 3001, proxy to 5173)
- [x] 314 tests, 6 gates CLOSED, 5/5 promotion

### v0.4 — Secure Execution Engine (Next)
- [ ] Tool Registry: `tools/celia-tool-registry.mjs` with read-only tools (fs.read, git.diff, http.get)
- [ ] Each tool requires evidence_ref, capability, policy check
- [ ] Sandbox: `REAL_EXECUTION` stays CLOSED, execution via port, not direct
- [ ] DAG Executor: parallel execution of independent nodes
- [ ] Speculative Tool Execution: start B during A (PASTE 48.5% improvement)

### v0.5 — Semantic Memory & RAG
- [ ] Supabase pgvector migration: `supabase/migrations/20260921_pgvector.sql`
- [ ] Embeddings: local + free cloud (OpenRouter free models, 50 req/day limit)
- [ ] RAG: Task → Retrieve 12 relevant facts → execute (not 10k messages → huge prompt)
- [ ] Context Caching: Google AI docs, reuse processed inputs

### v0.6 — NEXA OS Kernel
- [ ] Task Compiler: NL → DAG
- [ ] Model Router: classification→cheap, coding→coder, reasoning→reasoner, verification→independent
- [ ] Strategy Memory + Failure Memory: Policy Memory
- [ ] Persistent Agent State: checkpoint/resume
- [ ] Self-Repair Loop with max_attempts=3, require_new_evidence

## Sources 2026
- MCP spec 2026-07-28 (stateless core, multi round-trip, routing via headers)
- OpenAI Agents SDK (tools, files, shell, browser, sandbox for long-horizon)
- Gemini Context Caching
- OpenRouter free models + Free Router (50 req/day limit)
- Microsoft PASTE (48.5% latency reduction, 1.8× throughput)
- Persistent Q4 KV Cache (136× TTF improvement in some setups)
- Nightjar adaptive speculative decoding
- Anthropic programmatic tool calling (20-40% token saving)
- DeepVerifier (8-11% gains with rubric-guided verification)

## Conclusion

The strongest secret in 2026 is to stop building **Agent that depends on LLM** and start building **Operating System that uses LLM as one part**.

For NEXA: **AI proposes → Policy decides → Executor executes → Evidence proves → Verifier verifies → Memory learns**

This is the 100× harness — not bigger prompt, but **Compound Intelligence**: reuse what was computed, learned, succeeded, failed, and predicted.
