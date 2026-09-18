import test from 'node:test';
import assert from 'node:assert/strict';

import { McpBridge, RPC_ERRORS, toolNameFor, resourceForTool } from '../adapters/mcp/index.js';
import { verifyReceipt } from '../packages/evidence/index.js';
import { throwsCode, world, capabilityFor, T0 } from './helpers.mjs';

function bridgeFor(scope, options = {}) {
  return new McpBridge({ endpoint: scope.endpoint, ...options });
}

test('tool names round-trip between resource and MCP surfaces', () => {
  assert.equal(toolNameFor('tool:echo'), 'nexa_tool_echo');
  assert.equal(toolNameFor('mem:scratch.pad'), 'nexa_mem_scratch_pad');
  assert.equal(resourceForTool('nexa_tool_echo', ['tool:echo', 'tool:add']), 'tool:echo');
  assert.equal(resourceForTool('nexa_tool_nope', ['tool:echo']), null);
  throwsCode(assert, () => toolNameFor(':::'), 'NEXA_E_SCHEMA');
});

test('the bridge refuses to expose resources behind a closed gate', () => {
  const scope = world();
  scope.endpoint.registerHandler('fs:/etc/passwd', () => ({ ok: true }));
  throwsCode(
    assert,
    () => bridgeFor(scope, { expose: ['fs:/etc/passwd'] }),
    'NEXA_E_GATE',
  );
  throwsCode(
    assert,
    () => bridgeFor(scope, { expose: ['tool:not-registered'] }),
    'NEXA_E_NO_HANDLER',
  );
});

test('initialize, tools/list and nexa/posture describe the gated surface', () => {
  const scope = world();
  const bridge = bridgeFor(scope);

  const initialized = bridge.handleRpc({ jsonrpc: '2.0', id: 1, method: 'initialize' });
  assert.equal(initialized.result.serverInfo.name, 'nexa');
  assert.equal(initialized.result.capabilities.nexa.posture, true);

  const listed = bridge.handleRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.deepEqual(listed.result.tools.map((tool) => tool.name), ['nexa_tool_add', 'nexa_tool_boom', 'nexa_tool_echo']);

  const posture = bridge.handleRpc({ jsonrpc: '2.0', id: 3, method: 'nexa/posture' }).result;
  assert.equal(posture.gates.every((gate) => gate.state === 'CLOSED'), true);
  assert.deepEqual(posture.tools, ['nexa_tool_add', 'nexa_tool_boom', 'nexa_tool_echo']);
});

test('tools/call runs the full NEXA pipeline and returns the receipt', () => {
  const scope = world();
  const bridge = bridgeFor(scope);
  const capability = capabilityFor({ issuer: scope.operator, subject: scope.caller.kid, caveats: { max_uses: 2 } });

  const response = bridge.handleRpc(
    { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nexa_tool_echo', arguments: { text: 'hi' } } },
    { caller: scope.operator, clock: () => T0, capability },
  );
  assert.equal(response.error, undefined);
  assert.deepEqual(response.result.structuredContent, { echoed: { text: 'hi' } });
  assert.equal(response.result.nexa.decision, 'ALLOW');
  assert.equal(response.result.nexa.receipt.decision, 'ALLOW');
  assert.equal(response.result.content[0].type, 'text');
  assert.equal(scope.endpoint.ledger.used(capability.id), 1);
});

test('a missing capability is denied with a machine-readable code and a receipt', () => {
  const scope = world();
  const bridge = bridgeFor(scope);
  const response = bridge.handleRpc(
    { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nexa_tool_echo', arguments: {} } },
    { caller: scope.operator, clock: () => T0 },
  );
  assert.equal(response.error.code, RPC_ERRORS.NEXA_DENIED);
  assert.equal(response.error.data.nexa_code, 'NEXA_E_POLICY');
  assert.match(response.error.message, /capability/);
  assert.equal(verifyReceipt(response.error.data.receipt).summary.decision, 'DENY');
});

test('a capability granted to someone else cannot be spent by the caller', () => {
  const scope = world();
  const bridge = bridgeFor(scope);
  const capability = capabilityFor({ issuer: scope.operator, subject: scope.worker.kid });
  const response = bridge.handleRpc(
    { jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'nexa_tool_echo', arguments: {} } },
    { caller: scope.operator, clock: () => T0, capability },
  );
  assert.equal(response.error.code, RPC_ERRORS.NEXA_DENIED);
  assert.equal(response.error.data.nexa_code, 'NEXA_E_CAP_AUDIENCE');
});

test('JSON-RPC framing faults are reported as protocol errors, never as NEXA decisions', () => {
  const scope = world();
  const bridge = bridgeFor(scope);
  const cases = [
    [{ jsonrpc: '2.0', id: 1, method: 'nope' }, RPC_ERRORS.METHOD_NOT_FOUND],
    [{ jsonrpc: '1.0', id: 1, method: 'initialize' }, RPC_ERRORS.INVALID_REQUEST],
    [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {} }, RPC_ERRORS.INVALID_PARAMS],
    [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'nexa_tool_echo', arguments: [] } }, RPC_ERRORS.INVALID_PARAMS],
    [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'nexa_tool_ghost', arguments: {} } }, RPC_ERRORS.METHOD_NOT_FOUND],
    [[], RPC_ERRORS.INVALID_REQUEST],
  ];
  for (const [message, code] of cases) {
    const response = bridge.handleRpc(message);
    assert.equal(response.error.code, code, JSON.stringify(message));
  }
  assert.equal(scope.endpoint.evidence.length, 0, 'framing faults never reach the endpoint');
});

test('gated tool names are refused before any decision is recorded', () => {
  const scope = world();
  const bridge = bridgeFor(scope);
  scope.endpoint.registerHandler('deploy:prod', () => ({ deployed: true }));
  // `deploy:prod` is not exposed, so the tool name is simply unknown — and the
  // gate check inside tools/call refuses it even if it had been reachable.
  const response = bridge.handleRpc(
    { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'nexa_deploy_prod', arguments: {} } },
    { caller: scope.operator, clock: () => T0 },
  );
  assert.equal(response.error.code, RPC_ERRORS.METHOD_NOT_FOUND);
  assert.equal(scope.endpoint.hasHandler('deploy:prod'), true);
});

test('evidence can be pulled over JSON-RPC and stays verifiable', () => {
  const scope = world();
  const bridge = bridgeFor(scope);
  const capability = capabilityFor({ issuer: scope.operator, subject: scope.caller.kid });
  bridge.handleRpc(
    { jsonrpc: '2.0', id: 8, method: 'tools/call', params: { name: 'nexa_tool_echo', arguments: {} } },
    { caller: scope.operator, clock: () => T0, capability },
  );
  const evidence = bridge.handleRpc({ jsonrpc: '2.0', id: 9, method: 'nexa/evidence', params: { limit: 2 } }).result;
  assert.equal(evidence.length > 0, true);
  assert.equal(typeof evidence.head, 'string');
  assert.equal(evidence.records.every((record) => typeof record.hash === 'string'), true);
});
