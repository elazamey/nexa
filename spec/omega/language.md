# Ω — the language

A `.nexa` file is a **module**. It declares intent (`mission`), authority (`agent`,
`grant`, `policy`), reach (`instrument`, `mcp`) and growth (`evolve`). It contains no
addresses, no secrets, no escape hatches and no way to execute anything: the compiled
module is data until a runtime decides, step by step, that each step is allowed.

## The three nested layers

| Layer | Written by | Appears as | Example |
| --- | --- | --- | --- |
| **Ω Script** | developers | `mission` bodies: `let`, `do`, `if`, `emit` | `do echo.call(text: "hi") as echoed` |
| **Ω Intent** | agents / operators | `mission` goals + `plan` steps + `evolve` proposals | `plan { analyze implement test verify }` |
| **Ω Policy** | whoever owns the authority | `policy`, `agent`, `grant` blocks | `deny fs.write("/**")` |

All three are one grammar. That is the point: a program cannot express an intention that
skips the governance, because the governance sits between the intention and the kernel.

## Declarations

```nexa
nexa omega 1

policy project { … }         # default-deny rules, limits, secret egress policy
agent coder { … }            # a named actor with an explicit capref allow-list
mcp github { … }             # an MCP server and the tools it may expose
instrument echo { … }        # a local tool bound to a kernel resource id
grant fs.read { … }          # what the authority will mint, and for how long
mission review { … }         # the executable unit of intent
evolve planner { … }         # a proposal: from → to, hypothesis, expectations
```

Every declaration is checked before anything runs. Unknown names, missing caps,
unprovable scope coverage and type errors are compile-time failures — a module that
cannot be proven is a module that is never loaded (rule 23 of the design:
*proof-carrying*).

## Missions

```nexa
mission review {
    goal "Review a repository and report"
    agent architect

    plan { observe repositories flag risks emit }

    require capability github.repository.read
    require evidence "repository inspected"

    observe project
    let repo: UntrustedData = github.repository.read(owner: "elazamey", repo: "nexa")
    let clean: VerifiedData = untaint repo as VerifiedData via sanitizer.redact(text: "ok")
    evidence claim "repository inspected" from clean
    remember clean as episodic
    emit clean
}
```

* `goal` — the human sentence. It is recorded, never parsed for behaviour.
* `plan` — declared steps. A plan is *intent*: the runtime walks the statements, and an
  injected planner port may annotate or refuse the plan (never widen authority).
* `require capability` — a precondition. At compile time the capref must resolve to a
  known instrument/namespace **and** be covered by the acting agent's `allow` list. At
  run time the authority must be able to mint it; if it cannot, the mission does not
  start.
* `require evidence "…"` — a contract. The mission cannot report success unless an
  `EVIDENCE` record carrying that claim exists. Unmet contract → `OMEGA_E_CONTRACT_UNMET`
  with a signed record, never a silent pass.

## Statements

| Statement | Effect | Sink rules |
| --- | --- | --- |
| `let x [: T] = e` | bind an immutable name | `e` must be assignable to `T` |
| `set x = e` | rebind an existing name | same type attributes |
| `do call as x` | capability-gated call | arguments must be public (or the instrument declares `accepts_secret`) |
| `observe k` | read the world model at key `k` | records an `OBSERVATION`, binds nothing |
| `remember x as tier` | write to memory tier | must be public · never authority |
| `recall tier as x` | bind a memory *reference* | contents are not program-visible |
| `untaint x as T via s` | declassification | requires a `trust verified` sanitizer + a grant · recorded |
| `seal x` | mark a value as sealed | may only be passed to `accepts_secret` instruments |
| `assert x is T` / `assert a == b` | runtime contract | failure → DENY with evidence |
| `evidence claim "c" from x` | promote a verified value to evidence | `x` must be verified |
| `emit e` | the mission's result | must be public · at most one `emit` |
| `if e { … } else { … }` | deterministic branch | condition may be secret; a secret branch body is still a sink-checked body |
| `fail "reason"` | explicit refusal | recorded as a DENY |
| `require capability` / `require evidence` | preconditions / contracts | see above |

There is no `while`, no recursion, no I/O, no import, no reflection and no evaluation of
strings as code. A mission is a straight-line program with one branch statement: every
run is bounded, replayable and diffable.

## Execution model

```text
parse ──► analyze ──► lower to IR ──► (signed manifest) ──► run
   ▲                                                    │
   └────────────── diagnostics (OMEGA_E_*, OMEGA_W_*) ───┘
```

1. **Parse** — one error, with line/column, never a partial module.
2. **Analyze** — resolve caprefs to `(resource pattern, actions)`; check the acting
   agent covers each call site; check type flow into every sink; collect contracts.
3. **Lower to IR** — a canonical, versioned, hashable tree. `irHash` is what a manifest
   commits to (rule 23), so "the same source" is a provable statement.
4. **Run** — the mission machine walks the IR. Each step produces an Ω evidence record.
   Each call goes: capref → authority → capability token → kernel envelope → kernel
   decision → recorded result.

### Determinism

The compiler is pure: no clock, no randomness, no I/O. Compiling the same module twice
produces byte-identical IR and the same hash, which is why `nexa compile` output can be
committed as a pinned vector. The runtime takes its clock, memory, world and provider
ports as injected dependencies; the only nondeterminism in a run is the kernel's own
envelope id/nonce, which is exactly what makes each run individually provable.

### The planner port

`agent coder { model provider.auto }` is a declaration, not a network call. A runtime may
be given a `planner` port; it receives the mission's IR, the current memory references
and the world observation, and returns `{ steps }` or `{ refuse: "reason" }`. It cannot
return capabilities, cannot introduce new caprefs, and a `refuse` is recorded and ends
the mission. Without a planner the runtime walks the declared plan. A backend model is
therefore an *optional* port behind a stable interface, never a hole in the language.

## Refusals

| Code | Meaning |
| --- | --- |
| `OMEGA_E_PARSE` | the source is not in the grammar |
| `OMEGA_E_UNKNOWN_INSTRUMENT` | a capref or call names something not declared |
| `OMEGA_E_CAP_MISSING` | the acting agent does not allow this call |
| `OMEGA_E_TYPE` | a value is not assignable to its declared type |
| `OMEGA_E_SECRET_EGRESS` | a secret was routed to a public sink |
| `OMEGA_E_EVIDENCE_UNTRUSTED` | an unverified value was promoted to evidence |
| `OMEGA_E_GRANT_MISSING` | no `grant` covers the call (runtime, authority side) |
| `OMEGA_E_CONTRACT_UNMET` | a `require evidence` contract has no evidence (runtime) |
| `OMEGA_E_CIRCUIT_OPEN` | the circuit breaker isolated a repeatedly failing resource |
| `OMEGA_E_BUDGET` | `max_steps` or `max_runtime` exceeded |
| `OMEGA_E_KERNEL_IMMUTABLE` | an evolution proposal named the kernel |
| `OMEGA_E_GATE_STAGE` | the Evolution Gate refused a candidate |

Kernel refusals (`NEXA_E_*`) are never rewritten: a `NEXA_E_GATE` from the kernel
arrives in the transcript as a gate refusal, with the gate's name, because that is the
truth of what happened.
