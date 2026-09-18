# Ω — authority

**AI ≠ Authority.** In a conventional language a program's authority is whatever the
process it runs in happens to have. In Ω a program has exactly the authority that was
granted to it, for exactly the calls it makes, for exactly as long as it needs it — and
that grant is a signed token the kernel can verify without asking anybody.

```text
call site (IR)
   │  resource + action, computed from the source
   ▼
agent allow-list        ← compile time: does this actor reach this resource?
   │  yes
   ▼
mission precondition    ← compile time: is the requirement declared and reachable?
   │  yes
   ▼
authority (grant table) ← run time: will the operator mint it, for how long, how often?
   │  capability token: this subject, this resource, this action, one use, TTL
   ▼
kernel endpoint         ← run time: signature, trust, gates, capability, policy, handler
   │
   ▼
Ω evidence + kernel receipt
```

Every arrow is a chance to say no, and every no is recorded. Nothing in a `.nexa` module
can shorten the chain: there is no constructor for a capability, no field that names a
key, and no way to address the authority directly.

## Actors

```nexa
agent architect {
    role planning
    model provider.auto
    allow fs.read("/src/**"), github.repository.read, memory.read
}

agent coder {
    role implementation
    allow fs.read("/src/**"), fs.write("/src/**"), memory.write
    deny fs.write("/**")
}
```

* An `agent` is a *name in the program*, and the runtime binds it to a real key
  (`Agent` endpoint). The allow-list is checked statically against every call site in
  every mission that names that agent.
* `deny` is evaluated **before** `allow`, so a broad allow list can be narrowed by an
  explicit denial — the two lines above let `coder` write under `/src` but never at the
  filesystem root.
* An agent that is not named in a mission cannot act at all; there is no ambient default
  agent.

## Capability references

A capref resolves to `(resource, action)` through one deterministic function, used
identically at a call site and inside an allow-list:

| Form | Resolves to | Example |
| --- | --- | --- |
| `<ns>.<action>("<scope>")` | `resource = "<ns>:<scope>"` | `fs.read("/src/**")` → `fs:/src/**` |
| `<instrument>.<action>` | the instrument's declared resource | `echo.call` → `tool:echo` |
| `<server>.<tool>` | `mcp:<server>.<tool>` | `github.repository.read` → `mcp:github.repository.read` |
| exact resource id | itself | `tool:echo` |

Anything that does not resolve is `OMEGA_E_UNKNOWN_INSTRUMENT`. A call that would produce
a wildcard resource is `OMEGA_E_RESOURCE_WILDCARD`: patterns belong in allow-lists,
concrete ids belong in calls.

## Grants — the authority's side of the contract

```nexa
grant fs.read {
    subject coder            # this agent, or `any`
    scope "/src/**"          # pattern, matched with the same glob semantics as allow-lists
    ttl 10m
    max_calls 20
    require approval(owner)  # recorded; the runtime refuses to auto-issue without it
}
```

A grant is a *template*, never a token. When a mission reaches a call site the runtime
asks the authority: *"may I have `(coder, fs:/src/main.js, read, now)`?"* The authority
answers with a freshly minted capability or with `OMEGA_E_GRANT_MISSING`. The minted
token is deliberately the smallest token the kernel accepts:

| Field | Value | Consequence |
| --- | --- | --- |
| `resource` | the **exact** resource of this one call | no over-broad token exists to steal |
| `actions` | `[action]` | one verb |
| `subject` | the agent's key id | non-transferable: another agent cannot present it |
| `max_uses` | `1` | a replayed token is a kernel `NEXA_E_CAP_USES` |
| `max_depth` | `0` | cannot be delegated further |
| `nbf`/`exp` | now → now + `ttl` (capped at the grant's TTL) | short-lived by construction |
| `constraints.max_args_bytes` | module policy | argument size is bounded before the kernel hashes anything |

Scoped × expiring × revocable × auditable × non-transferable — the five properties the
design calls for, obtained by making **every call its own grant** instead of by trusting a
long-lived shared secret.

## Scope coverage is proven, not hoped

Because Ω refuses to guess, the compiler compares glob patterns conservatively:

```text
covers(grantPattern, requiredPattern) is true only when every resource matching
requiredPattern is also matched by grantPattern — otherwise the module does not compile
and the grant does not issue.
```

`/src/**` covers `/src/main.js` and `/src/**`; `/src/main.js` does **not** cover `/src/**`.
When coverage cannot be proven, the answer is no (`OMEGA_E_CAP_MISSING` at compile time,
`OMEGA_E_GRANT_MISSING` at run time). Default-deny applies to the compiler too.

## Budgets

Three budgets, enforced independently, so an exhausted one of them cannot be bypassed by
exhausting another:

1. **Steps** — `max_steps` in the mission's policy bounds statements executed.
2. **Time** — `max_runtime` bounds the clock delta the runtime is willing to spend.
3. **Calls** — `max_calls` bounds how many tokens the authority will mint for a grant,
   and the kernel's own use ledger spends each token exactly once.

Exceeding any of them is `OMEGA_E_BUDGET`, with the limit and the observed value in the
record.

## Revocation and short life

Revocation is the kernel's (`RevocationSet`, attributed to chain issuers). Ω adds the
cheaper half of the same idea: because tokens live for one call, revoking a *grant* means
deactivating the module or the agent, and there is nothing cached to revoke. A `reflect`
record uses the same mechanism: memory and reflection never become authority (see
[`evidence.md`](evidence.md)), so a learned lesson cannot promote itself into permission.

## What Ω deliberately cannot do

| Attempt | Result |
| --- | --- |
| `do exec.shell(cmd: "rm -rf /")` | compiles only if declared · kernel refuses: `NEXA_E_GATE` (`REAL_EXECUTION`) |
| `do fs.write(path: "/etc/passwd")` | kernel refuses: `NEXA_E_GATE` (`FILESYSTEM_WRITE`) |
| an agent calling outside its allow-list | `OMEGA_E_CAP_MISSING` at compile time |
| an allowed agent with no matching grant | `OMEGA_E_GRANT_MISSING` at run time |
| presenting another agent's capability | kernel `NEXA_E_CAP_AUDIENCE` (subject binding) |
| replaying a capability | kernel `NEXA_E_CAP_USES` (budget 1) |
| widening scope by delegation | kernel `NEXA_E_CAP_AMPLIFY` (subset-only algebra) |
| a program minting its own token | not expressible: there is no such syntax, and the kernel
  only obeys issuers named in `capabilityIssuers` |
