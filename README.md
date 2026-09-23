# NEXA

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/elazamey/nexa)
[![CodeQL Security Scan](https://github.com/elazamey/nexa/actions/workflows/codeql.yml/badge.svg)](https://github.com/elazamey/nexa/actions/workflows/codeql.yml)
[![Security Invariants Guard](https://github.com/elazamey/nexa/actions/workflows/security-scan.yml/badge.svg)](https://github.com/elazamey/nexa/actions/workflows/security-scan.yml)
[![Deploy Dashboard](https://github.com/elazamey/nexa/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/elazamey/nexa/actions/workflows/deploy-pages.yml)

**Two layers, one rule: AI proposes, the deterministic system decides.**

* **NEXA v0.1** — a signed, capability-gated *protocol* for agent tooling. Default-deny,
  evidence-first, Ed25519 from commit one, zero runtime dependencies. (This document.)
* **NEXA Ω** — a *language* (`.nexa`), a deterministic compiler, a capability-aware
  runtime, an immutable kernel, an Evolution Gate and a learning layer on top of that
  protocol. A program can **propose** intent and request authority; it can never grant
  itself anything, mint a capability, or mutate the kernel. → [jump to NEXA Ω](#nexa-ω--language--runtime--evolution-gate--learning)

NEXA is the layer between an autonomous agent and the tools it wants to use.
Every request is an *envelope*: canonicalized, Ed25519-signed, time-boxed, nonce-protected.
Every request is *evaluated* against a capability token and a policy.
Every decision — ALLOW or DENY — is written to a hash-chained evidence log and
comes back with a signed receipt you can verify later, without the log.

```text
INSPECT -> CREATE -> TEST -> VERIFY -> REPORT
```

* **Signed, not asserted.** Key ids *contain* their public key
  (`nexa:key:ed25519:z6Mk…`), so identity is checkable offline with no registry.
* **Authority only shrinks.** Capabilities are macaroon-style: delegation can narrow
  scope, actions, time, budget and constraints — and nothing else.
* **Authority has an origin.** An endpoint names the keys allowed to grant it
  authority (`capabilityIssuers`, empty by default). Being *pinned* as a correspondent
  is not the same as being allowed to mint permissions.
* **Deny by default.** No rule means no. A rule that says ALLOW still requires a
  verified capability and a verified envelope signature.
* **Provable afterwards.** Tamper-evident chain + signed receipts for both outcomes.
* **No ambient power.** The six gates below are closed in code, not in configuration.

## Celia — unified advisory interface

`node tools/celia-system.mjs --help` exposes local `status`, `catalog`, `advise`,
`fingerprint`, `verify`, explicit offline `train`, and read-only `research` commands.
It joins real Ω policy/capability/evidence machinery to supplied-plan assessment and
optional experimental ranking. No shell execution, patch application, COMMIT or model
activation. The 200-entry catalog distinguishes audit maturity from runtime integration;
registration does **not** mean implementation. See the [Arabic operator guide](docs/celia-system.ar.md).

**2026-09-20 verification (before the research-library addition):** 39 advisory/learning tests
and 59 boundary regression tests were green; that day's suite measured 415 with two failures left
open on record, with six gates CLOSED. H2 atomicity and H3 external-writer concurrency remained
unresolved; no production-readiness or deployment claim.

The later [research/skills advisory library](docs/celia-research-skills.ar.md) adds
10 source-linked references and 10 non-executable skill cards (`library`, `skills`).
That 2026-09-21 snapshot recorded 426 green and two documented known-failures; it is a dated
record, not a current claim. Current counts are never restated in prose: the single source of
truth is `self-model/baseline.json` (`live_measurement`, refreshed by `npm run metrics`), mirrored
in the enforced NEXA_METRICS block below and checked by `tests/count-claims-sync.test.js`.
H2/H3 and the P00 provenance HOLD remained unresolved at that snapshot.

**2026-09-22 verification:** H3 external-writer concurrency is **resolved** — the
bounded COMMIT executor now re-verifies each target **at the write point** (before and
after a zero-byte reserved write through `fs.writeFileSync`), so an external writer
that mutates a target at the moment of the write is seen before the approved bytes
land; the stale COMMIT is denied (`COMMIT_BASE_CHANGED`, 403), the external edit is
preserved and no other target is applied. The reserved write moves no bytes and
changes no mtime/ctime, so a denial or a kill at that point leaves zero trace.
Full verification via `npm run verify`: posture **ALL SIX GATES CLOSED**, the suite green end to
end (measured 2026-09-22), audit, three demos, adversarial suite blocked, gate report. H1
(consumed authority across restart/ABA), H2 (compensating rollback) and H3 are all green.

## NEXA Ω — language · runtime · Evolution Gate · learning

> **NEXA does not trust itself. NEXA proves itself.**

Ω is a front end that can only ever *propose*. It compiles intent to a signed,
typed IR and asks the deterministic kernel to decide. The wire protocol, the capability
algebra, the policy engine and the evidence chain of v0.1 are unchanged and remain the
only things that can authorize anything — Ω never mints, never verifies itself, and
never bypasses a gate.

```text
.nexa source ──► compiler (pure) ──► typed IR ──► manifest (signed) ──► Evolution Gate
                                                            │
                      AI / planner ──► proposal ────────────┘
                                                            ▼
                              runtime ──► authority ──► capability ──► kernel (v0.1)
                                                                          │
                                        Ω ledger ◄── receipts ◄── gates · policy · evidence
```

### The rules, and where they are enforced in code

| Rule | Enforced by |
| --- | --- |
| **AI ≠ Authority** — a program cannot create permission | `packages/runtime/src/authority.js` |
| **No secret in the language** — `vault://` handles only; a credential bound to a secret-typed name is a compile error | `packages/compiler/src/analyzer.js` |
| **Types carry trust** — `SecretString` cannot reach a log, a tool argument, a prompt or evidence | `packages/compiler/src/security-types.js` |
| **Evidence ≠ opinion** — only verified values become evidence | `packages/compiler/src/analyzer.js` |
| **Six gates stay closed** — `fs.write` compiles, and is then refused by the kernel | `packages/policy/src/gates.js` |
| **Self-modifying ≠ self-authorizing** — propose → verify → attack → measure → canary → activate | `packages/evolution` |
| **The kernel is immutable** — six modules no manifest may name | `packages/evolution/src/manifest.js` |
| **Learning proposes, never applies** — `learner.apply()` throws | `packages/learning/src/learner.js` |
| **Refusal is evidence** — every denied step is recorded and receipted | `packages/runtime/src/ledger.js` |
| **A claim without a check does not exist** — every claim in `spec/omega/threat-model.md` names its test | `tests/omega-*.test.js` |

### The Evolution Gate: eight stages, each of which can only fail

```text
compile → types → capabilities → security → adversarial → regression → benchmark → policy
                                                       │
   a missing stage fails · authority is monotone · the kernel is refused first ·
   a forged manifest is REFUSED, not quarantined · every attack must be blocked
```

`adversarial` is re-counted by the gate itself: a candidate cannot pass by asserting that
it attacked. A candidate then runs **beside** the active version through a canary window,
and only an identity the registry was told to trust can activate it. A quarantine is not a
warning: `activate()` counts *clean* observations and refuses a quarantined candidate
(`OMEGA_E_QUARANTINED`).

### Learning, measurement and self-healing

```text
observe → reflect → hypothesize → propose → [ replay · benchmark · adversarial · gate ]
```

* **Observations** are summaries of finished runs, derived from records, carrying the hash
  of every record they were derived from. Rates are basis points: canonical NEXA data has
  no floats, so a number that cannot be hashed is not evidence.
* **Hypotheses** are evidence-bound and *falsifiable*, with a documented confidence and a
  list of targets that excludes the kernel.
* **Knowledge** has a lifecycle: verified only with evidence (`OMEGA_E_UNPROVEN`),
  invalidated when contradicted, with everything resting on it marked `STALE`.
* **Benchmarks** run a fixed suite twice and refuse a plan whose own results move; a task
  the baseline passed and the candidate fails is a regression, whatever the aggregate says.
* **Replay** turns a transcript into a content-addressed decision skeleton, so determinism
  is inspectable: the same inputs must produce the same plan id.
* **Self-healing** is `detect → isolate → diagnose → recover → verify → learn`. Failures
  are classified: a closed gate is *permanent* (never retried, never routed around), a
  handler error is *transient*, anything unrecognised fails closed.

### Quickstart

```bash
node tools/nexa.mjs check   examples/omega/repository-review.nexa
node tools/nexa.mjs explain examples/omega/repository-review.nexa   # the authority table
node tools/nexa.mjs run     examples/omega/repository-review.nexa --mission review
node tools/nexa.mjs run     examples/omega/gated-write.nexa --mission write-report   # NEXA_E_GATE
node tools/nexa.mjs check   examples/omega/refused-secret-egress.nexa                # 3 compile errors

npm run demo:omega            # nine sections: compile → run → refuse → evolve → learn → heal
npm run attacks               # 31 attacks, 12 categories, against the real system
npm run attacks:google        # the 8 identity forgeries alone, offline
node tools/omega-vectors.mjs  # regenerate the pinned Ω vectors
```

### Implemented surface

```text
packages/compiler   lexer · parser · analyzer (types + authority) · IR · diagnostics
packages/runtime    mission machine · kernel host · authority · memory · world ·
                    providers + vault · circuit breaker · self-healer · Ω evidence ledger
packages/evolution  manifests · eight-stage deterministic gate · adversarial stage ·
                    immutable version registry · canary · quarantine · rollback
packages/learning   observation · patterns · hypotheses · reflection · knowledge ·
                    replay · reproducible benchmarks (pure, no authority, no I/O)
packages/cli        argv → plan · renderers (pure, no I/O)
packages/cell       nucleus · membrane · receptors · ports · lifecycle · health ·
                    guarantor · tissue · organ · organism · homeostasis (the cellular layer)
packages/cellular-evolution
                    division · fusion · terminal quarantine
tools/nexa.mjs      the CLI shell: the only place in Ω that touches a filesystem
tools/cellular-demo.mjs  the organism end to end, plus the cellular attacks, live
tools/cellular-vectors.mjs  pins `spec/vectors/cellular.json`
```

Deliberately **not** in Ω v1: a network transport (ports are injected), durable storage
(the `FILESYSTEM_WRITE` gate is closed and Ω does not reopen it), a model backend (the
planner is an injected port with a deterministic default), WASM compilation (the IR is
already the boundary a WASM backend would consume), and any claim of unbreakability —
`spec/omega/threat-model.md` § 6 states what remains open.

## NEXA Ω∞ — the cellular layer

> **A cell composes; it does not authorize.**

Ω v1 made authority and evidence *grammar*. Ω∞ makes them *structure*: the unit of
composition is a **cell**, and nothing composes by importing anything. The layer sits above
the Ω foundations and borrows them — the compiler's error vocabulary, the runtime's circuit
breaker, the capability authority, the evidence ledger, the Evolution Gate. It adds no new
kind of authority.

```text
Cell A → Membrane → Identity → Capability → Type/Schema → Policy → Budget → Execution → Evidence → Cell B
```

- **The cell** has an identity, a nucleus (module + invariants, frozen), a membrane (the
  only way in), receptors, ports, local memory (digests, not values), a budget, health, a
  lifecycle of six states and its own evidence. A cell holds **no authority**: it can
  `propose()`, and the tissue's guarantor asks the operator's authority.
- **The recursion:** Cell → Tissue → Organ → Organism, and an organ is usable as a cell at
  the next level (`tissue.asCell()`, `organ.asCell()`). A tissue with no entry points cannot
  pretend to be a cell — it has no receptors.
- **No direct access:** a route the contract does not name has no capability to travel on,
  so it is refused by the tissue (`OMEGA_E_ROUTE`, nothing minted) *and* by the destination
  membrane. Routes are declared before traffic; the topology is sealed on the first call.
- **Capabilities are presenter-bound and single-use:** a replay is `NEXA_E_REPLAY`, another
  cell's token is `NEXA_E_CAP_AUDIENCE`, an untrusted issuer is `NEXA_E_UNTRUSTED`.
- **Homeostasis** reuses the runtime's breaker: `DEGRADED` → `ISOLATE` → fallback →
  recovery → **verify** → `ACTIVE`. A degraded cell still serves; an isolated one serves only
  life support, and nothing returns to service without a check that passes.
- **Division** gives each child only the capabilities it needs (`OMEGA_E_CELL_AMPLIFY`
  otherwise). **Fusion never overwrites**: compatibility → contract → capability analysis →
  state migration → sandbox → security tests → benchmark → canary → a new immutable version.
  **Quarantine is terminal.**
- **Cellular learning** is evidence-first: cells publish `CELL_MESSAGE` evidence, the tissue
  aggregates it, the organ sees the pattern, the organism learns — and the learner proposes,
  never applies (`OMEGA_E_LEARNER_AUTHORITY`).

Full specification: [`spec/omega/cellular.md`](spec/omega/cellular.md) ·
[الملخّص العربي](spec/omega/cellular.ar.md) · run it: `npm run demo:cellular`.

## Safety posture (v0.1) — hard gates

| Gate | State | Meaning |
| --- | --- | --- |
| `REAL_EXECUTION` | CLOSED | no command execution, no shell, no subprocess |
| `TERMINAL` | CLOSED | no tty / terminal session control |
| `FILESYSTEM_WRITE` | CLOSED | no write, delete, move, chmod |
| `AUTO_COMMIT` | CLOSED | no VCS commit performed by the protocol |
| `AUTO_PUSH` | CLOSED | no VCS push performed by the protocol |
| `AUTO_DEPLOY` | CLOSED | no deploy, release, or infrastructure mutation |

Gates are checked **before** policy rules, in `packages/policy/src/gates.js`, and there
is no API that opens one — no rule, capability, caveat or peer identity can. A gated
request gets `NEXA_E_GATE`, a `GATE_BLOCKED` evidence record and a signed receipt.

Handlers run in-process and in memory. An endpoint with no handler for a resource
answers `NEXA_E_NO_HANDLER` (a DENY), never a real side effect. The test suite uses no
network, no clock, no subprocesses and no files outside the repo.

## Quickstart

```bash
node --version     # >= 20
npm test           # 113 tests, zero dependencies
npm run demo       # end-to-end flow with a gate denial and a tamper check
npm run report     # gate posture + protocol surface + inventory
npm run vectors    # regenerate spec/vectors/*.json (pinned test vectors)
node examples/hello-nexa.mjs
```

`examples/hello-nexa.mjs` is the whole protocol in ~40 lines, and
`tests/example.test.js` executes it, so this README cannot drift from the code:

```js
import { createIdentity } from './packages/identity/index.js';
import { mintCapability } from './packages/capability/index.js';
import { Policy } from './packages/policy/index.js';
import { Endpoint } from './packages/protocol/index.js';

const operator = createIdentity({ label: 'operator', seed: '11'.repeat(32) });
const agent = createIdentity({ label: 'agent-01', kind: 'agent', seed: '22'.repeat(32) });

const endpoint = new Endpoint({
  identity: agent,
  clock: () => new Date('2026-09-18T12:00:00Z'),
  // Who may grant this endpoint authority. Left empty, the endpoint obeys no
  // capability at all — a pinned peer still cannot mint itself permissions.
  capabilityIssuers: [operator.kid],
  policy: new Policy({
    rules: [{ id: 'allow-echo', effect: 'ALLOW', resource: 'tool:echo', actions: ['call'] }],
  }),
});
endpoint.registerHandler('tool:echo', ({ args }) => ({ echoed: args }));
endpoint.trust.pin(operator.document);         // trust is an explicit, local decision

const capability = mintCapability({
  issuer: operator,
  subject: operator.kid,                       // the holder: the only key id that may present it
  resource: 'tool:echo',
  actions: ['call'],
  caveats: { nbf: '2026-09-18T11:00:00Z', exp: '2026-09-18T13:00:00Z', max_uses: 5, max_depth: 0 },
  constraints: { max_args_bytes: 1024 },
});

const caller = new Endpoint({ identity: operator, clock: () => new Date('2026-09-18T12:00:00Z') });
caller.trust.pin(agent.document);

const allowed = endpoint.receive(
  caller.call({ to: agent.kid, resource: 'tool:echo', args: { text: 'hello nexa' }, capability }),
);
// allowed.decision === 'ALLOW', allowed.value === { echoed: { text: 'hello nexa' } }

const denied = endpoint.receive(
  caller.call({ to: agent.kid, resource: 'fs:/etc/passwd', action: 'write', args: {}, capability }),
);
// denied.decision === 'DENY', denied.code === 'NEXA_E_GATE', details.gate === 'FILESYSTEM_WRITE'
```

## How a request is decided

Each step can only deny; a failure at step *n* means later steps never run.

| # | Step | Failure code |
| --- | --- | --- |
| 1 | envelope structure, signature, freshness, TTL bound | `NEXA_E_SIG` / `NEXA_E_EXPIRED` / `NEXA_E_TTL` / `NEXA_E_CLOCK` |
| 2 | recipient binding (`to == self`) | `NEXA_E_UNTRUSTED` |
| 3 | replay guard on `id` + `nonce` (after step 1 succeeds) | `NEXA_E_REPLAY` |
| 4 | sender trust (trust store, pin-or-reject) | `NEXA_E_UNTRUSTED` |
| 5 | **hard gates** (pre-policy, unmovable) | `NEXA_E_GATE` |
| 6 | capability: chain signatures, subset rules, budget, presenter, **root issuer allowlist**, attributed revocation | `NEXA_E_CAP_*` / `NEXA_E_UNTRUSTED` |
| 7 | policy: default-deny, first match wins | `NEXA_E_POLICY` |
| 8 | handler dispatch (in memory), then spend the budget | `NEXA_E_NO_HANDLER` / `NEXA_E_HANDLER` |

An oversized body is refused with `NEXA_E_TOO_LARGE` before any hashing, so an attacker
cannot make the endpoint do expensive work cheaply. Steps 1–3 produce **no reply** — unauthenticated input must not consume replay state,
and answering it is how loops start. Steps 4–8 produce a signed `DENY` carrying the
code, the details and a receipt.

## Layout

```text
nexa/
├── spec/                 protocol, canonicalization, envelope, grammar,
│                         identity, capability, policy, evidence  (+ vectors/)
├── packages/
│   ├── ast/              data model, NEXA-C14N canonical form, error taxonomy
│   ├── crypto/           Ed25519, self-certifying key ids, sha256, nonces
│   ├── identity/         self-signed identity documents, pin-or-reject trust store
│   ├── lexer/            tokens for the .nex syntax
│   ├── parser/           .nex <-> envelope, deterministic printer
│   ├── capability/       mint / attenuate / verify / revoke
│   ├── policy/           default-deny engine + the six hard gates
│   ├── evidence/         hash-chained log, receipts, inclusion checks
│   ├── protocol/         envelopes, replay guard, ledger, endpoint state machine
│   ├── compiler/         (Ω) lexer, parser, analyzer, IR, diagnostics
│   ├── runtime/          (Ω) mission machine, kernel host, authority, memory, healer, ledger
│   ├── evolution/        (Ω) manifests, eight-stage gate, adversarial runner, registry
│   ├── learning/         (Ω) observation, patterns, hypotheses, knowledge, replay, benchmarks
│   └── cli/              (Ω) argv → plan, renderers
├── adapters/mcp/         MCP (JSON-RPC 2.0) bridge, gated in both directions
├── examples/             hello-nexa.mjs (the README flow, executed by the tests)
│                         omega/*.nexa — six modules, from "runs end to end" to "refused"
├── tools/                demo, Ω demo, Ω attacks, gate report, vector regeneration
└── tests/                207 tests (incl. tests/security.test.js, tests/omega-*.test.js,
│                        tests/cellular.test.js)
```

## Capabilities in one screen

```js
const parent = mintCapability({
  issuer: operator, subject: agent.kid, resource: 'tool:echo', actions: ['call'],
  caveats: { nbf: '…', exp: '…', max_uses: 4, max_depth: 1 },
  constraints: { max_args_bytes: 1024, mode: ['safe', 'fast'] },
});

const child = attenuate(parent, {
  delegator: agent, subject: worker.kid,
  resource: 'tool:echo', actions: ['call'],
  caveats: { nbf: '…', exp: '…', max_uses: 2, max_depth: 0 },
  constraints: { max_args_bytes: 64, mode: ['safe'] },   // numbers shrink, arrays shrink
});
```

Widening anything — scope, action, expiry, budget, depth, constraint, or dropping a
parent constraint — raises `NEXA_E_CAP_AMPLIFY` at mint time, and the same checks run
again when a token arrives over the wire. A use spends **every** link's budget, so
redelegation cannot multiply authority. Revocation is a signed record; revoking a root
revokes the whole chain. Details: [`spec/capability.md`](spec/capability.md).

## Evidence

Every decision appends a record whose hash commits to the previous record's hash, and
each record is separately signed:

```text
hash_n = sha256("NEXA/0.1 evidence record\0" || C14N(record_n \ {hash, sig}))
prev_n = hash_(n-1)          # genesis: 43 zero bytes, base64url
```

Editing, deleting, reordering or re-signing any record is detected by
`verifyEvidenceChain`. `createReceipt({ record, actor })` turns one decision into a
portable, signed receipt (`ALLOW` *and* `DENY`), and `matchReceiptToRecord` binds it
back to the log entry it names. Details: [`spec/evidence.md`](spec/evidence.md).

## `.nex` — the readable form

The signed form is NEXA-C14N (a JSON subset: sorted keys, integers only, NFC strings).
For humans, `printNex` renders the same object and `parseNex` reads it back losslessly:

```text
nexa 0.1
@type CALL
@id "urn:nexa:msg:…"
@from "nexa:key:ed25519:z6Mk…"
@to "nexa:key:ed25519:z6Mk…"
@ts "2026-09-18T12:00:00Z"
@exp "2026-09-18T12:01:00Z"
@nonce 8Qm1V0nqW5m1jWv2kg
body {
  action call
  args { text "hello nexa" }
  resource "tool:echo"
}
```

Printing is deterministic (keys sorted), so `.nex` is diffable. Grammar:
[`spec/grammar.md`](spec/grammar.md).

## MCP adapter

`adapters/mcp` maps MCP JSON-RPC 2.0 onto NEXA envelopes without loosening either
side: `tools/call` becomes a real signed `CALL`, denials return `-32001` with the
`NEXA_E_*` code and the receipt, gated tools are refused at construction and never
listed. See [`adapters/mcp/README.md`](adapters/mcp/README.md).

## Specification

The Ω layer's documents sit beside the v0.1 ones: `spec/omega/README.md` (index),
`language.md`, `grammar.ebnf`, `types.md`, `authority.md`, `evidence.md`, `evolution.md`,
`learning.md`, `mcp.md` and `threat-model.md`.

| Document | Contents |
| --- | --- |
| [`spec/protocol.md`](spec/protocol.md) | message types, decision order, transport, versioning |
| [`spec/canonicalization.md`](spec/canonicalization.md) | NEXA-C14N rules and domain separation |
| [`spec/envelope.md`](spec/envelope.md) | signature payload, freshness, replay, bodies |
| [`spec/identity.md`](spec/identity.md) | key ids, identity documents, trust, fingerprints |
| [`spec/capability.md`](spec/capability.md) | token shape, attenuation rules, budgets, revocation |
| [`spec/policy.md`](spec/policy.md) | gate order, rule shape, determinism |
| [`spec/evidence.md`](spec/evidence.md) | chaining, receipts, what evidence is not |
| [`spec/grammar.md`](spec/grammar.md) | `.nex` EBNF and mapping |

`spec/vectors/*.json` pins canonical output, key derivation, envelope signatures and
capability grants. Regenerate with `npm run vectors`; the tests fail if the code and
the pinned bytes drift apart.

## Verify it yourself

```bash
npm test                      # H1 PASS; H2/H3 still RED; last all-green baseline: 353
npm run audit                 # 16 adversarial probes (attacks that must keep failing)
npm run posture               # CI gate: all six gates CLOSED, no ambient authority in the tree
npm run proof:permission      # runs the protocol flow while the runtime denies fs write,
                              # child processes and network — and fails if it does not deny them
npm run demo                  # ALLOW, delegation, revocation, gate DENY, tamper check
npm run demo:omega            # compile, run, refuse, evolve, benchmark, learn, heal
npm run attacks               # 31 Ω attacks across 12 categories — all must be blocked
npm run report                # runtime posture, protocol surface, inventory
npm run verify                # everything above, in order
```

`tests/security.test.js` is written as a series of attacks — NFC key collisions, a pinned
peer minting its own capability, third-party revocation, oversized payloads, replay-state
poisoning, log splicing, secret leakage through every serialized surface, MCP boundary
probing, and a grep for execution/filesystem imports. Five of them failed when first
written; see `CHANGELOG.md` for what each one found.

## Status

`v0.1.0` — protocol core, signatures, canonicalization, replay protection, capabilities,
policy, evidence, `.nex` syntax, MCP adapter, pinned spec vectors.

`Ω v1` (packages `0.2.0`) — the `.nexa` language, the security type system, the capability
authority, the mission runtime, the Ω evidence ledger, memory, the world model, the
provider/vault boundary, the MCP bridge, the eight-stage Evolution Gate, the immutable
version registry, the learning layer, the self-healer and the CLI. **207 tests, 16 of them
adversarial, plus a 23-attack Ω suite across 11 categories**, every one of which runs in
`npm run verify`.

`Ω∞` (packages `0.3.0`) — the cellular layer: cell anatomy, the seven-step membrane,
tissue / organ / organism contracts, homeostasis, division and fusion. **207 tests** at that
release.

`GOOGLE IDENTITY CELL v1` (packages `0.4.0`) — the first external organ, and with it the
twelfth attack category: identity that arrives from outside the system. **307 tests, plus a
31-attack suite across 12 categories**, once again entirely inside `npm run verify`.

`G0 closure` (packages `0.4.1`) — the gate that designed and shipped the identity cell is
closed: every clause of its definition of done, the invariants it fixes held by seven new
tests, and the publishing-status note. **314 tests.** No code changed: a closure is a record,
and a record that is not tested is a promise (`spec/google/closure-g0.md`).

The honest summary of the security posture is the one the repository can *demonstrate*,
not the one it can assert:

```text
0 unauthorized capability grants       (31/31 attacks blocked, re-counted by the gate)
0 forged Google identities admitted    (8/8 identity forgeries blocked, each refused at its own step)
0 secret exfiltrations                 (compile-time types + vault handles + egress refusal)
0 evidence-chain breaks                (one edited field fails verification)
0 kernel mutations                     (six modules, refused before any stage runs)
0 unsigned or forged modules admitted  (REFUSED, not quarantined)
gates · namespaces · Ω error codes · cell states: `npm run posture` prints them, and
`npm run metrics` fails CI unless the NEXA_METRICS block below matches — this fence
                                      deliberately does not restate any of those numbers
```

> Hardening status: **H1 persistence passes**, including actual restart/ABA,
> consume-before-effects and fresh-grant acceptance for the same changeSet.
> H2 atomicity and H3 external-writer concurrency are **green**: H2 via compensating
> rollback under exclusive-root ownership; H3 via write-point re-verification
> (zero-byte reserved write, then a post-check before the approved bytes are applied).
> `npm run verify` re-counts the suite on every run; the last recorded measurement lives in
> `self-model/baseline.json` (`live_measurement`) and in the enforced block below — no count is
> restated in prose here (D1.12: a number that no check compares against measurement is a claim,
> not evidence; `tests/count-claims-sync.test.js` fails if a literal creeps back in).
> The metrics block below is enforced by `npm run metrics` (docs must match measured
> reality) and tracks the current suite.
> COMMIT now also requires a pre-provisioned, external persistent `CELIA_COMMIT_STATE_DIR`.
> See [H1 evidence, storage contract and limits](docs/celia-workspace-commit-h1-persistence.ar.md)
> and the [original hardening RED](docs/celia-workspace-commit-hardening-red.ar.md).

<!-- NEXA_METRICS:START -->
- Total tests: 655
- Security tests: 16
- Ω attacks: 31
- Google identity attacks: 8
- Closed gates: 6
- Ω error codes: 86
- Gated namespaces: 14
- Attack categories: 12
<!-- NEXA_METRICS:END -->

Deliberately **not** in v0.1 or Ω v1: any execution of arbitrary code, filesystem or
terminal capability, durable evidence storage, cross-endpoint evidence reconciliation, and
WASM compilation.

## Celia adaptive plan learning — collection first

An isolated, **advisory-only** module can collect pre-registered repair plans,
actual Node TAP results and explicit human reviews. It includes real CPU
logistic-regression training and a small two-hidden-layer neural network, with
task-group-separated evaluation. It does not execute plans, promote models,
change policies, or update an external LLM's weights.

```bash
npm run learning -- --help
# The operator supplies a private, persistent directory OUTSIDE the repository.
node tools/celia-learning.mjs status --state /path/to/initialized-learning-data
node tools/celia-learning.mjs research --query "software repair"
```

Collection is empty initially; training refuses insufficient/unreviewed data.
Numerical tests use explicitly synthetic fixtures, not claimed real repair gains.
Research retrieval is read-only, fixed-source and bounded; live arXiv access
failed with `ECONNRESET` in this sandbox, despite passing connector unit tests.
See [Arabic setup, data schemas, research references and measured limits](docs/celia-adaptive-learning.ar.md).
H2/H3 are out of scope for this module (both are now green — see the 2026-09-22 verification above); this module does not reopen the execution gates.

## License

MIT — see [`LICENSE`](LICENSE).
