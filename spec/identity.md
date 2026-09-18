# Identity specification

## Key ids

```
kid = "nexa:key:ed25519:z" || base58btc( 0xed 0x01 || pubkey32 )
```

`0xed01` is the multicodec `ed25519-pub` prefix; `z` is the multibase prefix for
base58btc. Properties:

* **Self-certifying.** The public key is inside the id; `publicKeyFromKeyId(kid)`
  needs no registry. Comparing a key id to a document's published key is enough to
  detect substitution.
* **Collision-free by construction.** Two different keys cannot share an id without a
  base58 collision, which is not a practical concern.
* **No names.** Labels are metadata, never identifiers. Nothing is authorized because
  it claimed a name.

## Identity document

```json
{
  "nexa": "0.1",
  "kid": "nexa:key:ed25519:z...",
  "label": "agent-01",
  "kind": "agent",
  "scope": "nexa:local",
  "created": "2026-09-18T12:00:00Z",
  "not_before": "2026-09-18T12:00:00Z",
  "not_after": "2999-01-01T00:00:00Z",
  "keys": [ { "kid": "nexa:key:ed25519:z...", "alg": "ed25519", "public_key": "<base64url 32B>" } ],
  "sig": { "alg": "ed25519", "kid": "<same as kid>", "val": "<base64url 64B>" }
}
```

Rules:

* `kind` ∈ `{operator, agent, service, peer}`.
* `sig.kid` MUST equal `kid`: a document is **self-signed**, so it can never be used to
  vouch for someone else.
* Every published key MUST have `kid == document.kid`, and its `public_key` MUST
  re-derive that exact key id.
* `not_after` MUST be after `not_before`.
* Unknown fields are rejected (`NEXA_E_IDENTITY`).

Payload signed: `UTF8("NEXA/0.1 identity document\0") || NEXA-C14N(document \ {sig})`.

## Trust

A valid document proves only *self-consistency*. Trust is decided locally by
`TrustStore`:

| Operation | Behaviour |
| --- | --- |
| `pin(document)` | verifies, then stores. Optional `expectKid` / `expectFingerprint` turn a pin into an out-of-band match |
| `require(kid)` | throws `NEXA_E_UNTRUSTED` for unknown or revoked ids |
| `revoke(kid)` | keeps the record, marks it not trusted, `size`/`list()` exclude it |

There is **no implicit TOFU** anywhere: receiving a `HELLO` never adds trust. The
endpoint records a `PEER_PINNED` evidence entry describing the presented identity, but
`trust.require()` still fails until an operator pins it explicitly.

## Fingerprints

```text
identityFingerprint(document) = "nexa:fp:" || base58btc(sha256(NEXA-C14N(document)))[0..24)
```

A fingerprint is the thing an operator reads aloud or compares across two machines to
make a pin out-of-band. It is a hash of the whole document, so any change — including
a changed label or key list — changes the fingerprint.

## Non-goals in v0.1

* No key rotation certificates (a rotated identity is a new key id and a new pin).
* No certificate authorities, delegation of identity, or name systems.
* No key revocation lists; identity-level trust is revoked locally.
