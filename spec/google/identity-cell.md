# GOOGLE IDENTITY CELL SPEC v1.1

> **Status:** v1.1 — **design only.** No code, no dependency, no CI change, no package
> change, and **no new error code** has been added for this phase. This document is the
> contract that must be approved *before* any implementation lands.
>
> **Rule this spec keeps, everywhere:** *Google proves who you are. NEXA decides what you
> can do.* Google is an **identity provider**, never an authority. Nothing in this phase
> can mint, widen, or delegate a NEXA capability.

## Review record (v1 → v1.1)

G0-A … G0-H were reviewed item by item. Four items were returned **CHANGE REQUIRED** and
their replacement text is now part of the contract; the remaining sections were accepted as
written.

| Reviewed item | Verdict | Where the normative text now lives |
| --- | --- | --- |
| Identity paths A vs B | **CHANGE REQUIRED** | § A.2 (A is the sole v1 path; B deferred to G2, disabled by default) |
| OAuth scope table | **CHANGE REQUIRED** | § B.1 (`GOOGLE_SCOPE_TABLE` canonical rows + three "no scope" rules) |
| Risk class D | **CHANGE REQUIRED** | § G0-E (class is a function of the triple; `max_class` is a kernel invariant) |
| Revocation / break-glass | **CHANGE REQUIRED** | § C.2 rules 5–6 (recovery-only, time-bounded, evidence-first) |

Nothing else in v1 was weakened. `G0-A … G0-H` is **approved for review, not for
implementation**: the implementation phase (§ G0-H) starts only after this document is
committed as-is.

## Invariants this phase fixes

```text
Google proves identity.            NEXA decides authority.
Owner identity ≠ capability subject.
email = display metadata.          sub = identity anchor.
stored identity = sha256("NEXA/google1 subject\0" || sub)
gmail.send = privileged operation + capability + policy + owner approval + pre/post evidence
No write before evidence.
Break-glass = time-bounded recovery state, never Authority.
```

- Owner in scope: `canyoudfg@gmail.com` (display only; never a key, never a permission).
- Layers touched (planned): `packages/cells/google/{identity,gateway}` — **external organs**
  of the organism. Kernel modules are untouched and remain outside every surface below.
- Prerequisite reading: [`../omega/cellular.md`](../omega/cellular.md) (§3 membrane,
  §5 authority, §13 evidence) and [`../omega/authority.md`](../omega/authority.md).

---

## 0. Non-goals of v1

| Not in v1 | Why |
| --- | --- |
| Any Google call in tests or CI | CI must stay offline and deterministic; the live path is opt-in (§ G0-H) |
| Gmail write, Drive write, Calendar write | mutation scopes are G3+, each behind a new consent and an explicit capability |
| Multi-tenant roles | v1 has one owner binding plus the temporary `recovery` state of § C.2.6; role policy beyond `owner` is G4 |
| A browser-held refresh token | refresh material lives in the vault, in the gateway, never in a client |
| Google as a policy engine | a Google `role`/`hd` claim is *evidence*, never a decision |
| Trusting any client-supplied identity claim | the identity cell verifies tokens itself, server-side |

---

## G0-A — Identity Contract

### A.1 The identity key

| Field | Source | Use |
| --- | --- | --- |
| **`sub`** | Google ID token `sub` claim | **the identity key** — stable, never reused by Google |
| `email` | token `email` + `email_verified` | **display only**; never a key, never a permission, never matched for access |
| `hd` | token `hd` (if present) | recorded as a claim; v1 imposes no hosted-domain requirement |
| `name`, `picture`, `locale` | token (optional) | presentation only, never stored in evidence |

`sub` is never written to a ledger, a log, a prompt or an export. What is stored is:

```text
sub_hash   = sha256("NEXA/google1 subject\0" || sub)      // 32-byte digest, hex
email_hash = sha256("NEXA/google1 email\0"   || email)    // only when policy allows storage at all
```

`sub_hash` is recomputed on every login, so an auditor can match evidence to a subject
without the raw identifier existing in the repository, the ledger or any transcript.

### A.2 Identity path decision (normative)

**G0-A is the sole identity-verification path for v1.** Firebase is not a v1 path.

```text
G0-A MUST:
- validate the Google ID token signature against an explicitly configured
  Google JWKS source;
- validate issuer;
- validate audience against the exact configured NEXA web client ID;
- validate azp whenever the token semantics require it;
- validate nonce according to the authentication flow;
- validate exp and iat;
- reject any mismatch fail-closed.

The NEXA owner identity MUST be derived from Google `sub`.
Email MUST be presentation metadata only and MUST NOT establish ownership,
authority, capability, or account binding.
```

Each item above is realised by the *configured values* below. A value that is not configured
is a refusal, never a default:

| Requirement | Configured value | Rule |
| --- | --- | --- |
| JWKS source | `https://www.googleapis.com/oauth2/v3/certs` (pinned by issuer, not by config file) | keys cached by `kid`; unknown `kid` ⇒ one refresh, then refuse |
| Issuer | `accounts.google.com` or `https://accounts.google.com` | exact match; no prefix, suffix or wildcard matching |
| Audience | the single NEXA web client id for this environment (`GCLIENT_ID`) | exact match; one client per environment (dev ≠ prod); recorded in posture as `aud_hash`, never as text |
| `azp` | when the token semantics require it — i.e. whenever `aud` is an array, or the authorized party differs from the audience — `azp` MUST be present and MUST equal `GCLIENT_ID` | missing `azp` where required ⇒ refusal |
| `nonce` | the challenge this session issued | per the flow in use: MUST be carried and matched exactly, and MUST never be seen before; a flow that cannot carry a single-use nonce is **not** an accepted flow for identity |
| `exp` / `iat` | token claims | both MUST be present and integer seconds; now MUST be within `[iat − 60s, exp]`; expired or not-yet-valid ⇒ refusal |
| Any mismatch | — | refuse; there is no partial acceptance and no fallback path |

**G0-B is deferred to G2 and MUST remain disabled by default.** No G2 activation is permitted
until its own identity, token, scope, revocation, evidence, and adversarial contracts are
separately approved.

#### A.2.1 Why G0 is identity-only (measured against the provider's own limits)

Google's testing-mode rules — verified against the provider's documentation, not assumed:

- **Testing status:** up to **100 test users**, and *"authorizations by a test user will
  expire seven days from the time of consent"*, including a refresh token obtained with
  `access_type=offline`.
- **The exception is exactly this phase:** if the app requests only a subset of name, email
  and profile (`userinfo.email`, `userinfo.profile`, `openid` or their OIDC equivalents),
  users need not be on the test-user list and *"their authorizations will not expire after 7
  days"* — and this applies to Sign in with Google.
- Any other OAuth scope leaves that exception, and sensitive/restricted scopes additionally
  require verification (restricted scopes: a CASA assessment).

Therefore **v1 requests no OAuth scope beyond the ID token**, holds no refresh token, and
needs no token vault for identity. The 7-day condition cannot enter G0 at all; it becomes a
*planned reauthorization* condition for the later service cells (§ B.5).

#### A.2.2 Firebase path — deferred, not accepted (G2 candidate)

For the record only; **none of this is enabled in v1.** Firebase may later be accepted as a
*transport*, and only if all four conditions hold: `firebase.identities["google.com"][0]` is
present (a Firebase UID is not a Google subject), the `securetoken@system.gserviceaccount.com`
key source is pinned by name, the flow is proven to carry the single-use nonce required by
§ A.3 step 6, and the path is explicitly enabled by configuration — configuration is a
condition, never an authority. Until then, a Firebase token is refused (`OMEGA_E_IDENTITY`).

### A.3 Verification algorithm (normative, in this order)

```text
1. shape      — three base64url segments, JOSE header alg = RS256, kid present
2. signature  — the configured JWKS source of § A.2, cached by kid; unknown kid ⇒ one refresh, then refuse
3. issuer     — exact match against the allowed issuer; no prefix or suffix matching
4. audience   — exact match against GCLIENT_ID; when aud is an array, or the authorized party differs
                from the audience, azp MUST be present and MUST equal GCLIENT_ID
5. window     — exp and iat present and integer seconds; now within [iat - 60s, exp]
6. nonce      — the challenge this session issued, carried by the flow in use, matched exactly,
                and never seen before
7. subject    — sub per § A.1; refuse when absent, empty, or longer than 255 bytes
8. email      — email_verified must be true for the email to be displayed at all
```

Every step is *fail-closed*: a missing claim is a refusal, not a default, and a failure at
any step ends verification for that token — there is no retry with relaxed rules. Steps 3–6
are what make a stolen token useless outside the session it was issued for. Steps 1–8 are
the only accepted verification; a caller MAY NOT re-implement, reorder or partially apply
them.

The identity that is derived is `sub`, and only `sub` (§ A.4). Email is display metadata: it
MUST NOT establish ownership, authority, capability, or account binding, on this path or any
future one.

### A.4 Principal (the only identity value that crosses the membrane)

```js
{
  kind: 'google',
  sub_hash: 'sha256:…',        // the identity key, hashed
  email_display: '…@…',        // present in the session only; hashed before it is recorded
  method: 'gsi',               // v1: 'gsi' only; 'firebase' is reserved and unreachable (§ A.2.2)
  verified_at: '2026-09-18T12:00:00Z',
  nonce_id: 'sha256:…',        // the challenge that was spent
  claims: { hd: null | '…', email_verified: true, issuer: 'accounts.google.com' }
}
```

A `Principal` carries **no capability** and no role by itself. It is an input to the owner
binding (§ G0-C) and nothing else.

---

## G0-B — Google OAuth Contract

### B.1 Consent scopes — `GOOGLE_SCOPE_TABLE` (normative, canonical)

```text
GOOGLE_SCOPE_TABLE is a canonical specification constant.

Every scope row MUST contain:
- cell
- action
- question_answered
- full OAuth scope URI
- Google sensitivity/restriction classification
- v1_required
- approval_class

A scope MUST NOT be requested unless an enabled Cell has a documented
action whose contract requires that scope.

Scopes MUST be requested incrementally and in the narrowest form that
satisfies the Cell's contract.
```

The three admissions rules, in their exact form:

```text
No Cell → No Scope          a scope with no owning cell does not exist in v1
No Action → No Scope        a scope no enabled action requires is not requestable
No documented question → No Scope
                            an action whose contract cannot name the single question it
                            answers does not justify a scope
```

The table is a frozen constant in the gateway. A scope outside it is refused
(`OMEGA_E_SCOPE` at implementation), and **no configuration value can widen it** — widening is
a new consent, a new evidence record and a review.

| Cell | Action | Question it answers | Full scope URI | Google classification | v1 | Class |
| --- | --- | --- | --- | --- | --- | --- |
| `google.identity` | `verify` | *who is this subject?* | `openid` + `…/userinfo.email` + `…/userinfo.profile` (the ID-token scopes) | non-sensitive | **yes** | — |
| `google.gemini` | `invoke` | *what does the model answer?* | **no OAuth** — API key in the vault, restricted in the console to the Generative Language API | n/a (API key) | no | B |
| `google.drive` | `read.metadata` | *what files exist / what are their names?* | `…/auth/drive.file` **with the Google Picker** — narrowest rung; `…/auth/drive.metadata.readonly` only if the question needs a whole-drive listing | `drive.file`: non-sensitive · `drive.metadata.readonly`: **restricted** | no | A |
| `google.drive` | `read.content` | *what is inside this chosen file?* | `…/auth/drive.file` (per-file, user-picked) before `…/auth/drive.readonly` (all files) | `drive.file`: non-sensitive · `drive.readonly`: **restricted** | no | B |
| `google.sheets` | `read.range` | *what is the value in this range of the chosen sheet?* | `…/auth/drive.file` (per-file) before `…/auth/spreadsheets.readonly` (every sheet) | `drive.file`: non-sensitive · `spreadsheets.readonly`: sensitive (confirm) | no | B |
| `google.gmail` | `read.message` | *what does this message say?* | `…/auth/gmail.metadata` (headers/labels only) before `…/auth/gmail.readonly` (bodies) | both **restricted** | no | B |
| `google.gmail` | `send` | *what message leaves the account?* | `…/auth/gmail.send` | sensitive | no | **D** |
| `google.calendar` | `read.events` | *what is on the calendar?* | `…/auth/calendar.events.readonly` before `…/auth/calendar.readonly` | sensitive (confirm) | no | B |
| `google.calendar` | `write.event` | *what is written to the calendar?* | `…/auth/calendar.events` | sensitive (confirm) | no | C→D |

`Google classification` is filled from the provider's own published scope lists, never from
memory; `(confirm)` marks a value that MUST be re-read from that list at implementation time.
**G0 requests no OAuth scope beyond the ID token** — every other row is `v1: no`.

Two rules that make the table meaningful rather than decorative:

1. **Narrowest rung.** The scope requested is the lowest rung of the ladder that answers the
   documented question. The Picker-plus-`drive.file` combination is the narrowest form for
   per-file work, which is why it leads for Drive and Sheets; whole-account Drive read
   (`drive.metadata.readonly`, `drive.readonly`) is **restricted** and is used only when the
   question genuinely requires it.
2. **Two classifications, both binding.** Google's classification and the NEXA class are
   orthogonal, and a call passes only when **both** are satisfied. They do not even agree in
   direction: reading a mailbox is *restricted* on Google's side while sending is only
   *sensitive* — the opposite of NEXA's class ladder, where sending is class **D**. NEXA does
   not inherit Google's judgement, and Google's low classification is never a reason to relax
   NEXA's.

**Eligibility, stated before it becomes a surprise:** Google restricts who may use its
restricted scopes (permitted app categories are backup/sync, productivity/education,
reporting/security) and requires a security assessment when restricted-scope data is stored
on a server — which is exactly what a NEXA service cell does. Therefore Drive/Gmail read
scopes are gated on that qualification, and the narrow-rung choices above are the mechanism
that keeps the requirement small rather than a promise that it can be skipped.

Class **D** (irreversible or egress: `gmail.send`) requires, in addition to a capability:
policy approval and, in v1, **explicit owner approval** — the same `requiresApproval` gate
the Ω authority already enforces, with the single-use and evidence rules of § G0-E.
`gmail.modify` is not in v1 at all: sending is more reviewable than mutating a mailbox.

### B.2 Flow

```text
browser                identity cell (server)              Google
   │  login (GSI popup / Firebase)   │                        │
   │  ID token ─────────────────────►│                        │
   │                                 │ JWKS fetch (cached) ──►│
   │                                 │ verify § A.3           │
   │  session principal ◄────────────│                        │
   │                                 │                        │
   (later, G1+) service cells never speak OAuth:
   owner consent ──► authorization code + PKCE (S256) ──► token endpoint
                     server-side exchange only ──► vault
```

- **PKCE (S256) is mandatory**; `state` is a single-use nonce; the redirect URI is an exact
  allow-list match (no wildcards, no `localhost` in a deployed environment).
- `access_type=offline` + `prompt=consent` are used **only** when a refresh token is
  actually needed for a service cell, and the reason is recorded in evidence.
- Client secrets, if any, exist only in the gateway's environment, never in a cell, never in
  a browser, never in a repository. For public clients the client has no secret at all.
- **Incremental authorization:** each new service cell adds its own consent; a cell can
  never trigger a scope request for another cell.

### B.3 Quota and rate discipline

- Every service cell is created with a rate limiter (`calls` per minute) and a payload cap.
- `429` and quota errors are handled with **exponential backoff + jitter, single-flight per
  resource**; a refused call is never retried in a tight loop.
- Quota numbers are **read from the response/headers at run time, never hard-coded** (Drive
  project limits, Sheets per-minute project quotas and Gmail per-user quotas all change).
- Exhaustion is a *contained* failure, not a crash: the cell records `OMEGA_E_QUOTA`,
  degrades, and the homeostat decides between fallback and isolation.
- Gemini is **not assumed free**: the free tier covers only some models and has its own
  limits; token usage from `usage_metadata` is accounted per call.

### B.4 Google-side hardening (required, not optional)

- The API key for Gemini is restricted in the Google console to the Generative Language API
  and to the calling origin/IP that the sandbox uses.
- OAuth clients are separate per environment (dev/prod); no shared client.
- The pending Drive project-limit change is treated as a reason for a limiter, not as a
  date to remember.

### B.5 Expiry of a testing authorization is an expected condition

```text
Expiration of a Testing authorization MUST be represented as an expected
reauthorization condition, not as an integrity or security incident.
```

Concretely: when the provider ends an authorization on its own schedule (the seven-day
condition of § A.2.1), the system records a `CONSENT` record, degrades the affected cell,
and waits for a new consent — it does not treat the event as a breach, does not raise an
incident, does not retry in a loop, and does not attempt to extend its own access. The
identity path (G0) is outside this condition entirely, because it requests no scope that
triggers it.

---

## G0-C — Owner Binding

The binding is what turns *"this is a Google subject"* into *"this subject is the owner of
this NEXA instance"*. It is a signed record, created by the **operator key**, and it can be
revoked. Binding is not authority: it yields a role, and roles only ever inform the
capability policy.

### C.1 Record

```js
{
  binding: 'owner',
  sub_hash: 'sha256:…',       // the identity key from § A.1
  nexa_kid: 'nexa:key:ed25519:z…',   // the NEXA identity this subject speaks as
  role: 'owner',              // 'owner' for an invitation binding; 'recovery' for break-glass
  created_by: 'nexa:key:ed25519:z…', // the operator key
  created_at: '…',
  expires_at: null | '…',     // invitation: null = until revoked; break-glass: REQUIRED, ≤ 24h
  method: 'invitation' | 'break-glass',
  reason: null | '…',         // REQUIRED and non-empty when method = 'break-glass'
  sig: { kind: 'ed25519', kid: '…', val: '…' }
}
```

Two shape constraints follow from rule 6 and are checked when the record is validated, not
when it is used: `method: 'break-glass'` with `expires_at: null`, with an expiry beyond 24
hours from `created_at`, with `role` other than `'recovery'`, or with an empty `reason` is a
**refused record** — it is not a binding that later gets cleaned up.

### C.2 Rules

1. **One authority to bind.** Only a key the operator layer trusts may create a binding
   (`OMEGA_E_NOT_ACTIVATOR` otherwise). Google never creates a binding.
2. **Subject uniqueness.** One `sub_hash` has at most one active binding; a second is
   `OMEGA_E_BINDING_EXISTS` (registered at implementation, in the commit that throws it).
   `OMEGA_E_DUPLICATE` keeps its existing declaration-duplication meaning and is **not**
   widened to cover this case.
3. **Bootstrap.** The first binding is created by an invitation signed with the local
   operator key — the same `createIdentity()` path that exists today. There is no path in
   which a successful Google login creates its own binding.
4. **`email` never binds.** Changing the display email changes nothing; only `sub_hash`
   does. Email MUST NOT establish ownership, authority, capability, or account binding.
5. **Revocation is evidence, and it is immediate.** Revoking a binding records
   `OWNER_BINDING` with `decision: DENY` and the reason, revokes the capabilities minted
   under that role in the same transaction shape used by `@nexa/capability`'s
   `RevocationSet`, and deletes the vault entries for that `sub_hash` first (§ D.2). A
   capability that was revoked is never re-minted with the same identity, and revocation
   itself always produces evidence.
6. **Break-glass is a recovery state, not an authority.**

```text
Break-glass MUST be a recovery-only mechanism.

Rules:
1. Only the `recovery` role may invoke break-glass.
2. Break-glass MUST have a finite expiry.
3. Maximum lifetime MUST NOT exceed 24 hours.
4. A shorter per-operation lifetime SHOULD be used where possible.
5. Break-glass MUST NOT grant, mint, amplify, or proxy Class D capability.
6. Break-glass MUST NOT modify the immutable kernel, verifier,
   policy engine, capability authority, or evidence ledger.
7. A mandatory `reason` MUST exist.
8. Pre-grant evidence MUST be committed before the recovery binding is active.
9. Break-glass bindings MUST NOT be chained or delegated.
10. Any legitimate new owner binding MUST immediately revoke the
    break-glass binding.
11. Revocation MUST itself produce evidence.
12. All break-glass operations MUST be fail-closed and auditable.
```

7. **Role is data.** `owner` maps to a capability policy (§ G0-E); nothing in the identity
   cell may grant a capability because a role says "owner". `recovery` is not a second owner
   role: it is the temporary state of rule 6, with a capability set that is closed by rule 5.

Three consequences worth stating in the record itself: rule 8 means a failed evidence write
**is** a failed binding (there is no recovery state without its evidence); rule 10 means a
recovery state cannot outlive the return of the legitimate path, so its 24-hour ceiling is
the worst case and not a window to be used up; and rule 5 means the recovery state cannot
reach mail, files or the model as a substitute for the owner. Break-glass is therefore
reachable, loud, bounded, revocable and never a shortcut around the authority chain.

---

## G0-D — Token / Vault Contract

### D.1 Where each secret lives

| Material | Lives in | Reachable by a cell? |
| --- | --- | --- |
| ID token | the identity cell, for the duration of verification | as bytes, only inside verification; never stored |
| Access token | Token Vault | **no** — a cell receives a handle |
| Refresh token | Token Vault (gateway-only resolution) | **no**, never |
| Client secret | gateway environment | **no** |
| Gemini API key | Token Vault | **no** — handle only |
| Vault sealing key | KMS / OS keychain (G0: in-process dev vault) | **no** |

### D.2 Handle flow

```text
Token Vault                                   Service cell
  vault://google/<service>                      │
        │                                       │  capability: cell:google.<service>.<action>
        └── ephemeral handle { handle, scopes,   │
            expires_at, subject: sub_hash } ──────┘
                                              │  gateway resolves at call time
                                              ▼
                        Google API  ◄── token exists only inside the adapter
```

- The handle is bound to the **service cell's key id** (`presenter`), so it is useless if
  it leaks into another cell.
- `secrets.load` semantics are unchanged: the Ω type system already refuses to let a
  secret reach a log, a prompt, a tool argument or evidence without a recorded
  declassification, and the value never crosses into the module.
- **Refresh** happens only in the gateway, 5 minutes before expiry, with single-flight
  locking; a failed refresh yields `OMEGA_E_TOKEN`, isolates the affected cell and requires
  a new consent. Tokens are re-vaulted after each refresh; old material is destroyed. A
  refresh that fails because the provider ended the authorization on its own schedule is the
  expected condition of § B.5 (a new `CONSENT`), not an incident.
- **Deletion:** revoking a binding deletes the vault entries for that `sub_hash` first,
  then revokes capabilities. A token that survives a revocation is a defect.

---

## G0-E — Capability Mapping

### E.0 Risk classes (normative — kernel invariant)

```text
Risk class is a property of the triple:

(resource, action, scope/effect)

and MUST NOT be inherited solely from Cell identity.

Each Cell manifest MAY declare a maximum permitted class (`max_class`).

An operation whose required class exceeds `max_class` MUST fail during
authorization and MUST NOT mint a capability.
```

The ladder is defined by **effect**, not by example, so a new Google operation is classified
without a new debate: **A** reads metadata (no content, no egress); **B** reads content or
invokes a model at a cost; **C** writes inside one named object, correctable; **D** egresses
or is irreversible (sending, sharing, deleting, changing permissions). One cell can hold a
low-effect read and a high-effect send; the class follows the operation, never the cell.

`max_class` is an **immutable-kernel invariant**: it is declared with the cell's nucleus and
is not editable by the cell, by a proposal, or by the identity path. Because the ceiling is
checked when the capability is minted, an over-class operation fails at authorization and
never reaches the network — it fails at definition time when possible, and never silently at
call time.

```text
D capability   ≠   D approval
```

Both are required. A class-D operation needs **all six**:

```text
1. an explicit capability;
2. policy authorization;
3. an explicit owner approval;
4. pre-call intent evidence;
5. single-use approval bound to the exact operation;
6. post-call evidence.

The approval is consumed as part of the invocation and MUST NOT be reusable.
```

The approval's **author** is the owner binding; the capability's **subject** is the service
cell's key id (rule 4 below). These are two different roles in the same record, and keeping
them apart is what lets "a human approved this" coexist with
`Owner identity ≠ capability subject`.

Google operations become NEXA capabilities exactly the way every other call does — the
compiler's capref machinery and the authority are reused, not extended:

| Google operation | NEXA resource | Action | Required capability | Class |
| --- | --- | --- | --- | --- |
| verify an ID token | `cell:google.identity` | `verify` | `identity.verify` (grant: operator → identity cell) | — |
| read file metadata | `net:google.drive` | `read` | `net.read(scope "drive.metadata")` | A |
| read file content | `net:google.drive` | `read` | `net.read(scope "drive.content")` | B |
| read a sheet range | `net:google.sheets` | `read` | `net.read(scope "sheets.values")` | B |
| read a message | `net:google.gmail` | `read` | `net.read(scope "gmail.messages")` | B |
| send a message | `net:google.gmail` | `send` | `net.send(scope "gmail.send")` **+ approval** | **D** |
| read events | `net:google.calendar` | `read` | `net.read(scope "calendar.events")` | B |
| model completion | `model:gemini` | `invoke` | `model.invoke(provider: "gemini")` + vault handle | B |

Rules:

1. **Service cells hold no ambient Google access.** Each call site declares its
   capability; a call with no grant is `OMEGA_E_CAP_MISSING` before any network work.
2. **Budgets are per cell**: calls/minute, payload bytes, token cost, and a class-D
   ceiling that is lower still.
3. **Class D requires the six conditions of § E.0** — capability, policy, explicit owner
   approval, pre-call intent evidence, a single-use approval consumed by the invocation, and
   post-call evidence. A missing approval is `OMEGA_E_APPROVAL_REQUIRED` (already
   registered); a failed intent-evidence write is a refused call, not a retried one.
4. **Owner identity is never a capability subject.** The subject of every Google
   capability is a **service cell's key id** — the owner's login is what lets a binding
   exist, not what authorizes a call. This is what makes the confused-deputy attack
   structurally impossible rather than merely forbidden.
5. **Non-transferable:** capability and handle are both presenter-bound to the same cell
   key; neither travels.

---

## G0-F — Evidence Contract

### F.1 Ledger kinds to register (implementation commit)

The Ω ledger's kind list is closed; a kind that is used before it is registered fails an
invariant test, which is the point. These are added **in the same commit as the code that
writes them**. For a break-glass binding, `OWNER_BINDING` is written **before** the binding
becomes active (§ C.2 rule 8), so the recovery state cannot exist ahead of its record:

| Kind | Written when | Key fields |
| --- | --- | --- |
| `IDENTITY_VERIFIED` | an ID token was verified (or refused) | `sub_hash`, `method`, `issuer`, `aud_hash`, `nonce_id`, `decision`, `code` |
| `OWNER_BINDING` | a binding is created, revoked or replaced | `binding`, `sub_hash`, `nexa_kid`, `role`, `by`, `method`, `reason`, `expires_at` |
| `APPROVAL` | a class-D approval is granted and consumed | `operation`, `approver`, `subject_cell`, `consumed_at`, `evidence_id` |
| `CONSENT` | a scope set is granted, changed or refused | `service`, `scopes[]`, `reason`, `decision` |
| `QUOTA` | a call was throttled or a quota was exhausted | `service`, `retry_after_ms`, `remaining`, `code` |

### F.2 Record shape (example)

```js
{ kind: 'CELL_MESSAGE', decision: 'ALLOW', mission: 'google.drive',
  resource: 'net:google.drive', action: 'read', capability: '<grant id>',
  detail: { from: 'google.gateway', step: 'evidence', latency_ms: 41, bytes: 812,
            payload_digest: 'sha256:…', handle: 'vault://google/drive', scope: 'drive.metadata' } }
```

### F.3 Never in evidence

Raw `sub`, raw `email` (only `email_hash` when policy allows storage), access or refresh
tokens, API keys, file contents, message bodies, model prompts, response bodies. Payloads
appear as `payload_digest`; a Google response is typed `UntrustedData` and cannot be
promoted to evidence without verification.

### F.4 Verifiability

An auditor with the owner's Google account can recompute `sub_hash` and match
`IDENTITY_VERIFIED` records — and can confirm, by search, that no token, key or raw subject
identifier appears anywhere in the ledger, the transcripts or the exports. That search is a
test (§ G0-H), not a promise.

---

## G0-G — Threat Model (Google phase)

| # | Threat | Control | Refusal code |
| --- | --- | --- | --- |
| T1 | token theft from memory, logs, prompts or evidence | vault + handle-only + digest-only evidence + the Ω secret types | `OMEGA_E_SECRET_EGRESS` |
| T2 | ID-token replay / nonce reuse | single-use challenge, `exp`/`iat` window, single-use nonce store | `OMEGA_E_NONCE` |
| T3 | audience confusion (token minted for another app) | exact `aud` + `azp` match | `OMEGA_E_IDENTITY_TOKEN` |
| T4 | subject spoofing via a display email | `sub_hash` is the only key; email is display-only | `OMEGA_E_IDENTITY` |
| T5 | over-scoped consent | canonical `GOOGLE_SCOPE_TABLE`, narrowest rung, the three admission rules, incremental consent, consent evidence | `OMEGA_E_SCOPE` |
| T6 | quota exhaustion used as a denial of service | per-cell limiter, backoff + jitter, single-flight, homeostat isolation | `OMEGA_E_QUOTA` |
| T7 | confused deputy: a low-privilege cell borrows the owner's authority | capabilities name the **service cell**, never the owner; presenter-binding | `NEXA_E_CAP_AUDIENCE` |
| T8 | refresh-token exfiltration | refresh resolved only in the gateway; rotation; vault-only | `OMEGA_E_TOKEN` |
| T9 | malicious/compromised API response (injection) | responses typed `UntrustedData`; promotion requires verification | `OMEGA_E_EVIDENCE_UNTRUSTED` |
| T10 | the browser lying about who the user is | server-side verification only, JWKS pinned by issuer | `OMEGA_E_IDENTITY_TOKEN` |
| T11 | owner lockout (lost account) | break-glass as a recovery-only state by the local operator key: finite expiry ≤ 24h, no class D, no chaining, pre-grant evidence, immediately revoked by a legitimate rebinding | `OMEGA_E_NOT_ACTIVATOR` |
| T12 | implicit principal reuse across logins | principals are per-session; no caching of a principal beyond its session | `OMEGA_E_IDENTITY` |
| T13 | break-glass abused as an authority bypass | recovery role only, ≤ 24h, cannot touch the kernel/verifier/policy/authority/ledger, every operation evidence-first and fail-closed | `NEXA_E_CAP_AUDIENCE` + `OMEGA_E_CAP_MISSING` |

**Residual risk, stated plainly:** a compromised owner Google account is a compromised
owner — no design removes that. What this phase guarantees is that such a compromise cannot
silently *widen* NEXA authority, cannot touch the kernel, and cannot erase its own evidence.

---

## G0-H — Tests (the acceptance bar for implementation)

Same bar as today: `npm run verify` green, the adversarial suite extended, and everything
deterministic and offline.

### H.1 Suites to add

| Suite | Content | Count |
| --- | --- | --- |
| `tests/google-identity.test.js` | § A.3 verification vectors: valid · expired · not-yet-valid · wrong issuer · wrong audience · bad signature · unknown `kid` · `azp` missing while `aud` is an array · missing nonce · replayed nonce · missing `sub` · Firebase token refused (path B disabled) · email replaced while `sub` is unchanged (identity unchanged, no ownership) | ≥ 13 |
| `tests/google-binding.test.js` | bind · duplicate `sub_hash` (`OMEGA_E_BINDING_EXISTS`) · forged signature · unauthorized creator · expired binding · revocation produces evidence · **one assertion for each of the twelve break-glass rules of § C.2** — including: expiry required and ≤ 24h, no second break-glass, no class D, no kernel/verifier/policy/authority/ledger modification, mandatory `reason`, pre-grant evidence committed before the binding is active, no chaining or delegation, immediate termination on a legitimate new binding | ≥ 16 |
| `tests/google-vault.test.js` | handle never resolves in a cell; no `ya29.`/`AIza` pattern anywhere in records; refresh single-flight; refresh failure isolates the cell | ≥ 6 |
| `tests/google-capability.test.js` | every operation in § G0-E refuses without its capability · class D refuses without approval · class D refuses with a **reused** approval · an operation above the cell's `max_class` fails during authorization and mints nothing · a failed pre-call intent-evidence write refuses the call · owner identity is never a subject | ≥ 10 |
| `tests/google-quota.test.js` | `429` → backoff, `OMEGA_E_QUOTA`, no tight retry, limiter accounting | ≥ 4 |

### H.2 Fixtures and offline rule

- A **local JWKS fixture** and locally signed test tokens: CI never calls Google.
- A live smoke test exists as `npm run google:smoke` (opt-in, credentials from the
  environment, never in CI, never committed).

### H.3 Adversarial suite

A twelfth category, **`identity-forgery`**, with these attacks (all must be blocked):

1. forged ID-token signature
2. expired token accepted
3. wrong-audience token accepted
4. nonce replay accepted
5. email-as-identity escalation (email changed, `sub` unchanged)
6. over-scoped consent accepted in G0
7. confused deputy: a service cell asks the gateway to act as the owner
8. token material present in evidence / logs / exports

(Class-D abuse and break-glass abuse are asserted one rule at a time in § H.1 — the six
conditions of § E.0 and the twelve rules of § C.2 — rather than by enlarging this list, so
the approved attack count stays at eight.)

### H.4 Vectors

`spec/vectors/google.json` pins: the JWKS fixture digest, the verdict of each § A.3 vector,
the binding record shape, the § G0-E capability table, and one `IDENTITY_VERIFIED` record
byte for byte. `--check` must report "google vectors are in sync".

### H.5 Posture and invariants (extended, not weakened)

- `tools/check-posture.mjs`: identity verification order asserted; `GOOGLE_SCOPE_TABLE`
  present, frozen, and every row carrying its seven fields, with `v1_required` true only for
  the ID-token row in G0; every declared `max_class` present and treated as immutable; no
  token pattern in any package; `packages/cells/google/**` contains no `mintCapability(` and
  no `new Authority(`.
- `tests/omega-invariants.test.js`: the new ledger kinds are registered before use; every
  new error code exists in `OMEGA_ERROR_CODES`; no ambient network import in the identity
  cell's verification path (the network is an injected port, as with MCP); a break-glass
  record that is unbounded, second-in-line, or class-D-capable fails to register.

### H.6 Definition of done for G0

```text
0. the design commit is design-only: no code, no dependency, no CI change, and no new
   OMEGA_E_* code is added while designing — each new code is registered in the same
   commit that introduces the behaviour using it
1. this spec approved (§ G0-A … § G0-H reviewed line by line, the four CHANGE REQUIRED
   items incorporated)
2. every new error code registered in packages/compiler/src/errors.js in the same commit
   as the code that throws it
3. new ledger kinds registered in OMEGA_EVIDENCE_KINDS in the same commit
4. npm test ≥ 207 + the G0 suites (§ H.1), 0 failures
5. npm run attacks ≥ 23 + 8, all blocked, 12 categories
6. node tools/google-vectors.mjs --check in sync
7. npm run verify exits 0, with the identity path exercised through the cellular layer
   (a cell crossing a membrane, not a function call)
8. no network access anywhere in the test suite
```

### H.7 Codes to register at implementation (not now)

Nothing below exists yet, and **none of it is added by the design commit**. Each is
registered in the same commit that first throws it, and the invariants suite (§ H.5) is what
enforces that:

| Code | Thrown when | Notes |
| --- | --- | --- |
| `OMEGA_E_IDENTITY_TOKEN` | shape/signature/issuer/audience/`azp` failure | reserved for this phase |
| `OMEGA_E_NONCE` | missing, mismatched or replayed challenge | |
| `OMEGA_E_SCOPE` | a scope outside `GOOGLE_SCOPE_TABLE` is requested | |
| `OMEGA_E_QUOTA` | throttled or exhausted | |
| `OMEGA_E_TOKEN` | refresh failure; cell isolated, new consent required | |
| `OMEGA_E_BINDING_EXISTS` | a second live binding for one `sub_hash` | replaces the widened `OMEGA_E_DUPLICATE` |

Already registered and reused unchanged: `OMEGA_E_IDENTITY`, `OMEGA_E_SECRET_EGRESS`,
`OMEGA_E_EVIDENCE_UNTRUSTED`, `OMEGA_E_APPROVAL_REQUIRED`, `OMEGA_E_CAP_MISSING`,
`OMEGA_E_NOT_ACTIVATOR`, `NEXA_E_CAP_AUDIENCE` (presenter binding, already enforced and
tested), `OMEGA_E_ROUTE`, `OMEGA_E_ISOLATED`.

---

## Phases after G0 (unchanged order, each gated the same way)

| Phase | Adds | Exit criterion |
| --- | --- | --- |
| **G1** | `google.gemini` cell (API key in vault, quota-aware, cost accounted) | Gemini answers through a capability-gated cell crossing; token never in evidence |
| **G2** | `google.drive`, `google.sheets` (read-only, narrowest rung first) **and the deferred Firebase transport (§ A.2.2), each with its own approved contracts** | a real read returns through a cell; scope + quota evidence recorded; restricted-scope eligibility satisfied for whatever rung is chosen |
| **G3** | `google.gmail`, `google.calendar` (read; `gmail.send` behind class D per § E.0) | class D requires capability + policy + owner approval + pre/post evidence, all in evidence |
| **G4** | write paths, multiple bindings, the gateway as a tissue with per-service contracts | the Google organ is a first-class organ of the organism, with its own homeostasis |

G2 and G3 each begin with their own design pass — identity, token, scope, revocation,
evidence and adversarial contracts — exactly as G0 did. No scope from § B.1 is requested
before its phase's contracts are approved; `v1: no` in the table is the machine-readable form
of that rule.

## Repo-change plan (only after approval)

```text
spec/google/identity-cell.md            this document (design-only, normative)
spec/google/README.ar.md                the Arabic rendering of the same contract
spec/google/review-g0.ar.md             the review record and the four verdicts
spec/vectors/google.json                pinned vectors (H.4)
packages/cells/google/identity/         the identity cell (external organ)
packages/cells/google/gateway/          JWKS + OAuth + token vault + limiter (trusted provider)
adapters/google/jwks.js                 the injected network port (JWKS fetch), opt-in
tools/google-vectors.mjs                vector generator
tools/google-smoke.mjs                  live, opt-in, never in CI
tests/google-*.test.js                  the suites of H.1
```

Nothing in that list exists yet. This spec is the only artifact of G0 so far.

## Provider documentation this contract is measured against

Every provider-dependent statement above is taken from the provider's own documentation, not
from memory. The load-bearing ones:

- **Manage App Audience** — testing status is limited to 100 test users; *"authorizations by a
  test user will expire seven days from the time of consent"*, including an `offline` refresh
  token; and the exception for `userinfo.email` / `userinfo.profile` / `openid` (and Sign in
  with Google), for which authorizations do not expire after seven days and users need not be
  on the test list: <https://support.google.com/cloud/answer/15549945>
- **Google OpenID Connect reference** — the meaning and validation requirements of `aud`,
  `azp` and `nonce`: <https://developers.google.com/identity/openid-connect/reference>
- **Drive API scopes** — `drive.file` is non-sensitive and recommended with the Picker;
  `drive.readonly` and `drive.metadata.readonly` are **restricted**, with app-category
  qualification and a security assessment when restricted data is stored on servers:
  <https://developers.google.com/workspace/drive/api/guides/api-specific-auth>
- **Gmail API scopes** — `gmail.readonly` and `gmail.metadata` are **restricted**;
  `gmail.send` is *sensitive*: <https://developers.google.com/workspace/gmail/api/auth/scopes>
- **OAuth 2.0 for web server applications** — incremental authorization and requesting the
  fewest scopes:
  <https://developers.google.com/identity/protocols/oauth2/web-server>
- **Drive and Sheets quotas**, **Gemini billing** — the reason quota numbers are read at run
  time instead of pinned:
  <https://developers.google.com/workspace/drive/api/guides/limits> ·
  <https://developers.google.com/workspace/sheets/api/limits> ·
  <https://ai.google.dev/gemini-api/docs/billing>
