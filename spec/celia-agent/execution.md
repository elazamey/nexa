# Celia Secure Execution Engine — v0.4

> Built on NEXA v0.1 baseline: 6 gates CLOSED, 314 tests, 5/5 promotion, dashboard live.

## Principle

Until now, Celia only **proposed** steps (Propose). Now it **executes** them in a sandbox, but with evidence.

```
Intent → Planner (Grok) → DAG → Capability Resolver → Policy Engine → Authorization → Executor (Sandbox) → Evidence → Verifier
```

**REAL_EXECUTION gate stays CLOSED** — no direct `spawn`, `exec`, `child_process` in `packages/`. Execution via injected ports in `tools/` only.

## Tool Registry

Every tool declares capabilities, policy, inputs, outputs, evidence.

```yaml
skill:
  id: fs.read
  capabilities: [filesystem.read]
  policy:
    default: deny
    allowed_paths: [spec/**, README.md, package.json, examples/**]
  inputs: [path]
  outputs: [content, digest, evidence]
```

### Tools (Read-only first)

| Tool | Capabilities | Policy | Inputs | Outputs |
|------|--------------|--------|--------|---------|
| `fs.read` | filesystem.read | allow-listed paths only | path | content digest, evidence |
| `git.diff` | git.diff | max 10KB | base, head | diff, digest, evidence |
| `git.log` | git.log | max 20 commits | limit | commits, evidence |
| `http.get` | http.get | allow-listed hosts (api.github.com, example.com) | url | body, status, evidence |
| `supabase.read` | supabase.read | default deny | table, tier, limit | rows, evidence |
| `memory.recall` | memory.recall | default deny | tier, limit | digests, evidence |

**Invariants:**
- Every tool requires `evidence_ref` before execution (`OMEGA_E_EVIDENCE_UNTRUSTED` otherwise)
- Every tool requires capability (`OMEGA_E_CAP_MISSING` otherwise)
- Returns digest, not raw secret (if secret, `OMEGA_E_SECRET_EGRESS`)
- Execution via port, not direct import

### Implementation

`packages/cells/celia/executor/src/tool-registry.js`:
- `createToolRegistry({ ports })` — registry of definitions
- `execute({ id, inputs, capability, evidence_ref, ledger })` — validates policy, executes via port, records evidence

`tools/celia-tool-registry.mjs`:
- `createFsReadPort`, `createGitPort`, `createHttpPort` — ports in tools/ (allowed ambient authority)
- Mock fallback for CI

## DAG Executor

### Structure

```
MISSION
 ├── discover (fs.read README.md)
 ├── inspect (parallel)
 │   ├── repo (git.log)
 │   ├── docs (fs.read spec/omega/README.md)
 │   └── runtime (fs.read package.json)
 ├── implement (analyze)
 ├── test (git.diff)
 ├── security (posture)
 └── verify (evidence chain)
```

### Features

- **Topological sort** + level-based parallel execution (maxParallel=3)
- **Speculative Tool Execution:** start B while A runs if predicted
  - Microsoft PASTE research: 48.5% latency reduction, 1.8× throughput
- **Evidence per node:** each node → `CELL_MESSAGE` with `payload_digest` + `evidence_ref`
- **Critical nodes:** if critical node fails, DAG stops
- **Self-healing:** fail → diagnose → patch → retest (max_attempts: 3, require_new_evidence)

### Implementation

`packages/cells/celia/executor/src/executor.js`:
- `createSecureExecutor({ toolRegistry, maxParallel, speculative })`
- `executeDAG(dag, { capability, evidenceRefPrefix })` → { ok, passed, failed, results, evidenceChain }

`tools/dag-executor.mjs`:
- `createDAGExecutor({ maxParallel, speculative })`
- Demo DAG: discover → 3 parallel inspects → analyze (critical) → verify (speculative)

## Security

| Invariant | Enforced by |
|-----------|-------------|
| No mint | Tool never calls `mintCapability` (posture scan) |
| evidence_ref required | `TOOL_POLICIES.require_evidence_ref` → `OMEGA_E_EVIDENCE_UNTRUSTED` |
| Allow-listed paths/hosts | Policy check in registry → `OMEGA_E_POLICY` |
| No fs write | `FILESYSTEM_WRITE` gate CLOSED, only read-only tools in v0.4 |
| No child_process | `REAL_EXECUTION` gate CLOSED, execution via port |
| Digest-only | Returns digest, not raw content |

## Demo

```bash
node tools/celia-tool-registry.mjs
# Tool: fs.read, git.diff, git.log, http.get
# Executing fs.read with evidence_ref...

node tools/dag-executor.mjs
# 🚀 Executing Mission: Review repository
# level 0: discover (parallel=1)
# level 1: inspect-repo, inspect-docs, inspect-runtime (parallel=3)
# level 2: analyze (critical)
# level 3: verify (speculative)
# 📊 DAG Result: 6/6 nodes executed

node tools/celia-demo.mjs
# Now includes tool execution + evidence chain
```

## Next

- Add write tools (gated, requires extra approval): `supabase.write` with RLS
- Add `pgvector` for semantic search (v0.5)
- Integrate with dashboard: show DAG execution live
- Add 5 new adversarial tests: `tool-evasion`, `evidence-ref-missing`, `allow-list-bypass`
