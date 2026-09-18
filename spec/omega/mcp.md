# Ω — MCP as a first-class namespace

MCP is not an afterthought bolted onto Ω: a tool server is declared in the module, its
tools become caprefs, and a tool call is an ordinary Ω `do` statement that happens to
resolve to the `mcp:` namespace.

```nexa
mcp github {
    tools repository.read, issues.read
}

agent architect {
    allow github.repository.read, github.issues.read
}

grant github.repository.read {
    subject architect
    scope "owner=elazamey"
    ttl 5m
    max_calls 4
}
```

## The call path

```nexa
do github.repository.read(owner: "elazamey", repo: "nexa") as repo
```

```text
1  compile        capref → resource "mcp:github.repository.read", action "call"
2  compile        agent allow-list covers it? grant declared? types of args public?
3  authority      mint: subject=architect, resource=exact, action=call, uses=1, depth=0
4  kernel         envelope CALL → signature → trust → gates → capability → policy → handler
5  bridge         the injected MCP bridge turns the call into JSON-RPC tools/call
6  kernel         result → HANDLER_RESULT record → signed receipt
7  runtime        Ω TOOL_RESULT record { kernel_hash, receipt, decision, code }
8  program        `repo` is now bound with type ToolResult (public, untrusted)
```

The bridge is a **port**: `packages/runtime` never opens a socket. It calls the injected
bridge, which is `adapters/mcp`'s `McpBridge` in production and a deterministic stub in
tests. An MCP tool that the kernel cannot legally expose (a gated resource) is refused at
bridge construction, so it never appears in `tools/list` — a tool you cannot call is not
advertised as callable.

## Rules specific to MCP

| Rule | Why |
| --- | --- |
| The server's tool list is declared in the module, and a call to an undeclared tool is `OMEGA_E_UNKNOWN_INSTRUMENT` | a module's reach is reviewable text, not whatever a server felt like advertising that day |
| Tools may only appear in the module if the kernel can expose them (no closed gate) | the language cannot be a way around a hard gate |
| Results are always `ToolResult` (public, untrusted) | remote data is not evidence until something in the module is declared to verify it |
| An MCP result is no more trusted than a local tool's | transport is not trust |
| Arguments are checked against `constraints.max_args_bytes` twice: by the authority at mint time and by the kernel before hashing | oversized input is refused before it costs work |
| A failing tool trips the circuit breaker after the module's threshold | four failures of one tool isolate it, record it, and hand the mission a fallback path instead of a retry storm |

## Server-initiated traffic

Inbound MCP traffic (`tools/call` addressed *to* a NEXA endpoint) is the kernel's
business: the bridge maps it to a signed envelope and the endpoint decides. An Ω runtime
that hosts tools therefore needs `capabilityIssuers` naming the authority (empty by
default) — with no named authority, an endpoint obeys no capability at all, and the
inbound call is refused with a receipt. Ω adds nothing to that flow and can take nothing
away from it.
