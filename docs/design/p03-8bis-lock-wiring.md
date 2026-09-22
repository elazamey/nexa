# 8bis.2 — Root lock wiring: decision order and mutation matrix

Written after the wiring existed (`952d6d3`), which is the wrong order and is
recorded as such. The value here is not the design — it is the mutation run,
which found two tests that were green while measuring nothing.

## Decision order (nine steps)

The eight-step list in the earlier note did not name the lock. It is a step,
not a clause of another step:

| # | Step | Note |
|---|---|---|
| 1 | `authorize` | identity, capability, policy — before any filesystem access |
| 2 | latch check | an unconfirmed root refuses with 503 |
| 3 | capture + compare | `changeSetHash`, `expectedBaseHash`, non-empty change set |
| 4 | **`consume`** | the grant is spent |
| 5 | **acquire root lock** | **between `consume` and the intent log** |
| 6 | `intentLog.open` | write-ahead, durable before the first repository byte |
| 7 | `apply` | claim probe, then write |
| 8 | `verify` | read back, compare bytes |
| 9 | `close`, then `release` | `release` in `finally`, on every path |

**Why 5 sits after 4.** A refusal at the lock spends the grant with nothing
written. That is deliberate: the spend lands in the consumption journal as
`opened` without `committed`, which is a *measured signal*. Locking before
`consume` would let a healthy capability be refused without ever being spent,
leaving no trace that the attempt happened. R5 tests this, and the
`R-consume-order` mutation confirms R5 is the test that sees it.

**Why 5 sits before 6.** If the lock were taken after the intent log opened, a
competitor could create an intent between inspection and open. The window is
small and no outcome-level test can see it — which is exactly why R6 exists.

## Refusal codes

Three states, three answers. Collapsing them makes an operator retry something
that will never succeed.

| Lock state | HTTP | Code | Meaning |
|---|---|---|---|
| `held` | **409** | `COMMIT_ROOT_LOCKED` | a live holder owns the root; retry later |
| `contested` | **503** | `COMMIT_ROOT_CONTESTED` | TTL expired, holder may be frozen; needs a human |
| `awaiting-operator` | **503** | `COMMIT_ROOT_CONTESTED` + `cause.lockState` | dead lock, manual resolution |
| `abandoned` | — | — | broken, then the commit proceeds |

409 is resolvable by waiting. 503 is not. Both 503 cases carry
`cause.lockState` and `cause.reason` so the two are distinguishable in the
payload without inventing a fourth code where an existing one serves.

## Test matrix

Every test drives the **real port**, with real OS processes where concurrency
is claimed. No mock of the lock module, no `sleep` — synchronisation is by
named stdin/stdout handshake.

| # | Test | Proves |
|---|---|---|
| R1 | two OS processes commit through the port | the lock is on the real path, not the unit |
| R1b | two spawned processes race, released together after both report `READY` | one winner; the port then loses to the holder |
| R2 | a `contested` root is refused 503, not 409 | the transition is legible from outside |
| R3a | lock released on success | exit path 1 |
| R3b | lock released on a DENY after the grant is spent | exit path 2 |
| R3c | lock released when the effect cannot be proven (503) | exit path 3 |
| R3d | lock released when `apply` throws | exit path 4 |
| R4 | `SIGKILL` between acquire and release | the binding does not leak; the next run sees `abandoned` |
| R5 | a refusal at the lock still records the spend | the declared cost of locking after `consume` |
| **R6** | the lock is held **when the intent log writes** | ordering (5 before 6) — **new** |
| **R7** | a failing `release()` reaches the caller | no swallowed failure — **new** |

R3 is four tests, not one. A partial-release defect leaves the success path
working, so a single combined test would pass.

## Mutation results

| Mutation | Kills | Verdict |
|---|---|---|
| `I-real` — port never calls `acquire` | R1, R1b, R4, R5, R6, R7 | **dead** |
| `R-release-partial` — release only on success | R3a, R3b, R3c, R3d, R4, R7 | **dead** |
| `R-order` — acquire after `intentLog.open` | R4, **R6** | **dead** (R6 only) |
| `R-release-swallow` — `try { release() } catch {}` | **R7** | **dead** (R7 only) |
| `R-consume-order` — lock before `consume` | R5 | **dead** |

`I-real` is the mutation that **survived packages 8.2–8.9**. It no longer
survives: six tests fail. That is the difference between a lock module that
exists and a lock that is called.

## Two tests that were green and measured nothing

Both were found by running the matrix, not by reading the code.

**`R-order` survived R1.** R1 asserts the *outcome* — one process wins — which
stays true no matter how late the lock is taken. The ordering rule is about the
*mechanism*, so the probe has to observe the critical region from inside. R6
uses the intent log's own hooks to check the lock file at the moment the intent
is written. This is the same survival shape as R4 in P03: a test measuring the
result cannot see the mechanism move.

**`R-release-swallow` killed nothing**, because no test ever made `release()`
fail. The first attempt at R7 chmod-ed the whole state directory and "passed"
on `COMMIT_DURABLE_STATE_UNAVAILABLE` — the consumption store failed long
before release was reached, so the test asserted nothing about releasing. It
was diagnosed by printing the error actually being caught. R7 now gives the
lock its own directory, seals only that directory mid-commit via the intent
hook, and asserts the error is `EACCES` — the release error itself, not a
convenient earlier one.

The seam this needed is `rootLockDirectory`, defaulting to the state directory.
It does not change where the lock lives in production.

## Declared limits

- POSIX/Linux only: `linkSync` atomicity and `/proc`-based liveness.
- Single host, single filesystem. No network lock, no multi-machine recovery.
- R7 skips itself where a filesystem permits unlink from a read-only directory
  (e.g. running as root). A platform that cannot host the test reports a skip,
  never a pass.
- A held lock proves a holder claimed the root. It does not prove the holder is
  making progress; that is what `contested` and `awaiting-operator` exist for.
