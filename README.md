# NEXA v0.1

**A signed, capability-gated protocol for agent tooling.**
Default-deny. Evidence-first. Digital signatures from commit one. Zero runtime dependencies.

NEXA is the layer between an autonomous agent and the tools it wants to use.
Every request is an *envelope*: canonicalized, Ed25519-signed, time-boxed, nonce-protected.
Every request is *evaluated* against a capability token and a policy.
Every decision — ALLOW or DENY — is written to a hash-chained evidence log and
comes back with a signed receipt you can verify later, without the log.

```text
INSPECT -> CREATE -> TEST -> VERIFY -> REPORT
```

* **Signed, not asserted.** Key ids *contain* their public key
  (`nexa:key:ed25519:z6Mk…`), so identity is checkable offline with no registry.
* **Authority only shrinks.** Capabilities are macaroon-style: delegation can narrow
  scope, actions, time, budget and constraints — and nothing else.
* **Authority has an origin.** An endpoint names the keys allowed to grant it
  authority (`capabilityIssuers`, empty by default). Being *pinned* as a correspondent
  is not the same as being allowed to mint permissions.
* **Deny by default.** No rule means no. A rule that says ALLOW still requires a
  verified capability and a verified envelope signature.
* **Provable afterwards.** Tamper-evident chain + signed receipts for both outcomes.
* **No ambient power.** The six gates below are closed in code, not in configuration.

## Safety posture (v0.1) — hard gates

| Gate | State | Meaning |
| --- | --- | --- |
| `REAL_EXECUTION` | CLOSED | no command execution, no shell, no subprocess |
| `TERMINAL` | CLOSED | no tty / terminal session control |
| `FILESYSTEM_WRITE` | CLOSED | no write, delete, move, chmod |
| `AUTO_COMMIT` | CLOSED | no VCS commit performed by the protocol |
| `AUTO_PUSH` | CLOSED | no VCS push performed by the protocol |
| `AUTO_DEPLOY` | CLOSED | no deploy, release, or infrastructure mutation |

Gates are checked **before** policy rules, in `packages/policy/src/gates.js`, and there
is no API that opens one — no rule, capability, caveat or peer identity can. A gated
request gets `NEXA_E_GATE`, a `GATE_BLOCKED` evidence record and a signed receipt.

Handlers run in-process and in memory. An endpoint with no handler for a resource
answers `NEXA_E_NO_HANDLER` (a DENY), never a real side effect. The test suite uses no
network, no clock, no subprocesses and no files outside the repo.

## Quickstart

```bash
node --version     # >= 20
npm test           # 113 tests, zero dependencies
npm run demo       # end-to-end flow with a gate denial and a tamper check
npm run report     # gate posture + protocol surface + inventory
npm run vectors    # regenerate spec/vectors/*.json (pinned test vectors)
node examples/hello-nexa.mjs
```

`examples/hello-nexa.mjs` is the whole protocol in ~40 lines, and
`tests/example.test.js` executes it, so this README cannot drift from the code:

```js
import { createIdentity } from './packages/identity/index.js';
import { mintCapability } from './packages/capability/index.js';
import { Policy } from './packages/policy/index.js';
import { Endpoint } from './packages/protocol/index.js';

const operator = createIdentity({ label: 'operator', seed: '11'.repeat(32) });
const agent = createIdentity({ label: 'agent-01', kind: 'agent', seed: '22'.repeat(32) });

const endpoint = new Endpoint({
  identity: agent,
  clock: () => new Date('2026-09-18T12:00:00Z'),
  // Who may grant this endpoint authority. Left empty, the endpoint obeys no
  // capability at all — a pinned peer still cannot mint itself permissions.
  capabilityIssuers: [operator.kid],
  policy: new Policy({
    rules: [{ id: 'allow-echo', effect: 'ALLOW', resource: 'tool:echo', actions: ['call'] }],
  }),
});
endpoint.registerHandler('tool:echo', ({ args }) => ({ echoed: args }));
endpoint.trust.pin(operator.document);         // trust is an explicit, local decision

const capability = mintCapability({
  issuer: operator,
  subject: operator.kid,                       // the holder: the only key id that may present it
  resource: 'tool:echo',
  actions: ['call'],
  caveats: { nbf: '2026-09-18T11:00:00Z', exp: '2026-09-18T13:00:00Z', max_uses: 5, max_depth: 0 },
  constraints: { max_args_bytes: 1024 },
});

const caller = new Endpoint({ identity: operator, clock: () => new Date('2026-09-18T12:00:00Z') });
caller.trust.pin(agent.document);

const allowed = endpoint.receive(
  caller.call({ to: agent.kid, resource: 'tool:echo', args: { text: 'hello nexa' }, capability }),
);
// allowed.decision === 'ALLOW', allowed.value === { echoed: { text: 'hello nexa' } }

const denied = endpoint.receive(
  caller.call({ to: agent.kid, resource: 'fs:/etc/passwd', action: 'write', args: {}, capability }),
);
// denied.decision === 'DENY', denied.code === 'NEXA_E_GATE', details.gate === 'FILESYSTEM_WRITE'
```

## How a request is decided

Each step can only deny; a failure at step *n* means later steps never run.

| # | Step | Failure code |
| --- | --- | --- |
| 1 | envelope structure, signature, freshness, TTL bound | `NEXA_E_SIG` / `NEXA_E_EXPIRED` / `NEXA_E_TTL` / `NEXA_E_CLOCK` |
| 2 | recipient binding (`to == self`) | `NEXA_E_UNTRUSTED` |
| 3 | replay guard on `id` + `nonce` (after step 1 succeeds) | `NEXA_E_REPLAY` |
| 4 | sender trust (trust store, pin-or-reject) | `NEXA_E_UNTRUSTED` |
| 5 | **hard gates** (pre-policy, unmovable) | `NEXA_E_GATE` |
| 6 | capability: chain signatures, subset rules, budget, presenter, **root issuer allowlist**, attributed revocation | `NEXA_E_CAP_*` / `NEXA_E_UNTRUSTED` |
| 7 | policy: default-deny, first match wins | `NEXA_E_POLICY` |
| 8 | handler dispatch (in memory), then spend the budget | `NEXA_E_NO_HANDLER` / `NEXA_E_HANDLER` |

An oversized body is refused with `NEXA_E_TOO_LARGE` before any hashing, so an attacker
cannot make the endpoint do expensive work cheaply. Steps 1–3 produce **no reply** — unauthenticated input must not consume replay state,
and answering it is how loops start. Steps 4–8 produce a signed `DENY` carrying the
code, the details and a receipt.

## Layout

```text
nexa/
├── spec/                 protocol, canonicalization, envelope, grammar,
│                         identity, capability, policy, evidence  (+ vectors/)
├── packages/
│   ├── ast/              data model, NEXA-C14N canonical form, error taxonomy
│   ├── crypto/           Ed25519, self-certifying key ids, sha256, nonces
│   ├── identity/         self-signed identity documents, pin-or-reject trust store
│   ├── lexer/            tokens for the .nex syntax
│   ├── parser/           .nex <-> envelope, deterministic printer
│   ├── capability/       mint / attenuate / verify / revoke
│   ├── policy/           default-deny engine + the six hard gates
│   ├── evidence/         hash-chained log, receipts, inclusion checks
│   └── protocol/         envelopes, replay guard, ledger, endpoint state machine
├── adapters/mcp/         MCP (JSON-RPC 2.0) bridge, gated in both directions
├── examples/             hello-nexa.mjs (the README flow, executed by the tests)
├── tools/                demo, gate report, vector regeneration
└── tests/                113 tests (incl. tests/security.test.js), no external services
```

## Capabilities in one screen

```js
const parent = mintCapability({
  issuer: operator, subject: agent.kid, resource: 'tool:echo', actions: ['call'],
  caveats: { nbf: '…', exp: '…', max_uses: 4, max_depth: 1 },
  constraints: { max_args_bytes: 1024, mode: ['safe', 'fast'] },
});

const child = attenuate(parent, {
  delegator: agent, subject: worker.kid,
  resource: 'tool:echo', actions: ['call'],
  caveats: { nbf: '…', exp: '…', max_uses: 2, max_depth: 0 },
  constraints: { max_args_bytes: 64, mode: ['safe'] },   // numbers shrink, arrays shrink
});
```

Widening anything — scope, action, expiry, budget, depth, constraint, or dropping a
parent constraint — raises `NEXA_E_CAP_AMPLIFY` at mint time, and the same checks run
again when a token arrives over the wire. A use spends **every** link's budget, so
redelegation cannot multiply authority. Revocation is a signed record; revoking a root
revokes the whole chain. Details: [`spec/capability.md`](spec/capability.md).

## Evidence

Every decision appends a record whose hash commits to the previous record's hash, and
each record is separately signed:

```text
hash_n = sha256("NEXA/0.1 evidence record\0" || C14N(record_n \ {hash, sig}))
prev_n = hash_(n-1)          # genesis: 43 zero bytes, base64url
```

Editing, deleting, reordering or re-signing any record is detected by
`verifyEvidenceChain`. `createReceipt({ record, actor })` turns one decision into a
portable, signed receipt (`ALLOW` *and* `DENY`), and `matchReceiptToRecord` binds it
back to the log entry it names. Details: [`spec/evidence.md`](spec/evidence.md).

## `.nex` — the readable form

The signed form is NEXA-C14N (a JSON subset: sorted keys, integers only, NFC strings).
For humans, `printNex` renders the same object and `parseNex` reads it back losslessly:

```text
nexa 0.1
@type CALL
@id "urn:nexa:msg:…"
@from "nexa:key:ed25519:z6Mk…"
@to "nexa:key:ed25519:z6Mk…"
@ts "2026-09-18T12:00:00Z"
@exp "2026-09-18T12:01:00Z"
@nonce 8Qm1V0nqW5m1jWv2kg
body {
  action call
  args { text "hello nexa" }
  resource "tool:echo"
}
```

Printing is deterministic (keys sorted), so `.nex` is diffable. Grammar:
[`spec/grammar.md`](spec/grammar.md).

## MCP adapter

`adapters/mcp` maps MCP JSON-RPC 2.0 onto NEXA envelopes without loosening either
side: `tools/call` becomes a real signed `CALL`, denials return `-32001` with the
`NEXA_E_*` code and the receipt, gated tools are refused at construction and never
listed. See [`adapters/mcp/README.md`](adapters/mcp/README.md).

## Specification

| Document | Contents |
| --- | --- |
| [`spec/protocol.md`](spec/protocol.md) | message types, decision order, transport, versioning |
| [`spec/canonicalization.md`](spec/canonicalization.md) | NEXA-C14N rules and domain separation |
| [`spec/envelope.md`](spec/envelope.md) | signature payload, freshness, replay, bodies |
| [`spec/identity.md`](spec/identity.md) | key ids, identity documents, trust, fingerprints |
| [`spec/capability.md`](spec/capability.md) | token shape, attenuation rules, budgets, revocation |
| [`spec/policy.md`](spec/policy.md) | gate order, rule shape, determinism |
| [`spec/evidence.md`](spec/evidence.md) | chaining, receipts, what evidence is not |
| [`spec/grammar.md`](spec/grammar.md) | `.nex` EBNF and mapping |

`spec/vectors/*.json` pins canonical output, key derivation, envelope signatures and
capability grants. Regenerate with `npm run vectors`; the tests fail if the code and
the pinned bytes drift apart.

## Verify it yourself

```bash
npm test                      # 113 tests
npm run audit                 # 16 adversarial probes (attacks that must keep failing)
npm run posture               # CI gate: all six gates CLOSED, no ambient authority in the tree
npm run demo                  # ALLOW, delegation, revocation, gate DENY, tamper check
npm run report                # runtime posture, protocol surface, inventory
npm run verify                # everything above, in order
```

`tests/security.test.js` is written as a series of attacks — NFC key collisions, a pinned
peer minting its own capability, third-party revocation, oversized payloads, replay-state
poisoning, log splicing, secret leakage through every serialized surface, MCP boundary
probing, and a grep for execution/filesystem imports. Five of them failed when first
written; see `CHANGELOG.md` for what each one found.

## Status

`v0.1.0` — protocol core, signatures, canonicalization, replay protection, capabilities,
policy, evidence, `.nex` syntax, MCP adapter, 113 tests (16 of them adversarial), pinned spec vectors.
Deliberately **not** in v0.1: any execution, filesystem, terminal, VCS or deploy
capability; durable evidence storage; cross-endpoint evidence reconciliation.

## License

MIT — see [`LICENSE`](LICENSE).
