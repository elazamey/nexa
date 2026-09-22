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

Tests 1–3 are implemented first. The rest only after the WAL is proven.

**`SIGKILL` method:** real `spawn` + `process.kill(pid, 'SIGKILL')`, triggered at **named
cut points** the child announces on `stderr` — never a race on `setTimeout`. Each cut point
runs **3+ times**; passing once is not proof.

**GREEN is not declared** until a mutation that disables intent reading at startup makes
the expected tests fail. P02.x's lesson: a test that passes under a disabling mutation is
not evidence — it is a defective test.
