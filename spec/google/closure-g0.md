# G0 CLOSURE RECORD

> **Status: CLOSED — 2026-09-18.** Gate G0 (the Google Identity Cell) is closed: its design
> (`spec/google/identity-cell.md` v1.1) was reviewed line by line, the four mandatory amendments
> were incorporated verbatim, the implementation shipped as release 0.4.0, and every clause of the
> definition of done (§ H.6) is met. This document is the record of the closure: what was closed
> (§ 1), the invariants the gate fixes, now held by tests (§ 2), the publishing status of the work
> (§ 3), and what remains open (§ 4).

## 0. What was closed

G0 was the gate for the identity phase only. It never claimed the scopes of the phases after it —
Drive, Gmail, Sheets, Calendar and Gemini writes, and the Firebase transport, are G2–G4, each
behind its own gate of the same kind.

| Step | What happened | Where |
| --- | --- | --- |
| Design | v1.0 presented: identity, scope, binding, vault, capability, evidence, threat-model and test contracts | `spec/google/identity-cell.md` v1 · `spec/google/README.ar.md` · `spec/google/review-g0.ar.md` |
| Review | Four items returned **CHANGE REQUIRED** (identity paths A/B, scope table, class D, revocation/break-glass); replacement text adopted verbatim → v1.1, a design-only commit: no code, no dependency, no CI change, no error code | `spec/google/review-g0.ar.md` § 0 |
| Implementation (G0-H) | Release 0.4.0: the identity cell and the service gateway as external organs; 100 Google tests in five groups; the twelfth attack category (`identity-forgery`, eight attacks); pinned vectors; twelve error codes and five ledger kinds, each registered in the same commit as the behaviour that uses it | `CHANGELOG.md` 0.4.0 |
| Closure | This record: the clauses of done, the invariants as tests, the publishing status | `spec/google/closure-g0.md` (this file) · `tests/google-invariants.test.js` |

## 1. Definition of done — clause by clause

The bar is the one the spec wrote before the code existed, and it is kept as a bar rather than
rewritten as a summary. The column on the right is where each clause is met, at closure.

| # | Clause | Met by |
| --- | --- | --- |
| 0 | the design commit is design-only | commit `760c7cf` — three spec files, no code, no dependency, no CI change, no error code |
| 1 | the spec approved, the four CHANGE REQUIRED items incorporated | `review-g0.ar.md` § 0: paths A/B, scope table, class D, revocation/break-glass — all in the normative text of v1.1 |
| 2 | every new error code registered in the same commit as the behaviour that throws it | twelve codes in `packages/compiler/src/errors.js` (72 → 84); `tests/omega-invariants.test.js` Ω/I1–I2 keeps the rule |
| 3 | new ledger kinds registered in the same commit | five kinds in `OMEGA_EVIDENCE_KINDS` (27 → 32) |
| 4 | `npm test` ≥ 207 + the G0 suites, 0 failures | 307/307 at 0.4.0; **314/314 at closure** (107 of them Google) |
| 5 | `npm run attacks` ≥ 23 + 8, all blocked, 12 categories | 31/31 blocked across 12 categories, `identity-forgery` among them with its eight forgeries |
| 6 | vectors in sync | `node tools/google-vectors.mjs --check` → "google vectors are in sync" |
| 7 | `npm run verify` exits 0; the login is a membrane crossing | exit 0; `google.session → google.identity.verify` evidenced as `CELL_MESSAGE`, not a function call |
| 8 | no network access anywhere in the test suite | tokens signed by `tools/google-fixtures.mjs` with throwaway RSA keys; no network import under `packages/cells/google` (posture) |

Two things the implementation added that the design did not name, recorded in § H.6 of the spec
because a contract that hides its own growth is not a contract: the session's challenge is bound to
both halves (issued by this session and never spent), and the `audience+azp` step names itself in
the refusal.

## 2. Invariants this gate fixes — now tested

The invariants below are the spec's "Invariants this phase fixes", each of them asserted against
the code in `tests/google-invariants.test.js` (group 6, one test per invariant, GI-1 … GI-7). The
pinned vectors (`spec/vectors/google.json`, `invariants` block) carry the same set, so the record,
the vector and the code have to agree. A closure whose invariants live only in prose is a promise;
this file is only as strong as the tests that hold it.

| # | Invariant | Enforced by |
| --- | --- | --- |
| GI-1 | Google proves identity. NEXA decides authority. | a verified principal carries no capability, no role, no token; the gate refuses a call without a capability (`OMEGA_E_CAP_MISSING`); only NEXA's authority mints, and it may refuse |
| GI-2 | `sub` = identity anchor. `email` = display metadata. | the same `sub` under another email is the same identity; an unverified email is not displayed; the binding is keyed on the digest |
| GI-3 | stored identity = `sha256("NEXA/google1 subject\0" \|\| sub)` | the stored value equals the recomputed digest under the domain separator; the vector pins the same; the raw `sub` appears in no written record |
| GI-4 | Owner identity ≠ capability subject. | the minted capability's subject is the service cell and the owner's key appears nowhere in it; a login never creates a binding |
| GI-5 | class is a property of the triple (resource, action, scope/effect); `max_class` is a kernel invariant | the class rides on the operation row, never on the cell; the ceiling is frozen with the nucleus; an operation above the ceiling fails at authorization and nothing is minted |
| GI-6 | `gmail.send` = privileged operation + capability + policy + owner approval + pre/post evidence | capability + policy without an approval is refused (`OMEGA_E_APPROVAL_REQUIRED`); an approval for a different operation is refused by digest; the approval is in evidence before it authorizes and is consumed with the call (`OMEGA_E_APPROVAL_CONSUMED` on replay) |
| GI-7 | Break-glass = time-bounded recovery state, never Authority. | longer than 24 hours is refused (`OMEGA_E_BREAKGLASS_UNBOUNDED`); it does not chain (`OMEGA_E_BREAKGLASS_CHAIN`); class D is unreachable under it (`OMEGA_E_CLASS_CEILING`, `identity.verify` only); a legitimate binding ends it immediately, with the revocation in evidence |

## 3. Publishing status

**Nothing in this repository is published.** The note is part of the closure record because a
publishing status that is not written down will eventually be guessed.

* **No packages.** Every `package.json` in the tree is `private: true`; nothing is registered on npm
  or on any other registry. The workspaces are local source directories, the monorepo root is the
  only publishable unit, and it is not published either.
* **Zero dependencies.** No runtime dependencies and no development dependencies: `npm test` runs
  with no install, and there is no dependency graph to publish transitively or to supply-chain.
* **No network surface.** No source under `packages/cells/google` imports `node:http`,
  `node:https`, `node:net` or `node:tls` (posture asserts it on every commit); the network is an
  injected port, and CI never touches it. There is no hosted endpoint, no API and no service, so
  there is nothing this work can be "deployed" to.
* **The gate is the publish.** The only publication this project performs is the gate itself: a
  design commit, then an implementation commit, each registration (error code, ledger kind,
  invariant) made in the same commit as the behaviour that uses it. Closing G0 publishes the record
  — this file and its tests — and nothing else.
* **Versions.** Release numbers live in `CHANGELOG.md`; the `0.x` versions in the tree are
  placeholders until publication is decided. Closing a gate does not publish a package, and G1–G4
  will not change this note: each phase lands behind its own gate, in the same unpublished tree.

## 4. What stays open

| Phase | Adds | Gate |
| --- | --- | --- |
| **G1** | `google.gemini` cell (API key in vault, quota-aware, cost accounted) | its own design pass, approved before code |
| **G2** | `google.drive`, `google.sheets` (read-only, narrowest rung first) and the deferred Firebase transport (§ A.2.2), each with its own approved contracts | Firebase stays disabled by default until its gate closes |
| **G3** | `google.gmail`, `google.calendar` (read; `gmail.send` behind class D) | the class-D stack of GI-6, every time |
| **G4** | write paths, multiple bindings, the gateway as a tissue | the same gate order G0 set |

G0 is not reopened. A change to the closed contract takes the normal review path — design first,
verdicts recorded, code after — and is appended to this record as a new entry, not as an edit to
these lines.

## 5. Verification of this record

```text
npm run verify   exit 0 · posture (6 gates CLOSED · 84 error codes · 32 record kinds)
                 · 314/314 tests (307 of 0.4.0 + 7 closure invariants) · audit · three demos
                 · adversarial suite 31/31 blocked
node tools/google-vectors.mjs --check   → "google vectors are in sync"
```
