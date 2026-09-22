# Principles

Rules extracted from failures this project actually paid for. Each one names
the incident that produced it, because a principle without a scar is a slogan.

---

## P1. Accept no proof you cannot write a mutation to kill

> A proof that is subtly wrong verifies successfully and means nothing.

A test that passes under a disabling mutation is not evidence; it is evidence
the test is defective. This extends past tests to any claim-bearing mechanism:
if there is no way to break it such that something visibly fails, its success
carries no information.

**Where it was paid for:**
- Package 7's first test file passed 11/11 and survived mutation E completely.
  It exercised `planRecovery` over hand-written fixtures and never touched the
  lifecycle that produces them. Rewritten to drive the real `createIntentLog`,
  mutation E then killed two tests.
- The old H3 test passed without proving anything, for the same reason.

**Where it decides future work:** zero-knowledge proofs are rejected for this
codebase. A hand-rolled proving system produces proofs that verify and mean
nothing, and no mutation I can write would detect it — P1 failing in a place
where failure is invisible.

**Operational form:** mutations are run *before* a green result is read. A
first-run pass is a danger signal, not a completion signal.

---

## P2. An inference from the log is not evidence; evidence is a read of the disk

> "A proven emergency" is an inference wearing the costume of evidence.

The absence of a signal is never evidence of its opposite. Two different world
states that produce byte-identical records must be distinguished by going and
looking, not by choosing the more convenient reading.

**Where it was paid for:**
- `RESTORE_COMPLETED` was returned whenever a parent sat in `restore_pending`
  with no child file. But "child completed and was erased" and "the crash
  landed before the child was created" produce identical logs. The verdict was
  opposite to the disk in the second case, and would have erased the only
  record that a rollback was owed. Fixed by reading the target digests:
  `RESTORE_COMPLETED`, `RESTORE_SKIPPED_NO_CHILD`, or `CORRUPT_RESTORE_STATE`.
- The 2026-09 repository incident: `git status` printed no "behind" marker, and
  that silence was read as being current. With no upstream configured, git had
  nothing to compare and therefore said nothing. Fixed by asking the server for
  the tip rather than trusting a local silence.

**Where it decides future work:** runtime intent-based policies are rejected.
A judgement cannot be mutation-tested, because no disabling mutation has an
unambiguous effect. And in package 8: **an expired TTL is a signal, not a
verdict.** A frozen process is alive; declaring it dead because a timer elapsed
is `RESTORE_COMPLETED` in a new costume.

---

## P3. Attribution requires a known set of writers

> A lock with no party to lock against is not a lock.

Every guarantee in this system is of the form "this actor did this, in this
order, and here is the mutation that proves the test would notice otherwise".
That form collapses the moment the actor set is unbounded or anonymous.

**Where it was paid for:**
- P02.x's central trap was a failure that could not be attributed to a cause.
- Mutation matrices deliberately preserve attribution: mutation C is *not*
  required to kill test 7, because forcing every mutation to kill every test
  destroys the ability to say what each test measures.
- The consumption lock and the root lock are kept separate for the same reason:
  two hazards, two locks. Merged, an ordering mutation would produce a conflict
  whose origin cannot be determined.

**Where it decides future work:** self-routing capability envelopes are
rejected. Broadcast routing replaces "this process did this" with "something
capable did something", makes the writer set unbounded, and makes package 8
unbuildable — there is no principal to lock against, and a dead lock cannot be
attributed to a dead holder.

---

## P4 — A command that looks like recovery can be loss

**The rule:** never run `git checkout -- <file>` on a file with uncommitted
changes without first running `git diff --stat` or `git stash`.

**Why it is a principle and not a tip:** this pattern has now cost work three
separate times, which is the threshold at which something stops being a
mistake and becomes a property of the tooling.

1. A local copy looked stale, and the response discarded it.
2. Reverting an executed mutation with `git checkout` also reverted the real
   production change the mutation had been layered on top of.
3. Reverting a mutation on `tools/celia-dashboard-server.mjs` silently restored
   the deleted fake-proof endpoint — the very deletion the commit existed to
   make (`docs/incidents/2026-09-fake-proof-endpoint.md`).

Each time, the command succeeded. Exit code 0. No warning. That is what makes
it dangerous: `git checkout -- <file>` has **no undo**, the working tree has no
reflog, and for untracked files it does not even restore — it leaves them gone
without having ever held a copy.

The deeper error is treating "restore" as a safe word. Restoration is only safe
when the thing being restored *to* is known. In all three cases the target
state was assumed, not checked. `git diff --stat` costs one second and converts
an assumption into a fact.

**Note on mutation testing specifically:** mutations are applied to production
files and must come back off. The safe reversal is the one that restores the
exact bytes — `cp` from a backup taken before the mutation — not `git checkout`,
which reverts to the *last commit* and therefore silently discards every
uncommitted change in that file.

**Where it is enforced:** `node tools/check-branch-sync.mjs` lists modified and
untracked files before any push, and `--strict` refuses to proceed while
uncommitted work is present. It cannot prevent a `git checkout`, but it removes
the ignorance the mistake depends on.

---

## How these are enforced

- P1 — every package ships a mutation matrix in `docs/evidence/`; mutations run
  before green results are read.
- P2 — classifiers read the disk and return distinct codes for distinct world
  states; fail-closed is the default for anything unexplained.
- P3 — one lock per hazard; tests name the acting process.
- P4 — `node tools/check-branch-sync.mjs` names dirty files before every push;
  `--strict` blocks while uncommitted work is present.
- Repository state — `node tools/check-branch-sync.mjs` before committing.
- Evidence claims — `npm run verify-evidence` recomputes digests; the dashboard
  displays that output and is forbidden by test from adding a verdict
  (`tests/evidence-check.test.js`).
