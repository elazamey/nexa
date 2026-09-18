# Ω — evidence

The kernel records *decisions*. Ω records **reasoning**: what was claimed, what was
observed, what counts as proof, and what verdict the mission reached. The two are
separate on purpose — a mission's opinion can never overwrite a kernel's decision.

## Four words, four record kinds

| Kind | Written when | Trust | Can it prove anything? |
| --- | --- | --- | --- |
| `CLAIM` | the program asserts something is true | none | no: a claim is a *sentence*, not a fact |
| `OBSERVATION` | `observe <key>` reads the world model | observed | no: an observation is context, not proof |
| `EVIDENCE` | `evidence claim "c" from x` where `x` is verified | verified | **yes** |
| `VERDICT` | the mission ends (or fails) | derived | yes: it is hash-linked to the evidence it cites |

```nexa
require evidence "repository inspected"     # a contract: what must be true to succeed

observe project                                            # OBSERVATION
let repo: UntrustedData = github.repository.read(…)        # TOOL_RESULT (untrusted)
let clean: VerifiedData = untaint repo as VerifiedData via sanitizer.redact(text: "ok")
evidence claim "repository inspected" from clean           # EVIDENCE
emit clean                                                 # MISSION_END
```

`evidence claim … from x` is the only way to create evidence, and it requires `x` to have
the `verified` trust attribute. That single rule is the difference between

```text
"I think it worked"   →   a CLAIM record, which proves nothing
```

and

```text
"I can show it worked" →  an EVIDENCE record whose value hash, instrument, capability
                          id and kernel receipt are in the chain
```

A mission that ends without its declared evidence gets `OMEGA_E_CONTRACT_UNMET` and a
`VERDICT` of `DENY`. There is no path from a claim to a pass.

## The Ω ledger

Each record is:

```text
{ nexa: "omega1", seq, ts, kind, decision, actor, mission, step,
  subject?, resource?, action?, capability?, claim?, trust?, detail?,
  prev, hash, sig }
```

* `hash = sha256("NEXA/omega1 evidence record\0" ‖ C14N(record \ {hash, sig}))`
* `prev` chains to the previous record, `GENESIS` at seq 0 (same construction as the
  kernel's evidence chain, different domain separator, so the two chains can never be
  confused for one another).
* `sig` is an Ed25519 signature by `actor` over the same bytes, so a single record is
  verifiable out of context and a whole ledger is verifiable in order with
  `verifyOmegaChain(records, { expectActor })`.

Kinds emitted by the mission machine:

```text
MISSION_START  PLAN      OBSERVATION  MEMORY_WRITE  MEMORY_READ  RECALL
TOOL_CALL      TOOL_RESULT  GATE_REFUSAL  CIRCUIT_OPEN  DECLASSIFY  SEAL
CLAIM          EVIDENCE  ASSERT  CONTRACT_UNMET  VERDICT  MISSION_END
PROPOSAL       GATE  CANARY  ACTIVATION  ROLLBACK  QUARANTINE
```

`TOOL_RESULT` embeds the kernel's answer — `decision`, `NEXA_E_*` code where refused, the
kernel record hash and the receipt id — so the Ω transcript points at kernel truth rather
than restating it. A `GATE_REFUSAL` names the gate (`FILESYSTEM_WRITE`, `REAL_EXECUTION`,
…) exactly as the kernel reported it. Ω never rewrites, softens or retries a gate refusal
into something else; the mission fails and the failure is provable.

## Memory is not evidence

`remember x as episodic` writes a hash of the value, the mission, the step and the tier.
Memory tiers are `working`, `episodic`, `semantic`, `procedural`, `meta`, `evolution`.
Two rules make the memory safe to learn from:

1. `remember` is a sink: only public values can be remembered (no secret ever enters
   memory, so no memory dump can leak one).
2. `recall` returns a `MemoryRef` — a handle, not a value. Memory therefore cannot be
   laundered into evidence, and it cannot be used as an argument: it is context for a
   planner, not data for a tool.

A lesson learned in one mission is visible to the next (`MemoryRef` counts and digests)
and can *propose* a change; it cannot grant one. That is the boundary between §12 and §27
of the design, enforced by types instead of by convention.

## Receipts

Kernel receipts travel with the Ω record that cites them. `matchReceiptToRecord(receipt,
record)` still binds a receipt to its log entry, so an Ω transcript claiming a tool call
that the kernel never decided is detectable by anyone holding the kernel's chain — the
two ledgers have to agree.

## Transcribing a mission

```text
seq  kind            decision  detail
 0   MISSION_START   INFO      mission "review", agent "architect", module hash
 1   PLAN            INFO      steps ["observe","repositories","flag","risks","emit"]
 2   OBSERVATION     INFO      key "project", world digest
 3   TOOL_CALL       INFO      resource "mcp:github.repository.read", capability urn:nexa:cap:…
 4   TOOL_RESULT     ALLOW     kernel record sha256:…, receipt urn:nexa:msg:…
 5   DECLASSIFY      INFO      untrusted+public → verified via sanitizer.redact
 6   EVIDENCE        ALLOW     claim "repository inspected", value sha256:…
 7   MEMORY_WRITE    INFO      tier "episodic", value sha256:…
 8   VERDICT         ALLOW     contracts satisfied: 1/1
```

`nexa run` prints exactly this, and `verifyOmegaChain` re-derives every hash and
signature in it.
