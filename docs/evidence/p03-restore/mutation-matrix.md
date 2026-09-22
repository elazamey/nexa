# P03 test 7 — extended mutation matrix (A–G)

Rule: a test that survives a disabling mutation is not evidence; it is evidence
the test is defective. Every mutation below was injected into the real source,
run, and reverted. `7-param` is the whole test-7 file (11 assertions).

| Mutation | 4 | 5 | 6 | corrupt | order | 7-param |
|---|---|---|---|---|---|---|
| A — unreadable intent read as absent | ✓ | ✓ | ✓ | **KILLED** | ✓ | **KILLED** (unreadable child) |
| B — inspectIntent before consume | ✓ | ✓ | ✓ | ✓ | **KILLED** | ✓ |
| C — direct write, no temp+rename | ✓ | **KILLED** | **KILLED** | ✓ | ✓ | ✓ (by design) |
| D — intent opened after first write | **KILLED** | **KILLED** | **KILLED** | ✓ | **KILLED** | ✓ |
| E — parent left `applying` when child opens | ✓ | ✓ | ✓ | ✓ | ✓ | **KILLED ×2** |
| F — parent erased before the child | ✓ | ✓ | ✓ | ✓ | ✓ | **KILLED** |
| G — `parentTxId` link unchecked | ✓ | ✓ | ✓ | ✓ | ✓ | **KILLED** |
| H — no-child assumed RESTORE_COMPLETED | ✓ | ✓ | ✓ | ✓ | ✓ | **KILLED ×2** |

## Acceptance rule, evaluated

- E or F must kill at least one cut point: **satisfied** (E kills 2, F kills 1).
- Every test is killed by at least one mutation: satisfied.
- No single mutation kills everything: satisfied.
- C deliberately does NOT kill 7-param: the child's atomic-write discipline is a
  separate contract, already covered by tests 5 and 6.

## A recorded defect, and its correction

The first version of test 7 wrote intent files by hand and only exercised
`planRecovery`. **Mutation E survived it entirely** (11 pass / 0 fail) — the
test measured classification, never the lifecycle that produces the states.
Three lifecycle tests driving the real `createIntentLog` were added; E then
killed two of them. The first-run green was the danger signal it was assumed to
be.

## Declared limits

- Classification only. `planRecovery` never repairs; the operator decides.
- No restore of a restore — enforced by the API: the child object exposes no
  `openRestore`, and rule 5 rejects a parent carrying `parentTxId`.
- ~~A cut between the parent's `restore_pending` write and the child's creation
  is classified `RESTORE_COMPLETED`.~~ **Closed, not declared.** This was a false
  verdict, not an acceptable limit: it would have cleared the parent while the
  targets still held the applied bytes. The classifier now reads the disk and
  returns `RESTORE_SKIPPED_NO_CHILD` (fail-closed, parent preserved). Mutation H
  reproduces the old behaviour and kills two assertions. See section 7septies.
- `INTERRUPTED_RESTORE` remains in the code for intents written by older builds.
  No path in this build can produce it, and every cut point asserts its absence.
