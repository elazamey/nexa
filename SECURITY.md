# 🛡️ سياسة الأمان والنموذج الأمني لمشروع NEXA Protocol (Security Policy & Model)

نحن نأخذ أمان مشروع **NEXA** وسيادته البرمجية بجدية فائقة. إذا اكتشفت ثغرة أمنية أو خطأً في آليات التشفير والائتلاف، يُرجى اتباع الإرشادات الموضحة أدناه.

---

## 📋 الإصدارات المدعومة (Supported Versions)

نقدم التحديثات والتصحيحات الأمنية للإصدارات التالية:

| الإصدار | مدعوم أمنياً | حالة الصيانة |
| ------- | :---: | :---: |
| `1.x.x` (Current Main) | `✅ نعم` | نشط ومدعوم بالكامل |
| `0.x.x` (v0.1 / Omega) | `✅ نعم` | تحديثات الأمان الحرجة فقط |
| `< 0.1.0` | `❌ لا` | غير مدعوم |

---

## 🚨 كيفية الإبلاغ عن ثغرة أمنية (Reporting a Vulnerability)

**نرجو عدم إنشاء Issue علني للثغرات الأمنية.**

يرجى استخدام إحدى الطرق التالية للإبلاغ السري:

1. **عبر خيار GitHub Private Vulnerability Reporting (المفضل):**
   - انتقل إلى علامة التبويب **Security** في المستودع.
   - اضغط على **Report a vulnerability**.
   - أدخل تفاصيل الثغرة وخطوات إعادة إنتاجها.

2. **عبر البريد الإلكتروني المباشر:**
   - أرسل تفاصيل الثغرة إلى: `sayedelazameydesign@gmail.com`
   - يُفضل تضمين الإثباتات الفنية (Proof-of-Concept) وسجل المظاريف المشفرة.

---

## ⏱️ جدول الاستجابة (Response Timeline)

- **التأكيد الأول (Initial Acknowledgment):** خلال **24 ساعة** من استلام التقرير.
- **التقييم والتحقق (Triage & Verification):** خلال **72 ساعة**.
- **إصدار الإصلاح الأمني (Security Patch Release):** خلال **7 أيام عمل** (حسب درجة خطورة الثغرة).

---

## Security model

NEXA v0.1 is a protocol for *deciding* and *proving* — not for doing. That distinction
is the whole security story, and it is enforced in code rather than documented as intent.

## The six gates

| Gate | State | Refused at |
| --- | --- | --- |
| `REAL_EXECUTION` | CLOSED | namespaces `exec`, `shell`, `process`; actions `exec`, `spawn`, `shell` |
| `TERMINAL` | CLOSED | namespaces `terminal`, `tty` |
| `FILESYSTEM_WRITE` | CLOSED | namespaces `fs`, `file`; actions `write`, `delete`, `remove`, `move`, `chmod` |
| `AUTO_COMMIT` | CLOSED | namespaces `vcs`, `git`; action `commit` |
| `AUTO_PUSH` | CLOSED | namespaces `push`, `remote`; actions `push`, `merge` |
| `AUTO_DEPLOY` | CLOSED | namespaces `deploy`, `release`, `infra`; actions `deploy`, `release`, `publish` |

Properties worth stating precisely:

* `checkGates()` runs in the CALL path **before** `policy.evaluate()`. A policy rule
  cannot answer for a gated request, because gates never ask policy.
* `packages/policy/src/gates.js` exposes no setter, no environment lookup, no override
  parameter. `GATE_STATE` is frozen at `CLOSED`.
* The evidence log records which gate refused, so a refusal is auditable, not silent.
* Handlers are in-memory and registered by the host process. NEXA never reaches outside
  the process: no filesystem, no sockets, no child processes.

## Threat model

| Threat | Mitigation |
| --- | --- |
| Forged sender | Ed25519 over the whole envelope; key id is self-certifying |
| Replay of a captured request | 128-bit `id` + `nonce`, replay guard committed *after* signature verification |
| Stolen envelope, re-targeted | `to` is signed; a receiver refuses mail addressed elsewhere |
| Signature confused between object types | per-object domain separators |
| Canonical-form ambiguity | strict NEXA-C14N with a re-encode check; floats and unpaired surrogates rejected |
| Authority escalation through delegation | subset-only attenuation, re-checked from the wire; delegation payload binds the parent hash |
| Redelegation multiplying a budget | every use debits the whole chain atomically |
| Untrusted peer | trust store is pin-or-reject; `HELLO` never pins implicitly |
| Pinned peer minting itself authority | `capabilityIssuers` allowlist on the root issuer; empty by default |
| Third party revoking someone else's capability | revocation is attributed to an issuer inside the chain |
| Compromised endpoint rewriting history | tamper-evident hash chain + signed receipts that commit to chain head |
| Malicious tool injecting ambient authority | MCP bridge accepts only declared schemas, maps caller to unprivileged kid, default-deny |
| Egress leaking private key material | key id derivation is one-way (`crypto.subtle.digest`); private key object is never serialized |
| Hostile environment tampering with gates | gate map is deeply frozen at module evaluation time; mutation throws in strict mode |
| Cheap denial of service through huge payloads | 64 KiB body cap enforced before hashing or verification |
| Signature ambiguity from normalized keys | NFC key collisions and `__proto__` are hard errors |
| Behaviour smuggled in as configuration | policy rules must be plain data; evidence fields are whitelisted |
| Revoked authority | signed revocation records; revoking a root revokes the chain |
| Silent policy gaps | default-deny; unknown rule fields are errors |
| Log rewriting | hash-chained, signed evidence records; edit/delete/reorder/forge all detected |
| Denial-of-service through replay state | unauthenticated input never consumes replay slots and never gets a reply |
| Leaking gate-protected data through an error | DENY bodies carry codes and reasons, never handler output |

## Out of scope for v0.1

* **Durable evidence storage.** The log is in memory; exporting and persisting is the
  host's job (v0.1 has no filesystem capability by design).
* **Cross-endpoint evidence reconciliation.** `EVIDENCE` envelopes are specified but not
  implemented; compare chain heads yourself if you need it.
* **Key rotation and identity-level revocation lists.** A rotated identity is a new key
  id and a new pin.
* **Transport.** NEXA defines envelopes, not framing; secure transport (mTLS, Noise) is
  the caller's responsibility.
* **A hostile host process.** NEXA constrains what the *protocol* allows, not what a
  process with the same privileges could do by ignoring it.

## Test surfaces

| Suite | Purpose |
| --- | --- |
| `npm test` | 113 tests: canonical form, crypto, identity, capability lattice, gates, policy, envelopes, replay, ledger, endpoint pipeline, evidence, parser, MCP |
| `npm run audit` | 16 adversarial probes that must keep failing to break the protocol |
| `npm run posture` | runtime assertion that all six gates are CLOSED and that no protocol/adapter source imports execution or filesystem APIs |
| `npm run proof:permission` | executes the protocol flow under Node's permission model and asserts that filesystem write, child processes and network are denied *by the runtime* |
| `npm run vectors` | pinned canonical bytes, key derivation, signatures and capability grants; CI fails on drift |

## Reporting

This is a specification-and-implementation repository with no users, no service, and no
data. If you find a security bug — a way past a gate, an amplification path through
attenuation, or a signature that verifies when it should not — open an issue with
`[security]` in the title and a failing test. A reproduction in `tests/` is the most
useful possible report.


## Measured security metrics (enforced by CI)

The block below is the only place a number is stated: `npm run metrics` re-measures
every line from a live run and fails when a documented number does not match the
measurement. Counts are not restated in prose (D1.12 — an unreferenced literal is a
claim, not evidence); the last recorded measurement is `live_measurement` in
`self-model/baseline.json`, and `tests/count-claims-sync.test.js` fails if a prose
count creeps back into either document.
H1 durable consumption passes its unchanged restart/ABA test; H2 atomicity and H3
external-writer concurrency were resolved in the 2026-09-22 verification and their
tests run unskipped in `npm test`.
COMMIT requires a pre-provisioned private persistent `CELIA_COMMIT_STATE_DIR`
outside the target root; missing/uncertain storage fails closed. Do not reset the
store or clear stale reservation locks to restore availability.
See [H1 evidence and storage assumptions](docs/celia-workspace-commit-h1-persistence.ar.md)
and [the original H1/H2/H3 RED](docs/celia-workspace-commit-hardening-red.ar.md).

<!-- NEXA_METRICS:START -->
- Total tests: 723
- Security tests: 16
- Ω attacks: 31
- Google identity attacks: 8
- Closed gates: 6
- Ω error codes: 86
- Gated namespaces: 14
- Attack categories: 12
<!-- NEXA_METRICS:END -->

## Celia workspace HTTP write boundary

`POST /api/v1/workspace/write` is the only HTTP mutation route with verified
authorization and staging isolation. An authorization grant binds the caller,
workspace, file path and exact bytes hash. Staged writes use a separate staging
directory, not the workspace root; mutations only reach the root after the separate
COMMIT step. All other workspace routes remain under the legacy default-deny
boundary described below. Legacy create/rollback
and other mutation routes are **not** secured; do not expose the dashboard API
publicly. Replay/use accounting is process-local, not durable.

See the [authorization contract and RED → GREEN evidence](docs/celia-workspace-write-authorization.ar.md)
for configuration, filesystem checks, and remaining limitations.

## Celia workspace HTTP commit boundary

`POST /api/v1/workspace/commit` requires independently configured COMMIT authority,
not WRITE authority. A one-use grant binds the caller, workspace, target root,
full staged-file manifest hash and expected base-file hash. The server verifies
current state before applying the captured bytes synchronously. Core gates are
unchanged. This is **not** a multi-file atomic transaction or protection against
concurrent external OS writers; it assumes a single process with exclusive root
access for application safety. H1 now uses a mandatory external, persistent
consumption store across restarts; see the [H1 storage contract](docs/celia-workspace-commit-h1-persistence.ar.md).
This does not close H2 atomicity or H3 external-writer races.

See the [COMMIT v1 contract](docs/celia-workspace-commit-contract.ar.md) and
[RED → GREEN runtime evidence](docs/celia-workspace-commit-green.ar.md).

## Celia adaptive learning boundary

The learning package is pure numerical/data code. Its operator CLI is separate
from HTTP and from all execution/authorization paths. Ranking always remains
advisory; no automatic patch application, model promotion, shell execution or
changes to capability/policy configuration are implemented. A learning score
and a reviewer's text identifier are NOT authority or authenticated evidence.

Keep collections private and outside the repository. Reports, labels and model
files rely on a trusted local operator; hashes are consistency checks, not signed
attestations or protection against privileged dataset tampering. Unreviewed data
is excluded. Finite weights, bounded inputs and task-group splits are checked,
but this is not a complete poisoning, fairness, causal-effect or drift defense.
Research abstracts are untrusted text, never instructions or automatic training
samples. Do not render them as HTML or execute linked code. No LLM fine-tuning,
network model provider or periodic fetch worker was activated.

See [learning evidence and limitations](docs/celia-adaptive-learning.ar.md).
