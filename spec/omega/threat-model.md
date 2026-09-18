# NEXA Ω — Threat Model

> No system is unbreakable. This document does not claim otherwise.
> It states what NEXA defends against, what it contains, what it cannot see, and how each
> claim is *checked* rather than asserted.

The working loop is the one in the design: **minimize attack surface → contain failure →
detect → prove → roll back → learn.** Everything below is written against that loop.

## 1. Assets

| Asset | Why it matters | Where it lives |
| --- | --- | --- |
| **Authority** (the ability to cause an effect) | the only thing worth stealing | capability tokens, `packages/runtime/src/authority.js` |
| **Credentials** | they turn a contained failure into a breach | the vault; modules hold `vault://` handles |
| **Evidence** | a decision nobody can audit is a decision nobody can trust | the Ω ledger + kernel chain, hash-linked and signed |
| **The kernel** | if it can be changed at run time, nothing else matters | `KERNEL_MODULES`, immutable by construction |
| **Versions** | a silently replaced module is a supply-chain attack | signed manifests, immutable registry |

## 2. Adversaries

| Adversary | Capability assumed | Primary defences |
| --- | --- | --- |
| A **malicious module** | can be any `.nexa` source | types, allow-lists, grants, closed gates, receipts |
| A **compromised agent** | holds a valid identity and a valid capability | capability scope, TTL, single-use tokens, subject binding, budgets |
| A **compromised provider** | returns hostile text and tries to echo credentials | `accepts_secret`, egress refusal, untrusted-by-default typing |
| A **hostile evolution candidate** | is signed, plausible, and improves the metrics it was asked to | monotone authority, adversarial stage, canary, quarantine, rollback |
| A **forged or replayed message** | can copy any bytes off the wire | signatures, nonces, replay sets, chain verification |
| A **buggy or unlucky operator** | is not an attacker, and does the most damage | compile-time refusals, default-deny, evidence for every step |

Out of scope, and stated so plainly: a compromised **host** (kernel-level attacker), a
compromised **signing key** (key custody is the deployment's problem), **side channels**
(timing, power) and **denial of service** beyond the budgets and the circuit breaker.

## 3. The attack suite, and what it proves

`tools/omega-attacks.mjs` runs twenty-three attacks across eleven categories. `node
tools/omega-attacks.mjs` must report `23/23 attacks blocked`; `tests/omega-security.test.js`
fails the build if any attack succeeds, if a category is missing, or if the suite shrinks.
The Evolution Gate runs the same suite as its `adversarial` stage and **re-counts the
reports itself**, so a candidate cannot pass by asserting that it passed.

| # | Category | Attack | Refusal |
| --- | --- | --- | --- |
| 1 | capability-escalation | an agent calls outside its allow-list | `OMEGA_E_CAP_MISSING` |
| 2 | secret-exfiltration | a loaded secret is emitted | `OMEGA_E_SECRET_EGRESS` |
| 3 | secret-exfiltration | a credential is attached to an adapter that does not accept one; an accepting adapter echoes it back | `OMEGA_E_SECRET_EGRESS` |
| 4 | replay | a valid signed envelope is delivered twice | `NEXA_E_REPLAY` |
| 5 | tampering | one field of a sealed record is edited | `OMEGA_E_CHAIN_BROKEN` |
| 6 | invalid-signature | a manifest signed by an untrusted identity | `OMEGA_E_NOT_ACTIVATOR` (REFUSED) |
| 7 | invalid-signature | a manifest field edited after signing | `OMEGA_E_SIGNATURE` (REFUSED) |
| 8 | scope-widening | a candidate adds `fs:*!write` | `OMEGA_E_GATE_STAGE` (monotone authority) |
| 9 | resource-exhaustion | a mission spends more steps than its policy allows | `OMEGA_E_BUDGET` |
| 10 | resource-exhaustion | a tool that always fails | `OMEGA_E_CIRCUIT_OPEN` |
| 11 | policy-bypass | a well-typed module writes to a closed gate anyway | `NEXA_E_GATE` |
| 12 | tool-confusion | two instruments claim one resource | `OMEGA_E_DUPLICATE` |
| 13 | untrusted-to-evidence | a tool result is promoted to evidence | `OMEGA_E_EVIDENCE_UNTRUSTED` |

### Findings this suite produced

An adversarial suite that has never found anything is decoration. This one found three
defects, each fixed and each pinned by a test:

1. **The step budget was never enforced.** The IR emitted `maxSteps` while the machine
   read `max_steps`, so `max_steps` parsed, compiled, and was ignored. Fixed by
   normalising the IR to snake_case (`Ω/C4`) and by the attack itself (`Ω/S2`).
2. **Every `if` was broken end to end.** The analyser replaced the condition *expression*
   with its type attributes, so a conditional compiled and then died mid-mission with
   `OMEGA_E_SCHEMA: unknown expression kind`. Fixed (`Ω/R6b`), and the lowering now
   refuses to emit an IR containing a hole (`findUnlowered`).
3. **A quarantined candidate could be activated.** `activate()` counted samples instead of
   *clean* samples and never checked the quarantine state, so a candidate that violated
   its own declared expectations could still be promoted. Fixed: `OMEGA_E_QUARANTINED`,
   and only clean observations count (`Ω/E11`).

## 4. Trust boundaries

```text
 untrusted        .nexa source ──► compiler (pure) ──► typed IR ──► manifest (signed)
 trusted-but-     runtime ──► authority ──► capability token ──► kernel endpoint
 verified         kernel ──► gate → policy → handler ──► receipt ──► evidence chain
 host-only        vault · clock · instruments · provider adapters · activation keys
```

Every arrow crossing a boundary carries a signature or an evidence record. Nothing leans
on the *caller's* account of what happened: the runtime records what the kernel decided,
the ledger covers its own records with `prev`, and the learning layer reads records rather
than the runtime's memory.

## 5. Standing properties (each one checked in CI)

| Property | Checked by |
| --- | --- |
| every refusal carries a registered code | `Ω/I1`, `Ω/I2` |
| the compiler reads no clock and no randomness | `Ω/I3`, posture |
| only the authority mints capabilities | `Ω/I3`, posture |
| packages and adapters hold no ambient authority (`fs`, `child_process`, `process.env`) | `Ω/I6`, posture |
| the kernel is a closed list of six immutable modules | `Ω/I4`, `Ω/E5` |
| the Evolution Gate has eight stages and a missing stage fails | `Ω/E3` |
| every attack category is attempted and blocked | `Ω/S1`, `Ω/S4` |
| secrets never reach a record, a receipt, a result or a prompt | `Ω/R7`, `Ω/S2` |
| a transcript chain verifies, and one edit breaks it | `Ω/R2`, `Ω/S2` |
| a quarantined candidate cannot be activated | `Ω/E11` |
| the learning layer cannot apply anything | `Ω/L6`, `Ω/I8` |
| the spec, the threat model and the examples ship with the code | `Ω/I7` |

## 6. Residual risk, stated honestly

* **The planner port is injected.** A model behind it can propose a plan that is
  well-typed and still wrong. The defence is not correctness — it is that a wrong plan
  still cannot exceed its authority, and that its steps are recorded.
* **The gate is only as good as its checks.** A stage that reports `PASS` because a
  script always reports `PASS` is a hole; the mitigations are that stages are enumerated
  (a missing one fails), that authority monotonicity and adversarial results are re-derived
  by the gate rather than trusted, and that the whole pipeline is re-runnable from the
  ledger.
* **Replay proves determinism, not correctness.** A run that decides the same wrong thing
  twice replays cleanly.
* **Side channels and host compromise remain open**, as stated in § 2. NEXA narrows what
  a compromised component can *do*; it does not make a compromised host safe, and it does
  not claim to.
