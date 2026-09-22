# Supersession Record

- **Status:** partially superseded
- **Recorded:** 2026-09-21
- **Original sealed at commit:** unrecorded
- **Files:** tools/celia-workspace-commit-port.mjs
- **Reason:** the pinned digest of tools/celia-workspace-commit-port.mjs no
  longer matches the file on disk. The file changed legitimately after this
  bundle was sealed, through P03 phase 1 (6c2528d), P03 test 7 (bda2be6) and
  P03 package 8 (952d6d3), which wired the root lock into the port.
- **Superseded by:** p03-wiring, and p03-restore (sealed at commit 9a742fe)
- **Action:** the historical bundle is preserved exactly as sealed. Nothing in
  it has been regenerated, re-hashed, or edited.

## Why "unrecorded" rather than a commit id

This bundle's `manifest.json` records `createdAt` (2026-09-20T20:56:03Z) but no
commit. The HEAD at the moment of sealing is therefore not known. It could be
guessed from `git log` around that timestamp, and the guess would probably be
right — but a guess written into an evidence record is indistinguishable from a
fact once it is written down. `unrecorded` is the only honest value.

## Why this bundle was not regenerated

Re-running `sha256sum` today would produce digests that verify cleanly and mean
nothing: they would describe the files as they are now, not as they were at the
sealed moment, while presenting themselves as the original seal. The mismatch
would disappear from the report and the gap would disappear with it.

That is P1 applied to the archive — a check that passes without measuring what
it claims to measure. See `docs/principles.md` P5.

## What this record does and does not do

It does **not** make the bundle verify. The digest still does not match, and
the checker still reports the underlying file as `mismatch` if this record is
removed. What it does is move the finding from *unexplained gap* to *known,
attributed gap*. The status the tool emits is `superseded-explained`, which is
a third state — not a pass.
