# Security model

NEXA v0.1 is a protocol for *deciding* and *proving* — not for doing. That distinction
is the whole security story, and it is enforced in code rather than documented as intent.

## The six gates

| Gate | State | Refused at |
| --- | --- | --- |
| `REAL_EXECUTION` | CLOSED | namespaces `exec`, `shell`, `process`; actions `exec`, `spawn`, `shell` |
| `TERMINAL` | CLOSED | namespaces `terminal`, `tty` |
| `FILESYSTEM_WRITE` | CLOSED | namespaces `fs`, `file`; actions `write`, `delete`, `remove`, `move`, `chmod` |
| `AUTO_COMMIT` | CLOSED | namespaces `vcs`, `git`; action `commit` |
| `AUTO_PUSH` | CLOSED | namespaces `push`, `remote`; actions `push`, `merge` |
| `AUTO_DEPLOY` | CLOSED | namespaces `deploy`, `release`, `infra`; actions `deploy`, `release`, `publish` |

Properties worth stating precisely:

* `checkGates()` runs in the CALL path **before** `policy.evaluate()`. A policy rule
  cannot answer for a gated request, because gates never ask policy.
* `packages/policy/src/gates.js` exposes no setter, no environment lookup, no override
  parameter. `GATE_STATE` is frozen at `CLOSED`.
* The evidence log records which gate refused, so a refusal is auditable, not silent.
* Handlers are in-memory and registered by the host process. NEXA never reaches outside
  the process: no filesystem, no sockets, no child processes.

## Threat model

| Threat | Mitigation |
| --- | --- |
| Forged sender | Ed25519 over the whole envelope; key id is self-certifying |
| Replay of a captured request | 128-bit `id` + `nonce`, replay guard committed *after* signature verification |
| Stolen envelope, re-targeted | `to` is signed; a receiver refuses mail addressed elsewhere |
| Signature confused between object types | per-object domain separators |
| Canonical-form ambiguity | strict NEXA-C14N with a re-encode check; floats and unpaired surrogates rejected |
| Authority escalation through delegation | subset-only attenuation, re-checked from the wire; delegation payload binds the parent hash |
| Redelegation multiplying a budget | every use debits the whole chain atomically |
| Untrusted peer | trust store is pin-or-reject; `HELLO` never pins implicitly |
| Pinned peer minting itself authority | `capabilityIssuers` allowlist on the root issuer; empty by default |
| Third party revoking someone else's capability | revocation is attributed to an issuer inside the chain |
| Cheap denial of service through huge payloads | 64 KiB body cap enforced before hashing or verification |
| Signature ambiguity from normalized keys | NFC key collisions and `__proto__` are hard errors |
| Behaviour smuggled in as configuration | policy rules must be plain data; evidence fields are whitelisted |
| Revoked authority | signed revocation records; revoking a root revokes the chain |
| Silent policy gaps | default-deny; unknown rule fields are errors |
| Log rewriting | hash-chained, signed evidence records; edit/delete/reorder/forge all detected |
| Denial-of-service through replay state | unauthenticated input never consumes replay slots and never gets a reply |
| Leaking gate-protected data through an error | DENY bodies carry codes and reasons, never handler output |

## Out of scope for v0.1

* **Durable evidence storage.** The log is in memory; exporting and persisting is the
  host's job (v0.1 has no filesystem capability by design).
* **Cross-endpoint evidence reconciliation.** `EVIDENCE` envelopes are specified but not
  implemented; compare chain heads yourself if you need it.
* **Key rotation and identity-level revocation lists.** A rotated identity is a new key
  id and a new pin.
* **Transport.** NEXA defines envelopes, not framing; secure transport (mTLS, Noise) is
  the caller's responsibility.
* **A hostile host process.** NEXA constrains what the *protocol* allows, not what a
  process with the same privileges could do by ignoring it.

## Test surfaces

| Suite | Purpose |
| --- | --- |
| `npm test` | 113 tests: canonical form, crypto, identity, capability lattice, gates, policy, envelopes, replay, ledger, endpoint pipeline, evidence, parser, MCP |
| `npm run audit` | 16 adversarial probes that must keep failing to break the protocol |
| `npm run posture` | runtime assertion that all six gates are CLOSED and that no protocol/adapter source imports execution or filesystem APIs |
| `npm run vectors` | pinned canonical bytes, key derivation, signatures and capability grants; CI fails on drift |

## Reporting

This is a specification-and-implementation repository with no users, no service, and no
data. If you find a security bug — a way past a gate, an amplification path through
attenuation, or a signature that verifies when it should not — open an issue with
`[security]` in the title and a failing test. A reproduction in `tests/` is the most
useful possible report.
