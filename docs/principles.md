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

### Fourth occurrence: the sandbox reset

The local checkout was later found reset to `9d01947` — four commits behind —
with fifty modified and untracked files in the tree. Every visible signal said
the work was gone.

It was not. `git ls-remote` showed `214b75c` on the server: everything had been
pushed, and the local files were stale duplicates predating those commits. The
recovery was `git fetch` + `git reset --hard FETCH_HEAD`, after
`git stash push -u` preserved the local state in case that reading was wrong.

Two rules earned their keep here, and the sequence is the point:

1. **Ask the remote before believing the local tree.** The first instinct — that
   a reset checkout means lost work — was wrong, and acting on it by rebuilding
   would have produced a duplicate of work that already existed.
2. **Stash before resetting.** `git reset --hard` is as irreversible as
   `git checkout --`. The stash cost one second and made the step reversible.

The deeper point is the same one P4 opened with: *a command that looks like
recovery can be loss*, and **a state that looks like loss may not be**. Both
errors come from acting on an assumed world state instead of a measured one.
Measure first — `git status`, `git ls-remote`, `git diff --stat` — then act.

---

## P5 — Do not complete evidence retroactively

**The rule:** an evidence bundle is sealed once, covers only what existed at
that moment, and is never re-sealed. A bundle that is incomplete stays
incomplete. It is annotated, not repaired.

**What triggered it:** the evidence checker's first run reported 63 matches, one
real mismatch, 14 files covered by no digest, and seven bundles recording no
commit. The obvious next move was to regenerate the sums and backfill the
commits. That move is a defect, and it is worth naming exactly why, because it
looks like diligence.

Regenerated digests **verify**. They are correct hashes of real files. They are
also meaningless: they describe the bundle as it is today while presenting
themselves as the seal taken at the moment the evidence was produced. The
report would go green and the gap would vanish from it. The check would pass
without measuring what it claims to measure — **P1, applied to the archive**.

Backfilling a commit is worse, because it manufactures a fact. The HEAD at seal
time is not known for those seven bundles. It could be inferred from timestamps
and would probably even be right, but a guess written into an evidence record
is indistinguishable from a measurement once it is written down. The only
honest value is `unrecorded`.

**The distinction that governs the response:**

| Cause | Response |
|---|---|
| A file changed because the code moved on | `SUPERSEDED.md` beside the bundle. Never re-seal. |
| `SHA256SUMS` is itself corrupt (truncated line, bad encoding) | Documented manual repair, original preserved. |
| A file reads as `missing` because the record used a different path form | Fix the path resolution in the tool. The record is fine. |

The first and third both occurred. The third was a bug in the checker, which
initially reported 27 phantom missing files in `h2-atomicity` because that
bundle records repo-relative paths while others record bare names — fixed in
the resolver, with no evidence touched.

**`superseded-explained` is not a pass.** It is a mismatch whose cause has been
written down and attributed, and the checker emits it only from the *presence*
of a valid record. Delete the record and the status reverts to `mismatch`. A
malformed record downgrades nothing, because an unparseable explanation is not
an explanation.

**Where it is enforced:**
- `tools/seal-evidence.mjs` refuses to seal a bundle that already has a
  `SHA256SUMS`, and records `sealed_at`, `sealed_at_commit` and
  `sealed_over_dirty_tree` read from the repository rather than supplied by hand.
- `tools/verify-evidence.mjs` reports `unlisted` and `no commit recorded` as
  standing facts about the historical record.
- `tests/evidence-check.test.js` fails if a malformed record launders a
  mismatch, if a record downgrades a file it does not name, or if
  `superseded-explained` is ever counted as a match.

**The general form:** the question is never "how do we close the gap", it is
"how do we record that the gap is known". Closing a gap you cannot measure is
decoration.

**A corollary learned the hard way.** The mutation run for this very principle
destroyed the bundle it was protecting: the test invoked the sealer against the
live `h2-atomicity` while mutation M5 had the re-seal refusal disabled, and the
real archive was overwritten (`docs/incidents/2026-09-mutation-destroyed-evidence.md`).
The suite stayed green, because a re-sealed bundle is internally consistent —
that is precisely what re-sealing does. It was caught by noticing a finding had
*disappeared* from the report.

> A test that invokes a write-capable tool must point it at a throwaway
> directory. A mutation run deliberately breaks guards, so any test whose
> safety depends on the guard it is testing will become destructive at exactly
> the moment it matters.

---

## P6 — Mutations run on copies, never on live data

**The rule:** any test that invokes a tool capable of writing must point that
tool at a throwaway directory. A mutation that touches production data — even
with the intent of breaking something — is not a test. It is an incident
waiting for its turn.

**This is not P4.** P4 is about recovering from a destructive command after the
fact. P6 is about the isolation boundary that exists *before* the command runs.
P4 limits loss; P6 removes the reach.

**Why it had to become a rule rather than a fix.** Mutation M5 disabled the
re-seal refusal while the test pointed the sealer at the live
`docs/evidence/h2-atomicity`, and the real archive was overwritten
(`docs/incidents/2026-09-mutation-destroyed-evidence.md`). Fixing that one test
would have been treating the symptom. M1–M4 in the same run invoked the same
write-capable tool; they did no damage only because they happened not to target
the refusal. They were equally capable of it. The next mutation, on code not
yet written, would inherit the same exposure.

The general shape: **a mutation run deliberately breaks guards, so any test
whose safety rests on the guard it is testing becomes destructive at exactly
the moment it matters.** That is a circular safety argument, the same form as
every other failure recorded here.

**The audit this produced.** Every test that can spawn a process was checked.
`celia-system.mjs` writes only under `--state`, which the tests point at temp
directories. The crash and HTTP tests already build their `root` with
`mkdtemp`. One real exposure was found beyond M5:
`dashboard-stats-contract.test.js` spawned the dashboard server with no `cwd`
at all, inheriting the repository. Its writes happen to be module-relative into
gitignored `.nexa/`, so nothing was harmed — but that is a property of the
tool, not a boundary, and it now runs with a throwaway `cwd`.

**Where it is enforced:** `tests/mutation-isolation.test.js` holds three
layers, because a source scan alone can be outwitted by a path built at
runtime:
1. No test spawns a write-capable tool with the repository as its cwd.
2. No test writes *into* `docs/evidence/` (copying *out of* it is the rule
   being obeyed, so only the destination is judged).
3. `git status` confirms the archive is byte-unchanged after the suite runs.
   This is the backstop that would have caught M5 the moment it happened.

**The operational limit that goes with it:** `git checkout` recovered
`h2-atomicity` only because it was committed. An uncommitted bundle has no
recovery path whatsoever. `tools/seal-evidence.mjs --strict` therefore refuses
to run while `docs/evidence/` has uncommitted changes.

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
- P5 — `tools/seal-evidence.mjs` refuses to re-seal; old bundles keep their
  `unlisted` and `no commit recorded` findings; gaps are annotated with
  `SUPERSEDED.md` or `UNVERIFIABLE.md`, never regenerated.
- P6 — `tests/mutation-isolation.test.js` blocks live-data mutation at three
  layers; `seal-evidence.mjs --strict` refuses an uncommitted archive.
- Evidence claims — `npm run verify-evidence` recomputes digests; the dashboard
  displays that output and is forbidden by test from adding a verdict
  (`tests/evidence-check.test.js`).
