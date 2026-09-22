# Assessment — "Intent & Trust Envelope" proposals (2026 framing)

Six additions were proposed to move NEXA from a data-transport envelope to a
trust-and-intent envelope. This note classifies each against the project's
standing constraints (zero runtime dependencies, zero architectural expansion,
narrow tests, every claim bounded) and against NEXA's core thesis.

**The thesis that governs every verdict below:** authority is not effect. A
message that proves who asked, proves nothing about what happened. P02.x and
P03 exist because `write()` returning success is not evidence the bytes are on
disk. Five of the six proposals strengthen the *claim* side of a boundary whose
*effect* side is where the unproven gap actually lives.

---

## 1. Decentralized Identifiers (DIDs) — COMPATIBLE, but premature

`did:key` with ed25519 is implementable on Node core alone (`crypto` ships
ed25519; a raw 32-byte public key extracts cleanly from the SPKI DER). No
dependency cost. The offline-verification argument is real and matches NEXA's
posture: verifying a signature against a key embedded in the identifier needs
no central server.

**Why not now:** NEXA currently has no network identity layer to put a DID
into. The commit port authorizes local grants against a consumption store. A
DID would be a field nothing reads. Adding it now creates an unverified
surface — the precise pattern the mutation matrices were built to catch.

**Condition for adoption:** when a remote caller boundary exists. Not before.

## 2. Zero-Knowledge Proofs for capabilities — REJECTED for this codebase

The privacy argument is sound in the abstract. The engineering verdict is not.

- Zero runtime dependencies is a standing constraint. There is no ZK proof
  system in Node core, and there will not be one.
- The alternative — hand-rolling a proving system — is the single most
  dangerous thing this project could do. A subtly wrong ZK implementation
  produces proofs that verify and mean nothing: a counterfeit that passes every
  test. That is the failure mode of mutation E in package 7, promoted to
  cryptography, where no mutation testing I can write would detect it.
- The threat it addresses (a verifier learning the holder's identity) is not a
  threat in the current model, where the verifier IS the resource owner.

**If privacy between principals ever becomes in-scope,** the honest path is an
audited external library and an explicit dependency decision — reversing a
standing constraint deliberately, not smuggling it in.

## 3. Intent-based policies — PARTIALLY PRESENT, and the rest is rejected

NEXA already carries intent: the intent log records what a transaction meant to
do before it does it, which is why crash recovery can classify rather than
guess. That part is done and tested.

What is proposed beyond that — a policy agent evaluating context at runtime
("open the door if there is a *proven* medical emergency") — is rejected, and
the rejection is the interesting part:

> Evaluating intent at runtime moves the decision from a fixed, auditable rule
> to a judgement. A judgement cannot be mutation-tested, because there is no
> disabling mutation whose effect is unambiguous. "Proven emergency" is exactly
> the kind of predicate that looks like evidence and is an inference.

This is the same distinction that killed the false `RESTORE_COMPLETED`: the
absence of a signal is not evidence of its opposite.

## 4. WebTransport / QUIC / HTTP-3 — CATEGORY ERROR

`node:quic` does not exist in Node 22. Any WebTransport stack is a dependency
tree, which the constraints forbid.

More fundamentally, this is a latency proposal answering a correctness
question. NEXA's unproven gap is not between sender and receiver; it is between
the receiver's syscall returning and the durable state being what it claims.
Moving from HTTP to QUIC makes an unverified effect arrive faster. Every test
in `tests/celia-commit-crash-*.test.js` would pass or fail identically over any
transport, which is the proof that transport is not the variable.

## 5. Immutable multimodal evidence hashes — ALREADY THE DESIGN

This is not an addition; it is a description of what is built.

- The intent log stores digests, never bytes (a standing technical requirement).
- Every op carries `fromDigest` and `toDigest`; recovery classifies by reading
  the disk and comparing digests, never by trusting the log's own narrative.
- Completed transactions are appended to an archive, and the evidence bundles
  in `docs/evidence/` carry `SHA256SUMS` plus a manifest.

The one genuine extension worth considering is binding a digest of an
*external* artifact (a recording, a sensor capture) into the intent before the
action. That is cheap, dependency-free, and consistent. The limit must be
declared loudly: a hash proves the artifact did not change after it was
recorded. It proves nothing about whether the artifact depicts reality. A
fabricated recording hashes just as cleanly as a true one.

## 6. Self-routing capability envelopes — REJECTED, actively harmful here

An envelope that broadcasts a need and lets any capable agent answer destroys
attribution. NEXA's entire P03 effort is built on being able to say which
transaction touched which root, in what order, and to prove it by killing each
test with a specific mutation. Capability routing replaces "this process did
this" with "something capable did something".

It also converts package 8 from hard to impossible. Package 8 exists to make
two competing writers safe on one root via an `O_EXCL` lock. Broadcast routing
makes the writer set unbounded and unidentified — there is no principal to lock
against, and a dead lock cannot be attributed to a dead holder.

This is the P02.x trap in a new form: an architecture where a failure cannot be
attributed to a cause.

---

## Summary

| Proposal | Verdict | Reason |
|---|---|---|
| DIDs | Compatible, deferred | No remote boundary exists yet to carry one |
| ZKPs | Rejected | Needs a dependency; hand-rolling produces undetectable counterfeits |
| Intent policies | Partly present; runtime judgement rejected | A judgement cannot be mutation-tested |
| WebTransport/QUIC | Category error | Latency answer to a correctness question |
| Evidence hashes | Already the design | Digests not bytes; disk-verified; SHA256SUMS bundles |
| Self-routing | Rejected | Destroys attribution and makes package 8 unbuildable |

**Net:** one item is already built, one is compatible but premature, and four
are rejected on grounds the project has already paid to learn. The roadmap does
not change: finish package 8 (two competing transactions), then package 9
(verified restore plus a signed bundle).

**What this note does NOT claim:** that these ideas are wrong in general. DIDs,
ZKPs and QUIC are serious technologies solving real problems at boundaries
NEXA does not currently have. The claim is narrower and specific: adopting them
now would add unverified surface to a system whose only asset is that every
claim it makes has been killed by a mutation first.
