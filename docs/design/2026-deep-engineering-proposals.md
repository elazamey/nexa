# Assessment — "deep engineering" / "architectural sovereignty" proposals

A second, larger wave of proposals: recursive envelopes, a reasoning bridge,
protocol abstraction, desired-state sync, post-quantum signatures, semantic
routing, compute budgeting, self-healing routes, and temporal state versioning.

Verdicts follow the same standing constraints (zero runtime dependencies, zero
architectural expansion, narrow tests, bounded claims) and `docs/principles.md`.

---

## 1. Recursive provenance / chain of custody — ALREADY BUILT, and stronger

This is the one proposal that is not a proposal: it exists.

`packages/capability/src/attenuation.js` implements a delegation chain where
every link must be a **strict narrowing** of its parent — verified, not
asserted:

- resource must be a subset (`NEXA_E_CAP_AMPLIFY` otherwise)
- action set must be a subset
- validity window must be inside the parent's (`nbf` no earlier, `exp` no later)
- `max_uses` may not exceed the parent's
- `max_depth` must decrease, and a depth-0 capability is not delegable at all
- constraints must be a subset

`packages/protocol/src/endpoint.js` walks the chain (`chainLinks`, child-first)
during verification and records `depth` and `chain` in the evidence log.

**Why what exists is stronger than what was proposed.** Nested envelopes let a
device *read* the original request and apply a policy like "only if it came
from the owner through a trusted agent". That is provenance you must interpret
correctly at every hop. Attenuation makes the misuse **unrepresentable**: an
intermediary cannot widen scope, extend expiry, add actions or increase the use
budget, because a widening link fails verification. A readable chain tells you
what happened; a narrowing chain stops it happening.

A readable-but-unenforced chain would in fact be a regression: it invites
policies written against `original_sender` while the actual authority carried
by the envelope is whatever the last hop chose to put in it.

## 2. Reasoning bridge (`Thought_Process`, `Constraint_Check`) — REJECTED as evidence, acceptable as a diagnostic note

Recording why an agent acted is genuinely useful for debugging. The rejection is
narrower and specific: **these fields must never participate in a decision.**

`Constraint_Check` is the dangerous one. A field in which the *requester*
asserts "I verified this does not violate policy" is the requester grading its
own exam. NEXA's whole posture is that the enforcer derives the decision from
what it can check itself. The IETF CAID draft states the same rule from the
other side: at the effect boundary the executor must derive the action object
from the operation it is about to perform, and must not let a counterparty-
supplied identifier substitute for that derivation.

`Thought_Process` is a natural-language narrative. By principle P2, an inference
from a narrative is not evidence. It also cannot be mutation-tested: there is no
disabling mutation of a free-text field whose effect is unambiguous (P1).

**Acceptable form:** an opaque, size-bounded, signed-over diagnostic blob that
no code reads. The moment anything branches on it, it becomes an attack surface
with the appearance of an audit trail — worse than having neither.

## 3. Protocol abstraction / CBOR / Protobuf connectors — REJECTED (dependency + a signature trap)

No CBOR or Protobuf in Node core (verified). Both are dependency trees.

The deeper problem is the claim "compress the envelope while retaining the
digital signature, then reassemble". A signature covers **exact bytes**.
Re-encoding JSON to CBOR and back is a canonicalisation problem, and
canonicalisation bugs are the classic source of signature-bypass
vulnerabilities: two different byte strings that a verifier treats as the same
document. This is P1's failure mode in cryptography — a verification that
succeeds and means nothing.

If constrained transports ever become in-scope, the honest design is to sign the
*canonical binary form* natively, never to transcode a signed document in
flight.

## 4. Desired-state sync — PARTLY PRESENT, and the rest is where P03 lives

The commit port is already desired-state, not imperative: a request carries
`expectedBaseHash` (the state the caller believes exists) and `changeSetHash`
(the state it wants), and the executor refuses when the observed base does not
match. That is compare-and-swap on content digests, which is the sound core of
this proposal.

What is rejected is the framing that a device should "compute a sequence of
actions to reach the target state" autonomously. That converts a verifiable
transition into a plan, and a plan cannot be mutation-tested the way a digest
comparison can.

The conflict case the proposal raises — two agents sending contradictory target
states at the same instant — is exactly package 8, now built: a root lock taken
with `link()`, a five-state machine in which an expired TTL is an alarm rather
than a verdict, and immediate refusal for the loser. **Note the difference in
resolution rule**: the proposal resolves conflicts by *identity priority*. We
refuse instead. Priority-based resolution means the loser's write is silently
discarded, and it cannot tell whether it was applied.

## 5. Post-quantum signatures — COMPATIBLE IN PRINCIPLE, unavailable in practice

Verified on this runtime (Node 22): `ml-dsa-65`, `ml-kem-768`, `dilithium` and
`kyber` all fail `generateKeyPairSync` with `ERR_INVALID_ARG_VALUE`. Only
ed25519 is available.

So the options are a dependency (forbidden by a standing constraint) or a
hand-rolled lattice implementation (the single worst idea available — see P1).

**Checked, and already true:** the signature format is algorithm-agile. Every
signature is `{ alg, kid, val }` with `alg: 'ed25519'` carried explicitly
(`packages/protocol/src/envelope.js`), the key identifier embeds the algorithm
(`nexa:key:ed25519:z6Mk...`), and `packages/identity/src/document.js` rejects
any unknown algorithm with `NEXA_E_SIG_ALG` rather than guessing. A future
ML-DSA signature is therefore a new *value*, not a format migration — and an
unsupported algorithm fails closed today.

So the preparation is done and no work is required. Claiming quantum resistance
now would still be false, and is not claimed.

Also worth correcting: PQC signatures provide authenticity, not forward
secrecy. "Perfect forward secrecy against quantum attacks" conflates signatures
with key exchange, and NEXA's envelopes are signed, not key-exchanged.

## 6. Semantic routing / ontological mapping — REJECTED (P3)

"The device that matches the description pulls the envelope" makes the writer
set unbounded and unidentified. That is principle P3 exactly, and the same
ground on which self-routing envelopes were rejected in the previous
assessment. It also breaks package 8: there is no principal to lock against,
and a dead lock cannot be attributed to a dead holder.

Capability-based *authorization* (what this codebase has) and capability-based
*routing* (what is proposed) are opposites: the first binds an action to a
named, verified principal; the second deliberately unbinds it.

## 7. Cognitive compute budgeting — OUT OF SCOPE, but one idea is reusable

Model selection by token budget is an orchestration concern; NEXA has no model
router, so the field would be read by nothing.

The reusable part is already present in a stricter form: `max_uses` and
`max_depth` are **enforced budgets** that attenuate down a delegation chain and
fail closed when exceeded. A budget that is verified beats a budget that is
advisory.

## 8. Self-healing adaptive routing — REJECTED (fail-open by construction)

"After three failures the system marks the path polluted and reroutes itself"
is fail-open behaviour wearing the language of resilience. Two specific
objections:

- The trigger conflates **slow responses** with **signature failures**. A
  signature failure is an authentication event, never a routing hint. Rerouting
  after one is the correct way to get an attacker to choose your transport.
- "Zero downtime, no human intervention" is the opposite of this project's
  posture. `RECOVERY_UNVERIFIED` blocks. `contested` locks wait for an
  operator. A system that cannot prove a safe state must stop, not reroute.

## 9. Temporal state versioning — SOUND PROBLEM, WRONG MECHANISM

Late-arriving stale commands are a real hazard, and discarding them is right.

The mechanism is not a version counter. A monotonic `State_Version` requires a
single writer or consensus to allocate — reintroducing distributed coordination,
which is rejected for all of P03. Two partitioned agents both emit `5.3` and the
tiebreak is gone.

The built alternative needs no allocator: `expectedBaseHash`. A stale command
names a base digest that no longer matches, and is refused on content, not on a
number someone assigned. Content-addressed staleness detection is strictly
stronger, and it is already tested.

---

## Summary

| Proposal | Verdict |
|---|---|
| Recursive provenance | Already built, and stronger (enforced attenuation) |
| Reasoning bridge | Rejected as evidence; opaque diagnostic only |
| Protocol abstraction / CBOR | Rejected: dependency + signature canonicalisation trap |
| Desired-state sync | Partly built (`expectedBaseHash`); autonomous planning rejected |
| Post-quantum crypto | Unavailable in Node 22; adopt algorithm agility now |
| Semantic routing | Rejected: destroys attribution (P3) |
| Compute budgeting | Out of scope; enforced budgets already exist |
| Self-healing routing | Rejected: fail-open, and conflates auth failure with latency |
| Temporal versioning | Right problem, wrong mechanism; use `expectedBaseHash` |

**Actionable items: one, and it turned out to be already done.**

1. ~~Verify signature algorithm agility.~~ Checked: `{ alg, kid, val }` with an
   explicit algorithm, algorithm-qualified key ids, and `NEXA_E_SIG_ALG` on
   anything unknown. Nothing to change.
2. If a reasoning trace is ever added, it must be opaque, bounded, and read by
   no code.

**What this note does not claim:** that these ideas are wrong in general. Most
are serious techniques for systems with boundaries NEXA does not have. The
claim is narrower: adopting them now would add unverified surface to a system
whose only asset is that every claim it makes has been killed by a mutation
first.

**Roadmap is unchanged:** package 9 — verified restore plus a signed evidence
bundle.
