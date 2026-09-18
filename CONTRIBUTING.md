# Contributing

NEXA is small on purpose. The rules below exist so it stays checkable.

## Ground rules

1. **Zero dependencies.** Runtime and development. `node:crypto` and the standard
   library only. `npm test` must work after `git clone` with no install step.
2. **No new ambient power.** A change that adds execution, filesystem, terminal, VCS or
   deploy behaviour is out of scope for v0.1, whatever the configuration says.
3. **Sign what you mean, mean what you sign.** New signed object types need a domain
   separator, a spec section, and a vector in `spec/vectors/`.
4. **Fail closed.** New failure paths get a `NEXA_E_*` code in
   `packages/ast/src/errors.js` and a test that proves the refusal.
5. **Every decision is evidence.** If a new step can refuse a request, it must append an
   evidence record and, for authenticated input, produce a receipt.
6. **Authority has an origin.** New capability paths must ask *who may grant this*, not
   only *is the token self-consistent*. Fail closed when the answer is unset.
7. **Attacks become tests.** Every security-relevant fix lands with an entry in
   `tests/security.test.js` that fails without it.

## Workflow

```bash
npm test           # 113 tests
npm run audit      # 16 adversarial probes
npm run posture    # gate posture + no-ambient-authority scan; must pass
npm run proof:permission  # protocol flow under Node's permission model
npm run demo       # end-to-end flow; prints ALLOW, DENY, tamper check
npm run vectors    # regenerate spec/vectors/*.json after a protocol change
```

CI additionally fails when a vector is out of sync with the code, so regenerate and
commit them in the same change.

## Changing the protocol

A protocol change means touching, together:

1. the implementation in `packages/*`,
2. the matching document in `spec/`,
3. the vectors in `spec/vectors/` (via `npm run vectors`),
4. the tests that pin the new behaviour — including at least one *refusal* test.

If a change alters what a signature covers, say so explicitly in the pull request: that
is a breaking change even if every test still passes.

## Tests style

* `node:test` + `node:assert/strict`; no test framework.
* Deterministic: fixed seeds, injected clock (`helpers.mjs`), no network, no subprocess.
* Negative cases are the point. A feature is not done until the ways to misuse it are
  tests that fail loudly.
* Assert on error **codes**, not message text.

## Commit style

Conventional-ish, imperative, with a body that explains *why* the change is safe:

```text
fix(capability): require parent constraints to be inherited

Dropping a constraint silently relaxed a delegated grant. ...

Verified: npm test (113 pass), npm run demo, npm run report (all gates CLOSED)
```
