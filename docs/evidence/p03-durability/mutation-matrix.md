# P03 tests 4-6 — mutation matrix

Each test must be killed by at least one targeted mutation, or it is not
evidence. All five passed on the first run, which is a reason for suspicion,
not comfort — so each was checked against a mutation that breaks exactly the
property it claims to hold.

| Mutation | What it breaks | 4 | 5 | 6 | corrupt | order |
|---|---|---|---|---|---|---|
| A — unreadable intent read as absent | fail-closed on corruption | ok | ok | ok | **FAIL** | ok |
| B — intent check before `consume` | decision order (the H1 regression) | ok | ok | ok | ok | **FAIL** |
| C — direct write, no temp+`rename` | atomic write discipline | ok | **FAIL** | **FAIL** | ok | ok |
| D — intent opened after first root write | write-ahead ordering | **FAIL** | **FAIL** | **FAIL** | ok | **FAIL** |

Every test is killed by at least one mutation, and no mutation kills all of
them, so the suite discriminates between distinct properties rather than
refusing everything.

Mutation B is the important one: the phase-1 regression that an existing H1
test caught by accident is now caught on purpose by a test whose only job is
decision order.
