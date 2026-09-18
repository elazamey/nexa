# NEXA Ω v1 — Autonomous Secure Language

> **NEXA does not trust itself. NEXA proves itself.**

> **Ω∞ adds composition.** The same foundations, one level up: [`cellular.md`](cellular.md)
> describes the cellular layer — Cell → Tissue → Organ → Organism — where the unit of
> composition is a cell with an identity, a nucleus, a membrane that verifies a capability
> before anything else, a lifecycle, a budget and its own evidence. Nothing in the cellular
> layer mints authority; a cell can only propose.

NEXA v0.1 is a signed, capability-gated *protocol* for agent tooling: envelopes,
capability tokens, a default-deny policy engine, an evidence chain, and six closed hard
gates. NEXA Ω is the layer above it: a **language** in which intent, authority,
types, evidence and self-evolution are grammar, compiled by a deterministic compiler and
executed by a runtime that owns no authority of its own.

Ω does not replace v0.1 and does not modify it. The wire protocol, the capability
algebra, the policy engine and the evidence chain are unchanged and remain the only
things that can *authorize* anything. Ω is a front end that can only ever **ask**.

```text
intent  ──►  compiler  ──►  typed IR  ──►  runtime  ──►  kernel (NEXA v0.1)
             (pure)        (signed)      (no authority)   caps · policy · gates · evidence
```

## The rules Ω is built to keep

| # | Rule | Where it is enforced |
| --- | --- | --- |
| 1 | **AI ≠ Authority.** A program cannot create permission; it can only request it. | `packages/runtime/src/authority.js`, `spec/omega/authority.md` |
| 2 | **No secret in the language.** Secrets live behind `vault://` handles the program never sees. | `packages/runtime/src/providers.js`, § 20 of the design |
| 3 | **Types carry trust.** `SecretString` cannot reach a log, a tool argument, a prompt or evidence without an explicit, recorded declassification. | `packages/compiler/src/security-types.js` |
| 4 | **Evidence ≠ opinion.** Only values typed as verified may become evidence. | `packages/compiler/src/analyzer.js`, `spec/omega/evidence.md` |
| 5 | **Self-modifying ≠ self-authorizing.** A candidate version runs only after the deterministic Evolution Gate, a canary window and an explicit activation — never in place. | `packages/evolution`, `spec/omega/evolution.md` |
| 6 | **The kernel is immutable.** No proposal may target the kernel, the verifier, the policy engine or the capability authority. | `packages/evolution/src/gate.js` |
| 7 | **Refusal is evidence.** Every denied step is recorded, receipted and verifiable afterwards. | `packages/runtime/src/ledger.js` |
| 8 | **Learning proposes; it never applies.** `learner.apply()` throws `OMEGA_E_LEARNER_AUTHORITY`. | `packages/learning/src/learner.js` |
| 9 | **Improvement is a measurement.** A benchmark that moves is refused; a regression fails the comparison. | `packages/learning/src/benchmark.js` |
| 10 | **A promise that is not checked does not exist.** Every claim in `threat-model.md` names the test or the scanner that checks it. | `tests/omega-*.test.js`, `tools/check-posture.mjs` |
| 11 | **Composition is not authority.** A cell, a tissue, an organ and an organism each hold a nucleus and a contract; none of them can grant themselves a capability. | `packages/cell`, `spec/omega/cellular.md` |

Nothing in Ω claims to make a system unbreakable. The goal is narrower and achievable:
**minimize attack surface → contain failure → detect → prove → roll back → learn.**

## Documents

| Document | Contents |
| --- | --- |
| [`language.md`](language.md) | the three nested layers (script / intent / policy), declarations, statements, execution model |
| [`grammar.ebnf`](grammar.ebnf) | normative grammar of `.nexa` |
| [`types.md`](types.md) | the security type system: secrecy × trust lattice, sinks, declassification |
| [`authority.md`](authority.md) | capability binding: agents, instruments, grants, decision order, budget |
| [`evidence.md`](evidence.md) | CLAIM / OBSERVATION / EVIDENCE / VERDICT, the Ω ledger, receipts |
| [`mcp.md`](mcp.md) | MCP as a first-class namespace: declaration, call path, evidence |
| [`evolution.md`](evolution.md) | proposals, immutable versions, the eight-stage Evolution Gate, canary, rollback |
| [`learning.md`](learning.md) | observation, patterns, hypotheses, reflection, knowledge, replay, benchmarks |
| [`threat-model.md`](threat-model.md) | assets, adversaries, trust boundaries, the attack suite, residual risk |
| [`cellular.md`](cellular.md) | the cellular layer: cell anatomy, the seven-step membrane, tissue / organ / organism contracts, homeostasis, cellular evolution |
| [`cellular.ar.md`](cellular.ar.md) | الملخّص العربي للطبقة الخلوية |
| [`../google/identity-cell.md`](../google/identity-cell.md) | GOOGLE IDENTITY CELL v1: the first external organ — the identity contract, the scope table, the class ladder, the vault, the evidence contract and the threat model |
| [`../google/README.ar.md`](../google/README.ar.md) | الملخّص العربي لعقد خلية هوية Google |
| [`README.ar.md`](README.ar.md) | الملخّص التنفيذي العربي لـ Ω v1 |

## Implemented surface (v1)

```text
packages/compiler   lexer · parser · analyzer (types + authority) · IR · diagnostics
packages/runtime    mission machine · kernel host · authority · memory · world ·
                    providers · circuit breaker · self-healer · Ω evidence ledger
packages/evolution  manifests · deterministic gate · adversarial stage · immutable
                    registry · canary · quarantine · rollback
packages/learning   observation · patterns · hypotheses · reflection · knowledge
                    lifecycle · replay · reproducible benchmarks (pure, no authority)
packages/cli        argv → plan · renderers (pure, no I/O)
packages/cell       nucleus · membrane · receptors · ports · lifecycle · health ·
                    guarantor (the tissue's authority port) · tissue · organ · organism ·
                    homeostasis — the cellular layer, above Ω, below nothing
packages/cellular-evolution  division · fusion (compatibility → contract → capability
                    analysis → sandbox → benchmark → canary) · terminal quarantine
tools/cellular-demo.mjs  the organism end to end, plus the cellular attacks, live
tools/nexa.mjs      the CLI shell: the only place in Ω that touches a filesystem
tools/cellular-demo.mjs  the organism end to end, plus the cellular attacks, live
tools/omega-demo.mjs     nine sections, end to end: compile → run → refuse → learn → heal
tools/omega-attacks.mjs  thirty-one attacks across twelve categories, run by the gate
tools/google-attacks.mjs the eight identity-forgery attacks, offline, run by the same gate
tools/omega-vectors.mjs  regenerates the pinned Ω vectors in spec/vectors/omega.json
```

What is deliberately **not** in v1: a network transport for MCP (the bridge is
injected as a port), durable storage (the kernel's `FILESYSTEM_WRITE` gate is closed,
and Ω does not reopen it), a model backend (the planner is an injected port with a
deterministic default), and any way for a program to open a hard gate.
