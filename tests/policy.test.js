import test from 'node:test';
import assert from 'node:assert/strict';

import {
  Policy,
  policyFromMatrix,
  gatePosture,
  checkGates,
  assertGateOpen,
  GATE_NAMES,
  GATE_STATE,
  GATED_RESOURCES,
  GATED_ACTIONS,
  resourceNamespace,
} from '../packages/policy/index.js';
import { throwsCode, world, capabilityFor } from './helpers.mjs';

test('every gate is closed and reports itself as such', () => {
  assert.deepEqual(GATE_NAMES, ['REAL_EXECUTION', 'TERMINAL', 'FILESYSTEM_WRITE', 'AUTO_COMMIT', 'AUTO_PUSH', 'AUTO_DEPLOY']);
  for (const gate of gatePosture()) {
    assert.equal(gate.state, 'CLOSED');
    assert.equal(GATE_STATE[gate.name], 'CLOSED');
  }
});

test('gated namespaces and actions are refused, including nested ones', () => {
  for (const [namespace, gate] of Object.entries(GATED_RESOURCES)) {
    const verdict = checkGates({ resource: `${namespace}:/anything`, action: 'read' });
    assert.equal(verdict.allowed, false, namespace);
    assert.equal(verdict.gate, gate, namespace);
  }
  for (const [action, gate] of Object.entries(GATED_ACTIONS)) {
    const verdict = checkGates({ resource: 'tool:anything', action });
    assert.equal(verdict.allowed, false, action);
    assert.equal(verdict.gate, gate, action);
  }
  assert.equal(checkGates({ resource: 'tool:echo', action: 'call' }).allowed, true);
  assert.equal(checkGates({ resource: 'mem:scratch', action: 'read' }).allowed, true);
  assert.equal(resourceNamespace('tool:echo'), 'tool');
  assert.equal(resourceNamespace('bare'), 'bare');
  assert.equal(resourceNamespace(undefined), null);
  throwsCode(assert, () => assertGateOpen({ resource: 'vcs:repo', action: 'push' }), 'NEXA_E_GATE');
  assert.equal(assertGateOpen({ resource: 'tool:echo', action: 'call' }), undefined);
});

test('policy is default-deny and cannot be configured otherwise', () => {
  const scope = world();
  const policy = Policy.denyAll();
  const verdict = policy.evaluate({
    resource: 'tool:echo',
    action: 'call',
    subject: scope.caller.kid,
    capability: { id: 'urn:nexa:cap:x' },
    signals: { signed: true },
  });
  assert.equal(verdict.effect, 'DENY');
  assert.equal(verdict.rule, null);
  assert.match(verdict.reason, /default-deny/);
  throwsCode(assert, () => new Policy({ defaultEffect: 'ALLOW' }), 'NEXA_E_POLICY');
});

test('an ALLOW rule still requires a capability and a signed envelope', () => {
  const scope = world();
  const policy = new Policy({
    rules: [{ id: 'allow-echo', effect: 'ALLOW', resource: 'tool:echo', actions: ['call'] }],
  });
  const base = { resource: 'tool:echo', action: 'call', subject: scope.caller.kid };
  assert.equal(policy.evaluate({ ...base, capability: { id: 'urn:nexa:cap:x' }, signals: { signed: true } }).effect, 'ALLOW');
  assert.equal(policy.evaluate({ ...base, signals: { signed: true } }).effect, 'DENY');
  assert.equal(policy.evaluate({ ...base, capability: { id: 'urn:nexa:cap:x' }, signals: { signed: false } }).effect, 'DENY');
  const lenient = new Policy({
    rules: [{ id: 'allow-echo', effect: 'ALLOW', resource: 'tool:echo', actions: ['call'], require_capability: false, require_signature: false }],
  });
  assert.equal(lenient.evaluate(base).effect, 'ALLOW', 'a rule may only relax its own extra requirements');
});

test('first matching rule wins, in ascending id order, and DENY outranks later ALLOW', () => {
  const scope = world();
  const policy = new Policy({
    rules: [
      { id: 'b-allow', effect: 'ALLOW', resource: 'tool:echo', actions: ['call'] },
      { id: 'a-deny', effect: 'DENY', resource: 'tool:echo', actions: ['call'], subjects: [scope.worker.kid] },
    ],
  });
  const base = { resource: 'tool:echo', action: 'call', capability: {}, signals: { signed: true } };
  assert.equal(policy.evaluate({ ...base, subject: scope.worker.kid }).rule, 'a-deny');
  assert.equal(policy.evaluate({ ...base, subject: scope.worker.kid }).effect, 'DENY');
  assert.equal(policy.evaluate({ ...base, subject: scope.caller.kid }).rule, 'b-allow');
  assert.equal(policy.evaluate({ ...base, subject: scope.caller.kid }).effect, 'ALLOW');
});

test('resource patterns support namespace wildcards and prefixes', () => {
  const scope = world();
  const policy = new Policy({
    rules: [
      { id: 'echo-prefix', effect: 'ALLOW', resource_prefix: 'tool:echo', actions: ['call'] },
      { id: 'mem-wildcard', effect: 'ALLOW', resource: 'mem:*', actions: ['read'] },
    ],
  });
  const subject = scope.caller.kid;
  const request = (resource, action) => policy.evaluate({ resource, action, subject, capability: {}, signals: { signed: true } });
  assert.equal(request('tool:echo', 'call').effect, 'ALLOW');
  assert.equal(request('tool:echo.nested', 'call').effect, 'ALLOW');
  assert.equal(request('tool:echo-other', 'call').effect, 'DENY');
  assert.equal(request('mem:scratch', 'read').effect, 'ALLOW');
  assert.equal(request('mem:scratch', 'write').effect, 'DENY');
  assert.equal(request('tool:other', 'call').effect, 'DENY');
});

test('rules reject typos and malformed scopes instead of ignoring them', () => {
  throwsCode(assert, () => new Policy({ rules: [{ id: 'x', effect: 'ALLOWOW', resource: 'tool:echo' }] }), 'NEXA_E_POLICY');
  throwsCode(assert, () => new Policy({ rules: [{ id: 'x', effect: 'ALLOW', resource: 'tool:echo', alow: true }] }), 'NEXA_E_POLICY');
  throwsCode(assert, () => new Policy({ rules: [{ id: 'Bad Id', effect: 'ALLOW', resource: 'tool:echo' }] }), 'NEXA_E_POLICY');
  throwsCode(assert, () => new Policy({ rules: [{ id: 'x', effect: 'ALLOW', resource: 'tool:echo', actions: [] }] }), 'NEXA_E_POLICY');
  throwsCode(assert, () => new Policy({ rules: [{ id: 'x', effect: 'ALLOW', resource: 'tool:echo', subjects: ['nope'] }] }), 'NEXA_E_IDENTITY');
  throwsCode(
    assert,
    () => new Policy({ rules: [
      { id: 'x', effect: 'ALLOW', resource: 'tool:echo' },
      { id: 'x', effect: 'DENY', resource: 'tool:echo' },
    ] }),
    'NEXA_E_POLICY',
  );
  throwsCode(assert, () => new Policy().evaluate({ resource: 'NOPE', action: 'call', subject: 'x' }), 'NEXA_E_SCHEMA');
});

test('the policy digest is deterministic and changes with the rules', () => {
  const scope = world();
  const build = () => new Policy({ rules: [{ id: 'allow-echo', effect: 'ALLOW', resource: 'tool:echo', actions: ['call'] }] });
  assert.equal(build().digest(), build().digest());
  const other = new Policy({ rules: [{ id: 'allow-echo', effect: 'DENY', resource: 'tool:echo', actions: ['call'] }] });
  assert.notEqual(other.digest(), build().digest());
  assert.equal(policyFromMatrix([['tool:echo', 'call']]).evaluate({
    resource: 'tool:echo',
    action: 'call',
    subject: scope.caller.kid,
    capability: {},
    signals: { signed: true },
  }).effect, 'ALLOW');
});

test('a gated resource is refused by the endpoint even when policy would allow it', () => {
  const scope = world();
  scope.endpoint.policy = new Policy({
    rules: [{ id: 'allow-everything', effect: 'ALLOW', resource: '*', actions: ['call', 'write', 'commit', 'push', 'deploy'] }],
  });
  const capability = capabilityFor({
    issuer: scope.operator,
    subject: scope.caller.kid,
    resource: 'vcs:repo',
    actions: ['commit'],
    caveats: { max_uses: 5, max_depth: 0 },
  });
  const attempts = [
    ['vcs:repo', 'commit', 'AUTO_COMMIT'],
    ['push:origin', 'push', 'AUTO_PUSH'],
    ['deploy:prod', 'deploy', 'AUTO_DEPLOY'],
    ['fs:/tmp/x', 'write', 'FILESYSTEM_WRITE'],
    ['exec:ls', 'exec', 'REAL_EXECUTION'],
    ['tty:0', 'call', 'TERMINAL'],
  ];
  for (const [resource, action, gate] of attempts) {
    const envelope = scope.caller.call({ to: scope.agent.kid, resource, action, args: {}, capability });
    const result = scope.endpoint.receive(envelope);
    assert.equal(result.decision, 'DENY', `${resource}/${action}`);
    assert.equal(result.code, 'NEXA_E_GATE', `${resource}/${action}`);
    assert.equal(result.reply.body.details.gate, gate, `${resource}/${action}`);
    assert.equal(result.record.kind, 'GATE_BLOCKED', `${resource}/${action}`);
  }
  // Nothing behind a gate ever produced a handler result.
  assert.equal(scope.endpoint.evidence.entries().some((record) => record.kind === 'HANDLER_RESULT'), false);
});
