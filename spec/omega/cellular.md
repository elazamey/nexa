# NEXA Ω∞ — the Cellular Layer

> **A cell composes; it does not authorize.**
> NEXA Ω v1 made authority and evidence *grammar*. Ω∞ makes them *structure*: the unit of
> composition is a cell, and nothing composes by importing anything.

This document describes what is implemented in `packages/cell/` and
`packages/cellular-evolution/`. It is written against the code, not ahead of it: every
mechanism named here has a file, a test and a refusal code.

## 1. Why a layer, and why above

The Ω foundations — compiler, runtime, capability authority, evidence ledger, Evolution
Gate — already answer *"may this call happen?"* and *"what is the proof?"*. What they did
not answer is *"what is the thing that calls?"*.

The cellular layer answers that without adding a new kind of authority:

- the **cell** is the unit of composition, with a nucleus, a membrane and a lifecycle;
- composition is **recursive** — Cell → Tissue → Organ → Organism — and an organ is usable
  as a cell at the next level;
- no cell ever *holds* authority: it holds a **port** that can verify, never mint.

Nothing in the Ω foundations changed. The six kernel modules stay immutable, and the
cellular layer is not part of them: it is a composition layer that can only ask.

## 2. Cell anatomy

| Part | What it is | Where |
| --- | --- | --- |
| **Identity** | a NEXA-ID key pair created by the host; a cell never creates its own | `packages/identity`, `createCell({identity})` |
| **Nucleus** | module + version + the invariants it may not change; frozen | `packages/cell/src/cell.js` `validateNucleus` |
| **Membrane** | the only way in: seven checks, in order | `packages/cell/src/membrane.js` |
| **Receptors** | named entry points with `accepts` (payload keys) and `requires` (audience) | `createCell({receptors})` |
| **Ports** | `{ verify, record }` — verification and evidence, never minting | `packages/cell/src/tissue.js` |
| **Local memory** | digests and references, never values | `createCell({memory})` |
| **Capabilities** | what a caller must present; a cell can only `propose()` | `packages/cell/src/guarantor.js` |
| **Policy** | per-receptor audience rules, evaluated at the membrane | `membrane.js` step 4 |
| **Budget** | `max_payload_bytes`, `max_calls`, `max_failures` | `membrane.js` step 5, `health.js` |
| **Health** | calls, failures, latency, breaker state — integers only | `packages/cell/src/health.js` |
| **Lifecycle** | six states with a closed transition set | `packages/cell/src/lifecycle.js` |
| **Evidence** | every crossing, allowed or refused, as a ledger record | `guarantor.record()` |
| **Version** | the nucleus' module/version; changes are new versions, never edits | `cell.version()` |

## 3. The message path

```text
Cell A → Membrane → Identity → Capability → Type/Schema → Policy → Budget → Execution → Evidence → Cell B
```

The membrane crosses seven steps, and the order is the guarantee (`MEMBRANE_STEPS`):

| # | Step | Refuses with |
| --- | --- | --- |
| 1 | **identity** — sender, sender key id, receptor, lifecycle state | `OMEGA_E_MEMBRANE`, `OMEGA_E_IDENTITY`, `OMEGA_E_RECEPTOR`, `OMEGA_E_ISOLATED` |
| 2 | **capability** — verified by the port, presenter-bound, single use | `OMEGA_E_CAP_MISSING`, `NEXA_E_CAP_AUDIENCE`, `NEXA_E_SIG`, `NEXA_E_UNTRUSTED`, `NEXA_E_REPLAY` |
| 3 | **type** — the payload must be canonical and only the keys `accepts` names | `OMEGA_E_SCHEMA` |
| 4 | **policy** — audience requirements | `OMEGA_E_POLICY` |
| 5 | **budget** — call ceiling and payload size | `OMEGA_E_BUDGET` |
| 6 | **execution** — the receptor runs; a throw is a refusal, never a crash | the thrown code, else `OMEGA_E_HANDLER` |
| 7 | **evidence** — the decision and the payload *digest* are recorded | — (`CELL_MESSAGE` record) |

A receptor returns a value or throws a registered Ω error. There is no third option and no
partial success.

Two properties are worth stating plainly:

- **A refusal is recorded.** The membrane records its own refusals inside the refusal path,
  so a denial cannot be lost by forgetting to log it somewhere else.
- **A payload never enters the transcript.** The record carries
  `payload_digest: sha256:…` and `bytes`, not the payload.

## 4. The nucleus, and what is not a cell

A nucleus is `{ module, invariants }`, validated on construction, `Object.freeze`d, and
never written to by any method of the cell. A nucleus whose module is one of the six kernel
modules is refused outright:

```js
createCell({ nucleus: { module: 'capability-authority@1' } });
// OMEGA_E_KERNEL_IMMUTABLE
```

The kernel is not a cell. It cannot be composed, divided, fused or evolved — that is the
mechanical meaning of "off the self-modifying surface", and the adversarial suite attacks
exactly that (`wrap-the-kernel-in-a-cell`).

## 5. Authority: `Cell → Proposal → Authority → Policy → Execution`

A cell has no `issue`, no `mint`, and no authority object. What it has is:

```js
planner.propose({ to: 'coder', receptor: 'implement', payload: { steps: ['x'] } });
// { kind: 'CellProposal', from, to, receptor, payload } — inert: it carries no token
```

The **guarantor** is the tissue's connection to the operator's `Authority`. The tissue
creates it, keeps it, and never hands it to a cell. Two rules give it teeth:

1. **Routes are declared before traffic.** The grant set is built from the contract and
   sealed on the first issue; a route added afterwards is `OMEGA_E_ROUTE`, because widening
   the topology at run time is privilege escalation.
2. **One call, one capability.** Each token is presenter-bound and single-use. Presenting it
   twice is `NEXA_E_REPLAY`; presenting one minted for another cell is
   `NEXA_E_CAP_AUDIENCE`; a token from an authority the receiver does not trust is
   `NEXA_E_UNTRUSTED` (verification fails closed — an empty trust list trusts nobody).

## 6. Tissue — cells plus a contract

A tissue is a topology: who talks to whom, on which receptor, for how long and how often.
The contract *is* the grant set, so a message the contract does not name has no capability
to travel on and is refused twice over — by the tissue (`OMEGA_E_ROUTE`, nothing minted) and
by the destination membrane (no valid token).

`entryPoints` are the receptors the outside may use. They build the **composite cell**:

```js
const tissue = createTissue({ name: 'coding', operator, cells, routes, entryPoints, clock });
tissue.asCell();   // a Cell that speaks for the contract — the recursion, made concrete
```

A tissue with no entry points cannot pretend to be a cell: `asCell()` refuses
(`OMEGA_E_ROUTE`), because a bubble without receptors is not addressable.

## 7. Organ — tissues plus a contract

An organ declares **cross-tissue** routes. Declaring one adds it to the *source* tissue's
contract, which is where the right to call actually lives: the destination learns nothing,
because receiving is not a right, it is a membrane decision.

Two rules:

- **One organ, one authority.** Every tissue of an organ must share one guarantor
  (`OMEGA_E_CELL_AMPLIFY` otherwise) — two guarantors would mean two grant sets and two
  answers to "may this call happen?".
- **An organ is a cell.** `organ.asCell()` returns a composite cell whose receptors are the
  organ's entry points; calling it goes back through a membrane like any other call.

## 8. Organism — organs plus homeostasis

An organism declares **cross-organ** routes and reads the system:

```js
organism.sample();              // { state, calls, failures, failure_rate_bp, isolated[], degraded[], evidence{…} }
organism.react();               // isolate what is unhealthy, and say why
organism.recover(isItHealthy);  // every isolated cell must pass its own check
organism.contract();            // the cross-organ topology, as data
```

`sample()` returns integers and lists, never prose: cells, calls, failures,
`failure_rate_bp`, the isolated and degraded names, and `evidence: { entries, continuous }`.
`continuous` is false when the evidence sequence has a hole, and a hole halts the system
(`SYSTEM_HALTED`). A broken transcript is not a warning.

## 9. Lifecycle

```text
DEFINED ──► READY ──► ACTIVE ⇄ DEGRADED
   │           │         │        │
   └───────────┴─────────┴────────┴──► RETIRED (terminal)
                ISOLATED ──► READY
```

| State | Serves traffic | Notes |
| --- | --- | --- |
| `DEFINED` | no | built, never activated |
| `READY` | no | activated, waiting for `activate()` |
| `ACTIVE` | yes | normal |
| `DEGRADED` | yes | the warning state: it keeps serving while the homeostat watches |
| `ISOLATED` | only `health`, `recover`, `retire` | containment; everything else is `OMEGA_E_ISOLATED` |
| `RETIRED` | no | terminal — `activate()` and `isolate()` both refuse |

An illegal transition is `OMEGA_E_LIFECYCLE`. **Recovery is a decision, not a timer**: only
`recover({ check })` with a check that returns `true` moves a cell from `ISOLATED` or
`DEGRADED` back to `ACTIVE`, and a retired cell is never "recovered" — reporting success for
a state change that never happened would make the recovery record lie.

## 10. Homeostasis

Homeostasis is not a second mechanism: `Health` wraps the circuit breaker the runtime
already owns, so the cell layer reads the same counters the Ω runtime acts on.

- **Signals:** consecutive failures, failure rate (basis points), latency, calls, breaker
  state, budgets, evidence continuity, capability refusals.
- **Flow:** `DEGRADED` → `ISOLATE` → fallback → recovery → **verify** → `ACTIVE`.
- **Thresholds** (`createHomeostat`): `max_consecutive_failures` (default 3) and
  `max_failure_rate_bp` (default 4000 = 40% after at least 3 calls).
- **Refusal:** a malformed policy is `OMEGA_E_HOMEOSTASIS`; a cell that fails its check stays
  isolated, and no timer brings it back.

The organ reports what it did, not what it hoped: `homeostat.enforce()` returns the reading,
the cells it isolated and the cells it degraded.

## 11. Cellular learning

Learning is decentralized and still evidence-first and gated:

```text
cell observes → local learning → hypothesis → publishes evidence
      → tissue aggregates → organ sees the pattern → organism learns
```

The learning layer reads the membrane's own records: a `CELL_MESSAGE` is a call with a
resource (the cell), an action (the receptor) and a decision, so a cell refusal is observable
exactly like a tool refusal (`packages/learning/src/observation.js`). Then, without
exception:

```text
Learning → Reflection → Proposal → Simulation → Attack → Verification → Benchmark → Canary → Activation
```

- The learner **proposes and never applies**; `learner.apply()` throws
  `OMEGA_E_LEARNER_AUTHORITY`.
- A hypothesis needs support (`min_support`, `min_failures`, `min_rate_bp`) and carries the
  evidence ids it was formed from; a promotion without evidence is `OMEGA_E_UNPROVEN`.
- A proposal carries `baseline`, `expected_change`, `confidence_bp` and the gates it
  requires (`replay → benchmark → adversarial → evolution-gate`). An improvement claim
  without a baseline is not an improvement.
- Knowledge entries move `HYPOTHESIZED → VERIFIED` only with evidence, and contradictory
  evidence **invalidates**: `OMEGA_E_EPISTEMIC`, `OMEGA_E_KNOWLEDGE_INVALIDATED`.

## 12. Cellular evolution: division and fusion

**Division** specializes a general cell (General → Plan / Code / Verify). Each child takes
only the capabilities it needs; asking for one the parent never had is
`OMEGA_E_CELL_AMPLIFY`. A child is a new nucleus (`childSpec`), never a parent edit.

**Fusion** never overwrites. `planFusion` runs
`Compatibility → Contract → Capability Analysis → State Migration → Sandbox → Security
Tests → Benchmark → Canary → new immutable version`:

- a receptor name defined by both parents is a **conflict**, not a merge;
- the fused cell may not hold authority neither parent held;
- `runFusion` requires the Evolution Gate's verdict: anything that is not a pass is
  `OMEGA_E_QUARANTINED`, and a regression or an incomplete canary stops it before release;
- the result names its parents and is immutable — the parents remain addressable.

**Quarantine is terminal.** `Quarantine.supersede()` records that a newer version replaced a
candidate; `release()` always throws `OMEGA_E_QUARANTINED`. A quarantined candidate is a
record, not a queue.

## 13. Evidence

Every crossing produces one `CELL_MESSAGE` record in the Ω ledger:

```js
{ kind: 'CELL_MESSAGE', decision: 'ALLOW'|'DENY', mission: '<cell>', resource: '<cell>',
  action: '<receptor>', capability: '<grant id>',
  detail: { from, step, code, reason, latency_ms, bytes, payload_digest } }
```

The record is hashed and signed by the operator identity behind the authority, so the
transcript is attributable and verifiable (`verifyOmegaChain`). Payloads appear by digest
only: a cell transcript cannot become a data-leak surface. Without a ledger, the guarantor's
in-memory journal is still content-addressed and shaped like the record it would have been,
so the learning layer reads the same fields either way.

## 14. Layout, and one deviation from the sketch

```text
packages/cell/src/nucleus-validated-by-cell.js  cell.js      identity · nucleus · receptors · budget · lifecycle
packages/cell/src/membrane.js                   membrane · the seven steps
packages/cell/src/lifecycle.js                  the six states and the allowed transitions
packages/cell/src/health.js                     counters + the runtime's circuit breaker
packages/cell/src/guarantor.js                  the tissue's authority port (verify + record)
packages/cell/src/tissue.js                     contract · entry points · composite cell
packages/cell/src/organ.js                      cross-tissue routes · one authority
packages/cell/src/organism.js                   cross-organ routes · sample · react · recover
packages/cell/src/homeostasis.js                thresholds · degrade · isolate · report
packages/cell/src/examples.js                   the sample organism the demo and tests run
packages/cellular-evolution/src/division.js     specialization, capability-checked
packages/cellular-evolution/src/fusion.js       the eight-stage fusion pipeline
packages/cellular-evolution/src/quarantine.js   terminal quarantine
```

The directive sketched `packages/{cell/{nucleus,membrane,receptor,ports,lifecycle,health,
metabolism}, tissue/{topology,routing,contracts}, organ/{coordinator,registry,contracts},
organism/{orchestration,system-state,homeostasis}}`. What was built is `packages/cell` plus
`packages/cellular-evolution`, with tissue / organ / organism as modules inside `cell`.

The deviation is deliberate and it is the smaller surface:

- **the receptor and the port are not objects.** A receptor is a `{ handler, accepts,
  requires }` entry in the cell that answers it; a port is `{ verify, record }` created once
  per guarantor. Giving either one its own directory would invent two more types for the
  same data.
- **tissue, organ and organism share one guarantor.** They are three scopes of the same
  decision — one contract per level — and splitting them into packages would have made the
  shared authority harder to see, not easier.
- **`metabolism` is `homeostasis` plus budgets.** Budgets are enforced at the membrane
  (step 5) and at the cell; homeostasis reads them. A separate metabolism module would have
  had nothing of its own to hold.

The package boundary that *is* real is the one that separates *composing* (`packages/cell`)
from *changing* (`packages/cellular-evolution`), because only the second one can propose a
new version.

## 15. What is not built

Stated so the layer is not read as more than it is:

- **no network transport** between cells: a cell is an in-process object today, and the MCP
  bridge across cells is designed, not implemented;
- **no durable storage**: the kernel's `FILESYSTEM_WRITE` gate is closed and the cellular
  layer does not reopen it — local memory is in-process and digest-only;
- **no Google service cells yet**: identity, Drive, Sheets, Gmail, Calendar and Gemini are
  designed (G0–G4) and not implemented; nothing in this layer contacts a network;
- **no automatic self-repair**: homeostasis detects, isolates and reports; repair is a
  proposal that goes through the gate like every other change.

## 16. Invariants, and how they are checked

| Invariant | Checked by |
| --- | --- |
| the membrane crosses exactly seven steps, in order | `tools/check-posture.mjs`, `tests/cellular.test.js` Ω/C1, C7, C9, C21 |
| a cell cannot mint, and no cell holds an authority | `tools/check-posture.mjs`, `tests/omega-invariants.test.js` Ω/I8, Ω/C13 |
| routes are declared before traffic | Ω/C2, Ω/C21, attack `call-across-an-undeclared-route` |
| a capability is single-use and presenter-bound | Ω/C3, Ω/C4, attacks `replay-a-spent-capability`, `present-another-cells-capability` |
| an untrusted issuer is refused | Ω/C6, attack `forge-a-cell-capability` |
| the nucleus is immutable, the kernel is not a cell | Ω/C12, attack `wrap-the-kernel-in-a-cell` |
| a degraded cell serves, an isolated one does not | Ω/C11, attack `keep-serving-while-isolated` |
| division and fusion cannot widen authority | Ω/C17, Ω/C18, attacks `widen-authority-by-dividing`, `fuse-into-a-conflict` |
| quarantine is terminal | Ω/C18b |
| every crossing is evidence | Ω/C16, Ω/C16b, `tools/cellular-demo.mjs` §3 |
| a cell refusal is observable to the learning layer | Ω/C22 |
| the organism reports the truth | Ω/C19, Ω/C20 |

Measured posture (`npm run verify`): **23 adversarial attacks across 11 categories, all
blocked · 207 tests · 72 registered Ω error codes · 7 membrane steps · 6 lifecycle states ·
0 runtime dependencies.**
