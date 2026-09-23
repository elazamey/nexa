# The NEXA Agent Loop — Inspect → … → Evidence → Deliver

> Arabic version: [`agent-loop.ar.md`](agent-loop.ar.md).
> Executable form: `tools/verification-gate.mjs`, pinned by `tests/verification-gate.test.js`.

NEXA's one rule is **AI proposes, the deterministic system decides**. This document
turns that rule into the *working loop* an AI coding agent (Celia, or any agent
speaking the NEXA protocol) is expected to follow, and names the three artefacts
that must never be confused: **MOCK**, **REAL**, **EVIDENCE**.

## 1. The loop

"Write code, then edit it" is not a loop. The engineering loop is:

```text
DISCOVER      what exists, what is asked
UNDERSTAND    goal, constraints, non-goals            → Specification
INSPECT       files, architecture, deps, tests        → Context
PLAN          which files, which changes, which order → Implementation Plan
AUTHORIZE     capability + policy for the plan        → ALLOW / DENY (default DENY)
IMPLEMENT     generate or edit code                   → Code Change
EXECUTE       build / run                             → Runtime Result
OBSERVE       capture logs, exits, outputs            → Observation
TEST          unit / integration / e2e                → Test Evidence
   ┌─────────────────────────────────────────────────┐
   │ FAIL?  yes → DIAGNOSE → REPAIR → RETEST ───┐    │
   │        no  ↓                                │    │
   └────────────┴──────── (repeat until no) ◄────┘    │
REVIEW        bugs, security, regressions             → Review Findings
VERIFY        did the *requirement* get met?          → Verdict
EVIDENCE      hash-chained, signed record of the run  → Evidence chain + receipt
DELIVER       commit / PR / deploy, only if authorized → Release
```

The order is exported as `LOOP_STAGES` in `tools/verification-gate.mjs`, and the test
asserts two invariants: `AUTHORIZE` precedes `IMPLEMENT`, and `VERIFY` precedes `DELIVER`.

### Where each stage lives in this repository

| Stage | Mechanism | Location |
| --- | --- | --- |
| INSPECT / PLAN | Celia `advise`, `catalog`, `research` — read-only | `tools/celia-system.mjs` |
| AUTHORIZE | capability token + policy, default deny | `packages/capability`, `packages/policy`, `packages/protocol` |
| EXECUTE (bounded) | Celia workspace COMMIT executor, re-verifies at write point | `tools/celia-workspace-commit-port.mjs` |
| OBSERVE / EVIDENCE | `EvidenceLog`, `verifyEvidenceChain`, signed receipts | `packages/evidence` |
| TEST / RETEST | `npm test`, `npm run verify` | `tests/`, `package.json` |
| VERIFY | `assessClaim()` — PASS / FAIL / BLOCKED | `tools/verification-gate.mjs` |
| DELIVER | never implicit; requires explicit operator authority | `docs/celia-workspace-commit-contract.ar.md` |

## 2. Who decides

```text
AI proposes
     ↓
Policy decides                (packages/policy — default DENY)
     ↓
Execution Authority executes  (capability-gated handler)
     ↓
System produces evidence      (packages/evidence — hash chain + receipt)
     ↓
Verifier verifies             (a key that is NOT the proposer)
     ↓
Result = PASS / FAIL / BLOCKED
```

The agent is never its own judge. `assessClaim()` returns **BLOCKED** if the proposer's
key appears among the signers of the evidence chain it is relying on.

## 3. MOCK ≠ REAL ≠ EVIDENCE

Three different things prove three different statements:

| Artefact | Proves | Can it produce PASS alone? |
| --- | --- | --- |
| **MOCK / STUB / FIXTURE test** | the code honours the *contract* of a dependency | **No** → `BLOCKED` |
| **REAL runtime run** | the *integration* actually works in this environment | Only when recorded as evidence |
| **EVIDENCE** (verified chain, independent signer, `HANDLER_RESULT/ALLOW`) | *what actually happened* | **Yes** → `PASS` |

Rules that follow:

1. A mock is not the first stage. The order is *real requirement → real contract →
   implementation → real test*; mocks are introduced only to isolate an external
   dependency or force a specific state.
2. "The mock passed, therefore the browser/terminal/API works" is an invalid inference.
   Say instead: *the contract is honoured; the integration is not yet evidenced*.
3. The evidence **source must be declared** (`mock` | `real`). Undeclared evidence is
   `BLOCKED`; there is no silent upgrade from mock to real.
4. **Registration ≠ implementation.** Being listed in Celia's catalog, having an adapter
   folder, or passing a fixture test means *registered*. Only a real run with evidence
   means *implemented*.

## 4. Verdicts

Only three verdicts exist. There is no "probably fine".

| Verdict | Meaning | Typical cause |
| --- | --- | --- |
| `PASS` | verified chain, independent signer, `HANDLER_RESULT/ALLOW` for the subject, no later DENY | real run recorded by the operator/verifier key |
| `FAIL` | evidence contradicts the claim, or the chain is tampered | `GATE_BLOCKED`, `DENY`, edited log |
| `BLOCKED` | not enough admissible evidence to decide | no evidence, self-signed, mock-only, wrong subject, no `HANDLER_RESULT` |

`BLOCKED` is not a soft `PASS`. It means the loop has not reached `EVIDENCE` yet; go back
to `EXECUTE`.

## 5. The repair loop

```text
CODE → RUN → FAIL?
              ├── NO  → REVIEW → VERIFY → EVIDENCE → DELIVER
              └── YES → DIAGNOSE → FIX → RETEST ─┐
                          ▲                      │
                          └──────────────────────┘
```

A repair does **not** rewrite history. The failing record stays in the chain; the new
verdict is about the *new* run. (`tests/verification-gate.test.js`: "the repair loop".)
Editing the log instead of the code is detected by `verifyEvidenceChain` and yields `FAIL`.

## 6. Minimal usage

```js
import { assessClaim } from './tools/verification-gate.mjs';

const verdict = assessClaim({
  claim:   { subject: workerKid, proposer: agentKid, asserted: true },
  records: evidenceLog.entries(),   // sealed by the verifier's key
  source:  'real',
});
// → { verdict: 'PASS' | 'FAIL' | 'BLOCKED', reason, evidence? }
```

Anything the agent *says* (`asserted: true`) is carried along for the record and
ignored by the decision.
