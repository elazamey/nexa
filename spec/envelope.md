# Envelope specification

An envelope is the unit of transfer. It is canonical (NEXA-C14N), signed with
Ed25519, and valid for at most five minutes.

## Signature computation

```
payload = UTF8("NEXA/0.1 envelope signature\0") || NEXA-C14N(envelope \ {sig})
sig.val = base64url(Ed25519_sign(sender_private_key, payload))
sig.kid = envelope.from
```

`sig` is the *only* field excluded. Adding, removing, reordering or re-encoding any
other field invalidates the signature — which is why unknown fields are rejected
outright by `validateEnvelope`.

## Freshness

* `exp - ts <= 300 seconds` → otherwise `NEXA_E_TTL`.
* `now >= exp` → `NEXA_E_EXPIRED` (no reply).
* `ts > now + skew` (default 30s) → `NEXA_E_CLOCK` (no reply).
* `exp` MUST be strictly after `ts` → otherwise `NEXA_E_SCHEMA`.

The 300-second ceiling is what bounds the replay guard: an entry is only remembered
until the envelope could no longer be accepted.

## Replay

Both `id` and `nonce` are 128-bit random values, and both are committed to the
`ReplayGuard` after verification succeeds. Duplicate either → `NEXA_E_REPLAY`.

Committing *after* signature verification is deliberate: replay state is a limited
resource, and letting unauthenticated traffic consume it would be a trivial
denial-of-service.

## CALL body

```json
{ "resource": "tool:echo", "action": "call", "args": { "text": "hi" }, "capability": { ... } }
```

* `resource` matches `^(tool|fs|vcs|deploy|net|mem|log):[a-z0-9][a-z0-9._-]{0,126}$`.
  Namespaces `exec`, `shell`, `process`, `terminal`, `tty`, `fs`, `file`, `vcs`, `git`,
  `push`, `remote`, `deploy`, `release`, `infra` are gated (§10 of `protocol.md`).
* `action` matches `^[a-z][a-z0-9_-]{0,31}$`.
* `args` is free-form canonical data, capped at 64 KiB, and further capped by the
  capability constraint `max_args_bytes`.
* `capability` carries the **full token**; the envelope's `cap` field is its id. A
  mismatch is `NEXA_E_CAP_INVALID` — the binding exists so that a stripped or swapped
  body is detectable.

## RESULT body

```json
{ "ok": true, "value": { ... }, "ref": "sha256:...", "receipt": { ... } }
```

`ref` is the hash of the `HANDLER_RESULT` evidence record; `receipt` is a signed
receipt for the same record.

## DENY body

```json
{ "code": "NEXA_E_GATE", "message": "...", "details": { "gate": "FILESYSTEM_WRITE" }, "receipt": { ... } }
```

A DENY carries no partial data from the handler: refusals must not leak the very
information the gate exists to protect.

## `.nex` rendering

The examples above render as:

```text
nexa 0.1
@type CALL
@id "urn:nexa:msg:..."
@from "nexa:key:ed25519:z..."
@to "nexa:key:ed25519:z..."
@ts "2026-09-18T12:00:00Z"
@exp "2026-09-18T12:01:00Z"
@nonce ...
body {
  action call
  args { text "hi" }
  resource "tool:echo"
}
```

See `spec/grammar.md`. The `.nex` form is never signed; it is rendered from, and
parsed back into, the canonical envelope.
