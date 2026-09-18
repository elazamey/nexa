# Policy specification

## Order of evaluation

```
CALL -> hard gates -> first matching rule -> default
```

1. **Hard gates** (`packages/policy/src/gates.js`). Checked before any rule exists in
   the decision. A gated resource or action is refused with `NEXA_E_GATE`. No rule,
   capability or configuration in the system can answer for it.
2. **Rules.** Evaluated in ascending `id` order (the constructor sorts them), first
   match wins. An `ALLOW` rule additionally requires:
   * `require_capability` (default `true`) — a *verified* capability grant must have
     been produced in step 6 of the receive pipeline, and
   * `require_signature` (default `true`) — the envelope signature must have verified.
3. **Default.** No match → `DENY`, `reason: "no rule matched; NEXA v0.1 is default-deny"`.

There is no `defaultEffect` other than `DENY`; passing anything else throws.

## Rule shape

```json
{
  "id": "allow-echo",
  "effect": "ALLOW",
  "resource": "tool:echo",
  "resource_prefix": "tool:echo",
  "actions": ["call"],
  "subjects": ["nexa:key:ed25519:z..."],
  "require_capability": true,
  "require_signature": true,
  "description": "echo is a pure function and safe to expose"
}
```

* `resource` accepts an exact value, a namespace wildcard (`tool:*`) or `*`.
* `resource_prefix` matches the resource itself or anything nested beneath it.
* `subjects` restricts a rule to specific key ids (never labels).
* Unknown fields are rejected (`NEXA_E_POLICY`), so a typo like `alow: true` cannot
  silently turn into a permit.

## Determinism

Rules are validated and sorted at construction; `Policy#digest()` returns a base64url
hash of the canonical policy document. Two endpoints with the same digest evaluate
identical inputs identically — useful when reasoning about a fleet, and useful in
evidence when an auditor asks "under which policy was this ALLOWed?".

## Interaction with capabilities

| Situation | Outcome |
| --- | --- |
| capability invalid | `NEXA_E_CAP_*` from step 6; policy is never consulted |
| capability valid, rule matches ALLOW | `ALLOW` |
| capability valid, no rule matches | `DENY` (`NEXA_E_POLICY`) |
| capability valid, rule explicitly DENY | `DENY` — a DENY rule always outranks an ALLOW |
| no capability, rule matches ALLOW | `DENY` (`require_capability` unmet) |
| gated resource, any capability | `DENY` (`NEXA_E_GATE`) |

**Policy is a filter, never a source of authority.** The maximum authority in a request
is `capability ∩ policy ∩ (everything not gated)`.

## Evidence

Every policy evaluation appends a `POLICY_DECISION` record carrying the rule id, the
policy id and the human reason — for ALLOW and DENY alike.
