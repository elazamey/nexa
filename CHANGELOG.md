# Changelog

All notable changes to NEXA are recorded here. The format follows Keep a Changelog,
and the project uses semantic versioning once it leaves `0.x`.

## [0.4.0] — 2026-09-18 — GOOGLE IDENTITY CELL v1 (the first external organ)

Google becomes an **external organ** of the organism rather than a set of APIs: an identity
cell in a tissue, behind the same membrane, holding no authority at all. The design of record
is `spec/google/identity-cell.md` (v1.1), committed and reviewed before any of this code
existed; this release is G0-H, the implementation of that contract.

    Google proves identity.        NEXA decides authority.

### Added

* **Identity cell** (`packages/cells/google/identity`) — the verification order
  `shape → signature → issuer → audience → window → nonce → subject → email`, fail-closed at
  every step, refusing with the *step* that decided it; the stored identity
  `sha256("NEXA/google1 subject\0" || sub)` with `email` kept as display metadata; a
  single-use challenge store; an evidence recorder that writes five record kinds and keeps the
  no-ledger journal ledger-shaped; owner bindings signed by the operator key; and break-glass
  as a bounded recovery state rather than a second owner.
* **Service gateway** (`packages/cells/google/gateway`) — the pinned key sources (Google only,
  Firebase deferred and disabled), the scope table with its three admission rules, the risk
  class ladder with per-cell and per-role ceilings, single-use class-D approvals bound to an
  exact operation digest, a presenter-bound token vault with a 300 s refresh margin and
  single-flight refresh, a per-service quota limiter with capped exponential backoff and
  injected jitter, and a secret-material scanner.
* **A login is a membrane crossing** — `google.session → google.identity.verify`, evidenced as
  `CELL_MESSAGE`, with the capability minted by the tissue's guarantor and verified by the
  cell's own membrane. *Owner identity ≠ capability subject*: the capability's subject is the
  service cell, and a login can never create a binding.
* **The twelfth attack category, `identity-forgery`** — eight distinct forgeries
  (`lookalike-signing-key`, `issuer-lookalike`, `audience-confusion`,
  `authorized-party-confusion`, `algorithm-confusion`, `nonce-replay-across-sessions`,
  `nonce-replay-after-login`, `owner-by-email`), each asserting the step that refuses it, run
  offline against throwaway RSA keys by `npm run attacks:google` and by the gate.
* **Offline fixtures** (`tools/google-fixtures.mjs`) — three throwaway RSA keys and a token
  signer, so the whole contract is exercised in CI with no network and no Google material.
* **Google test groups** — `tests/google-identity.test.js` (27), `tests/google-binding.test.js`
  (22), `tests/google-capability.test.js` (23), `tests/google-gateway.test.js` (18) and
  `tests/google-attacks.test.js` (10).
* **Vectors** — `tools/google-vectors.mjs` → `spec/vectors/google.json`: the verification
  order, nine refusal scenes with their steps, the key sources, the sixteen scope rows, the
  eight operations and their classes, the approval state machine, the vault contract, the
  backoff schedule, the egress scan and the eight attack reports.

### Changed

* `OMEGA_ERROR_CODES` grows from 72 to 84: `OMEGA_E_IDENTITY_TOKEN`, `OMEGA_E_NONCE`,
  `OMEGA_E_SCOPE`, `OMEGA_E_QUOTA`, `OMEGA_E_TOKEN`, `OMEGA_E_BINDING_EXISTS`,
  `OMEGA_E_BREAKGLASS_UNBOUNDED`, `OMEGA_E_BREAKGLASS_ROLE`, `OMEGA_E_BREAKGLASS_REASON`,
  `OMEGA_E_BREAKGLASS_CHAIN`, `OMEGA_E_CLASS_CEILING`, `OMEGA_E_APPROVAL_CONSUMED` — each
  registered in the same commit as the behaviour that throws it.
* `OMEGA_EVIDENCE_KINDS` gains `IDENTITY_VERIFIED`, `OWNER_BINDING`, `CONSENT`, `QUOTA` and
  `APPROVAL` (27 → 32).
* The adversarial suite gains the category `identity-forgery` and eight attacks
  (**31 attacks across 12 categories, all blocked**).
* `tools/check-posture.mjs` now asserts the Google scope table's shape and phases, the class of
  `gmail.send`, the cell ceilings, the 24-hour break-glass bound, the pinned key sources, and
  that no source under `packages/cells/google` mints, holds an authority, reads the
  environment, or opens a network.

### Verified

`npm run verify` → posture (12 attack categories, 84 error codes, 32 record kinds) →
**307/307 tests** (113 v0.1 + 68 Ω + 26 cellular + 100 Google) → audit 16/16 → three demos →
adversarial suite **31/31 blocked** → gate report. `node tools/google-vectors.mjs --check`
reports "google vectors are in sync".

## [0.3.0] — 2026-09-18 — NEXA Ω∞ (cellular layer)

The layer *above* Ω: composition becomes structural. The cell is the unit of composition,
the recursion Cell → Tissue → Organ → Organism holds at every level, and no cell ever holds
authority. Nothing in Ω v1 was changed except where the cellular layer needed to be visible
to it (two evidence kinds, one observation kind, one attack category, one error code).

### Added

* **Cell** (`@nexa/cell`) — identity, nucleus (module + invariants, `Object.freeze`d and
  never written), membrane, receptors (`accepts` / `requires`), a `{ verify, record }` port,
  digest-only local memory, a budget, health counters, a six-state lifecycle with a closed
  transition set, evidence, and a version. A cell has no `issue`, no `mint` and no authority
  object: `propose()` returns an inert `CellProposal`.
* **Membrane** — the seven steps, in order: `identity → capability → type/schema → policy →
  budget → execution → evidence`. The membrane records its own refusals, so a denial cannot
  be lost; payloads enter the transcript as `payload_digest`, never as data.
* **Tissue** — cells plus a contract whose grant set *is* the contract, plus entry points
  that make the tissue a composite cell (`asCell()`). A tissue with no entry points refuses
  to be a cell.
* **Organ** — cross-tissue routes declared by the organ and registered in the *source*
  tissue's contract; one guarantor per organ (`OMEGA_E_CELL_AMPLIFY` otherwise); the organ
  is a cell from above.
* **Organism** — cross-organ routes, `sample()` (cells, calls, failures, failure rate in
  basis points, isolated/degraded names, evidence continuity), `react()`, and `recover()`
  which requires a passing check per cell.
* **Homeostasis** — `DEGRADED` → `ISOLATE` → fallback → recovery → **verify** → `ACTIVE`,
  built on the runtime's existing circuit breaker. `DEGRADED` still serves; `ISOLATED`
  serves only life support; `RETIRED` is terminal.
* **Cellular evolution** (`@nexa/cellular-evolution`) — division (capability-checked:
  a child cannot hold what the parent never had), fusion (compatibility → contract →
  capability analysis → state migration → sandbox → security tests → benchmark → canary →
  new immutable version), and terminal quarantine (`release()` always throws).
* **Sample organism + demos** — `buildCodingOrganism()` (Planner → Coder → Tester →
  Reviewer → Evidence, plus memory and security tissues), `npm run demo:cellular`, and
  `tools/cellular-vectors.mjs` → `spec/vectors/cellular.json`.
* **Docs** — `spec/omega/cellular.md` and `spec/omega/cellular.ar.md`, including § 14 which
  states where the implemented layout deviates from the sketched one and why.

### Changed

* `OMEGA_EVIDENCE_KINDS` gains `CELL_MESSAGE`, `CELL_LIFECYCLE` and `HOMEOSTASIS`.
* The learning layer now treats a `CELL_MESSAGE` as a call observation, so a cell refusal is
  observable exactly like a tool refusal — that is how cellular learning gets its evidence.
* The adversarial suite gains the category `kernel-self-modification` and ten cellular
  attacks (23 attacks across 11 categories, all blocked).
* Nine new error codes — `OMEGA_E_MEMBRANE`, `OMEGA_E_IDENTITY`, `OMEGA_E_RECEPTOR`,
  `OMEGA_E_ROUTE`, `OMEGA_E_POLICY`, `OMEGA_E_LIFECYCLE`, `OMEGA_E_ISOLATED`,
  `OMEGA_E_HANDLER`, `OMEGA_E_HOMEOSTASIS`, `OMEGA_E_CELL_AMPLIFY` — taking the registry
  from 62 to 72.
* `tools/check-posture.mjs` now asserts the membrane order, the lifecycle table, the cell
  lifecycle table's serving rules, and that no package under `packages/cell` mints a
  capability or holds an authority object.

### Verified

`npm run verify` → posture (7 membrane steps, 6 cell states, 11 attack categories, 72 error
codes, 6 immutable kernel modules) → **207/207 tests** (113 v0.1 + 68 Ω + 26 cellular) →
audit 16/16 → v0.1 demo → Ω demo → cellular demo → adversarial suite **23/23 blocked** →
gate report. `node tools/cellular-vectors.mjs --check` reports "cellular vectors are in sync".

## [0.2.0] — 2026-09-18 — NEXA Ω v1

The layer above the protocol: a language, a runtime that holds no authority, an immutable
kernel, a deterministic Evolution Gate, and a learning layer that can propose but not
apply. Nothing in v0.1 was changed — the wire protocol, capability algebra, policy engine
and evidence chain are the same code, and Ω only ever *asks* them.

### Added

* **Compiler** (`@nexa/compiler` 0.2.0) — one grammar for script, intent and policy; a
  security type system (`SecretString`, `UntrustedData`, `VerifiedData`, `ToolResult`,
  `Capability`, …) with a secrecy × trust lattice; capability references (`fs.read("/src/**")`,
  `model.invoke(provider: "gemini")`, MCP tools); `vault://` handles as a lexer token; an IR
  that is canonical data and hashes to `sha256:…` under its own domain separator; diagnostics
  as values (`path:line:col: severity CODE: message`).
* **Runtime** (`@nexa/runtime` 0.2.0) — the mission machine, kernel host, capability
  authority, six-tier memory that stores digests and never values, world model, provider
  registry with a vault, circuit breaker, self-healer, and the Ω evidence ledger
  (hash-linked, signed, domain-separated from the kernel chain).
* **Evolution** (`@nexa/evolution` 0.2.0) — signed manifests, an **eight-stage** gate
  (`compile · types · capabilities · security · adversarial · regression · benchmark · policy`),
  an adversarial runner with ten attack categories, an immutable version registry with
  canary windows, quarantine, activation and rollback.
* **Learning** (`@nexa/learning` 0.2.0) — observations derived from records, pattern mining,
  falsifiable hypotheses with integer confidence, reflection, a knowledge store with a
  verification/invalidation lifecycle and cascading staleness, replay plans, and
  reproducible benchmarks with regression detection.
* **CLI** (`@nexa/cli` 0.2.0) and `tools/nexa.mjs` — `check`, `compile`, `explain`, `run`,
  `gate`, `version`; the shell is the only place in Ω that touches a filesystem.
* **Tools** — `tools/omega-demo.mjs` (nine sections, compile → run → refuse → evolve →
  benchmark → learn → heal), `tools/omega-attacks.mjs` (13 attacks, 10 categories),
  `tools/omega-vectors.mjs` (`spec/vectors/omega.json`, pinned and diffed in CI).
* **Examples** — `repository-review.nexa` (runs ALLOW end to end), `provider-secrets.nexa`
  (a secret never leaves the vault), `gated-write.nexa` (well-typed, and refused by a
  closed gate), `refused-secret-egress.nexa` (three compile-time refusals at once),
  `evolution-proposal.nexa` (an `evolve` block as data).
* **Documents** — `spec/omega/` (index, language, grammar, types, authority, evidence,
  evolution, learning, MCP) plus `threat-model.md`, which states what is defended, what is
  contained, what is out of scope, and names the test that checks every claim.
* **Tests** — 68 new tests (`tests/omega-{compiler,runtime,security,evolution,learning,invariants}.test.js`),
  taking the suite from 113 to **181**, plus a 13-attack adversarial suite that CI runs.

### Fixed (each found by an adversarial probe or a test, not by review)

* **The step budget was never enforced.** The IR emitted `maxSteps` while the machine read
  `max_steps`, so a mission could run past `max_steps 2` with no denial. The IR now speaks
  snake_case throughout, and the machine reads either spelling.
* **Every `if` was broken end to end.** The analyser replaced the condition *expression*
  with its type attributes, so a conditional compiled and then died mid-mission with
  `OMEGA_E_SCHEMA: unknown expression kind`. Lowering now also refuses to emit an IR
  containing an unlowerable node (`findUnlowered`).
* **A quarantined candidate could be activated.** `activate()` counted samples instead of
  *clean* samples and never checked the quarantine state: a candidate that violated its own
  declared expectations could still be promoted. Fixed with `OMEGA_E_QUARANTINED`.
* **A string literal could be bound to a secret type.** `let key: SecretString = "AIza…"`
  compiled; a credential in the source is not a secret. Now `OMEGA_E_SECRET_LITERAL`.
* **A named provider was ignored when a strategy was set**, so `model.invoke(provider: "gemini")`
  picked the cheapest adapter and refused the credential. Provider selection now honours a
  named adapter before falling back to strategy and cost.
* **Memory tier words were reserved**, which made `policy evolution { … }` a parse error.
  Reserved words are keywords again.
* **An observation counted records instead of calls**, doubling every gate refusal (a refused
  call writes both a `TOOL_RESULT` and a `GATE_REFUSAL`). One call, one count.
* **Grant scopes could only be written one way.** `grant fs.write { scope "/build/**" }` and
  `grant fs.write("/build/**")` now mean the same thing.

### Verified

`npm run verify` passes end to end on Node 22: posture (`6 gates CLOSED, 14 gated
namespaces, 8 Ω gate stages, 11 attack categories, 6 immutable kernel modules, 72 Ω error
codes`), `npm test` 207/207, `npm run audit` 16/16, all three demos, `npm run attacks` 23/23
blocked, and the gate report.

## [0.1.0] — 2026-09-18

First complete cut of the protocol core. Everything below is implemented and covered
by the test suite; nothing is aspirational.

### Added

* **Canonical form (NEXA-C14N)** — sorted keys by code unit, safe integers only, NFC
  strings, minimal escaping, unpaired surrogates rejected, plain objects only, 64-level
  depth cap, and a strict `parseCanonical` that rejects anything not already canonical.
* **Crypto** — Ed25519 via `node:crypto`, self-certifying key ids
  (`nexa:key:ed25519:z<base58btc(0xed01||pubkey)>`), base58btc/base64url codecs,
  sha256 multihashes, 128-bit nonces, domain-separated signing payloads.
* **Identity** — self-signed identity documents, out-of-band fingerprints, and a
  pin-or-reject `TrustStore` with explicit revocation (no implicit TOFU anywhere).
* **Capabilities** — mint, attenuate, verify and revoke. Subset-only delegation across
  scope, actions, time window, use budget, depth and constraints (numbers may shrink,
  arrays may shrink, strings must match, dependency constraints cannot be dropped),
  plus a `delegate_to` allowlist. Chain signatures bind each child to its exact parent.
* **Policy** — default-deny engine with deterministic rule order, namespace wildcards,
  subject scoping, and six hard gates checked before any rule.
* **Evidence** — hash-chained append-only log (edit/delete/reorder/forge detection) and
  signed receipts for both ALLOW and DENY, cross-checked against the log entry.
* **Protocol** — signed envelopes with a 300-second TTL ceiling, replay guard keyed on
  both message id and nonce, per-link use ledger, and an eight-step endpoint pipeline
  that answers every authenticated request with a receipt.
* **`.nex` syntax** — lexer, parser and deterministic printer, losslessly equivalent to
  the signed envelope.
* **MCP adapter** — JSON-RPC 2.0 bridge; gated tools are refused at construction and
  never listed, denials carry `NEXA_E_*` codes and receipts.
* **Specification and vectors** — eight spec documents plus `spec/vectors/*.json`
  pinning canonical bytes, key derivation, envelope signatures and capability grants.
* **Tooling** — `npm test`, `npm run audit`, `npm run posture`, `npm run demo`,
  `npm run report`, `npm run vectors`, and a CI workflow that fails if a gate is not
  `CLOSED`, an adversarial probe regresses, or a vector drifts out of sync.

### Test-found fixes (before first release)

* `delegate_to` was compared against an undefined subject because `attenuate` never
  passed the child subject to the amplification check.
* Dropping a parent constraint was silently accepted as attenuation; constraints must
  now be carried into the child.
* A capability token carried in the body without the envelope's `cap` field skipped
  verification entirely.
* Resolving a capability could throw out of `Endpoint.receive()` instead of producing
  a recorded, receipted DENY.
* A signed envelope naming a malformed `resource` or `action` threw out of
  `Endpoint.receive()`; it is now a `NEXA_E_SCHEMA` DENY with a receipt.
* A handler returning non-canonical data was reported as a generic failure; it is now a
  recorded `NEXA_E_HANDLER` DENY that does not spend capability budget.
* The resource grammar now allows paths (`fs:/etc/passwd`) while keeping the list of
  dangerous namespaces in exactly one place: the gate table.
* The use ledger accumulated zero-count entries instead of releasing them.

### Security audit round (same day, before merge)

An adversarial suite (`tests/security.test.js`, `npm run audit`) was written against the
finished code. Five probes failed on the first run; each one is now fixed and kept as a
permanent test:

1. **Canonicalization ambiguity.** Two keys that normalize to the same NFC key
   (`"é"` and `"e"` + U+0301) were silently merged, so two different documents could
   produce identical signed bytes. Now `NEXA_E_C14N_FORM`. `__proto__` is refused as an
   object key (`NEXA_E_C14N_TYPE`).
2. **No authority origin.** `verifyCapability` proved only that a token was internally
   consistent, so *any* key — including a merely-pinned peer — could self-issue a
   capability and have it honored. Added `trustedIssuers` (library) and
   `capabilityIssuers` (endpoint), **empty by default**: an endpoint with no named
   authority obeys no capability, and says how to name one.
3. **Unattributed revocation.** Anyone could sign a revocation record naming a
   capability id they did not own and take it out of service. Revocations are now
   attributed: `RevocationSet.revokes(id, chainIssuers)`, `add(record, {issuers})`,
   `issuersOf(id)`; `verifyCapability({revoked: revocationSet})` only counts records
   from issuers inside the chain.
4. **Unbounded work before authentication.** An oversized body was canonicalized (and
   therefore hashed) before any size check. Bodies over 64 KiB are now refused with
   `NEXA_E_TOO_LARGE` before hashing or signature verification, with no reply and no
   evidence record.
5. **Rules and evidence accepted non-data.** Policy rules that were class instances
   (behaviour, crafted prototypes) are refused with `NEXA_E_POLICY`; `EvidenceLog.append`
   now rejects unknown fields instead of silently dropping them, so an audit entry can
   never under-report what was recorded.

Three further probes were corrected rather than the code: a duplicate-key probe that
JavaScript cannot express, a log-splicing probe whose premise (a legitimately chained
foreign record) is impossible by construction, and an expectation that an unknown
envelope field would fail signature verification when it is in fact refused earlier by
schema validation — an earlier refusal being the stronger one.

Two verification tools were added alongside the audit:

* `npm run posture` — refuses to pass unless all six gates are
  `CLOSED`, the gate tables are intact, and no source under `packages/` or `adapters/`
  imports `child_process`, `fs`, network modules, `vm`, `eval` or `Function`.
* `npm run proof:permission` — runs the full protocol flow (identity, capability, ALLOW,
  gate DENY, evidence chain, MCP posture) under Node's permission model, and **fails if
  the runtime does not deny** a filesystem write, a child process and a network call.
  Without that second assertion the sandbox would prove nothing.

### Security posture

All six gates — `REAL_EXECUTION`, `TERMINAL`, `FILESYSTEM_WRITE`, `AUTO_COMMIT`,
`AUTO_PUSH`, `AUTO_DEPLOY` — are `CLOSED`. See `SECURITY.md`.
