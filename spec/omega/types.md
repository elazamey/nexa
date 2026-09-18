# Ω — the security type system

Types in Ω are not about shapes. They are about **who is allowed to see a value and how
much it can be believed**. Two attributes travel with every value:

* **secrecy** — `public` < `secret`
* **trust** — `untrusted` < `internal` < `verified`

A nominal type is a (base, secrecy, trust) triple. Assignment, arithmetic, branching and
every sink are checked against those two attributes, so a whole class of data-leak and
data-laundering bugs is caught **before the program runs** instead of being watched for
at run time.

## The table

| Type | base | secrecy | trust | Use |
| --- | --- | --- | --- | --- |
| `String`, `Number`, `Bool` | value | public | internal | computed from the program itself |
| `SecretString`, `SecretNumber`, `SecretBool` | value | **secret** | internal | held, never emitted |
| `UntrustedData` | data | public | **untrusted** | anything an instrument returned |
| `ToolResult` | data | public | untrusted | alias of `UntrustedData`, for readability |
| `UserIntent` | data | public | untrusted | what a user asked for; intent, not fact |
| `VerifiedData`, `VerifiedString` | data/string | public | **verified** | a value a declared-verified instrument produced |
| `SignedEvidence` | data | public | verified | a receipt or a sealed record |
| `MemoryRef` | data | public | internal | a handle into memory; contents are not readable |
| `Capability` | cap | **secret** | internal | authority itself; reserved, never a computed value |

## Subtyping

```text
from ≤ to   ⟺   secrecy(from) ≤ secrecy(to)   ∧   trust(to) ≤ trust(from)
```

Read it as: *you may always be more secret and less trusting than the value you hold.*
So:

| Statement | Verdict | Why |
| --- | --- | --- |
| `let s: SecretString = "x"` | allowed | public → secret is a widening |
| `let p: String = secret` | **`OMEGA_E_SECRET_EGRESS`** | secret → public is a leak |
| `let v: VerifiedData = toolResult` | **`OMEGA_E_TYPE`** | untrusted → verified is laundering |
| `let u: UntrustedData = verified` | allowed | verified → untrusted is merely cautious |
| `let c: Capability = anything` | **`OMEGA_E_TYPE`** | authority is never a value |

The **join** of two operands (`+`, comparison, `if` branches) is
`(max secrecy, min trust)`: mixing a secret with anything yields a secret, and mixing
untrusted with anything yields untrusted. Taint never washes off by accident.

## Sinks

A sink is a place where a value leaves the program. Every sink declares the attributes it
requires:

| Sink | Requires | On violation |
| --- | --- | --- |
| `emit e` | secrecy public | `OMEGA_E_SECRET_EGRESS` |
| `do tool(args)` | secrecy public (unless `accepts_secret`) | `OMEGA_E_SECRET_EGRESS` |
| `evidence claim … from x` | secrecy public **and** trust verified | `OMEGA_E_EVIDENCE_UNTRUSTED` |
| `remember x as tier` | secrecy public | `OMEGA_E_SECRET_EGRESS` |
| `assert a == b` | secrecy public (comparisons are recorded) | `OMEGA_E_SECRET_EGRESS` |
| prompts / providers (`model.invoke`) | secrecy public | `OMEGA_E_SECRET_EGRESS` |

There is no `print`. There is no string interpolation. There is no logging API. The only
way out of a program is a sink, and every sink is checked.

## The two escape hatches (both recorded)

### 1. Declassification — a deliberate, attributable act

```nexa
let raw: UntrustedData = github.repository.read(owner: "elazamey", repo: "nexa")
let clean: VerifiedData = untaint raw as VerifiedData via sanitizer.redact(text: "ok")
```

`untaint` requires a sanitizer that is declared `trust verified` **in the module** (so the
trust decision is reviewable, hash-committed text, not a runtime flag), and the call goes
through the kernel like every other call: capref → grant → capability → policy → receipt.
The runtime then writes a `DECLASSIFY` record naming the source value's hash, the target
type, the instrument used and the capability id. Un-recorded declassification is not
expressible.

Secrecy is declassified the same way, and only to the type the sanitizer is declared to
produce. A program cannot declassify by assigning, by branching, or by concatenating.

### 2. Sealing — secrets that stay sealed

```nexa
let key: SecretString = secrets.load(name: "gemini")
seal key
do model.invoke(provider: "gemini", prompt: publicPrompt, key: key)
```

A sealed value may be passed **only** to an instrument that declares
`accepts_secret true`, and only if the module's policy contains
`allow secret -> <instrument>`; otherwise the compiler refuses. The runtime never places
it in a transcript: Ω evidence stores `sha256` of the value, never the value.

## Secrets are not in the language

```nexa
provider gemini {
    secret vault://gemini        # a handle, not a key
    strategy cheapest
    fallback local
    max_cost 0
}
```

`AIza…` is not a value the language can express. The `vault://` handle is resolved by the
runtime, in a different trust domain from the agent; the resolved material is attached to
the outbound provider call and is never bound to a program name, never written to
evidence, and never visible to a tool argument. A program that tries
`provider gemini { secret "AIza…" }` fails at compile time with `OMEGA_E_SECRET_LITERAL`.

## What this system is not

It is not a proof of correctness, and it is not a sandbox for the *host*. It is a
compile-time discipline that makes two specific failures unexpressible — leaking a value
that is marked secret, and laundering unverified data into evidence — plus the runtime
records that make any remaining flow auditable. Everything else still runs behind the
kernel's capability checks and hard gates.
