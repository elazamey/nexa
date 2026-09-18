# Ω — evolution

The dangerous version of a self-improving system is a loop:

```text
AI → modifies itself → restarts → new AI with new authority
```

Ω has no such loop. What it has is a **proposal pipeline** whose every stage is a
deterministic check that can only say no, and whose final stage is a human-scale act
(`activate`) rather than a side effect.

```text
OBSERVE → MEMORIZE → REFLECT → HYPOTHESIZE → DESIGN → SIMULATE → BUILD → TEST →
VERIFY → BENCHMARK → SIGN → CANARY → ACTIVATE → OBSERVE AGAIN
```

## A proposal is data

```nexa
evolve planner {
    from "planner@4"
    to   "planner@5"
    hypothesis "reducing unnecessary replanning lowers iterations without lowering success"
    expect "success_rate" >= 96
    expect "security_findings" == 0
}
```

Compiling this produces an **evolution proposal**: the module hash it came from, the
parent version, the candidate version, the hypothesis, and the machine-checkable
expectations. Nothing runs. Nothing is replaced. The proposal is inert until the gate has
finished with it.

## Immutable versions

```text
planner@4  stable      ← active
planner@5  candidate   ← proposed, signed, quarantined until proven
planner@6  rejected    ← kept, with the reason
```

A version is a **manifest**, and a manifest is proof-carrying:

```text
module planner@5
  source_hash   sha256(module source)
  ir_hash       sha256(canonical IR)          ← what actually executes
  capabilities  ["memory.read", "model.invoke"]
  checks        { compile, types, capabilities, security, adversarial, regression, benchmark, policy }
  parent        planner@4
  evolver       nexa:key:ed25519:z…
  signature     ed25519 over C14N(manifest \ {signature})
```

The loader accepts a manifest only if every field verifies. `VALID → LOAD`;
`INVALID → REJECT`, with no partial load and no "trust me" path.

## The Evolution Gate

Eight stages, in a fixed order, each of which can only fail:

| # | Stage | Passes when |
| --- | --- | --- |
| 1 | `compile` | the candidate parses and lowers to a versioned IR |
| 2 | `types` | the security type system accepts every sink |
| 3 | `capabilities` | no capability the parent did not have is *added* (authority is monotone) |
| 4 | `security` | the module carries no secret-egress or authority gap the analyser can see |
| 5 | `adversarial` | every attack in the suite is blocked, in every category — **re-counted by the gate, not taken on trust** |
| 6 | `regression` | previously proven behaviour still holds |
| 7 | `benchmark` | every declared expectation is met, with the measured value appended |
| 8 | `policy` | the module's own `policy` blocks and the deployment policy agree |

### The adversarial stage

`tools/omega-attacks.mjs` attempts thirty-one attacks across twelve categories
(`capability-escalation`, `secret-exfiltration`, `replay`, `tampering`,
`invalid-signature`, `scope-widening`, `resource-exhaustion`, `policy-bypass`,
`tool-confusion`, `untrusted-to-evidence`, `kernel-self-modification`, `identity-forgery`)
against the real compiler, the real runtime, the real registry and the Google organ. The
twelfth category is the only one whose attacker begins **outside** the system: the other
eleven assume someone already inside, while `identity-forgery` begins with a token a
provider would have signed. `summarizeAttacks()` then re-derives the verdict from the *reports*:
fewer attacks than categories, a missing category, or a single unblocked attack fails the
stage. An attack that throws something the system does not model counts as a failure, not
as a pass — an unhandled crash is a finding.

A refusal is not a failed candidate: `OMEGA_E_SIGNATURE`, `OMEGA_E_NOT_ACTIVATOR`,
`OMEGA_E_KERNEL_IMMUTABLE` and `OMEGA_E_MANIFEST` **REFUSE** — the candidate never reaches
stage evaluation, and cannot be rescued by a canary.

```text
CANDIDATE → static analysis → type checking → security tests → behavioural tests →
replay benchmark → regression check → DETERMINISTIC GATE
                                        ├── FAIL → QUARANTINE (+ reason, signed)
                                        └── PASS → CANARY → OBSERVE → ACTIVATE
```

Mechanics that matter:

* The gate is **deterministic**: it takes `(candidate, parent, checks, now)` and nothing
  else — no clock of its own, no randomness, no network. The same inputs produce the same
  verdict, byte for byte, forever. A gate whose answer depends on the weather is not a
  gate.
* A **missing stage is a failed stage** (`OMEGA_E_GATE_STAGE`). Absence of evidence is
  not evidence of absence of risk — the reverse of the usual default.
* **Kernel targets are refused outright** (`OMEGA_E_KERNEL_IMMUTABLE`). The kernel, the
  verifier, the policy engine and the capability authority are not evolvable, by anyone,
  under any manifest. This is checked before any other stage, so a proposal that names
  the kernel does not even get a verdict.
* **Authority is monotone**: a candidate may not add capabilities. A cleverer planner
  does not thereby become a more powerful one.

## Canary, activation, rollback

A passing candidate enters a canary window:

```text
canary(planner@5)
  observe(iterations=0, success_rate=100, security_findings=0)  → 1/2 clean
  observe(iterations=0, success_rate=98,  security_findings=0)  → 2/2 clean
  activate()                                                    → planner@5 active, planner@4 retained
```

* `observe(sample)` accepts measurements. A sample that violates an expectation, or a
  sample reported by anyone other than the approving authority, sends the candidate back
  to quarantine — `rollback(reason)` restores the parent and records both moves.
* `activate()` refuses until the required number of clean samples exists
  (`OMEGA_E_CANARY_INCOMPLETE`). There is no `--force`.
* Rollback is always available and always recorded: `planner@5 → quarantine`,
  `planner@4 → active`. The previous version was never deleted, so rollback is a pointer
  move rather than a restore.
* Activation is an explicit call by an identity in the registry's `activators` allowlist.
  A program cannot activate itself: `evolve` compiles to a proposal, and proposals are not
  capabilities.
* **A quarantine is not a warning.** `activate()` counts only *clean* canary observations
  and refuses a candidate in `quarantined` (`OMEGA_E_QUARANTINED`). Before this rule, a
  candidate that violated its own declared expectation could still be promoted once it had
  enough samples of any kind.

## What the loop cannot do

| Attempt | Result |
| --- | --- |
| `evolve kernel { … }` | `OMEGA_E_KERNEL_IMMUTABLE`, before any stage runs |
| a candidate that adds `fs.write` | stage 3 fails: capabilities are monotone |
| an unsigned or tampered manifest | `OMEGA_E_MANIFEST` / signature verification fails |
| activate without observations | `OMEGA_E_CANARY_INCOMPLETE` |
| activate as an agent identity | refused: not in `activators` |
| make a passing candidate the active version silently | impossible: `activate()` is an explicit call whose result is recorded |
| teach the system a bad lesson | the lesson is memory (public, hashed, tiered) and a proposal — never authority |

## Relationship to the running system

The active version is a *pointer in a registry*, not a mutated process. Ω never patches
itself in place; it proposes, proves, canaries and (on an explicit call) switches. That is
the whole difference between self-modifying and self-authorizing.
