# Preview Baseline — `preview/pub-followups`

This document defines the **baseline** for any `preview/*` branch. It is the contract that
`preview/pub-followups` (and future preview branches) must keep green before being
promoted to `main`.

## Purpose

Preview branches are **publishing preparation** branches. They hold documentation
wording improvements, CI hardening, and non-behavioral baseline artifacts that must be
verified before a public release note is cut. No protocol behavior changes.

## Baseline invariants

| Invariant | Check |
| --- | --- |
| **No gate opened** | `npm run posture` → 6 gates CLOSED |
| **Tests green** | `npm test` → 314/314 (at G0 closure) |
| **Attacks blocked** | `npm run attacks` → 31/31 blocked, `npm run attacks:google` → 8/8 |
| **Vectors in sync** | `npm run vectors && git diff --exit-code spec/vectors` |
| **Permission proof** | `npm run proof:permission` or legacy flag, runtime denies fs/write/child/worker |
| **Spec co-located** | every doc in `spec/omega/README.md` table exists on disk |
| **No ambient authority** | no `node:fs`, `child_process`, `process.env` in `packages/` or `cells/` (except `tools/`) |

## What lives in this baseline

* `spec/omega/README.md` — clarified wording: **propose** vs **ask**, explicit no self-grant
* `spec/preview-baseline.md` — this file
* `tools/permission-probe.mjs` — robust probing of Node's permission model flag
* `.github/workflows/ci.yml` — uses the probe instead of inline `if node --permission`

## Promotion criteria

A preview branch is ready to merge when:

1. `npm run verify` passes on Node 20 and 22
2. `git log --oneline main..preview/*` contains only docs, CI, and baseline artifacts
3. `spec/vectors/*.json` unchanged or regenerated with `--check` passing
4. No new `OMEGA_E_*` codes, no new gates, no new dependencies

## Publishing note

Nothing in `preview/*` is published. The gate is the publish — see `spec/google/closure-g0.md`
publishing-status note. Preview exists to **prove** the baseline before any registry
or package is touched.

---
Generated: 2026-09-20
Branch: preview/pub-followups
Base: b123b900e3b386a09b63b3c7e1cb608cb0c2c24c
