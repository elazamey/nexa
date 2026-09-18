# NEXA Ω — Learning, Reflection and Measurement

> The system is allowed to notice, to argue and to measure.
> It is not allowed to change itself. `learner.apply()` throws.

This document specifies `packages/learning`, the layer that turns finished runs into
proposals. It sits **above** the runtime and **below** the Evolution Gate:

```text
records ──► observe ──► patterns ──► hypotheses ──► proposals ──► [ replay · benchmark · adversarial · gate ]
   ▲                                                                                │
   └────────────────────────── the ledger, which nothing edits ◄─────────────────────┘
```

## 1. The loop

```text
OBSERVE → REFLECT → HYPOTHESIZE → DESIGN → PROPOSE → ( outside this layer ) → VERIFY → ATTACK → BENCHMARK → CANARY → ACTIVATE
```

Everything up to `PROPOSE` is implemented here and is pure. Everything after it belongs
to the Evolution Gate (`evolution.md`) and to the activation authority. There is no path
from an observation to a running system that does not pass through that gate.

## 2. Observation

An `Observation` is a *summary of a finished run*, derived from Ω records. It is
content-addressed (`NEXA/omega1 observation\0`), so two identical windows are one
observation, and a claim can name exactly what it read.

| Field | Meaning |
| --- | --- |
| `mission`, `agent`, `module` | what ran |
| `verdict`, `code` | how it ended |
| `steps`, `records`, `receipts` | its size, in the ledger's own units |
| `calls`, `failures[]`, `failure_count` | the calls it made, and why they were refused |
| `latency_ms`, `cost`, `tokens`, `measured` | what the **host** measured (`measured: false` means "nothing") |
| `evidence[]` | the hash of every record it was derived from |
| `calls_detail[]` | one entry per *call* |

Two rules are enforced in code, because both were violated during development:

* **a call is not a record.** A call refused by a closed gate writes both a `TOOL_RESULT`
  and a `GATE_REFUSAL`; counting both doubles every failure. One call, one count.
* **the runtime reads no clock.** Its determinism is a feature; latency and cost are
  injected by the host as `measurements`, and unknown measurement keys are refused. A
  learning system that invents its own numbers is not measuring.

## 3. Patterns and hypotheses

`minePatterns(calls, { min_support })` groups calls by `resource!action` and counts. Rates
are **basis points** (integers out of 10000), because canonical NEXA data has no floats: a
number that cannot be hashed cannot be committed to.

A pattern is actionable when it repeats **and** dominates
(`failures ≥ min_failures` and `failure_rate_bp ≥ min_rate_bp`). A tool that fails once in
twenty is noise; a tool that fails in every mission is a design fact.

A `Hypothesis` carries:

| Field | Meaning |
| --- | --- |
| `claim` | the sentence being proposed |
| `target` | one of `strategy`, `plan`, `policy`, `tool-selection`, `memory-indexing`, `recovery`, `prompt` — the kernel is not on this list |
| `evidence[]` | the observation ids it rests on |
| `confidence_bp` | a Beta(1,1) posterior, `(failures + 1) / (support + 2)`, in basis points — a *belief*, never a fact |
| `baseline`, `expected_change` | what would have to move, and by how much |
| `falsifiable_by` | the observation that would kill it |
| `forbidden[]` | the immutable kernel modules, restated on every hypothesis |

An unfalsifiable claim is not a hypothesis, and `formHypothesis` refuses a pattern with
no failures: there is nothing to improve.

## 4. Reflection

`reflect({ observations })` returns a `Reflection` record: the window it read, the
evidence ids, the patterns it found, the hypotheses it formed and the proposals that
followed. It is a pure function of its input, so anyone holding the ledger can recompute
it and get the same ids. A reflection has `scope: 'self'` and `authority: 'none'` — it is
a statement about the system's own calls, not about the world.

## 5. Knowledge, with a lifecycle

`KnowledgeStore` holds beliefs, not facts. Every entry carries `claim`, `tier`, `source`,
`confidence_bp`, `evidence[]`, `created_by`, `created`, `last_verified`, `dependencies[]`
and `invalidated_by`.

| Rule | Enforced by |
| --- | --- |
| nothing is verified without evidence | `verify()` → `OMEGA_E_UNPROVEN` |
| a belief cannot be resurrected | `verify()` on an invalidated entry → `OMEGA_E_KNOWLEDGE_INVALIDATED` |
| a contradicted belief is invalidated, and everything resting on it goes `STALE` | `invalidate()` |
| a claim that rests on nothing is refused | a dependency on an unknown id → `OMEGA_E_KNOWLEDGE_UNKNOWN` |
| knowledge never holds credentials | credential-shaped claims → `OMEGA_E_SECRET_LITERAL` |

The five epistemic states are `OBSERVED → INFERRED → HYPOTHESIZED → PREDICTED →
VERIFIED`, with one forbidden move — `HYPOTHESIZED → VERIFIED` without evidence — and
`promoteClaim()` enforces it. The system may be wrong; it may not be unaccountable.

## 6. Benchmarking: improvement as a measurement

A `BenchmarkSuite` is a fixed list of tasks across nine categories (`coding`,
`filesystem-analysis`, `mcp`, `planning`, `reasoning`, `memory-retrieval`,
`tool-selection`, `recovery`, `security`). Each task declares the verdict it expects and
the ceilings it must stay under.

`assertReproducible({ suite, run })` runs the suite twice and **refuses a suite whose own
results move** (`OMEGA_E_BENCHMARK_NONDETERMINISTIC`). `compareRuns(baseline, candidate)`
reports `improvements`, `regressions` and integer deltas; a task the baseline passed and
the candidate fails is a regression whatever the aggregate says
(`OMEGA_E_BENCHMARK_REGRESSION`).

## 7. Replay

A `ReplayPlan` is the decision skeleton of a transcript — one entry per gated call:
`step`, `resource`, `action`, `decision`, `code`, `gate`. No payloads, no arguments, no
values, no secrets. It is content-addressed, so **determinism is inspectable**: the same
module and the same inputs must produce the same plan id.

```js
const before = planReplay(firstRun.records);
const after  = planReplay(secondRun.records);
diffReplay(before, after);      // { ok: true, mismatches: [] }
```

A mismatch is `OMEGA_E_REPLAY_MISMATCH`: the runtime decided differently on the same
input. For the kernel that is a correctness failure; for a candidate under the gate it is
evidence against promotion.

## 8. What this layer cannot do

```text
learner.apply()                      → OMEGA_E_LEARNER_AUTHORITY
new OmegaError('OMEGA_E_…')          → must be a registered code (tests/omega-invariants.test.js)
an offer to skip replay or benchmark → proposal.requires cannot be edited into a shortcut
a proposal that names the kernel     → OMEGA_E_HYPOTHESIS, and the gate would refuse it anyway
```

`packages/learning` imports no `node:` builtin, opens no session, runs no mission, and
writes nothing. It reads records and returns data. That is the whole of its power, and it
is deliberately the whole of its power.
