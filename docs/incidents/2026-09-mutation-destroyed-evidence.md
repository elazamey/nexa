# Incident: a mutation test re-sealed a real evidence bundle

- **Date:** 2026-09-21
- **Severity:** evidence loss, recovered
- **Detected by:** the checker's own output, one step after the mutation run

## What happened

While mutation-testing the new supersession logic, mutation **M5** disabled the
re-seal refusal in `tools/seal-evidence.mjs`:

```js
if (fs.existsSync(sumsPath)) {   →   if (false) {
```

The corresponding test invoked the sealer against the **live** bundle
`docs/evidence/h2-atomicity`. With the guard disabled, the sealer did exactly
what it was told: it re-sealed the real archive. `SHA256SUMS` went from 27
recorded files to 24, every path was rewritten from repo-relative to bare, and
the pinned digest of `tools/celia-workspace-commit-port.mjs` — the single real
mismatch this whole package exists to preserve and explain — was deleted.

The mutation was reverted. The damage was not: the sealer had written to disk,
and reverting the source did not unwrite it.

## How it was caught

Not by the test suite. The suite went green, because after the re-seal the
bundle genuinely was internally consistent — that is what re-sealing does.

It was caught by reading the checker's output and noticing the number had
moved: `h2-atomicity` reported `{"match":24,"unlisted":1}` where minutes
earlier it had reported 26 matches and one mismatch. The mismatch had vanished,
and a vanished finding is a louder signal than a red test.

## Recovery

`SHA256SUMS` and `manifest.json` were both tracked and committed, so
`git checkout --` restored them — after `git diff --stat`, per P4, which
confirmed exactly two tracked files were affected and that the untracked
`SUPERSEDED.md` would survive. Restored state verified: 27 lines, original
digest `7d2d853…` present.

Had the bundle been sealed in this same uncommitted session, it would have been
unrecoverable.

## The actual defect

Not the mutation. The mutation did its job.

**The test was destructive precisely when the guard it tested was broken.** Its
safety depended on the behaviour it was supposed to be verifying. That is a
circular safety argument, and it is the same shape as every other failure in
this repository: a check whose validity rests on the thing being checked.

A mutation run deliberately breaks guards. Any test exercising a
**write-capable tool** must therefore assume the guard is already gone and run
somewhere the damage does not matter.

## Fix

`tests/evidence-check.test.js` now builds a disposable bundle in a temp
directory and runs the sealer with `cwd` set there. It also asserts the
existing seal is **byte-identical** after a refused re-seal, so the test detects
a write instead of merely detecting a non-zero exit code.

Re-running M5 against the fixed test: still killed, archive untouched.

## Rule this adds

> A test that invokes a tool capable of writing must point that tool at a
> throwaway directory. Never at the repository's real artifacts. The test's
> safety must not depend on the guard it is testing.

## Related

- `docs/principles.md` P4 — inspect before restoring; that is why the recovery
  here was safe rather than a second loss.
- `docs/principles.md` P5 — re-sealing produces digests that verify and mean
  nothing. This incident is that principle demonstrated accidentally, against
  the archive it was written to protect.
