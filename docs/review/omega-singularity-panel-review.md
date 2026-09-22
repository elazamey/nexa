# Review — OmegaPanel vs SingularityPanel

Executed against the running dev stack (API on 3001, Vite on 5173). Every
finding below was reproduced with a live request, not read off the source.

---

## 1. BLOCKER — both panels read the wrong shape, and render `NaN` today

The API wraps everything in `stats`:

```json
{ "ok": true, "version": "v1.1-omega-...", "stats": { "version": ..., "uptime": ..., "executionLog": ..., "omega": {...}, "singularity": {...} } }
```

Both panels do `fetch(...).then(r => r.json()).then(setStats)` — storing the
**envelope**, then reading fields off its root.

Measured, with the server running:

| Expression in the panel | Actual value | Rendered |
|---|---|---|
| `stats?.version` | `"v1.1-omega-beyond-singularity-true-final"` | works *by accident* — `version` exists at both levels |
| `stats?.executionLog` | `undefined` | `0` (the `|| 0` fallback hides it) |
| `stats?.uptime` | `undefined` | **`NaNs`** — `(undefined/1000).toFixed(1)` |
| `stats?.omega` | `undefined` | the entire 10-engine section **never renders** |
| `stats?.singularity` | `undefined` | the entire foundation section **never renders** |

Identical defect in `SingularityPanel` (`stats.singularity.*`,
`stats.infinite.infinite.*` — all one level too shallow).

**So the visible result is: a header, four cards, one of which reads `NaNs`,
and nothing else.** The detail grids that make up ~80% of both files are dead
code in the current build.

`version` working by coincidence is the worst part — it makes the panel look
connected while every other field is broken.

**Fix (one line each):** `.then(j => setStats(j.stats ?? j))`.

## 2. The data source is a simulation, and the UI presents it as proof

This is the substantive finding, and it is not a bug — it is a labelling
problem that principle P1 exists to catch.

`POST /api/v1/omega/z3/verify` is labelled *"Formal Z3 SAT verification →
mathematically proven"* and returns `solver: "Z3 SMT v4.12"`. It is not a
solver. Two live requests:

```
{"code":"this is not code at all @@@","preconditions":["nonsense"],"postconditions":["false"]}
  -> {"result":"SAT","verified":true,"counterExample":null,
      "proof":"Z3_PROOF_..._VERIFIED_SAT_1790039562567"}

{"code":"x=1","preconditions":["x>0"],"postconditions":["x<0"]}
  -> {"result":"SAT","verified":true,"counterExample":null}
```

A contradiction (`x>0` ⊢ `x<0`) returns **verified: true**, and so does
syntactic garbage. The endpoint counts array elements and formats a string
containing `VERIFIED`. There is no Z3 dependency in the repo (zero runtime
dependencies is a standing constraint), so there could not be.

This is exactly the failure mode written down in `docs/principles.md` P1:

> A proof that is subtly wrong verifies successfully and means nothing.

Here it is not even subtle. The panel then renders `proofSignature`, `Proof:`,
`SAT`, and `✅ YES` — presenting a formatted string as a mathematical result.

Same pattern across the other indicators: `stats.omega.*.claim` fields are
static marketing strings shipped by the server ("spooky action instant any
distance", "extracts order from chaos"), and the counters are all `0` because
nothing has run. The footer lists "ZK-Proof 2.3KB 1ms", "FPGA 1000x",
"Post-Quantum Kyber768" — and Kyber is **verified unavailable** on this runtime
(`ml-kem-768` fails `generateKeyPairSync`, see
`docs/design/2026-deep-engineering-proposals.md`).

**Verdict: none of the indicators on either panel is a measured result.** They
are hardcoded literals (`80`, `70`), server-supplied prose, or zero counters.

Contrast with what *is* proven in this repo: 555 tests, 6 gates CLOSED, 31/31
attacks, each backed by a mutation matrix under `docs/evidence/`. **None of
that appears on these two panels.** The dashboard shows the unproven work and
hides the proven work.

## 3. Loading, failure and empty states — absent by construction

Both panels have exactly one state variable (`stats = null`) and this error
handling:

```js
fetch('/api/v1/omega/stats').then(r => r.json()).then(setStats).catch(() => {});
```

- **`.catch(() => {})`** — a swallowed error. A dead API is indistinguishable
  from a working one; the panel simply shows fallback values forever.
- **No `res.ok` check.** A 500 returning HTML throws inside `r.json()` and is
  swallowed by the same empty catch.
- **No loading state.** `stats === null` renders the same fallbacks as a failed
  fetch (`'v1.1-omega'`, `0`, `'0s'`), so the user cannot tell *loading* from
  *broken* from *genuinely zero*.
- **No empty state.** Counters of `0` are displayed identically whether the
  engine ran and found nothing or never ran at all — the same
  absence-vs-evidence confusion as principle P2.
- The execute path is slightly better (it pushes `{engine:'error'}` into logs)
  but still never checks `res.ok`, so an HTTP 500 with a JSON body renders as a
  successful result with `undefined` fields.

## 4. Access control — none, and identifiers are exposed

- No authentication, authorization or capability check on any
  `/api/v1/omega/*` or `/api/v1/singularity/*` route. Grepped: no auth in these
  handlers.
- `POST .../execute` is unauthenticated **state mutation** (it appends to
  execution logs and bumps counters).
- `ownerKid` values are returned to any caller:
  `nexa:omega:kernel:api:v1.1`, `...:singularity`, `...:singularity:infinite`.
  Low severity — they are internal labels, not keys — but they are internal
  topology disclosed for free.
- The server binds `0.0.0.0`. Correct and necessary **in this sandbox** (the
  browser is outside it), unacceptable anywhere reachable.

Worth stating plainly: the governed commit port has capability verification,
attenuation, single-use consumption and an intent log. **These endpoints share
none of it.** Two different security models in one process.

## 5. UI/API contract — no shared type, no validation, silent drift

The panels navigate 4–5 levels of optional chaining
(`stats.singularity.singularity.fpga?.bitstreams`) with no schema, no
validation, and no test. Optional chaining makes every mismatch render as blank
rather than fail — which is precisely why finding #1 survived into the repo.

## 6. Automated coverage — zero

- No test script in `dashboard/package.json`; no test files under
  `dashboard/`.
- Nothing in `npm run verify` touches the dashboard or these endpoints.
- No browser test, no smoke test, no contract test.

Two cheap, high-value additions (neither needs a browser or a new dependency):

1. **A contract smoke test** — start the server, `GET` each stats endpoint,
   assert the exact paths the panels read actually exist. This finding #1 would
   have been caught the day it was introduced.
2. **A claim-integrity test** — assert `z3/verify` returns `verified: false`
   for a contradiction. It currently returns `true`, so this test fails today,
   which is the correct outcome: the test is right and the endpoint is wrong.

---

## Comparison

| Aspect | OmegaPanel | SingularityPanel |
|---|---|---|
| Lines | 193 | 242 |
| Shape bug | yes (`stats.omega`) | yes (`stats.singularity`, `stats.infinite.infinite`) |
| Nesting depth read | 3 | 4 |
| Hardcoded "totals" | `80` | `70` |
| Renders `NaNs` | yes | yes |
| Error handling | `.catch(() => {})` | `.catch(() => {})` |
| Auth | none | none |
| Tests | none | none |

They are the same component with different strings; `OmegaPanel` additionally
embeds `SingularityPanel`'s data under `stats.singularity.singularity`. Whatever
is decided applies to both.

---

## Recommendation, in priority order

1. **Fix the shape bug** (one line per panel). Cheap, and makes the panels show
   what they claim to show.
2. **Add the contract smoke test** so it cannot silently regress.
3. **Relabel or remove the proof claims.** `verified: true` on a contradiction
   is the one finding I would treat as blocking: it is a counterfeit proof, and
   the repository's entire credibility rests on the opposite discipline. Either
   the endpoint stops saying "verified"/"Z3"/"proof", or it is removed.
4. **Do not deploy.** Unauthenticated mutating endpoints plus proof-shaped
   output aimed at a public audience.

I have not changed any panel code. Fixes #1 and #2 are small and safe, #3 is a
product decision about claims, not an engineering one — tell me which to make.
