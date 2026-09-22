# Package 9 — recovery-proof

Named `recovery-proof`, not "signed evidence". "Signed" implies a cryptographic
signature and invites an argument that should not be opened. The name is the
first defence against the next misunderstanding.

**Document before code, and code read before document.** The last package was
written in the wrong order and the cost was real. But order alone is not
enough: in P03.1 the document was correct and reality was still wider than it
— `restore()` verified bytes while the `unlinkSync` path did not. So every
claim below was checked against the source before it was written, and the
inspection changed what this package is.

---

## 1. What the inspection found

The honest headline: **most of what package 9 was going to build already
exists.** Reading it first turned a build into a much smaller gap-fill.

| Thing | Status on disk |
|---|---|
| `planRecovery(report, digestOf)` | **Exists**, `celia-commit-intent-log.mjs:178`. Classifies child-first (rule 2), fail-closed on unexplained states. |
| Called in production? | **Yes** — `intentLog.open()` line 240. A non-`clear` plan throws `503 COMMIT_RECOVERY_REQUIRED`. Not a unit without a caller. |
| `verifyRestored(base, attempted)` | **Exists**, `celia-workspace-commit-port.mjs:206`. Re-reads bytes **and** mode, and proves deletion (`STILL_PRESENT`) rather than trusting that `unlink` did not throw. |
| `restore_pending` before the child | **Yes** — `openRestore()` writes the parent's `restore_pending` and fsyncs it *before* creating the child intent. A cut between the two is classifiable. |
| Lock held across recovery? | **Yes.** `acquire()` precedes the whole apply/restore block and `release()` is in the outer `finally`. Rollback runs under the same lock as the apply. |
| Named cut points | **Exist** — `tests/fixtures/celia-commit-crash-child.mjs` parks on a named point and reports `PARKED` on stderr. No `sleep`. |
| `seal-evidence.mjs` | Records `sealed_at`, `sealed_at_commit`, `sealed_over_dirty_tree`. **No `tree_sha`, no `provenance.json`.** |

So package 9 is **not** "build recovery verification". It is:

1. `tree_sha` + `provenance.json` in the seal (the only genuinely new code).
2. Cut points in the **child restore transaction**, which the existing crash
   tests do not cover — they cut during apply, not during rollback.
3. A mutation matrix over both.

Claiming otherwise would be building a second `planRecovery` next to the one
already wired in, which is how a codebase grows two answers to one question.

---

## 2. Why the seal is git-anchored and not cryptographically signed

A locally generated key produces a signature that verifies successfully and
means nothing:

- **No trust anchor.** The key is signed by nobody. Anyone can generate a key,
  sign, and verify. That is `Z3_PROOF_..._VERIFIED_SAT` wearing different
  clothes — a check that passes while measuring nothing
  (`docs/incidents/2026-09-fake-proof-endpoint.md`).
- **No key management.** Ownership, rotation, revocation on compromise: none of
  it exists, and building it breaks the zero-runtime-dependency constraint.
- **No mutation.** The only mutation that would kill a fake local signature is
  "delete the signature". A guard with one trivial mutation is not a test.
- **P5 forbids it.** Signing today content whose production was not observed
  today is retroactive evidence — the same defect as regenerating
  `h2-atomicity`'s digests.

The git-anchored seal is verifiable by **any** party holding the repository,
with no keys and no trust in the issuer:

```
git cat-file -p <tree_sha>        # absent object  => the bundle is fabricated
sha256sum -c SHA256SUMS           # bytes unchanged since sealing
git merge-base --is-ancestor <sealed_at_commit> HEAD
```

`tree_sha` is the addition that matters: it names the **state of the files**,
not the history that produced them, so it survives a history rewrite that would
invalidate a bare commit id.

External identity binding (`did:key`) stays rejected as premature. It becomes
meaningful only once there is a network boundary holding the key.

---

## 3. Decision order under recovery

Numbered because it will be tested as a contract, as in 8bis.2.

| # | Step | Note |
|---|---|---|
| 1 | apply throws / verification fails | the trigger |
| 2 | `openRestore(ops)` | parent → `restore_pending`, **fsynced before the child exists** |
| 3 | child intent written | `parentTxId` back-links to the parent |
| 4 | `restore()` rewrites bytes / unlinks creations | reverse order |
| 5 | `verifyRestored()` re-reads | bytes, mode, and non-existence |
| 6 | `restoreTx.complete()` | **child closes first** (rule 3) |
| 7 | `transaction.recovered()` | parent closes second |
| 8 | `heldLock.release()` | in the outer `finally`, on every path |

**The lock is held for all of 1–7.** Releasing it before recovery finishes
would let a competitor acquire a root that is mid-rollback — the window the
lock exists to prevent. This is recorded here because it is a decision, not an
accident of structure.

**If step 5 finds anything unproven, the root latches** (`recoveryRequiredRoots`)
and every later commit gets `503 COMMIT_RECOVERY_REQUIRED`. `RECOVERY_UNVERIFIED`
is a distinct state from `RECOVERY_FAILED`: the first means the rollback ran but
could not be proven, the second that it demonstrably did not complete.

---

## 4. Cut points (to be written before the code)

The existing crash tests cut during **apply**. Package 9 cuts during
**rollback**, which nothing currently exercises.

| # | Cut point | Expected classification on the next run |
|---|---|---|
| C1 | after parent `restore_pending` fsync, **before** the child is written | `RESTORE_SKIPPED_NO_CHILD` if bytes are still applied; `clear/RESTORE_COMPLETED` if at base |
| C2 | after the child is written, before any byte is restored | `RESTORE_INCOMPLETE` (block) |
| C3 | mid-restore, some paths reverted | `RESTORE_INCOMPLETE` (block) |
| C4 | all bytes restored, before `restoreTx.complete()` | `restore_complete` |
| C5 | child erased, before `transaction.recovered()` | `clear/RESTORE_COMPLETED` |

C1 and C5 are the ones that matter: both leave a parent in `restore_pending`
with no child on disk, and the two are distinguishable **only by reading the
disk** — never by the absence of a file. `planRecovery` already implements
exactly this distinction; these tests prove it holds under a real `SIGKILL`.

Each cut runs `RUNS = 3` times. A `SIGKILL` test that passes once is not proof.

---

## 5. Mutation matrix (before the code)

| Mutation | Must kill |
|---|---|
| `S-tree` — seal omits `tree_sha` | the provenance test |
| `S-fabricate` — `tree_sha` set to a plausible but non-existent object | the `git cat-file` check |
| `S-dirty` — `sealed_over_dirty_tree` forced to `false` | the dirty-seal test |
| `V-bytes` — `verifyRestored` skips the byte comparison | C3, C4 |
| `V-delete` — `verifyRestored` drops the `STILL_PRESENT` branch | the creation-rollback test |
| `V-mode` — mode comparison removed | the mode test |
| `P-child-first` — `planRecovery` reads the parent before the child | C2, C4 |
| `P-assume-erased` — `restore_pending` with no child ⇒ assume completed | **C1** |
| `L-release-early` — lock released before the rollback | a new concurrency test |

`P-assume-erased` is the analogue of `I-real`: it is the mutation that makes
the system *look* correct on the happy path while silently erasing a parent
whose restore never ran.

**No GREEN is claimed before `P-assume-erased` and `V-bytes` have been run.**

---

## 6. Declared limits

- POSIX/Linux only. Single host, single filesystem.
- `tree_sha` proves file state, not that any test in the bundle was executed.
- A seal proves *when* content was recorded against *which* tree. It says
  nothing about whether the content is true — the same limit the evidence
  checker already carries in its payload.
- `sealed_over_dirty_tree: true` means the hashed bytes are not the bytes of
  the named commit. Declared, never hidden.
