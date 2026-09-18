# Capability specification

A capability is a signed, offline-verifiable grant of authority with a budget. It is
macaroon-style: attenuation is a *local* operation for the holder, and verification is
a *local* operation for the receiver. No issuer round-trip is needed at use time.

## Token shape

```json
{
  "nexa": "0.1",
  "id": "urn:nexa:cap:...",
  "issuer": "nexa:key:ed25519:z...",
  "subject": "nexa:key:ed25519:z...",
  "resource": "tool:echo",
  "actions": ["call"],
  "caveats": { "nbf": "...", "exp": "...", "max_uses": 5, "max_depth": 1 },
  "constraints": { "max_args_bytes": 1024, "mode": ["safe"], "delegate_to": ["nexa:key:ed25519:z..."] },
  "proof": { "kind": "ed25519", "parent": null, "alg": "ed25519", "kid": "...", "val": "..." }
}
```

* `issuer` — who granted (root) or delegated (chain link).
* `subject` — the **holder**: the only key id that may present the token. A receiver
  binds it to the envelope sender (`presenter`), so holding someone else's token is
  not the same as being allowed to use it.
* `resource` / `actions` — the scope.
* `caveats.exp - caveats.nbf <= 24h` (`NEXA_E_TTL`); `max_uses <= 10 000`;
  `max_depth <= 8`.
* `constraints` — flat `name -> number | string | string[]`. Numbers are upper bounds,
  strings are exact matches, arrays are allowed-value sets. The reserved name
  `delegate_to` is an allowlist of subjects the token may be handed to; it is checked
  when delegating and is *not* inherited by the child.

## Proofs

| kind | payload |
| --- | --- |
| `ed25519` (root) | `UTF8("NEXA/0.1 capability\0") \|\| C14N(token \ {proof})`, signed by `issuer` |
| `chain` (delegated) | `UTF8("NEXA/0.1 capability delegation\0") \|\| C14N(child \ {proof}) \|\| C14N({parent_hash})`, signed by the delegator |

The delegation payload commits to `sha256(NEXA-C14N(parent))`, so a child cannot be
re-parented under a different (more permissive) token after it was signed.

## Attenuation — "authority may only shrink"

`attenuate(parent, {...})` refuses to produce a child that widens any axis:

| Axis | Rule |
| --- | --- |
| resource | `child.resource == parent.resource` or nested beneath it (`parent:x` / `parent.x`) |
| actions | `child.actions ⊆ parent.actions` |
| `nbf` | `child.nbf >= parent.nbf` |
| `exp` | `child.exp <= parent.exp` |
| `max_uses` | `child.max_uses <= parent.max_uses` |
| `max_depth` | `child.max_depth <= parent.max_depth - 1` |
| constraints | numbers may only decrease, strings must match, arrays may only shrink |
| delegator | MUST be `parent.subject` or `parent.issuer` |
| `delegate_to` | child subject MUST be listed, when the parent constrains it |

Violations raise `NEXA_E_CAP_AMPLIFY` **at mint time**, and the identical checks run
again **at verify time** on the received chain — because a token that arrives over the
wire may have been assembled by someone who skipped the minting API entirely.

## Verification

`verifyCapability(token, {presenter, now, revoked, uses, action, resource})` walks the
chain from the tip to the root and checks:

1. shape, field set, caveat bounds (`validateCapabilityShape`)
2. each link's signature (root: issuer key; link: delegator key)
3. linkage: `child.issuer ∈ {parent.subject, parent.issuer}`
4. subset rules from the table above, for every adjacent pair
5. no link in the chain is in the revocation set
6. freshness on every link; the effective window is the intersection
7. `presenter == token.subject`, when a presenter is supplied (the endpoint always
   supplies `envelope.from`)
8. remaining budget on every link = `min(max_uses - used)`; any exhausted link denies
9. chain depth within the root's `max_depth`
10. requested `action` / `resource` are actually granted

Result: a `grant` object with the effective window, depth, chain of ids and remaining
uses.

Capabilities are verified *before* policy is asked. A capability failure never reaches
policy, and policy can never override a capability failure: the effective authority of
a request is `capability ∩ policy`, minus everything behind a closed gate.

## Budget accounting

`UsageLedger.spend(chainIds, caveats)` debits **every link** atomically. A use of a
delegated capability therefore consumes both the child's and the parent's budget, so
redelegation cannot multiply authority. A dry run (`receive(envelope, {execute:false})`)
never spends budget.

## Revocation

NEXA has no online revocation lookup. Instead an issuer publishes a signed record:

```json
{ "nexa": "0.1", "cap": "urn:nexa:cap:...", "issuer": "nexa:key:ed25519:z...",
  "ts": "...", "reason": "compromised", "sig": { ... } }
```

`RevocationSet` verifies records on the way in, refuses conflicting issuers for the
same capability, and answers `hasAnyInChain(token)` — revoking a root therefore revokes
everything delegated from it. Verifiers pass `revoked: revocationSet.asSet()` into
`verifyCapability`.

## Non-goals in v0.1

* No third-party (discharge) macaroons.
* No capabilities over the six closed gates — a capability naming `fs:` or `vcs:`
  still cannot be exercised, because gates are checked first.
