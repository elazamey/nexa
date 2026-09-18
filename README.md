# NEXA v0.1

**A signed, capability-gated protocol for agent tooling.**
Default-deny. Evidence-first. Digital signatures from commit one. Zero runtime dependencies.

NEXA is the layer that sits between an autonomous agent and the tools it wants to use.
Every request is an *envelope*: canonicalized, Ed25519-signed, time-boxed, nonce-protected.
Every request is *evaluated* against a capability token and a policy. Every decision —
ALLOW or DENY — is written to a hash-chained evidence log with a signed receipt.

```
INSPECT -> CREATE -> TEST -> VERIFY -> REPORT
```

## Safety posture (v0.1) — hard gates

These gates are **closed by construction**, not by configuration. They cannot be opened
by a policy document, a capability, or a peer identity. `packages/policy` checks them
before any rule is evaluated (`V01_GATES` / `HARD_DENY`).

| Gate | State | Meaning |
| --- | --- | --- |
| `REAL_EXECUTION` | CLOSED | no host command execution, no shell, no subprocess |
| `TERMINAL` | CLOSED | no tty / terminal session control |
| `FILESYSTEM_WRITE` | CLOSED | no write, delete, move, chmod outside the in-memory model |
| `AUTO_COMMIT` | CLOSED | no VCS commit performed by the protocol |
| `AUTO_PUSH` | CLOSED | no VCS push performed by the protocol |
| `AUTO_DEPLOY` | CLOSED | no deploy, release, or infrastructure mutation |

Handlers registered on an endpoint run **in-process and in-memory only**. An endpoint with
no registered handler for a resource answers `NEXA_E_NO_HANDLER` (a DENY), never a real
side effect. Tests never touch the network, the clock, or the filesystem outside `os.tmpdir()`.

## Layout

```text
nexa/
├── spec/                 protocol, grammar, envelope, identity, signature,
│                         capability, policy, evidence  (+ test vectors)
├── packages/
│   ├── ast/              data model, NEXA-C14N canonicalization, error codes
│   ├── crypto/           Ed25519 keys, base58btc key ids, sha256, nonces
│   ├── identity/         self-signed identity documents, trust store
│   ├── lexer/            character lexer for the .nex wire syntax
│   ├── parser/           .nex -> AST, AST -> .nex (round-trip printer)
│   ├── capability/       mint / attenuate / verify capability tokens
│   ├── policy/           default-deny engine + the six hard gates
│   ├── evidence/         append-only hash-chained log, signed receipts
│   └── protocol/         endpoint state machine, envelope build/verify,
│                         replay guard, usage ledger
├── adapters/
│   └── mcp/              MCP (JSON-RPC 2.0) bridge, gated both directions
├── tools/                demo flow, gate report, vector regeneration
└── tests/                node:test suite, no external services
```

## Quickstart

```bash
node --version          # >= 20
npm test                # full suite, zero dependencies
npm run demo            # end-to-end: capability -> ALLOW -> DENY(gate) -> receipts
npm run report          # gate posture + module inventory
```

```js
import { KeyPair } from './packages/crypto/index.js';
import { createIdentity } from './packages/identity/index.js';
import { mintCapability } from './packages/capability/index.js';
import { Endpoint } from './packages/protocol/index.js';

const operator = createIdentity({ label: 'operator' });
const agent = createIdentity({ label: 'agent-01' });

const endpoint = new Endpoint({ identity: agent });
endpoint.registerHandler('tool:echo', ({ args }) => ({ echoed: args }));

const cap = mintCapability({
  issuer: operator,                 // signs the grant
  subject: agent.kid,               // the only party allowed to use it
  resource: 'tool:echo',
  actions: ['call'],
  caveats: { max_uses: 3, exp: '2026-09-18T16:00:00Z' },
});

const message = endpoint.call({ to: agent.kid, resource: 'tool:echo', args: { text: 'hi' }, capability: cap });
const reply = endpoint.receive(message, { requester: operator });
// reply.body -> { ok: true, value: { echoed: { text: 'hi' } }, ref: ... }
// endpoint.evidence.verifyChain() -> { ok: true, length: 1 }
```

Everything above is real, runnable code — see `tools/demo.mjs` for the full flow including a
hard-gate DENY.

## Status

* `v0.1.0` — protocol core, signatures, canonicalization, replay protection, capabilities,
  policy, evidence, MCP adapter, test suite. All gates closed.
* Verify locally: `npm test && npm run demo`.

## License

MIT — see `LICENSE`.
