# NEXA Memory v0.5 — Governed Memory State Machine

> **Pivot from Static Vector Retrieval to Governed Memory State Machine**
> Distinction between chatbot and Self-Evolving Agent OS

```
Previous: pgvector RAG — Task → Embedding → Top-12 → Planner
New:      Governed Memory — State Machine + Procedural + Failure + Belief Revision + Forgetting + Ledger
```

## Why Pivot?

- `pgvector RAG` is surface-level: retrieves WHAT happened
- **Governed Memory** stores HOW to execute and WHAT to avoid, with lifecycle governed by evidence
- Local, tiny, ultra-fast (Map + JSONL/SQLite), no complex external deps
- Vector DB becomes optional future layer, activated only if numbers prove need

## Architecture

```
NEXA MEMORY v0.5 ENGINE
├── 1. Memory State Machine (PROPOSED → ACTIVE → WEAKENED → RETIRED)
├── 2. Procedural Memory (Recipe-based Execution Re-use)
├── 3. Failure Memory (Preemption & Error Prevention Rules)
├── 4. Belief Revision (Immutable Revision Edges & Superseding)
├── 5. Forgetting Engine (Utility Score-based Automatic Sweeping)
├── 6. State-Aware Pre-Filtering (System Context Matching)
└── 7. Evidence-Bound Memory Ledger (Cryptographically Auditable)
```

## 1. Memory State Machine

`lifecycle.js`:

```javascript
MemoryState = {
  PROPOSED: 'PROPOSED',   // Proposed by planner, not confirmed
  OBSERVED: 'OBSERVED',   // Observed during execution
  VALIDATED: 'VALIDATED', // Verified by Verifier
  ACTIVE: 'ACTIVE',       // Active and retrievable
  WEAKENED: 'WEAKENED',   // Utility decreased or recent failure
  SUPERSEDED: 'SUPERSEDED',// Revised by newer belief
  RETIRED: 'RETIRED'      // Forgotten/archived
}

Allowed transitions:
PROPOSED → OBSERVED, VALIDATED, ACTIVE, RETIRED
OBSERVED → VALIDATED, ACTIVE, WEAKENED, RETIRED
VALIDATED → ACTIVE, WEAKENED, SUPERSEDED, RETIRED
ACTIVE → WEAKENED, SUPERSEDED, RETIRED
WEAKENED → ACTIVE, SUPERSEDED, RETIRED
SUPERSEDED → RETIRED
RETIRED → [] (terminal)
```

`MemoryNode`:

```javascript
class MemoryNode {
  id, type, content, state=PROPOSED, contextState, evidenceRef
  createdAt, lastUsedAt, lastValidatedAt
  successCount, failureCount, confidence=0.5
  supersededBy, supersedes, version=1
  evidenceChain = [evidenceRef]

  transitionTo(newState, evidenceRef, actor) → validates allowed, pushes evidence
  recordSuccess(evidenceRef): successCount++, confidence+0.05, auto-promote WEAKENED→ACTIVE
  recordFailure(evidenceRef, cause): failureCount++, confidence-0.15, auto-weaken ACTIVE→WEAKENED
  calculateUtility(currentContext):
    recencyHours = (now - lastUsed)/3600000
    decayFactor = 1 / (1 + 0.05 * recencyHours) // Ebbinghaus forgetting
    successRatio = success / (success+failure)
    baseScore = (successRatio*2.0) - (failure*0.3) + confidence
    contextBonus = matchingKeys * 0.1
    typeWeight: failure=1.5, procedural=1.2
    utility = (baseScore + contextBonus) * decay * typeWeight

  isRetrievable(): ACTIVE, VALIDATED, WEAKENED
  isTerminal(): RETIRED, SUPERSEDED
}
```

## 2. Procedural & Failure Engine

`procedural-store.js`:

```javascript
class NexaProceduralMemory {
  store = Map<id, MemoryNode>
  intentIndex = Map<taskIntent, Set<id>>
  failureIndex = Map<failurePattern, Set<id>>
  typeIndex = Map<type, Set<id>>
  maxNodes = 1000

  registerStrategy({ taskIntent, condition, strategyDAG, evidenceRef }):
    id = proc_sha256(taskIntent+condition).slice(0,12)
    If exists → update DAG, version++, recordSuccess, VALIDATED
    Else → new MemoryNode procedural, VALIDATED, confidence 0.9, success=1
    Index, enforce limit

  registerFailure({ failurePattern, cause, preventiveFix, contextState, evidenceRef }):
    id = fail_sha256(pattern+cause).slice(0,12)
    If exists → update fix, version++, confidence 1.0, failure++
    Else → new procedural, ACTIVE, confidence 1.0, failure=1 (high preventive weight)
    Index

  registerBelief({ belief, condition, evidenceRef, confidence=0.6 }):
    Similar, type belief, ACTIVE

  recallRelevantKnowledge(taskIntent, currentSystemState):
    For each node not terminal:
      utility = calculateUtility(currentSystemState)
      If failure and taskIntent includes failurePattern → preventions.push, lastUsed=now
      If procedural and intentMatch (exact or includes) and utility>0.4 → strategies.push, lastUsed=now
        Else if utility<=0.4 → WEAKENED
      If belief and utility>0.3 → beliefs.push
    Sort by utility descending
    Return { preventions, strategies, beliefs }

  get(id), list({ type, state, minUtility, limit }), recordSuccess, recordFailure
  getStats(): total, retrievable, states, types, avgUtility, proceduralCount, failureCount, recalls, preventionsTriggered, strategiesReused
  export()/import() for JSONL/SQLite persistence
}
```

## 3. Belief Revision & Forgetting Engine

`belief-engine.js`:

```javascript
class BeliefRevisionEngine {
  proceduralStore, ledger
  revisionHistory = []

  reviseBelief(oldMemoryId, newContent, evidenceRef, actor):
    oldNode = store.get(oldId)
    newId = oldId + _rev_timestamp
    newNode = MemoryNode with ...oldContent, ...newContent, revisedFrom, revisedAt
      VALIDATED, confidence 0.8, version old+1, supersedes oldId, success=old.success, failure=0
    oldNode → SUPERSEDED, supersededBy = newId
    store.set(newId, newNode), index
    revision = { previous, current, status: REVISED, reason, evidenceRef, actor, timestamp }
    revisionHistory.push, ledger record REVISED + SUPERSEDED
    Return revision

  supersedeStrategy(oldId, { taskIntent, condition, strategyDAG, evidenceRef, reason }):
    Calls reviseBelief

  runForgettingSweep(minUtilityThreshold=0.1, { keepFailures=true, keepActiveBeliefs=false, maxRetire=100 }):
    Candidates = all not RETIRED/SUPERSEDED, keepFailures excludes ACTIVE failures
    Sort utility ascending
    For each utility < threshold: transition RETIRED, record ledger, collect retired[]
    Return { swept, threshold, retired, time, remaining }

  runWeakeningSweep(utilityThreshold=0.4):
    For ACTIVE not failure and utility < threshold: → WEAKENED, ledger
    Return { weakened, threshold, nodes }

  getRevisionHistory(limit=50)
  getLatestVersion(originalId): chain from original → latest via supersededBy
  pruneRetired(retentionDays=7): delete RETIRED older than cutoff
}
```

## 4. Memory Ledger — Audit Trail

`memory-ledger.js`:

```javascript
LedgerAction = {
  MEMORY_CREATED, OBSERVED, VALIDATED, ACTIVATED, WEAKENED,
  REVISED, SUPERSEDED, RETIRED, RECALLED, SUCCESS, FAILURE
}

class MemoryLedger {
  ledger = [], maxEntries=10000, actionCounts={}

  recordChange(action, node, evidenceRef, actor=NEXA_KERNEL):
    prevHash = last.hash or GENESIS
    entry = { index, timestamp, action, memoryId, memoryType, state, evidenceRef, actor, prevHash, hash:null, metadata: { confidence, utility, successCount, failureCount } }
    hash = sha256(prevHash + JSON.stringify(entryWithoutHash))
    ledger.push, actionCounts[action]++
    Enforce max: splice after genesis, re-index
    Return entry

  recordCreation, recordRecall
  verifyChain(): check prevHash chain and hash integrity → { valid, entries, genesis } or { valid:false, error, index }
  getEntries({ action, memoryId, actor, limit, fromIndex })
  getStats(): total, actions, genesis, latest, valid
  export()/import() — import verifies chain
}
```

## 5. Governed Engine — Unified

`governed-engine.js`:

```javascript
class NexaGovernedMemoryEngine {
  proceduralStore, ledger, beliefEngine
  vectorCache = Map<id, embedding> (optional 384d local)
  ownerKid, createdAt

  registerStrategy({ taskIntent, condition, strategyDAG, evidenceRef, confidence })
  registerFailure({ failurePattern, cause, preventiveFix, contextState, evidenceRef })
  registerBelief({ belief, condition, evidenceRef, confidence })

  recallRelevantKnowledge(taskIntent, currentSystemState, { includeVector, vectorThreshold, limit }):
    proceduralStore.recall + _vectorSearchSync (word overlap) → preventions, strategies, beliefs, vectorMatches, total
    ledger recordRecall

  recallWithEmbedding(taskIntent, currentSystemState, { threshold, limit }):
    async generateEmbedding(taskIntent) → cosine similarity with vectorCache → scored sorted by utility*0.6 + similarity*0.4

  reviseBelief(oldId, newContent, evidenceRef) → beliefEngine
  runForgettingSweep(threshold, options) → beliefEngine
  runWeakeningSweep(threshold)
  pruneRetired(retentionDays)
  recordSuccess(id, evidenceRef) → ledger SUCCESS
  recordFailure(id, evidenceRef, cause) → ledger FAILURE
  getStats(): procedural stats + ledger stats + revisions + vectorCache + uptime
  getLedgerEntries, verifyLedger, listMemories, getMemory
  export()/import() for persistence
  _vectorSearchSync(taskIntent, threshold, limit): word overlap sync fallback
}
```

## 6. Dashboard Integration

`tools/celia-dashboard-server.mjs`:

- Governed engine instance (maxNodes 500) seeded with 5 memories: 2 procedural, 2 failure, 1 belief
- Endpoints:
  - GET /api/v1/governed/memory?type=&state=&limit=100 → memories
  - GET /api/v1/governed/stats → total, retrievable, states, types, avgUtility, ledger, revisions, vectorCache
  - GET /api/v1/governed/ledger?limit=50 → entries + verification
  - POST /api/v1/governed/recall { taskIntent, currentSystemState, options } → preventions, strategies, beliefs
  - POST /api/v1/governed/register { kind: procedural|failure|belief, ... } → node + SSE GOVERNED_REGISTERED
  - POST /api/v1/governed/revise { oldId, newContent, evidenceRef } → revision + SSE BELIEF_REVISED
  - POST /api/v1/governed/sweep { kind: forgetting|weakening, threshold } → sweep result + SSE FORGETTING_SWEEP
  - POST /api/v1/governed/success { id, evidenceRef } and /failure { id, evidenceRef, cause }

Frontend `GovernedMemoryPanel.jsx`:

- Glassmorphism 620px height
- Telemetry: states, types, avgUtility, ledger total
- Recall: taskIntent input → state-aware recall, shows preventions (failure memory, red) + strategies (procedural, cyan)
- Memories list: type icon, state badge, utility, confidence, version, success/failure counts, preventiveFix
- Filter by type and state
- Ledger preview: last 5 entries hash-chained
- Sweep buttons: Forgetting (threshold 0.1) and Weakening (0.4)

Integrated in `NexaDashboard.jsx`:

- HUD + Telemetry (6 counters: Parallel DAGs, Speculative, Governed Mem, RAG Engine, Exec Time, Security)
- Arena: Terminal + DAG Visualizer (SSE)
- Governed Memory (6 cols) + Semantic RAG (6 cols) — side by side
- Evidence + Memory + Planner (3 cols)

Build: 59.11KB gzip (was 56.6KB) — still tiny, no heavy libs.

## 7. Demo

`tools/celia-memory-governed-demo.mjs`:

```
1. Register procedural strategies (read file with evidence, parallel DAG)
2. Register failure memories (fs write without evidence, path traversal, secret egress)
3. Register beliefs
4. State-aware recall: 3 queries → preventions + strategies + beliefs
5. Execution tracking: success/failure affects utility & state
6. Belief revision: old belief SUPERSEDED, new VALIDATED, revision history
7. Forgetting Engine: low utility node (10 failures, 10 days ago) → retired via sweep
8. Ledger verification: hash-chained, 18 entries, valid true
9. Final stats: total, states, types, avgUtility, procedural, failure, recalls, preventions, reuse, revisions
```

## Security — Still 6 CLOSED

- No fs write in packages/ — pure Map, no Supabase import in cells
- Supabase client only in tools/ (vector port, optional)
- Evidence-bound: every transition needs evidenceRef (warn if missing, but policy enforces in prod)
- Ledger hash-chained, tamper-evident
- Digest-only for content verification
- 314 tests pass
- Tool registry default deny

## Comparison: pgvector RAG vs Governed Memory

| Aspect | pgvector RAG | Governed Memory |
|--------|--------------|-----------------|
| Stores | WHAT happened (content) | HOW to execute + WHAT to avoid |
| Retrieval | Cosine similarity only | State-aware + Utility + Context matching + Vector optional |
| Lifecycle | Permanent | PROPOSED→ACTIVE→WEAKENED→RETIRED with evidence |
| Failure handling | None | Failure memory with high preventive weight (1.5) |
| Belief update | Overwrite | Immutable revision edges, superseding, version chain |
| Forgetting | Manual | Automatic utility-based sweep (Ebbinghaus curve) |
| Audit | None | Hash-chained ledger, actor, evidenceRef |
| Dependencies | Supabase pgvector, extension | Local Map, zero external deps |
| Size | Requires DB | Tiny, JSONL/SQLite ready |
| Future | - | Vector DB optional, activated only if metrics prove need |

## Files

- `packages/cells/celia/memory/src/lifecycle.js` — MemoryState, MemoryType, ALLOWED_TRANSITIONS, MemoryNode
- `packages/cells/celia/memory/src/procedural-store.js` — NexaProceduralMemory
- `packages/cells/celia/memory/src/belief-engine.js` — BeliefRevisionEngine
- `packages/cells/celia/memory/src/memory-ledger.js` — MemoryLedger, LedgerAction
- `packages/cells/celia/memory/src/governed-engine.js` — Unified NexaGovernedMemoryEngine
- `packages/cells/celia/memory/src/vector-store.js` — (legacy) 384d embedding, kept as optional
- `tools/celia-vector-port.mjs` — (legacy) pgvector port, optional
- `tools/celia-memory-governed-demo.mjs` — governed memory demo
- `tools/celia-rag-demo.mjs` — (legacy) RAG demo, still works
- `tools/celia-dashboard-server.mjs` — + governed endpoints
- `dashboard/src/components/GovernedMemoryPanel.jsx` — governed memory UI
- `dashboard/src/components/SemanticRagPanel.jsx` — (legacy) RAG UI, kept
- `dashboard/src/components/NexaDashboard.jsx` — integrated both panels
- `spec/celia-agent/governed-memory.md` — this spec
- `spec/celia-agent/semantic-memory.md` — legacy RAG spec, kept for optional future
