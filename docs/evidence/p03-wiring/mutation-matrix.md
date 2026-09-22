# Package 8 wiring — mutation matrix

A tested module and a module that is actually called are different claims.
These mutations are injected into `tools/celia-workspace-commit-port.mjs` —
the real caller — not into the lock module.

| Mutation | Killed |
|---|---|
| I-real — `acquire()` removed from the port | **R1, R1b, R4, R5** |
| R-release-partial — released on the success path only | **R3 (503), R3 (apply throw)** |
| R-contested — the 503 branch removed | **R2** |

## A defect this found, again

`I-real` did **not** kill R4 at first. R4 killed the lock holder, then asserted
the next run recovered and committed — which looks identical whether or not the
new run ever took a lock of its own. It measured the break, not the
acquisition.

R4 now observes the lock file *during* apply, through `intentHooks`, and
asserts the holder pid is this process. `I-real` then kills it.

This is the fourth occurrence of one pattern: P02.x (unproven delete path),
package 7 (mutation E, hand-written fixtures), package 8 (mutation I,
sequential spawns), and now R4. In every case the test exercised an outcome
rather than the mechanism that produces it.

## A rejected mutation

A first attempt at `R-release-partial` deleted the `finally` block and produced
a **syntax error**. A module that does not parse kills every test and proves
nothing — it is not a mutation, it is a broken build. It was replaced with a
semantically valid version (release only when no exception propagated), which
kills exactly the two R3 tests covering failure exits.

## Decision order actually wired (9 steps)

```
1 authorize   2 latch check   3 capture+compare   4 consume
5 acquire root lock   6 intentLog.open   7 apply   8 verify   9 close + release
```

- **4 before 6** — a spent grant is 403 regardless of root state.
- **5 before 6** — the lock is held before the intent log inspects the root.
- **9 on every path** — release runs in `finally`, proven by the R3 set.

## Declared limits

- R5 documents the accepted cost: a refusal at step 5 spends the grant. This is
  a measured signal in the consumption journal, never a silent loss.
- Dead-lock recovery through the port inherits the Linux-only limit of 8bis.3.
- The lock orders writers. It is not authorization and makes no claim about
  readers.

## Results

9/9 wiring tests, 15/15 stability, **555 pass / 0 fail**, 6 gates CLOSED, 31/31.
