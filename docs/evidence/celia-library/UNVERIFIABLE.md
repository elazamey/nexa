# Unverifiable — permanent

- **Status:** unverifiable
- **Recorded:** 2026-09-21
- **Files:** full-verify.txt, security.tap, targeted.tap
- **Reason:** this directory was never sealed. There is no `SHA256SUMS` and no
  `manifest.json`, so there is no recorded digest and no recorded commit to
  check anything against.

## Why this is permanent and not a task

Sealing it today would hash whatever is in the directory now and stamp it with
today's HEAD. Every file would then report `match`. Nothing would have been
verified: the digests would prove only that the files have not changed since
the moment I sealed them, which is a statement about this afternoon, not about
whenever these outputs were produced.

That is precisely the failure the checker exists to expose, committed by the
person operating the checker. See `docs/principles.md` P5.

## What to do instead

Treat the three files as untrusted narrative. If the results they describe
matter, re-run the underlying checks and seal a **new** bundle with
`node tools/seal-evidence.mjs <name>`, which records `sealed_at_commit` from
the repository at seal time. Do not seal this directory.
