# Ω — REAL EXECUTION: the declared-operations channel

> **Status: DESIGN — awaiting verdicts.** This document is a design pass under the gate
> order G0 set: *design first, verdicts recorded, code after.* Nothing here is
> implemented. This commit ships one specification file and one index row — no code, no
> dependency, no CI change, no error code, no ledger kind. It exists so that the first
> real effect NEXA ever performs happens through a channel that was argued about before
> it was built, and it names, one by one, the points it asks the review to rule on
> ([§ 11](#11-items-awaiting-verdict)).

## 0. What this document is, and is not

| It **is** | It **is not** |
| --- | --- |
| the Ω-layer design for how a *declared operation* becomes a *real effect* | an amendment to any closed gate — `REAL_EXECUTION` and the other five stay CLOSED (§ 7) |
| the foundation the Google roadmap's **G1** (`google.gemini`) gate must build on | the `google.gemini` design itself — that gate gets its own pass, citing this one |
| a review target: every decision point is numbered and awaiting a verdict | a publishing or deployment plan — G0's publishing status is unchanged |

One naming collision is stated plainly rather than worked around: the kernel has a hard
gate named `REAL_EXECUTION` (closed: no command execution, no shell, no subprocess), and
this design is titled REAL EXECUTION because it concerns **real effects** — the first
time anything a `.nexa` module asks for actually happens outside the process. The two
are not in tension, and keeping them distinct is a design rule (E0 below): the channel
this document designs never carries the gated resources or actions (`exec`, `shell`,
`process`, `spawn`). A network call to a declared provider is not a gated operation;
v1 simply had no transport to make one. This design adds the *design* of that transport
— gated by everything v0.1 and Ω already are.

The standing rules are inherited without edit: **AI ≠ Authority** — the channel owns no
authority and mints nothing; **refusal is evidence**; **learning proposes, it never
applies**; **the kernel is immutable**; **types carry trust**. Words in **bold small
caps** like `TOOL_RESULT`, `CLAIM`, `EVIDENCE`, `VERDICT` keep their `evidence.md`
meanings; class letters **A–D** and `max_class` keep their `../google/identity-cell.md`
§ G0-E meanings.

## 1. The problem: v1 executes nothing real

`spec/omega/README.md` says what v1 deliberately is not: *no network transport for MCP
(the bridge is an injected port), no durable storage, no model backend (the planner is
an injected port with a deterministic default).* Every provider in v1 is a port the
host injects; tests run fully offline; the G0 identity cell's keys are throwaway
fixtures. `examples/omega/gated-write.nexa` shows the honest edge of the system: the
language can express the intent, the compiler proves it, the authority is willing — and
the kernel still refuses, recorded and receipted, because the gate is closed.

That restraint is the reason nothing real has ever gone wrong. It is also the frontier:
the Google roadmap's next gate asks for a cell that *really* invokes a model — a call
that crosses a network, spends a quota and costs money (class **B**), with the key
restricted in the vault. The first real effect must not be built as a special case.
One-off plumbing is where security properties go to die: a direct adaptor here, an
exception there, and two gates later nobody can say what the reach of a module *is*.
This document designs the general thing once — **the declared-operations channel** —
and any gate that needs a real effect afterwards, gemini first, asks for a *row* in it,
not a *mechanism*.

The design question is therefore narrow and answerable:

```text
given that everything v0.1 and Ω already prove (identity, capability, policy,
evidence, classes, approvals, budgets) — what is the reviewed conduit by which
a declared operation performs a real effect, across a real network, against a
real provider, with spend accounted, such that the conduit itself adds no
authority, no trust, and no way around any gate?
```

## 2. The principle: declaration is the reach

Five rules, named E0–E4 so the review and the future tests can cite them.

| # | Rule | What it means |
| --- | --- | --- |
| **E0** | **The channel never crosses a gate.** | `REAL_EXECUTION`, `TERMINAL`, `FILESYSTEM_WRITE`, `AUTO_COMMIT`, `AUTO_PUSH`, `AUTO_DEPLOY` remain CLOSED and pre-policy. The channel executes *declared provider operations*; it cannot be used to express `exec`, `shell`, `spawn` or any gated resource/action, at any layer. |
| **E1** | **No declaration, no operation.** | An operation that is not declared in the module's text does not exist at run time. This is `mcp.md`'s rule — *a module's reach is reviewable text, not whatever a server felt like advertising that day* — extended from MCP tools to every real effect. The set of real things NEXA can do is exactly the set a reviewer can read. |
| **E2** | **One row, one effect.** | Each operation is an explicit row: name, resource, class, provider, secret posture, spend limits, approval class. No row is created by inheritance, by wildcard, or by a provider's own description of itself. |
| **E3** | **The channel carries; it never decides.** | Decision order stays where v0.1 put it: signature → trust → gates → capability → policy → handler. The channel sits *behind* the decision, as the handler's way of reaching a real provider. Removing the channel cannot weaken a decision; corrupting it cannot make one. |
| **E4** | **Real ≠ trusted.** | A real result enters the program as an untrusted, public `ToolResult`, exactly like a stub's. Transport is not trust (`mcp.md`), reality is not trust either: a successful call is evidence the *provider answered*, and claims about the answer still need a declared verifier. |

A corollary worth stating on its own line: **the channel is the only place real effects
happen, and everything the channel does was declared.** Reach becomes a read. An
operator who wants to know what NEXA can do to the world reads declarations and rows;
an adversary who wants NEXA to do an undeclared thing to the world has to write a
declaration into reviewable text first.

## 3. The anatomy of the channel

```text
 do google.gemini.invoke(prompt: q) as answer              ← ordinary Ω statement
   │
   │  compile time                          run time
   ▼                                       ─────────────────────────────────────────────
 op row resolved? ── no ──► OMEGA_E_UNKNOWN_INSTRUMENT
   │ yes
 agent allow-list covers row? ── no ──► OMEGA_E_CAP_MISSING
   │ yes
 grant covers call? ── no ──► OMEGA_E_GRANT_MISSING
   │ yes: authority mints — exact resource, one action, one use, depth 0, short TTL
   ▼
 class ceiling: row.class ≤ cell max_class? ── no ──► fails at authorization, nothing
   │ yes                                                 minted, nothing crosses
   ▼
 policy + approval: class D rows need capability + policy + recorded owner approval
   │ yes
   ▼
 PRE-EVIDENCE: intent to cross is recorded BEFORE the network is touched
   │            (row digest · capability id · approval digest if any · spend ceiling)
   ▼
 ═══════════════ THE CROSSING — the only new thing ═══════════════
   effect adaptor (injected port; vault handle for secrets; no authority constructor)
   ▼
 POST-EVIDENCE: outcome is recorded — result digest · receipt · observed spend
   ▼
 answer bound as ToolResult (public, untrusted)            ← the program continues
```

Three objects make this up, and the design fixes their boundaries:

* **The operation row.** Declared with the existing `instrument` / `mcp` declarations —
  this design proposes **no grammar change** (verdict item D1). A row binds an operation
  to `provider`, `trust`, `accepts_secret` and — new in *binding*, not in syntax — the
  class, spend ceiling and approval class of the risk ladder (§ 4). The row is data the
  compiler can hash and the reviewer can read; a manifest already commits to `irHash`,
  so "the same declared operations" is a provable statement about a module.
* **The channel.** A host-bound port, constructed like the MCP bridge and the planner:
  the runtime asks for it, tests inject a deterministic stub, and **at bind time the
  channel checks parity** — every declared real-operation row must have an adaptor, and
  every adaptor must back a declared row. A mismatch is a construction failure, never a
  run-time surprise: an operation you cannot perform is not advertised as performable
  (the rule `mcp.md` applied to `tools/list`, generalised to effects).
* **The effect adaptor.** The only code that ever touches a network for real. It is
  injected (never imported by a package), it is constructed with no authority object,
  no capability mint and no ledger of its own, and it cannot be reached by a program —
  only by the channel, on behalf of a row the kernel already allowed. A stub replaces
  it everywhere the test suite runs; the standing zero-network posture of the suite is
  not amended by this design.

What is deliberately *not* a new object: a new authority, a new token type, a new
envelope type, a new namespace syntax. The channel's argument is that v0.1's decision
machinery was already strong enough; what was missing is a reviewed conduit behind it.

## 4. Class, spend and approval ride on the row

The class ladder is inherited from `../google/identity-cell.md` § G0-E exactly as G0
fixed it — **the ladder is defined by effect**: **A** reads metadata; **B** reads
content or *invokes a model at a cost*; **C** writes inside one named object,
correctable; **D** egresses or is irreversible. Three consequences for the channel:

1. **Class is a property of the operation row, never of the adaptor and never of the
   cell that hosts it.** One adaptor can back an A row and a B row; the class follows
   the row. `max_class` stays the immutable-kernel invariant G0 made it (GI-5): an
   operation above the ceiling fails at authorization, and nothing is minted — it fails
   at definition time where possible, and never silently at call time. It certainly
   never reaches a network.
2. **Class B rows carry a spend budget.** The gemini row is the case the design is
   written against: invocation must be quota-aware and cost-accounted. The channel
   enforces this as a *budget*, not a hope: a declared `spend` ceiling on the row, the
   observed spend in every post-evidence record (§ 9), and the existing single-use,
   short-TTL capability construction so that an allowed call is replayed by nobody —
   not by an adversary, and not by a retry policy (§ 6).
3. **Class D rows carry the GI-6 stack every time**: privileged operation + capability
   + policy + recorded owner approval + pre/post evidence — and the approval is in
   evidence *before* it authorizes and is *consumed with the call*, exactly as G0
   fixed it. The channel does not weaken, batch or inherit approvals.

This is the sense in which the channel is the *foundation* of the Google G1 gate
rather than a part of it: G1 will decide what gemini's rows are; this design decides
what a row *is*, what may ride on it, and what may never.

## 5. Secrets: the channel sees handles, never secrets

Nothing in this design changes where secrets live. The standing rules carry over
unchanged and are restated because the stakes become real:

* Modules hold `vault://` handles; the language never sees a secret (rule 2 of the Ω
  design). A real API key — the first class-B secret the roadmap needs — is restricted
  in the vault and restricted at the provider, exactly as the Google review prescribed
  for G1.
* `SecretString` still cannot reach a log, a tool argument, a prompt or evidence
  without an explicit, recorded declassification (rule 3). **The crossing is not a
  declassification.** Secret material moves vault → adaptor, inside the host, at the
  last possible moment; it never enters an envelope, a record, a receipt, a URL that
  gets logged, or a result. The evidence of its use is a digest of the *handle*, not
  the material.
* An adaptor declares `accepts_secret` only on the row that needs it; a secret offered
  to any other row is the existing `OMEGA_E_SECRET_EGRESS`, and a provider that echoes
  credential-looking bytes is the existing compromised-provider adversary — now against
  a real endpoint, which is why the attack obligations in § 8 include it by name.

## 6. Failure semantics: a real failure is a recorded one

The existing taxonomy absorbs almost everything, and the design requires it to:

| Situation | Answer |
| --- | --- |
| undeclared operation, allowance gap, missing grant, type/egress violation, budget, contract | the existing `OMEGA_E_*` code, unwrapped and unrenamed — kernel refusals arrive as kernel refusals because that is the truth of what happened (`language.md` § Refusals) |
| the provider is down, slow or hostile | the adaptor throws; **a throw is a refusal, never a crash** (membrane step 6 semantics); repeated failures trip the circuit breaker and hand the mission the fallback path, not a retry storm |
| an adaptor throws something that is not a registered code | refused before the fact: like every new code in the project, adaptor codes are **registered in the same commit as the behaviour that throws them** (this commit registers none — D8) |
| the spend meter cannot account for a call | the call does not happen. A spend that cannot be evidenced cannot occur: pre-evidence first, single-use tokens, **no hidden retry** — a retried effect is a *new* row-resolved call with a *new* capability, visible as one |

A network makes one failure cheap and dangerous: repeating an allowed-but-costly call.
The design's answer is structural, not textual: replay does not exist (single use,
depth 0, the kernel's use ledger), retries are themselves declared operations with
their own minted capabilities and their own line in the ledger, and the spend budget
of § 4 is enforced at the same place the capability is minted — before the network,
never at it.

## 7. What the channel deliberately cannot do

| Attempt | Result |
| --- | --- |
| `do exec.shell(cmd: "…")` through the channel | not expressible as an operation row; if hand-registered by a hostile host, the kernel still refuses: `NEXA_E_GATE` (`REAL_EXECUTION`) — gates run before policy, and the channel sits after the decision |
| an undeclared real operation | no row → `OMEGA_E_UNKNOWN_INSTRUMENT` at compile time; no adaptor parity → construction failure |
| an operation above the cell's class ceiling | fails at authorization; nothing minted; nothing crosses (GI-5 mechanism) |
| a class-D row without a live, matching approval | refused; an approval for another operation or a spent approval is refused by digest (GI-6) |
| widening a row by provider description, delegation or wildcard | rows are reviewable text; caprefs refuse wildcards at call time (`OMEGA_E_RESOURCE_WILDCARD`); the capability algebra is subset-only |
| the channel or an adaptor minting, widening or holding authority | no authority constructor is reachable; posture asserts it of every package, and this design adds the adaptor boundary to that assertion |
| a payload — secret or not — entering a transcript | records carry `payload_digest` and `bytes` (cellular rule), never the payload |
| an ambient, global channel | the channel is bound per runtime host, like the bridge and the planner; there is no module-level way to name it, so there is nothing for a module to capture |

## 8. Attack obligations

This design ships no suite — but a design that names no attacks is asking to be
forgotten, so the implementation commit is **required** to extend the adversarial
suite with a new category (working name `effect-execution`), re-counted by the
Evolution Gate's adversarial stage like every other category. Minimum attacks, stated
now so the review can rule on the *bars* before the *code*:

| # | Attack | Must be refused by |
| --- | --- | --- |
| 1 | call a real operation the module never declared | E1 — `OMEGA_E_UNKNOWN_INSTRUMENT` |
| 2 | substitute adaptor A's row for adaptor B's at bind time (cross-call confusion) | parity check, row digest in pre-evidence |
| 3 | launder a class-D effect into a class-B row | class on the row + `max_class` at mint |
| 4 | replay an approval across two crossings | approval consumed with the call; digest mismatch |
| 5 | drain quota/cost by replaying an allowed call | single-use capability + spend budget |
| 6 | smuggle a secret into URL/header/log through a real call | `accepts_secret` + vault-handle hand-off, digest-only evidence |
| 7 | hostile provider echoes credential-looking bytes in its answer | result typed untrusted; no path to `EVIDENCE` without a declared verifier |
| 8 | adaptor throws an unregistered error code | refused at registration time — codes ship with the behaviour |
| 9 | skip pre-evidence, or forge post-evidence, for a crossing | both records mandatory; ledger chain verification |
| 10 | an adaptor exposing more than its rows (an extra method, a debug path) | parity at bind time; posture scan |

## 9. The evidence contract of a crossing

Two records bracket every real effect, on the Ω ledger, pointing at kernel truth:

* **Pre-evidence (intent):** the row digest, the capability id, the approval digest if
  the row needs one, the spend ceiling, the row's class. Written **before** the
  network is touched — so a crossing that is interrupted is still a provable intent
  plus a provable absence of outcome, never a blank.
* **Post-evidence (outcome):** the result digest (`payload_digest`, `bytes` — never the
  payload), the kernel record hash and receipt id it cites, and the **observed spend**.
  `matchReceiptToRecord` continues to bind receipt to record; an Ω transcript claiming
  a crossing the kernel never decided stays detectable by anyone holding the kernel
  chain.

Working names for the two record kinds are reserved for the implementation commit
(D8): they register in `OMEGA_EVIDENCE_KINDS` **in the same commit as the behaviour
that emits them**, per the G0 clauses. Mission-level semantics are unchanged:
`CLAIM` proves nothing, `EVIDENCE` requires verified trust, a result of a real call is
untrusted until a declared verifier says otherwise — because something really
happening and something being *true* remain different statements (E4).

## 10. Threat-model deltas

Everything `threat-model.md` § 2 declares out of scope stays out of scope (host,
key custody, side channels, denial of service beyond budgets and the breaker). Three
deltas arrive with real effects:

* **New assets to defend:** quota and money (class-B spend), and the *fact of
  reachability* — which providers NEXA talks to is metadata worth protecting. Defence:
  spend budgets, exact-resource capabilities, digest-only transcripts, and rows that a
  reviewer reads instead of traffic an operator discovers.
* **The compromised-provider adversary becomes real.** Its answers are untrusted input
  arriving over a real network: hostile text, credential echoes, oversized bodies. The
  defences are the standing ones, now exercised live: untrusted typing, sink rules,
  `max_args_bytes`/body bounds, the circuit breaker, and § 8's attacks 6–7.
* **The buggy-or-unlucky operator does the most damage** — the design's answer is that
  the reach of the system is *reviewable text* (E1), that nothing executes at bind
  time by surprise (parity), and that every crossing is reconstructable afterwards
  from two records and a receipt (§ 9).

## 11. Items awaiting verdict

Each item names a decision this document refuses to take alone, the document's
recommendation, and what the review is asked to return — **APPROVED** or **CHANGE
REQUIRED** — recorded as a review document in the manner of
`../google/review-g0.ar.md`, appended rather than edited.

| # | Decision point | Recommendation |
| --- | --- | --- |
| **D1** | Whether real operation rows ride on existing `instrument`/`mcp` declarations (**no grammar change**) or introduce a `channel`/`effect` declaration | no grammar change now; rows are binding data over existing declarations — grammar only if the review finds the binding unreadable |
| **D2** | The class ladder's source of truth: this design asserts the row carries class, spend ceiling and approval class | approve the row as the single carrier, with `max_class` enforced at mint (GI-5 mechanism), not re-derivable elsewhere |
| **D3** | One generic channel for all organs vs. a per-organ channel | one channel, designed generally; organs differ in rows and adaptors, never in mechanics |
| **D4** | Where the spend meter lives | with the capability: observed spend is post-evidence data; the ceiling is checked where the token is minted |
| **D5** | Whether pre-evidence is mandatory for **all** real crossings or only for class B+ | mandatory for all: a class-A promise is cheap to keep and the uniformity closes § 8.9 |
| **D6** | The secret hand-off boundary (vault → adaptor, in-host, at the last moment) | approve as stated; any transport of material outside the host is a CHANGE to a closed-contract clause |
| **D7** | Parity check at bind time: every row an adaptor, every adaptor a row | approve as construction-time failure, never run-time |
| **D8** | The reserved names for the two new ledger kinds and the adaptor error codes | names chosen at implementation; **registered in the same commit as the behaviour**, counted by posture like the 84/32 that G0 fixed |
| **D9** | Numbering: this design answers to "G1" in the real-execution series while the Google roadmap's gemini gate is also G1 | keep both, with this gate cited as the gemini gate's prerequisite — unless the review prefers renumbering one series; the record must name exactly one choice |

Nothing else in the tree is affected: the G0 closure record is **not amended** (a
change to a closed contract takes the same path this document is taking), the
publishing status of G0 § 3 stands (nothing published, zero dependencies, no network
surface in the suite — the gate is the publish), and the six hard gates are untouched.

## 12. Definition of done for this design commit

| # | Clause | Met by |
| --- | --- | --- |
| 0 | the design commit is design-only | one specification file (`spec/omega/execution.md`) plus its index row in `spec/omega/README.md` — no code, no dependency, no CI change, no error code, no ledger kind |
| 1 | every decision is a numbered verdict item, not a silent choice | § 11, D1–D9 |
| 2 | no closed contract is edited | G0's record untouched; the six gates and their tables untouched |
| 3 | the attacks the future must survive are named before the code exists | § 8, ten minimum attacks, one new category |
| 4 | implementation starts only after verdicts are recorded | the review document, appended in the manner of `review-g0.ar.md` |
| 5 | an Arabic executive summary follows the approved design | pending verdicts, in the manner of `cellular.ar.md` / `README.ar.md` |

> Design first. Verdicts recorded. Code after. The channel this document describes will
> carry real effects one day soon; what it must never carry is a surprise.
