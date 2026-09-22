# Incident — a counterfeit proof endpoint, and why it was deleted rather than renamed

**Date:** 2026-09-22
**Severity:** high (claim integrity), low (runtime)
**Impact:** no data loss, no unsafe write. `POST /api/v1/omega/z3/verify`
returned proof-shaped verdicts with no verifier behind them, and the dashboard
rendered them as results.

## What it did

The endpoint advertised a real SMT solver by name and version and returned:

```
{"code":"this is not code at all @@@","preconditions":["nonsense"],"postconditions":["false"]}
  -> {"result":"SAT","verified":true,"counterExample":null,
      "proof":"Z3_PROOF_..._VERIFIED_SAT_1790039562567"}

{"code":"x=1","preconditions":["x>0"],"postconditions":["x<0"]}
  -> {"result":"SAT","verified":true,"counterExample":null}
```

`x>0 ⊢ x<0` is a contradiction. It returned `verified: true`. So did syntactic
garbage. The implementation counted array lengths, looked for three literal
substrings, and formatted a string containing `VERIFIED`. Its own comment said
`// Mock Z3 solving`.

There is no solver in this repository and there cannot be: zero runtime
dependencies is a standing constraint.

## Why this was the worst possible defect here

`docs/principles.md` P1 exists for exactly this:

> A proof that is subtly wrong verifies successfully and means nothing.

This one was not even subtle. Everything this project claims rests on one
discipline — no claim ships until a mutation has killed a test that defends it.
An endpoint emitting `verified: true` from array arithmetic inverts that
discipline while wearing its vocabulary.

## Why deleted, not renamed

Renaming to `mock` or `simulation` was rejected:

1. **Clients read fields, not labels.** A field named `verified` is consumed by
   the caller; the adjective beside it is not.
2. **Naming a real product in fabricated output is a false claim,** not a
   declared simulation.
3. **P1 applied to the fix itself.** The only mutation that kills
   `verified: true` is removing the field. Renaming kills nothing — so by this
   project's own rule, renaming is not a fix.
4. `verified: false` always, with `reason: "no proof engine"`, was also
   rejected: it keeps the verdict field in the contract, and invites a future
   caller to branch on it.

## What was removed

- `POST /api/v1/omega/z3/verify` — the route, its advertisement in the API
  index, and its startup log line.
- The fields `verified`, `proof`, `result` (SAT/UNSAT), `solver` and
  `counterExample` from the engine's output.
- `FormalZ3VerificationEngine` → `HeuristicCodeScreeningEngine`, which returns
  `{ flagged, matchedPatterns, method: 'literal substring scan', limits }` and
  carries its limits in the payload so they travel with the data.
- The panel card that rendered proof counts and SAT rates, and the
  `proofSignature` line in the task result.
- A **second instance**, found by the guard test rather than by reading:
  `packages/cells/celia/ultimate/src/z3-verifier.js` contained
  `|| true, // Mock pass for demo` — an unconditional pass dressed as a check —
  plus five `proof: 'Z3 proved ...'` strings.

## The guard

`tests/no-counterfeit-proof-claims.test.js` enforces structural rules rather
than chasing strings, so the next instance is caught without anyone remembering
this one:

1. No module may name a solver product (with a version, or as
   `Z3 proved ...`) that is not installed.
2. Any module admitting to be a mock must not emit verdict-shaped fields.
3. The deleted endpoint stays deleted.
4. The screening engine emits no `verified` / `proof` / `result` / `solver` /
   `counterExample` field at all.

Both mutations were executed: reintroducing `proof: 'Z3 proved null safety'`
kills rule 1, and restoring the route kills rule 3.

## A process note worth keeping

While reverting a mutation I ran `git checkout` on the server file and silently
undid the real deletion along with it. The tests caught it immediately (rule 3
failed, then the endpoint reappeared in a grep). Reverting a mutation by
checking out a file that also contains intended, uncommitted work destroys the
work — the same shape as the stale-base incident: an action that looks like a
restore is actually a loss.

## Limits of this fix, declared

- The screening engine is a substring scan and says so in its payload. It is
  not analysis, and a clean result is not evidence of correctness.
- The guard tests are lexical. They catch products named in source; they cannot
  detect a counterfeit that invents a plausible in-house name.
- Other engines in the same family still emit confident prose (`claim` fields).
  They were not audited here. This incident covers proof-shaped verdicts only.
