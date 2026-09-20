# NEXA OS v0.6 — Transactional Workspace + Contract-First + Adaptive DAG + AST Patching + Time-Travel

> **Bundle Core — الحزمة الأساسية الآمنة** — Rollback ذري، عقود قبل/بعد، DAG يعيد تشكيل نفسه، تعديل آمن، إعادة تشغيل زمني
> Built on v0.5 Governed Memory: State Machine → Procedural → Failure → Belief → Forgetting → Ledger, 6 gates CLOSED, 314 tests, 59KB dashboard

## Vision

Agent OS must be **transactional** like a database, not like a shell script that leaves half-written files on failure.

```
Before v0.6: Agent writes directly to repo → test fails → repo left dirty → manual cleanup
After v0.6:  Agent writes to staging (CoW) → verifier checks → atomic commit or rollback → zero side effects
```

## 1. Agent Transactional Workspace (Staging / Copy-on-Write FS)

### Concept

Isolated staging environment with Copy-on-Write semantics, like temporary Git tree. All changes happen in `staging/`, not real repo. Only after `Commit Evidence` does anything reach real FS.

### Mechanism

```
Real Repo (immutable during task)
  ↓ CoW clone (git worktree or file copy + overlay)
Staging Workspace (isolated)
  ├── Agent executes all changes here
  ├── Verifier runs tests here
  ├── If fail → Rollback atomic → zero side effects
  └── If pass → Commit Evidence → atomic move to real repo
```

### Invariants

- No direct write to real repo from agent — only via workspace port in `tools/`
- Every file write in staging requires evidence_ref
- Rollback is atomic and instant — delete staging dir or git worktree remove
- Commit is atomic — move/merge only after postconditions pass
- REAL_EXECUTION stays CLOSED — workspace port lives in tools/, not packages/

### Implementation

`tools/celia-workspace-port.mjs`:

```javascript
createTransactionalWorkspacePort({ root, stagingPrefix })
  → createWorkspace(taskId): creates staging dir .nexa/staging/{taskId} or git worktree
  → writeFile(workspaceId, path, content, evidenceRef): writes to staging only, records evidence
  → readFile(workspaceId, path): reads from staging (CoW fallback to real)
  → listChanges(workspaceId): diff staging vs real (git diff or file diff)
  → verify(workspaceId, contract): runs pre/post conditions in staging
  → commit(workspaceId, evidenceRef): atomic merge to real repo if postconditions pass
  → rollback(workspaceId): atomic delete staging, zero side effects
```

`packages/cells/celia/executor/src/transactional-workspace.js`:

```javascript
createTransactionalWorkspaceCell({ identity, workspacePort, ledger })
  receptors:
  - create({ taskId, evidenceRef }): create staging
  - write({ workspaceId, path, content, evidenceRef }): write to staging
  - commit({ workspaceId, evidenceRef }): commit if verified
  - rollback({ workspaceId, evidenceRef }): rollback
  - status({ workspaceId }): list changes, utility
```

## 2. Invariant-Driven Execution (Contract-First Harness)

### Concept

Write contracts and invariants BEFORE execution, not "fix the problem".

```yaml
contract:
  id: fix-login-bug
  preconditions:
    - git_status: clean
    - tests_passing: true
    - no_uncommitted_changes: true
  postconditions:
    - build_status: success
    - no_new_eslint_warnings: true
    - changed_files_max: 3
    - tests_passing: true
    - no_secrets_leaked: true
  invariants:
    - real_execution_closed: true
    - evidence_chain_valid: true
    - ledger_hash_valid: true
```

If preconditions pass and postconditions pass after execution, task auto-approved.

### Implementation

`packages/cells/celia/executor/src/contract-engine.js`:

```javascript
class ContractEngine {
  checkPreconditions(contract, context): { ok, failures[] }
    - git_status clean (via git port)
    - tests_passing (via test runner)
    - no_uncommitted_changes
    - custom checks

  checkPostconditions(contract, context, changes): { ok, failures[], metrics }
    - build_status success (npm run build)
    - no_new_eslint_warnings (compare before/after)
    - changed_files_max (count changed files)
    - tests_passing
    - no_secrets_leaked (scan for API keys)
    - evidence_chain_valid
    - ledger_hash_valid

  verify(contract, beforeContext, afterContext): { ok, pre, post, shouldCommit }
}
```

## 3. Adaptive DAG Engine with Dynamic Node Injection

### Concept

DAG is not static — it mutates in real-time. If Node_3 fails, engine injects Node_3a, 3b, 3c without affecting completed nodes.

```
[Node 1: Inspect] → [Node 2: Build] → [Node 3: Test (Failed)]
                                    │
                       (Dynamic Injection via Kernel)
                                    ▼
                         [3a: Parse Error Log]
                                    │
                                    ▼
                         [3b: Apply AST Patch]
                                    │
                                    ▼
                         [3c: Re-run Test] → [Node 4: Deploy]
```

### Mechanism

- DAG stored as mutable graph with versioning
- On node failure, kernel calls `injectNodes(failedNodeId, newNodes)` 
- New nodes get dependencies: 3a depends on 3, 3b depends on 3a, 3c depends on 3b, 4 depends on 3c
- Completed nodes never re-executed — only new branch
- Emits via SSE: `DAG_NODE_INJECTED`, `DAG_BRANCH_CREATED`

### Implementation

`packages/cells/celia/executor/src/adaptive-dag.js`:

```javascript
class AdaptiveDagEngine {
  constructor({ maxDepth=5, maxInjections=10 })
  dag = { nodes, edges, version }

  injectNodes(failedNodeId, newNodes, evidenceRef):
    Validate failedNode exists and is FAILED
    Check maxDepth and maxInjections not exceeded (circuit breaker)
    For each newNode in newNodes:
      newNode.id = `${failedNodeId}_${newNode.suffix}` (e.g., 3a, 3b)
      newNode.injectedFrom = failedNodeId
      newNode.evidenceRef = evidenceRef
      Add to dag.nodes, add edges
    Increment dag.version, emit DAG_NODE_INJECTED via dagEventEmitter
    Return new DAG

  getExecutableNodes(): nodes with all deps SUCCESS and not yet RUNNING
  getFailedNodes(): nodes FAILED and not yet handled
  shouldInject(failedNode): check if failure is recoverable (not critical, not max retries)
}
```

Extend `executor.js`:

```javascript
// On node failure
if (node.critical) { stop DAG }
else if (adaptiveEngine.shouldInject(node)) {
  const recoveryNodes = generateRecoveryNodes(node, error) // parse error log → 3a,3b,3c
  adaptiveEngine.injectNodes(node.id, recoveryNodes, evidenceRef)
  emitDagEvent('DAG_NODE_INJECTED', { failedNodeId, injected: recoveryNodes })
  // Continue execution with new nodes
}
```

## 4. AST-Aware Patching & Node Mutation

### Concept

Instead of rewriting whole file or fragile search-and-replace, transform source to AST before patching. Generate instruction to replace specific node (e.g., Replace FunctionBody at Node #402). Kernel merges and validates syntax before saving.

### Mechanism

```
Source Code → Parse AST (acorn/babel) → Find Node by id/path → Generate Patch → Validate Syntax → Apply → Evidence
```

Prevents missing brackets, broken imports, syntax errors.

### Implementation

`tools/celia-ast-port.mjs` (lives in tools/, allowed fs):

```javascript
createAstPort()
  → parse(code, { language: 'js/ts' }): returns AST with node ids
  → findNode(ast, { type, name, line }): finds node
  → generatePatch({ file, nodeId, newContent, operation: 'replace|insert|delete' }): creates patch
  → validateSyntax(code): uses vm.Script or acorn parse to check syntax, returns { ok, error }
  → applyPatch(file, patch, evidenceRef): validates then writes to staging workspace, returns { ok, digest, evidence }
  → mutateNode(file, { nodeType, nodeName, newBody, evidenceRef }): high-level API
```

`packages/cells/celia/executor/src/ast-cell.js`:

```javascript
createAstCell({ identity, astPort, workspacePort, ledger })
  receptors:
  - parse({ file, evidenceRef }): parse file in workspace
  - patch({ file, nodeId, newContent, evidenceRef }): AST-aware patch in staging
  - mutate({ file, functionName, newBody, evidenceRef }): mutate function body
```

## 5. Time-Travel Debugging & Deterministic Replay (Event Sourcing)

### Concept

Full Event Sourcing for all inputs/outputs and env. Record every tool output, response code, with fixed random seeds. If task fails at step 42, kernel can replay from step 39 with one param change without re-calling LLM for steps 1-38, saving cost/time and making debugging 100% accurate.

### Mechanism

```
Event Log (append-only, hash-chained):
[
  { index: 0, type: 'DAG_START', dagId, timestamp, seed, env },
  { index: 1, type: 'NODE_START', nodeId, inputs, capability, evidenceRef },
  { index: 2, type: 'TOOL_OUTPUT', nodeId, tool, output, digest, duration },
  { index: 3, type: 'NODE_COMPLETE', nodeId, state, evidenceRef },
  ...
  { index: 42, type: 'NODE_FAILED', nodeId, error, evidenceRef }
]

Replay:
replayFrom(index=39, { overrideParams }): 
  Load events 0..38 from log (no LLM calls)
  Reconstruct state at 39
  Execute from 39 with new param
  Record new branch
```

### Implementation

`packages/cells/celia/executor/src/event-sourcing.js`:

```javascript
class EventSourcingEngine {
  log = [], seed, env
  record(eventType, payload, evidenceRef): appends to log with hash chaining, emits via SSE
  getStateAt(index): reconstructs DAG, nodes, evidence, memory at that index
  replayFrom(index, overrides, evidenceRef): loads state at index, executes from there with overrides
  getEvents({ from, to, type, nodeId })
  verifyChain(): hash chain integrity
  export()/import() for persistence
}

Events:
- DAG_START, DAG_COMPLETE
- NODE_START, NODE_COMPLETE, NODE_FAILED, NODE_INJECTED
- TOOL_CALL, TOOL_OUTPUT
- WORKSPACE_CREATED, WORKSPACE_COMMIT, WORKSPACE_ROLLBACK
- CONTRACT_CHECK_PRE, CONTRACT_CHECK_POST
- MEMORY_RECALLED, MEMORY_REGISTERED, BELIEF_REVISED
- LEDGER_ENTRY
```

Extend `executor.js` to record every event.

## 6. Integration — v0.6 Flow

```
Task with Contract
  ↓
Check Preconditions (git clean, tests passing)
  ↓
Create Transactional Workspace (CoW)
  ↓
Governed Memory Recall (preventions + strategies) → Planner Context
  ↓
Planner generates DAG
  ↓
For each node in topological order (maxParallel 3):
  Record NODE_START event
  Execute via tool registry (with evidence_ref, capability, workspace)
  If AST patch needed → use AST port (parse → patch → validate → apply in staging)
  Record TOOL_OUTPUT event
  If success → recordSuccess in governed memory, NODE_COMPLETE
  If failure:
    Record NODE_FAILED event
    If critical → rollback workspace, stop
    Else if shouldInject → generate recovery nodes (parse error log → 3a,3b,3c) → inject → continue
    Else → recordFailure in governed memory
  ↓
Check Postconditions (build success, no new warnings, changed_files_max, tests passing, no secrets, evidence valid, ledger valid)
  ↓
If postconditions pass → commit workspace (atomic) + emit DAG_COMPLETE + record WORKSPACE_COMMIT
Else → rollback workspace (atomic) + emit DAG_FAILED + record WORKSPACE_ROLLBACK
  ↓
Forgetting sweep (low utility → RETIRED) + ledger verification
```

## 7. Dashboard — v0.6 UI

- Transactional Workspace Panel:
  - Current workspace id, status (staging, verifying, committed, rolled back)
  - Changes list (diff), files changed count
  - Contract pre/post checks (green/red)
  - Commit/Rollback buttons
- Adaptive DAG Panel:
  - Shows injected nodes (3a,3b,3c) with dashed edges from failed node
  - Branch visualization
  - Replay button: Time-travel from step N
- AST Patching Panel:
  - File parsed, nodes list, patch preview, syntax validation
- Event Sourcing Panel:
  - Event log timeline, replay from index, chain verification

Build target: <65KB gzip (currently 59KB, add ~5KB)

## 8. Security — Still 6 CLOSED

- No fs write in packages/ — workspace and AST ports in tools/
- All writes in staging require evidence_ref
- Contracts enforce invariants
- Ledger hash-chained for workspace and memory
- AST validation prevents syntax errors
- Rollback atomic, zero side effects
- 314 tests + new tests for v0.6

## 9. Files for v0.6

- `spec/celia-agent/v06-transactional.md` — this spec
- `packages/cells/celia/executor/src/contract-engine.js` — ContractEngine
- `packages/cells/celia/executor/src/transactional-workspace.js` — workspace cell logic
- `packages/cells/celia/executor/src/adaptive-dag.js` — AdaptiveDagEngine
- `packages/cells/celia/executor/src/ast-cell.js` — AST cell
- `packages/cells/celia/executor/src/event-sourcing.js` — EventSourcingEngine
- `tools/celia-workspace-port.mjs` — transactional workspace port (CoW)
- `tools/celia-ast-port.mjs` — AST port (parse, patch, validate)
- `tools/celia-v06-demo.mjs` — end-to-end demo: contract → workspace → DAG → failure → injection → commit/rollback
- `tools/celia-dashboard-server.mjs` — + v0.6 endpoints
- `dashboard/src/components/TransactionalWorkspacePanel.jsx` — workspace UI
- `dashboard/src/components/AdaptiveDagPanel.jsx` — adaptive DAG UI
- `dashboard/src/components/EventSourcingPanel.jsx` — event log + time-travel UI
