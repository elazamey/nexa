import test from 'node:test';
import assert from 'node:assert/strict';

import { run, T0 } from '../examples/hello-nexa.mjs';
import { verifyEvidenceChain } from '../packages/evidence/index.js';
import { gatePosture } from '../packages/policy/index.js';

/**
 * The README's quickstart is this file. Running it here means the documented flow
 * cannot rot: if the example stops working, the suite fails.
 */
test('examples/hello-nexa.mjs runs the documented flow end to end', () => {
  const lines = [];
  const result = run({ log: (line) => lines.push(String(line)) });

  assert.equal(lines.length, 7);
  assert.equal(result.allowed.decision, 'ALLOW');
  assert.deepEqual(result.allowed.value, { echoed: { text: 'hello nexa' } });
  assert.equal(result.denied.decision, 'DENY');
  assert.equal(result.denied.code, 'NEXA_E_GATE');
  assert.equal(result.denied.reply.body.details.gate, 'FILESYSTEM_WRITE');

  // Evidence produced by the example verifies, and the endpoint is still clean.
  assert.equal(verifyEvidenceChain(result.endpoint.evidence.entries()).ok, true);
  assert.equal(result.endpoint.evidence.length, 6);
  assert.equal(gatePosture().every((gate) => gate.state === 'CLOSED'), true);
  assert.equal(result.capability.caveats.max_uses, 5);
  assert.equal(result.endpoint.ledger.used(result.capability.id), 1, 'only the ALLOWed call spent budget');
  assert.equal(T0.toISOString(), '2026-09-18T12:00:00.000Z');
});

test('the example is deterministic: same seeds, same key ids', () => {
  const first = [];
  const second = [];
  const a = run({ log: (line) => first.push(String(line)) });
  const b = run({ log: (line) => second.push(String(line)) });
  assert.equal(a.operator.kid, b.operator.kid);
  assert.equal(a.agent.kid, b.agent.kid);
  assert.deepEqual(first.slice(0, 2), second.slice(0, 2));
  assert.equal(first.length, second.length);
});
