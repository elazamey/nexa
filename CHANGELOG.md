# Changelog

All notable changes to NEXA are recorded here. The format follows Keep a Changelog,
and the project uses semantic versioning once it leaves `0.x`.

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

### Security posture

All six gates — `REAL_EXECUTION`, `TERMINAL`, `FILESYSTEM_WRITE`, `AUTO_COMMIT`,
`AUTO_PUSH`, `AUTO_DEPLOY` — are `CLOSED`. See `SECURITY.md`.
