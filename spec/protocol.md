# NEXA Protocol v0.1

Status: **draft specification, implemented and tested in this repository.**
Normative words: MUST, MUST NOT, SHOULD, MAY (RFC 2119).

## 1. Purpose

NEXA specifies how an autonomous agent asks a peer to do something, and how the peer
decides — with a cryptographic answer for both outcomes.

It exists to make three questions answerable *after the fact*:

1. **Who** asked? — a self-certifying key id, never a name.
2. **On what authority?** — a signed capability token the verifier can check offline.
3. **What was decided, and why?** — a signed receipt pointing into a hash-chained log.

NEXA v0.1 deliberately specifies *no* way to execute commands, write files, use a
terminal, commit, push or deploy. Those six gates are closed (§10).

## 2. Design rules

| # | Rule | Where it is enforced |
| --- | --- | --- |
| R1 | One value, one byte string: canonical form before signing | `packages/ast` NEXA-C14N |
| R2 | Domain separation between every signed object type | `*_DOMAIN` constants |
| R3 | Default-deny: absence of a rule is a DENY | `packages/policy` |
| R4 | Authority only shrinks: delegation is subset-only | `packages/capability` |
| R5 | Every decision is recorded, ALLOW and DENY alike | `packages/evidence` |
| R6 | Unauthenticated input has no side effects and no reply | `Endpoint.receive` steps 1–3 |
| R7 | Closed gates are checked before policy, not by policy | `checkGates` in the CALL path |
| R8 | No hidden state: replay, budget and revocation are explicit objects | `ReplayGuard`, `UsageLedger`, `RevocationSet` |

## 3. Identity

* A key id is `nexa:key:ed25519:z<base58btc(0xed01 || pubkey32)>`.
  It is **self-certifying**: the id contains the public key, so a verifier never
  needs a registry to check that "this id" is "this key".
* An identity document is a self-signed statement binding that key id to a label,
  a kind (`operator` / `agent` / `service` / `peer`) and a scope. See `spec/identity.md`.
* **Trust is a local decision.** A document being valid does not make it trusted.
  `TrustStore` is pin-or-reject: unknown key ids raise `NEXA_E_UNTRUSTED`, and pinning
  can require an expected key id or fingerprint observed out of band.

## 4. Envelope

Every message is an envelope; it is the only object that travels on the wire.

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `nexa` | string | yes | always `"0.1"` |
| `type` | string | yes | one of `HELLO`, `CAP_GRANT`, `CALL`, `RESULT`, `DENY`, `EVIDENCE`, `RECEIPT`, `ERROR` |
| `id` | string | yes | `urn:nexa:msg:` + base64url, 128-bit random |
| `from` | kid | yes | sender; MUST equal `sig.kid` |
| `to` | kid | yes | recipient; a receiver MUST reject mail addressed elsewhere |
| `ts` | RFC 3339 UTC | yes | second precision |
| `exp` | RFC 3339 UTC | yes | MUST be `<= ts + 300s` |
| `nonce` | base64url | yes | 128-bit random, unique per message |
| `cap` | capability id | no | id of the token carried in `body.capability`; a mismatch is an error |
| `in_reply_to` | message id | no | set on every `RESULT` / `DENY` |
| `body` | object | yes | canonicalizable, `<= 64 KiB` |
| `sig` | object | yes | `{alg:"ed25519", kid, val}` |

**Unknown fields are rejected.** There is no extension point in v0.1 precisely so that
nothing can ride alongside a signature without being covered by it.

## 5. Verification order at a receiver

Each step can only DENY. A failure at step *n* means steps after it never ran.

1. structure + signature + freshness + TTL bound
2. recipient binding (`to == self`)
3. replay guard (`id` and `nonce`, commit only after step 1 succeeded)
4. sender trust (trust store)
5. **hard gates** (§10)
6. capability verification (signature chain, subset rules, budget, presenter binding, revocation)
7. policy evaluation (default-deny)
8. handler dispatch (in-memory), then budget spend

Steps 1–3 failures produce **no reply** (R6); steps 4–8 produce a signed `DENY`
envelope carrying the reason code and a receipt.

## 6. Message types

| Type | Direction | Meaning |
| --- | --- | --- |
| `HELLO` | any | present an identity document; never auto-pins trust |
| `CAP_GRANT` | issuer → holder | deliver a capability out of band from a `CALL` |
| `CALL` | requester → endpoint | ask for `{resource, action, args}` |
| `RESULT` | endpoint → requester | ALLOW: `{ok:true, value, ref, receipt}` |
| `DENY` | endpoint → requester | refusal: `{code, message, details?, receipt?}` |
| `EVIDENCE` | any | ship evidence records or a chain proof |
| `RECEIPT` | any | ship a standalone signed receipt |
| `ERROR` | any | protocol-level fault (malformed, unsupported) |

v0.1 receivers implement `HELLO` and `CALL`; the remaining types are defined so that
the envelope format is stable, and `receive()` refuses them with `NEXA_E_SCHEMA`.

## 7. Failure codes

All failures are `NEXA_E_*` codes (`packages/ast/src/errors.js`). The code, not the
message, is the contract; `DENY.reply.body.code` carries it.

`NEXA_E_PARSE`, `NEXA_E_SCHEMA`, `NEXA_E_C14N_*`, `NEXA_E_KEY`, `NEXA_E_SIG`,
`NEXA_E_SIG_ALG`, `NEXA_E_REPLAY`, `NEXA_E_EXPIRED`, `NEXA_E_CLOCK`, `NEXA_E_TTL`,
`NEXA_E_UNTRUSTED`, `NEXA_E_IDENTITY`, `NEXA_E_CAP_MISSING`, `NEXA_E_CAP_INVALID`,
`NEXA_E_CAP_EXPIRED`, `NEXA_E_CAP_AMPLIFY`, `NEXA_E_CAP_USES`, `NEXA_E_CAP_AUDIENCE`,
`NEXA_E_CAP_REVOKED`, `NEXA_E_POLICY`, `NEXA_E_GATE`, `NEXA_E_NO_HANDLER`,
`NEXA_E_HANDLER`.

## 8. Transport

v0.1 is transport-agnostic and defines no wire framing beyond the envelope itself.
The reference implementation exercises envelopes **in process**; `.nex` (see
`spec/grammar.md`) is the human-readable rendering, and `adapters/mcp` bridges
envelopes to MCP JSON-RPC 2.0 without loosening any gate.

## 9. Versioning

`nexa: "0.1"` appears in envelopes, identity documents, capability tokens and
evidence records. A receiver MUST reject an unknown version rather than guess.
Changing a signed object's field set is a breaking change and requires a new
version string.

## 10. Closed gates (v0.1)

| Gate | State | Enforced by |
| --- | --- | --- |
| `REAL_EXECUTION` | CLOSED | `GATED_RESOURCES` (`exec`, `shell`, `process`) + `GATED_ACTIONS` (`exec`, `spawn`, `shell`) |
| `TERMINAL` | CLOSED | `GATED_RESOURCES` (`terminal`, `tty`) |
| `FILESYSTEM_WRITE` | CLOSED | `GATED_RESOURCES` (`fs`, `file`) + `GATED_ACTIONS` (`write`, `delete`, `move`, `chmod`) |
| `AUTO_COMMIT` | CLOSED | `GATED_RESOURCES` (`vcs`, `git`) + `GATED_ACTIONS` (`commit`) |
| `AUTO_PUSH` | CLOSED | `GATED_RESOURCES` (`push`, `remote`) + `GATED_ACTIONS` (`push`, `merge`) |
| `AUTO_DEPLOY` | CLOSED | `GATED_RESOURCES` (`deploy`, `release`, `infra`) + `GATED_ACTIONS` (`deploy`, `release`, `publish`) |

A gated request is refused with `NEXA_E_GATE`, a `GATE_BLOCKED` evidence record, and a
signed receipt. There is no configuration, capability or policy that reopens a gate —
`packages/policy/src/gates.js` exposes no setter, and the CALL path calls `checkGates`
before `policy.evaluate`.
