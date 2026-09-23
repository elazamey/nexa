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
| DELIVER | **enforced**: `createWorkspaceCommitter` denies unless the gate returns `PASS` | `tools/celia-workspace-commit-port.mjs` |

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

## 7. Enforcement at COMMIT (DELIVER)

The gate is not advisory. `createWorkspaceCommitter({ config })` requires
`config.verification = { verifiers: [kid, ...] }` and every COMMIT request must carry
`evidence: { source: 'real', records: [...] }`. After identity, capability, policy and
exact-state checks pass — and **before any filesystem I/O** — the committer calls
`assessClaim()` and additionally requires that the winning `HANDLER_RESULT/ALLOW` record:

* is signed by a configured verifier (never the committing principal),
* names `resource = workspace_commit:<hash>` of this request,
* carries `detail.changeSetHash` equal to the request's change set.

| Denial code | Meaning |
| --- | --- |
| `COMMIT_VERIFICATION_UNCONFIGURED` | no verifier configured → no COMMIT possible |
| `COMMIT_VERIFICATION_BLOCKED` | missing / mock / self-signed / unbound / stranger-signed evidence |
| `COMMIT_VERIFICATION_FAIL` | verifier recorded DENY, or the chain was tampered |

Pinned by `tests/celia-workspace-commit-auth.test.js` ("verification gate: …") at the
real HTTP boundary, with root/staging/event state asserted unchanged on every denial.

## 8. Producing evidence: `celia verify-run`

The verifier side is a tool, not a fixture:

```bash
npm run verify-run -- \
  --key ./verifier.seed \                 # 32-byte hex seed of the verifier identity
  --subject nexa:key:ed25519:z6Mk… \      # the principal that will send the COMMIT
  --descriptor ./descriptor.json \        # { workspaceId, targetRoot, changeSetHash, expectedBaseHash }
  --test tests/foo.test.js --test tests/bar.test.js \
  --out ./evidence.json
```

It runs `node --test` in a clean subprocess, parses the TAP summary, and signs a chain
`POLICY_DECISION/ALLOW → HANDLER_RESULT/ALLOW` (all passed) or `→ GATE_BLOCKED/DENY`
(anything failed, timed out, or zero tests). The output is exactly the `evidence`
object a COMMIT request carries. The tool refuses to sign when verifier == subject.
End-to-end proof: `tests/verify-run.test.js` — real subprocess → evidence → real COMMIT,
with the failing variant refused and the filesystem unchanged.

### 8.1 Why the judge never reads stdout

`# pass 1` printed by a test is a **claim by the process under test**, not evidence.
`verify-run` therefore runs each file in its own runner with
`--test-reporter=junit --test-reporter-destination=<private random file>`; the report is
written by the *runner* (the parent of the test), and the judge reads only that:

```text
Execution → Structured Test Result (runner report) → Independent Judge → Evidence → Gate
```

Pinned attacks (`tests/verify-run.test.js`, each also refused at COMMIT with the
filesystem unchanged):

| Attack | What a stdout parser sees | What the judge sees |
| --- | --- | --- |
| failing test prints a perfect TAP summary | `# pass 1 # fail 0` | report: `fail 1` → DENY |
| perfect summary then `process.exit(0)` | exit 0 + `# pass 1` | report names the *file* as the only testcase → "exited without reporting" → DENY |
| test that never resolves | nothing | real `spawnSync` `ETIMEDOUT`, no report → DENY, timeout recorded in evidence |
| one forged file among passing files | 2 pass | any bad file poisons the run → DENY |

## 9. Security boundary status — PROVEN vs NOT VERIFIED

"611/611 PASS" proves the regression suite passes. It does **not** prove the verifier is
tamper-proof. The boundary is tracked in two columns and must stay that way.

| Item | Status | Proof |
| --- | --- | --- |
| Forged TAP on stdout by a failing test | **PROVEN closed** | RED on old judge reproduced; `verify-run.test.js` "forged TAP" |
| Forged summary + `process.exit(0)` before reporting | **PROVEN closed** (specific defensive rule) | RED reproduced: even junit showed the file as 1 pass; judge rule "testcase == input file ⇒ unreported ⇒ DENY" |
| Real hanging test | **PROVEN closed** | real `spawnSync` `ETIMEDOUT`, no injected flag |
| One bad file in a multi-file run | **PROVEN closed** | "poisons the whole run" |
| **SEC-NEXT-01 / D1.10** Report-writer isolation — the test process runs as the same user and could in principle write the report file | **NOT VERIFIED** | random 16-byte destination in a private `mkdtemp` is obscurity, not a boundary; precondition reproduced in `tests/known-gaps/sec-next-01-report-writer-isolation.test.js` (test discovers the report path via `/proc/<ppid>/cmdline` and has write access); registered as D1.10; needs user/namespace/container isolation and an adversarial test that *fails to* tamper |
| **SEC-NEXT-02 / D1.9** Global execution deadline — per-file timeout only | **NOT VERIFIED** | reproduced as an open gap in `tests/known-gaps/sec-next-02-global-deadline.test.js`; registered as D1.9 in `self-model/gaps.json` |

Rule for closing either: the `process.exit(0)` finding showed that *a structured reporter
is not a root of trust by itself*. Neither item becomes PROVEN because code exists or a
test passes; it becomes PROVEN when an adversarial attempt is executed and shown to fail,
and the known-gap test is removed in the same change.
