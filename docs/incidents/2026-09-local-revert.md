# Incident — a commit built on a stale base, and a wrong first diagnosis

**Date:** 2026-09-21/22
**Impact:** none to the remote. One commit (`45ae218`) was authored on a base
five commits behind the branch tip and was rejected by the push. No work was
lost. Corrected by rebase onto the true tip; result `793cd00`, full verify
537 pass / 0 fail.

## What I said at the time, and why it was wrong

I reported: *"the local copy had reverted to the base commit — all of P03 was
missing locally."* That was a guess stated as a finding. The reflog disproves
it. Recording this is the point of the file: a plausible narrative offered
without reading the evidence is exactly the failure mode this project keeps
paying to learn.

## What actually happened

The reflog is six lines long and complete:

```
9d01947 clone: from https://github.com/elazamey/nexa.git
9d01947 checkout: moving from main to arena/01a0c63f-nexa
45ae218 commit: docs: assess the 2026 trust-envelope proposals
0ec74fd rebase (start): checkout FETCH_HEAD
793cd00 rebase (finish)
```

There is **no reset, no revert, no stray checkout**. Nothing was ever lost,
because nothing was ever there. The sequence is:

1. The sandbox was re-cloned fresh at some point in the session.
2. A clone fetches `main` only — the configured refspec is
   `+refs/heads/main:refs/remotes/origin/main`. The remote branch
   `origin/arena/01a0c63f-nexa` was **never fetched**; `git branch -r` lists
   only `origin/main` and `origin/HEAD`.
3. The local branch `arena/01a0c63f-nexa` was created at the clone point
   `9d01947`, which is the tip of `main` — not a reverted state, simply a base
   that predates all P03 work.
4. The branch had **no upstream configured** (`no upstream configured for
   branch 'arena/01a0c63f-nexa'`).

The five P03 commits existed only on the server. Locally they had never been
checked out.

## Why no alarm fired

This is the substantive finding, and it generalises.

- `git status -sb` printed `## arena/01a0c63f-nexa` with **no** `[behind N]`.
  Ahead/behind is computed against the upstream; with no upstream configured,
  git has nothing to compare against and says nothing. **The absence of a
  warning was not evidence of being current.**
- `git log --oneline -4` showed a coherent history ending at a real merge
  commit. A stale base and a current base look identical in isolation.
- The only thing that caught it was the push being rejected — that is, the
  *server* caught it, not any local check.

This is structurally the same error as the false `RESTORE_COMPLETED`: the
absence of a signal was read as the presence of its opposite. There, a missing
child file was read as a completed restore. Here, a missing "behind" marker was
read as an up-to-date branch. In both cases the fix is the same shape — go and
read the authoritative state instead of inferring from a silence.

## The check that prevents recurrence

Inference-free: ask the server what the branch tip is, and refuse to proceed if
the local HEAD is not a descendant of it.

`tools/check-branch-sync.mjs` does exactly that:

- `git ls-remote origin <branch>` — the authoritative tip, no local cache, no
  refspec dependency, no upstream needed.
- If the remote branch does not exist yet, that is reported as a distinct
  outcome, not silently treated as "fine".
- If the remote tip is not an ancestor of `HEAD`, exit non-zero with the list
  of missing commits.

Run it **before committing**, not only before pushing — a stale base is cheap
to fix before a commit and needs a rebase afterwards.

```
node tools/check-branch-sync.mjs
```

## Limits of this check, declared

- It proves the local branch contains the remote tip **at the moment it runs**.
  It is not a lock; a concurrent push can land immediately afterwards.
- It cannot detect a divergence that has not been pushed anywhere.
- It requires network access to `origin`. A failure to reach the remote is
  reported as `UNKNOWN` and is **not** treated as success.
