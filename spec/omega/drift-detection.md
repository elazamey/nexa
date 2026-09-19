# Design review: historical-metric drift detection

**Status:** review only — proposal, not an implementation

## 1. Problem and goal

A historical claim such as “the suite was 207/207 at release X” is a claim about a
particular repository state. It must not be re-evaluated against the current checkout,
and it must not become true merely because a later commit adds a label to an old-looking
paragraph. The goal is to make historical metrics reproducible, reviewable, and resistant
to retrospective relabelling while leaving current-metric enforcement read-only.

This document does **not** change `tools/check-metrics.mjs`, CI, or any metric value.

## 2. Anchor the claim to an immutable commit

Each historical claim should be represented by a versioned, machine-readable record (for
example, a future `spec/omega/metrics-history.json`). A record should contain at least:

- `claim_id`, a stable identifier;
- `commit`, the full 40-hex Git SHA, not a tag name, branch name, date, or prose label;
- `suite`, the exact command or named suite to run;
- `repository`, if claims can be consumed outside this repository;
- the expected result: test count, failures, and every other metric asserted;
- the measurement environment contract (Node/npm versions, platform policy, and relevant
  lockfile/package-manager identity);
- the result format/schema version; and
- provenance: who approved the baseline, when, and links to the review evidence.

The SHA is the authority. A release name or a sentence in a Markdown file is only
human-facing context and cannot identify the revision. The record itself must be committed
in a later, current revision; the record must never be treated as evidence that the target
commit contained the record.

Before accepting a record, tooling should verify that the SHA resolves to an object in the
expected repository and that its full object ID is exactly the recorded value. A short SHA,
annotated-tag target, mutable ref, or “nearest commit” fallback is an error. If the history
has been rewritten or the object is unavailable, the check must fail rather than silently
substitute another revision.

## 3. Re-measure the suite at that commit

A future `check-metrics` mode (or a dedicated historical checker invoked by it) should:

1. parse and schema-validate the historical records;
2. resolve each recorded full SHA without trusting the current working tree's prose;
3. create an isolated, disposable Git worktree at that SHA;
4. install dependencies according to the dependency files and the declared environment
   policy, without copying generated files or the current checkout into the worktree;
5. run the recorded suite command from that worktree with network access disabled unless
   the suite explicitly requires a pinned, separately verified fixture;
6. parse the result using a strict versioned result parser (including total, pass, and
   fail counts, plus named metrics); and
7. compare measured results with the recorded expectation and emit the target SHA, command,
   environment, and measured result in the check output.

The current checkout's `package.json`, tests, tools, and documentation must not be used to
measure a historical claim. In particular, a current `npm test` result is not evidence for
a prior commit. Worktrees must be cleaned up in success and failure paths, and a missing
or non-reproducible dependency lock must be reported as an explicit indeterminate/failure
state rather than converted into a pass.

Dependency installation needs an explicit two-phase policy. CI may use a verified, pinned
cache or fetch only the lockfile-resolved artifacts over the network in the setup phase;
the setup must record the cache/artifact digest and dependency-manager version. The suite
execution phase must then run without network access. Install scripts must be treated as
code: either run only from the pinned dependency set in a sandbox with the declared
permissions, or use an approved, documented `--ignore-scripts` policy and fail closed when
the historical suite requires a missing generated artifact. A historical claim must never
silently install unpinned dependencies or execute arbitrary lifecycle scripts with CI
credentials.

The repository workflow must make the target object available: historical verification CI
requires a complete history (`fetch-depth: 0`, or an equivalent explicit fetch of every
recorded SHA). If a recorded SHA cannot be resolved, the result is “not reproducible” and
not a pass.

For a first rollout, the checker may run only claims whose commands and dependencies are
known to be reproducible. Unsupported historical records should fail closed with a clear
“not reproducible” diagnostic; they should not be deleted or downgraded to a text-only
check.

## 4. Existing prose exemptions are not evidence

The current `tools/check-metrics.mjs` has no exemption path for historical prose: it reads
only the two explicit `NEXA_METRICS` blocks in `README.md` and `SECURITY.md`, measures the
current checkout, and compares the five required fields. It does not parse `README.md:434`,
recognize `at that release`, or skip a line because it is described as historical. This is
an important audit result, not a design assumption.

A future historical checker must preserve this boundary. It must never add a prose-based
exemption. Every historical claim that is intentionally excluded from the current-metric
check must instead have a schema-valid `claim_id` and an approved, full-SHA record in the
historical manifest. The current checker should reject an unregistered claim marker rather
than silently ignore it; a registered claim is handled by the historical checker and is
reported separately from current metrics. During migration, prose claims without such a
record are inventory items only: they cannot satisfy G1, and their omission from the
current-metric block must not be interpreted as verification.

## 5. Prevent the retrospective-tagging attack

The checker must distinguish evidence from annotation:

- It must never infer a historical claim by searching for words such as “at release”,
  “historical”, or a number pair in Markdown.
- A newly added label, footnote, or metric block cannot establish that the labelled commit
  had the claimed result, because the checker executes the suite from the recorded commit.
- A claim record must be reviewed as a claim about its target SHA, with the target SHA and
  command visible in CI output. Changing the target SHA, expected values, or suite command
  is a semantic baseline change and requires explicit review.
- The checker should reject duplicate or conflicting `claim_id` records and should require
  full-SHA equality in any generated report. It should also reject records whose expected
  result is copied from an untrusted current-document parser.
- Where a historical baseline cannot be rerun, the system should preserve the distinction:
  “not independently reproducible” is not “passed”. A manually supplied result may be
  retained as provisional evidence, but cannot satisfy an automated gate.

A stronger optional control is to store the measured result, command digest, and environment
metadata in a signed attestation. Verification still reruns the suite when possible; the
signature authenticates provenance and does not turn a text label into a measurement.

## 6. What remains manual, and why

Automation can establish what a checked-out commit produces. It cannot by itself decide
that a commit is the correct product/release boundary, that the intended suite was selected,
or that a test suite meaningfully represents the claimed property. The following therefore
remain manual and must carry a written rationale:

- selecting and approving the target SHA and the exact suite scope;
- mapping a human release name to that SHA, including any release-process evidence;
- approving environment exceptions, fixture refreshes, or a non-reproducible legacy suite;
- reviewing whether tests were weakened, skipped, or renamed at the target commit; and
- accepting a new baseline or changed expected result.

A manual approval must name the reviewer, date, target SHA, decision, evidence examined,
and reason automation could not decide it. It may approve metadata, but must not override a
failed automated rerun without recording the exception and keeping the result visibly
non-automated.

## 7. Effect on G1 and later gates

G1 should consume an immutable, machine-checked historical baseline rather than a Markdown
assertion. Its pass condition should require that every required claim resolves to the
recorded full SHA and that the suite rerun matches the expected result, with no unresolved,
unsupported, or manually substituted claim hidden as a pass. Current metrics should continue
to be checked independently against the current checkout; historical and current checks
must not be conflated.

Later gates can depend on G1's verified baseline to detect drift: a current result below a
historical floor, a changed test population, or a changed named security metric should stop
the gate and produce a diff against the anchored result. A later gate may add a new baseline
only through the manual approval process above; it must not mutate an earlier claim. This
makes the chain monotonic and auditable: G1 proves the historical reference, while later
gates prove that proposed changes preserve or explicitly revise it.

Migration should be staged: first inventory and review existing prose claims, then add
records for claims with recoverable SHAs, then run the historical checker in report-only
mode, and only after false positives and environment policy are resolved make it blocking.
No stage authorizes editing `tools/check-metrics.mjs` as part of this design review.
