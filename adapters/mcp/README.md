# MCP adapter

Bridges MCP (JSON-RPC 2.0) to NEXA. It does not implement a transport — it maps
messages, and it refuses everything NEXA refuses.

## Mapping

| MCP | NEXA |
| --- | --- |
| `initialize` | `serverInfo` + `capabilities.nexa` |
| `tools/list` | registered, ungated resources only; name = `nexa_<resource with : → _>` |
| `tools/call` | a real signed `CALL` envelope, decided by `Endpoint.receive()` |
| result | `structuredContent` = NEXA `RESULT.value`, plus `nexa.ref` and the receipt summary |
| denial | JSON-RPC error `-32001` with `data.nexa_code`, `data.details`, `data.receipt` |
| `nexa/posture` | gate posture, exposed tools, endpoint key id |
| `nexa/evidence` | last *n* evidence records and the chain head |

## Rules the bridge enforces

1. **No capability, no call.** A `tools/call` without a capability token reaches the
   endpoint as a `CALL` without `cap` and is denied with `NEXA_E_CAP_MISSING`; the
   bridge does not invent authority on the client's behalf.
2. **A capability from an unlisted issuer is refused.** The bridge builds a real
   `CALL`; the endpoint applies its `capabilityIssuers` allowlist, so a pinned peer
   cannot mint itself tool access through MCP either.
3. **Gated tools are never advertised.** `new McpBridge({...})` throws `NEXA_E_GATE`
   if asked to expose a resource in a gated namespace, and `tools/list` only ever
   reports what it was allowed to expose.
4. **Denials are provable.** Every denial returns the signed receipt for the
   `GATE_BLOCKED` / `POLICY_DECISION` / `CAPABILITY_REJECTED` evidence record,
   verifiable with `verifyReceipt` without access to the endpoint's log.
5. **No new authority surfaces.** The bridge adds no methods that could read files,
   execute commands or deploy; `MCP_METHODS` is a closed list.

## Example

```js
import { createIdentity, TrustStore } from '../../packages/identity/index.js';
import { mintCapability } from '../../packages/capability/index.js';
import { Policy } from '../../packages/policy/index.js';
import { Endpoint } from '../../packages/protocol/index.js';
import { McpBridge } from './index.js';

const operator = createIdentity({ label: 'operator' });
const agent = createIdentity({ label: 'agent', kind: 'agent' });

const endpoint = new Endpoint({
  identity: agent,
  capabilityIssuers: [operator.kid],   // who may grant authority; empty means nobody
  policy: new Policy({ rules: [
    { id: 'allow-echo', effect: 'ALLOW', resource: 'tool:echo', actions: ['call'] },
  ]}),
  trust: new TrustStore(),
});
endpoint.registerHandler('tool:echo', ({ args }) => ({ echoed: args }));
endpoint.trust.pin(operator.document);

const bridge = new McpBridge({ endpoint });      // throws if a gated resource is exposed

const capability = mintCapability({
  issuer: operator, subject: agent.kid, resource: 'tool:echo', actions: ['call'],
  caveats: { exp: '2026-09-18T13:00:00Z', max_uses: 3, max_depth: 0 },
});

bridge.handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call',
  params: { name: 'nexa_tool_echo', arguments: { text: 'hi' } } },
  { caller: operator });                          // -> error -32001 NEXA_E_CAP_MISSING

bridge.handleRpc({ jsonrpc: '2.0', id: 2, method: 'tools/call',
  params: { name: 'nexa_tool_echo', arguments: { text: 'hi' } } },
  { caller: operator, capability });              // -> result with receipt
```
