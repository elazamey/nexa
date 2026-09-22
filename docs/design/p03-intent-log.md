# P03 — Intent Log: architectural decision (written before any code)

**Status: DESIGN. 21 September 2026. No implementation claim, no deployment permission.**

P02.x proved "did the effect succeed?" by re-reading the disk. P03 answers a different
question: **"do we know what did not finish?"** That is a question about *stored state*,
not about the reader. This document fixes the four decisions the tests are allowed to
assume. Anything not fixed here must not be asserted by a P03 test.

---

## 1. What the intent records

Digests and identity — **never payload bytes**.

```text
intent = {
  version:          1,
  kind:             "COMMIT_INTENT",
  txId:             <uuid, one active transaction>,
  targetRoot:       sha256:...        // binds the log to one repository root
  workspaceId:      ws_...
  changeSetHash:    sha256:...        // the authorized change set
  expectedBaseHash: sha256:...        // the base the authorization was bound to
  authorizationRef: sha256:...        // joins this tx to the consumed grant
  ops: [ { path, fromDigest|null, toDigest, mode|null } ],
  state:            "opened" | "applying" | "restoring" | "committed" | "recovered",
  createdAt
}
```

**Why digests and not bytes.** Storing payloads would make the intent log a second copy
of the data, which immediately raises "who verifies the verifier?" — the same regress
P02.x was careful to avoid. Digests let recovery *compare* without the log ever becoming
an authority on content.

A consequence, stated plainly: **the intent log cannot roll a file forward.** It can only
determine that a root is unconfirmed and prove whether the base state is intact. Recovery
here means *return to base or refuse*, never *complete the commit*.

## 2. When it is written, and when it is erased

This is the core of P03; ambiguity here invalidates everything after it.

| Transition | Moment | Durability |
|---|---|---|
| `opened` | **before** the first byte is written to the root | `fsync` file, `fsync` directory |
| `applying` | **after** each successful target write/delete | `fsync` |
| `restoring` | **before** the first rollback write | `fsync` |
| `committed` | **after** post-state verification (P02.x) passes | `fsync` |
| erase | **only after** `committed` is durable | `unlink` + `fsync` directory |

**One active intent per root, plus an archive for diagnosis.** An active intent present at
startup *is* an incomplete transaction. Concurrency is denied by the existing exclusive
lock, not by a second active intent.

The acknowledgement barrier is inherited from the consumption store: the intent `fsync`
MUST precede any repository write, exactly as the consumption journal `fsync` already does.

## 3. Atomic write discipline

- Temp file in the **same directory as the target** — never `/tmp`, or `rename` crosses
  devices and stops being atomic.
- Order: `write` → `fsync(file)` → `rename` → `fsync(directory)`.
- `fsync` on the **directory** is mandatory, not a refinement. Without it, on ext4 with
  `data=writeback`, a `rename` can become visible before the content it points to.

## 4. The isolation invariant

> A root is **unconfirmed** if an active intent exists in state `opened`, `applying` or
> `restoring` at startup, and its recovery has not been proven.

An unconfirmed root refuses every commit with `503`. The invariant is asserted at **every**
cut point, not at one.

Reuse of the existing contract, unchanged: a lock is **never** broken merely because its
owning PID died, and consumed authority is **never** refunded by recovery.

---

## 5. Reader independence (the concession this design makes)

The process that reads the intent log at startup is the same kind of process that died.
That is a genuine weakness and it is not solved here.

What *is* required: recovery is a **module with explicit inputs and outputs**
(`inspectIntent(dir, root) -> report`, a pure decision over on-disk facts) that performs
no writes. A separate applier acts on the report. This does not make the reader
independent; it makes moving it into a separate process later a small change rather than
a rewrite, and it lets tests verify the decision without running the committer.

**Do not call P03 "independent recovery."** The accurate name is **crash-recovery with a
proven-restore contract**.

## 6. Explicitly out of scope

Distributed transactions · network locks · CRDT/OT · non-POSIX filesystems
(declared support: `ext4`, `xfs`, `apfs` only) · multi-host recovery · MutationGuard ·
Execution Attestation.

## 7. Declared durability limit

`SIGKILL` kills a process but not the page cache: data already written survives without
`fsync`. This design therefore protects against **process death**, and only claims
power-loss durability for state that reached an `fsync` barrier. Test 4 asserts the
declared limit — it does not simulate power loss.

---

## 7bis. Declared durability ladder (fixed before tests 4-6)

Without this ladder test 4 cannot fail, and a test that cannot fail is worse
than one that passes wrongly. Each rung states what a reader may observe after
a `SIGKILL` at that point.

| Point | Guarantee |
|---|---|
| **before `fsync(file)`** | **No guarantee.** The last write may be lost on process death or power loss. This is **accepted and declared**, not a failure. |
| **after `fsync(file)`, before `rename`** | Bytes are durable, but invisible through the target name. A reader sees the OLD content plus an orphan temp file. |
| **after `rename`, before `fsync(dir)`** | The name is visible in cache; it may be absent after a machine restart. |
| **after `fsync(dir)`** | Durably visible. |

`SIGKILL` kills a process, not the page cache: data written but not `fsync`ed
still survives process death. So these rungs are asserted against **process
death**; only the `fsync` rungs are claimed for power loss, and no test here
simulates power loss.

### What tests 4-6 must assert

**Test 4 (before `fsync`).** Do NOT assert a particular disk state — that would
encode a filesystem timing accident as a contract. Assert the **contract**: at
startup, either the write is present, or the intent reads `opened`, and in
**no case** is there an unexplained partial state. The absence of an
uninterpretable state is the property.

**Test 5 (after `fsync`, before `rename`).** Old target plus an orphan temp
file; the intent says `applying`. Correct recovery is **delete the temp and
clear the intent** — this is *not* a rollback, because no write ever reached
the name. It gets its own explicitly named branch in `planRecovery`
(`ORPHAN_TEMP`), never silently folded into the restore path.

**Test 6 (after `rename`, before the intent update).** The target carries
`toDigest` while the intent still says `applying`. Decision: **roll the intent
forward to `committed`, but only when EVERY `op.toDigest` matches the disk.**
This advances digests only and writes no payload bytes, so it stays inside the
"digests, never bytes" rule. If any digest fails to match, do not advance —
classify and block.

## 7ter. Intent-log corruption is fail-closed

An active intent that cannot be parsed or validated at startup is the most
dangerous state in the system, because every later decision reads it.

- **No automatic erase, no inference, no "assume empty".** An empty log and an
  unreadable log are different facts and must never collapse into one.
- State `CORRUPT_INTENT` stops all commits on that root for an operator.
- This mirrors the consumption store's existing rule that a missing or torn
  journal is never treated as a fresh empty ledger.

`inspectIntent` already returns `{ present: true, unconfirmed: true,
unreadable: true }` for this case; tests 4-6 must cover it rather than leave it
implied.

## 7quater. Decision order is itself a contract

The H1 regression in phase 1 was not a coding error; it was two correct rules
disagreeing about order. Every new decision point is another chance for that
same class of conflict, so the order is fixed here and tested as a unit rather
than discovered per-point:

```text
1. authorize        (identity, capability, policy)
2. consume          (durable, atomic; a spent grant is 403 even on a bad root)
3. inspectIntent    (read on-disk transaction state)
4. planRecovery     (classify: clear | forward | block)
5. open intent      (durable BEFORE the first repository byte)
6. apply            (targets, with per-op durable records)
7. verify post-state
8. close            (committed | recovered), then erase
```

**Rule 2-before-3 is load-bearing:** a spent authorization must be refused with
`403` regardless of root state, so crash state can never mask a replay as a
mere `503`. A test asserts this ordering directly.

## 7quinquies. Locking is by file, not by process

The in-memory `recoveryRequiredRoots` latch does not survive `SIGKILL`, which
is precisely the failure P03 exists to handle. Mutual exclusion therefore
relies on the **`O_EXCL` lock file** already used by the consumption store, and
test 8 will be written against that contract. A lock is never broken merely
because its owning PID died — a dead owner leaves an unconfirmed root, which is
an operator decision, not an automatic reclaim.

## 7sexies. Test 7 — the restore as its own transaction

Phase 1 left `restoring` as a sub-state of the parent intent. That shape has a
hole: a `SIGKILL` **before** the restore plan is durable leaves `restoring`
with no plan, which `planRecovery` can only classify as `INTERRUPTED_RESTORE`
— safe, but a dead end rather than recovery. Option A is adopted: the restore
is a **separate transaction** with its own `txId` and a `parentTxId` back-link.

### State machine

```text
parent: applying
   │  apply failed, or post-state verify mismatched
   ▼
parent: restore_pending        <- durable BEFORE the child is opened
   │  restoreIntent.open(parent)
   ▼
child: opened  ->  child: applying  ->  child: committed  -> child erased
   │
   ▼
parent: restore_pending with NO child  =  the restore completed
   ▼
parent erased
```

### The seven governing rules

1. `restore_pending` is never acted on directly; always through the child.
2. If a child exists with `parentTxId == parent.txId`, **process the child and
   ignore the parent entirely**.
3. No child + parent in `restore_pending` ⇒ **the restore completed**; erase
   the parent. No other inference is permitted.
4. `restoreIntent.open(parent)` refuses unless `parent.state === 'applying'`.
5. `restoreIntent.open(parent)` refuses if the parent itself carries a
   `parentTxId`. **There is no restore of a restore.** Declared limit.
6. Any on-disk state matching neither `fromDigest` nor `toDigest` of a child op
   ⇒ `CORRUPT_RESTORE_STATE`, fail-closed.
7. The old `INTERRUPTED_RESTORE` classification becomes an assertion: with the
   child transaction in place it must be unreachable, and a test proves it.

### Declared limits for test 7

* No automatic full restore. `planRecovery` classifies; an operator decides.
* No restore of a restore (rule 5).
* Atomic-write discipline for the child's own writes is a **separate** contract
  and is not asserted by the 7-param test.

### Acceptance rule (stricter than passing)

The 7-param test will very likely pass on its first run, exactly as tests 4-6
did. **That is a danger signal, not completion.** Mutations E and F are run
*before* the green result is accepted. If neither kills at least one cut point,
then `restore_pending` was never tested — only `restoring` under a new name.

| Mutation | Breaks | 4 | 5 | 6 | corrupt | order | 7-param |
|---|---|---|---|---|---|---|---|
| A — unreadable intent read as absent | fail-closed | ok | ok | ok | **FAIL** | ok | expect FAIL |
| B — intent check before `consume` | decision order | ok | ok | ok | ok | **FAIL** | expect FAIL |
| C — direct write, no temp+`rename` | atomic write | ok | **FAIL** | **FAIL** | ok | ok | — (separate contract) |
| D — intent opened after first root write | write-ahead | **FAIL** | **FAIL** | **FAIL** | ok | **FAIL** | expect FAIL |
| E — parent left `applying` when child opens | package invariant | — | — | — | — | — | **must FAIL** |
| F — parent erased before the child | package invariant | — | — | — | — | — | **must FAIL** |
| G — `parentTxId` pointing at a missing intent unchecked | link integrity | — | — | — | — | — | **must FAIL** |

E and F measure the invariant that makes this a package at all: **exactly one
actionable intent at a time**. C deliberately does not kill 7-param; a mutation
is not required to break everything.

## 8. RED plan (fixed before implementation)

| # | Test | Proves |
|---|---|---|
| 1 | intent written before the first root write | the WAL is real |
| 2 | `SIGKILL` right after `opened` | startup detects the gap |
| 3 | `SIGKILL` mid-`applying` | partial restore |
| 4 | `SIGKILL` after write, before `fsync` | the declared durability limit |
| 5 | `SIGKILL` after `fsync`, before `rename` | nothing visible to a reader |
| 6 | `SIGKILL` after `rename`, before intent update | recovery reads truth from disk |
| 7 | successful restore then `SIGKILL` before erase | **the restore is itself a transaction** |
| 8 | two competing transactions on one root | lock + explicit refusal |
| 9 | proven recovery then evidence | no `ok:true` without a real read |

**Packaging.** Tests 1-3 shipped as phase 1. Tests **4-6 are one package**: the
same primitive (atomic write) cut at different points, sharing one harness and
one decision (the durability ladder). Test **7 is a separate package** because
it is a different state machine — the restore as a transaction. Tests **8-9
follow 7**, and 8 depends on the file-lock decision in section 7quinquies.

Merging these would repeat the P02.x trap: tests asserting what was chosen
later instead of what the design forces, and no ability to attribute a
regression to one change.

**`SIGKILL` method:** real `spawn` + `process.kill(pid, 'SIGKILL')`, triggered at **named
cut points** the child announces on `stderr` — never a race on `setTimeout`. Each cut point
runs **3+ times**; passing once is not proof.

**GREEN is not declared** until a mutation that disables intent reading at startup makes
the expected tests fail. P02.x's lesson: a test that passes under a disabling mutation is
not evidence — it is a defective test.
