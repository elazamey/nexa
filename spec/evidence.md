# Evidence specification

## Record

```json
{
  "nexa": "0.1",
  "seq": 4,
  "ts": "2026-09-18T12:00:10Z",
  "kind": "POLICY_DECISION",
  "decision": "ALLOW",
  "actor": "nexa:key:ed25519:z...",
  "subject": "nexa:key:ed25519:z...",
  "resource": "tool:echo",
  "action": "call",
  "capability": "urn:nexa:cap:...",
  "detail": { "rule": "allow-echo", "policy": "urn:nexa:policy:default" },
  "prev": "sha256:...",
  "hash": "sha256:...",
  "sig": { "alg": "ed25519", "kid": "...", "val": "..." }
}
```

Kinds: `ENVELOPE_ACCEPTED`, `ENVELOPE_REJECTED`, `CAPABILITY_VERIFIED`,
`CAPABILITY_REJECTED`, `POLICY_DECISION`, `GATE_BLOCKED`, `HANDLER_RESULT`,
`REVOCATION_RECORDED`, `PEER_PINNED`, `PEER_REVOKED`.
Decisions: `ALLOW`, `DENY`, `INFO` (INFO events are context, not verdicts).

## Chaining

```
hash_n  = sha256("NEXA/0.1 evidence record\0" || C14N(record_n \ {hash, sig}))
prev_0  = "sha256:" + base64url(43 zero bytes)     # genesis
prev_n  = hash_(n-1)
```

`seq` starts at 0 and increments. `verifyEvidenceChain(records)` re-derives every hash,
checks linkage and `seq` continuity, and verifies every signature. Therefore:

| Attack | Detected as |
| --- | --- |
| edit a record | `evidence record N was modified after sealing` |
| delete a record | `evidence chain broken at seq N` |
| reorder records | `evidence record out of order at position N` |
| forge a record | `evidence record N has an invalid signature` |
| substitute another actor's log | `evidence record N was emitted by another actor` |

The log is append-only by construction: `EvidenceLog` exposes `append`, `at`, `entries`,
`head`, `length`, `summary` — and no mutators. `append` accepts a **fixed field set** and
refuses unknown keys (`NEXA_E_SCHEMA`), so a caller's typo cannot produce an audit entry
that quietly under-reports what was recorded.

A chain produced by one `EvidenceLog` always has exactly one actor: a record commits to
`seq` and `prev`, so nobody without the log can extend it, and re-sequencing a foreign
record is detected as tampering. `verifyEvidenceChain(records, {expectActor})` exists for
logs assembled from other sources, and turns any additional signer into a refusal. v0.1 keeps it in memory only
(`FILESYSTEM_WRITE` is closed); durability is the caller's responsibility via
`entries()`.

## Receipts

A receipt is the portable proof of a single decision:

```json
{
  "nexa": "0.1",
  "id": "urn:nexa:msg:...",
  "decision": "DENY",
  "evidence_seq": 7,
  "evidence_hash": "sha256:...",
  "chain_head": "sha256:...",
  "capability": "urn:nexa:cap:...",
  "actor": "nexa:key:ed25519:z...",
  "subject": "nexa:key:ed25519:z...",
  "ts": "2026-09-18T12:00:11Z",
  "sig": { "alg": "ed25519", "kid": "...", "val": "..." }
}
```

* Signed over `"NEXA/0.1 receipt\0" || C14N(receipt \ {sig})`.
* `ALLOW` and `DENY` both produce receipts. A refusal that cannot be proven is not
  much better than a silent failure.
* `matchReceiptToRecord(receipt, record)` binds a receipt to the log entry it names, so
  a receipt cannot reference work that never happened.
* `chain_head` pins the state of the log at decision time: presenting the receipt
  together with a chain head proves the decision was recorded, and pinning the receipt
  alone proves *who* decided *what* without shipping the whole log.

## What evidence is *not*

Evidence is not a ledger of authority and not a transport. It is a local, signed,
tamper-evident record of decisions taken by one endpoint. Cross-endpoint reconciliation
(sending `EVIDENCE` envelopes, comparing heads) is specified but out of the v0.1
implementation scope.
