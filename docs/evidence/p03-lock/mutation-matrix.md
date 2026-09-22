# Package 8 — root lock: mutation matrix (I–N)

Every mutation was injected into `tools/celia-commit-root-lock.mjs`, run, and
reverted. The matrix was written in the design document BEFORE the code.

| Mutation | Killed |
|---|---|
| I — `link()` claim removed (EEXIST steals the lock) | **8.8, 8.9** |
| J — expired TTL classified as dead | **8.2** (frozen is not dead) |
| K — stale break not atomic (`w` instead of `wx`) | **8.5** |
| L — `abandoned` without the startTime half | **8.4** (pid reuse) |
| M — lock broken with no recovery intent | **8.5** |
| N — empty lock file read as free | **8.6** |

Clean attribution: each mutation kills exactly the test written for it, and no
mutation kills everything.

## Two defects this package found in its own tests

**1. Mutation I initially survived (7/7 green).** Test 8.3 spawned two
processes sequentially, so the loser was refused by the `inspect()` pre-check
and `linkSync` was never reached — the test measured the optimisation, not the
guarantee. Tests 8.8 (two processes released only after both observed `free`)
and 8.9 (pre-check forced to report `free`) attack the atomic claim itself. I
then killed both.

**2. Test 8.2 was flaky, 6 failures in 10 runs.** `SIGSTOP` is delivered
asynchronously: `/proc/<pid>/stat` can still report `R` for microseconds after
`kill()` returns. The fixture asserted `T` immediately. Fixed by polling for the
observable transition with a deadline — encoding a timing assumption is exactly
what this package refuses to do. 20/20 stable afterwards
(`stability-20-runs.txt`).

## Declared limits

- Dead-lock detection is **Linux-only**. Test 8.2 and 8.4 skip explicitly where
  liveness cannot be proven; they never report an unearned pass.
- The lock protects against competing **writers**. It makes no claim about
  readers.
- Holding the lock is not authorization. It orders access; it never grants it.
- Single host. No network lock, no distributed transactions.
- `contested` and `awaiting-operator` are never cleared mechanically. A frozen
  holder on any platform requires a human.

## Results

9/9 lock tests, 20/20 stability, **546 pass / 0 fail** full verify, 6 gates
CLOSED, 31/31 attacks.
