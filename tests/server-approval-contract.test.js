import test from 'node:test';
import assert from 'node:assert/strict';
import { startIsolatedServer } from './celia-workspace-auth-helpers.mjs';
import {
  ApprovalContractError,
  decisionBytes,
  parseApprovalRoute,
  signApprovalDecision,
  verifyApprovalDecision,
  APPROVAL_DECISION_DOMAIN,
} from '../tools/celia-approval-http.mjs';
import { createDashboardOperator, DEMO_OPERATOR_SEED } from '../tools/celia-operator.mjs';
import { createIdentity } from '../packages/identity/index.js';

/**
 * D1.10 (O02) / P0-B layer 4 — the approval decision contract on the HTTP
 * boundary (D1.10.7 approve({}) → DENY, D1.10.8 encoded id → decoded,
 * D1.10.9 unsigned → DENY, D1.10.10 valid approval → existing execution path).
 *
 * The gate this file exists to close is not "approve returns 400": it is the
 * bypass chain reaching a *refused authorization decision* after the identity
 * layer, with the audit trail saying so. Nothing here changes packages/policy —
 * the ledger already enforced every binding; the route was inventing the two
 * inputs it should never have invented (approver identity and scope).
 */

const OPERATOR = createDashboardOperator({ env: {} });   // same default seed as the server
const KEY = 'nexa-approval-contract-test-key-1234567890';

function sign({ approvalId, verb, scope = null, reason = null }, operator = OPERATOR) {
  return signApprovalDecision({ operator, approvalId, verb, scope, reason });
}

async function requestApproval(server, target) {
  const res = await server.post('/api/v1/authorizations/request', {
    resource: 'terminal:exec', action: 'exec', target,
  });
  assert.equal(res.status, 200);
  return res.body.approvalId;
}

test('D1.10.7/8: approve بجسم فارغ تُرفض، والسلسلة تنتهي بقرار تفويض DENY مسجَّلًا', async (t) => {
  const server = await startIsolatedServer(t);
  const target = 'echo d110-empty-approve';
  const approvalId = await requestApproval(server, target);

  // 1) `{}` is not a decision. It used to be: kid and scope were defaulted.
  const empty = await server.post(`/api/v1/authorizations/${approvalId}/approve`, {});
  assert.equal(empty.status, 400, 'approve بجسم فارغ كانت تمنح APPROVED_ONCE');
  assert.equal(empty.body.ok, false);
  assert.equal(empty.body.code, 'NEXA_E_SCHEMA');

  // 2) The refusal is an authorization decision, visible in the audit trail.
  const timeline = await server.get('/api/v1/timeline?type=AUTHORIZATION_RESULT');
  assert.equal(timeline.status, 200);
  const denial = timeline.body.events.filter((e) => e.payload?.approvalId === approvalId).pop();
  assert.ok(denial, 'لم يُسجَّل قرار DENY في الخط الزمني');
  assert.equal(denial.payload.decision, 'DENY');
  assert.equal(denial.payload.code, 'NEXA_E_SCHEMA');

  // 3) So the terminal never runs: DENY comes from the approval contract, not
  //    from a transport error and not from a missing route.
  const run = await server.post('/api/v1/terminal/execute', {
    program: 'echo', args: ['d110-empty-approve'], approvalId,
  });
  assert.equal(run.status, 400, 'request → approve {} → terminal يجب أن ينتهي مرفوضًا');
  assert.equal(run.body.ok, false);
  assert.match(String(run.body.code), /^NEXA_E_APPROVAL_STATE$/, 'الرفض: لم تُمنح الموافقة قط');
  assert.equal(run.body.stdout, undefined, 'نُفِّذ الأمر فعلًا — تسلسل تجاوز مكتمل');
});

test('D1.10.9: توقيع مفقود أو موقَّع بمفتاح أجنبي أو موسَّع عمدًا = DENY', async (t) => {
  const server = await startIsolatedServer(t);
  const target = 'echo d110-signature';
  const approvalId = await requestApproval(server, target);

  // Explicit kid + scope but no signature: still not a decision anyone can forge.
  const unsigned = await server.post(`/api/v1/authorizations/${approvalId}/approve`, {
    approverKid: OPERATOR.kid, scope: 'once',
  });
  assert.equal(unsigned.status, 400);
  assert.equal(unsigned.body.code, 'NEXA_E_SIG');

  // Signature over scope 'once', submitted as 'mission': the bytes commit to scope.
  const once = sign({ approvalId, verb: 'approve', scope: 'once' });
  const widened = await server.post(`/api/v1/authorizations/${approvalId}/approve`, {
    approverKid: OPERATOR.kid, scope: 'mission', signature: once.signature,
  });
  assert.equal(widened.status, 400, 'توسيع النطاق بعد التوقيع يجب أن يكسر التحقق');
  assert.equal(widened.body.code, 'NEXA_E_SIG');

  // A signature from a key the deployment does not trust: verification passes
  // (it is a valid self-signature) and the LEDGER refuses. authN ≠ authZ.
  const foreign = createIdentity({ label: 'attacker', seed: 'a1'.repeat(32) });
  const forged = sign({ approvalId, verb: 'approve', scope: 'once' },
    { kid: foreign.kid, keys: foreign.keys });
  const notTrusted = await server.post(`/api/v1/authorizations/${approvalId}/approve`, {
    approverKid: foreign.kid, scope: 'once', signature: forged.signature,
  });
  assert.equal(notTrusted.status, 400);
  assert.equal(notTrusted.body.code, 'NEXA_E_UNTRUSTED', 'الدفتر يبقى جذر الثقة، لا هذا الملف');
  assert.doesNotMatch(String(notTrusted.body.decision ?? ''), /^APPROVED_/);

  // The approval is untouched by all three attempts: still REQUESTED.
  const list = await server.get('/api/v1/authorizations');
  const row = list.body.requests.find((r) => r.approvalId === approvalId);
  assert.equal(row.decision, 'REQUESTED');

  // A deny carries its reason inside the signature: a different reason breaks it.
  const denial = sign({ approvalId, verb: 'deny', reason: 'not this command' });
  const swapped = await server.post(`/api/v1/authorizations/${approvalId}/deny`, {
    approverKid: OPERATOR.kid, reason: 'looks fine to me', signature: denial.signature,
  });
  assert.equal(swapped.status, 400);
  assert.equal(swapped.body.code, 'NEXA_E_SIG');
  const honest = await server.post(`/api/v1/authorizations/${approvalId}/deny`, {
    approverKid: OPERATOR.kid, reason: 'not this command', signature: denial.signature,
  });
  assert.equal(honest.status, 200, 'قرار موقَّع بدقة من المشغّل الموثوق ينفّذ');
  assert.equal(honest.body.decision, 'DENIED');
});

test('D1.10.8/10: معرف مرمَّز + قرار موقَّع = مسار التنفيذ القائم يعمل كما هو', async (t) => {
  const server = await startIsolatedServer(t);
  const marker = 'd110-encoded-approve';
  const approvalId = await requestApproval(server, `echo ${marker}`);

  // The SPA always percent-encodes; the route now decodes. Raw form must resolve
  // to the SAME approval id (both are the same contract input).
  const signed = await server.post(`/api/v1/authorizations/${encodeURIComponent(approvalId)}/sign`, {
    decision: 'approve', scope: 'once',
  });
  assert.equal(signed.status, 200);
  assert.equal(signed.body.ledger, 'unchanged', 'منصة التوقيع لا تمنح شيئًا');
  const stillRequested = await server.get('/api/v1/authorizations');
  assert.equal(stillRequested.body.requests.find((r) => r.approvalId === approvalId).decision, 'REQUESTED');

  const encoded = await server.post(`/api/v1/authorizations/${encodeURIComponent(approvalId)}/approve`, {
    approverKid: signed.body.approverKid, scope: 'once', signature: signed.body.signature,
  });
  assert.equal(encoded.status, 200, 'approve بالمعرف المرمَّز كان 400 — العقد مع الواجهة');
  assert.equal(encoded.body.decision, 'APPROVED_ONCE');

  // Execution path unchanged: the route spends the approval itself (consume
  // before exec), binding to resource/action/target inside packages/policy.
  const run = await server.post('/api/v1/terminal/execute', {
    program: 'echo', args: [marker], approvalId,
  });
  if (run.status === 200) {
    assert.match(String(run.body.stdout ?? ''), new RegExp(marker), 'الخارج لا يحمل الأثر');
  } else {
    // The only permissible failure is the sandbox itself, never the contract.
    assert.doesNotMatch(String(run.body.code), /^NEXA_E_APPROVAL_/, `العقد رفض: ${run.body.code}`);
    assert.match(String(run.body.code), /^NEXA_E_TERMINAL_/);
  }

  // A 'once' approval is single-use — the state machine still owns that rule.
  const reuse = await server.post('/api/v1/terminal/execute', {
    program: 'echo', args: [marker], approvalId,
  });
  assert.equal(reuse.status, 400);
  assert.equal(reuse.body.code, 'NEXA_E_APPROVAL_USED');

  // consume over the encoded path decodes too (the human-side spend probe).
  const second = await requestApproval(server, 'echo d110-encoded-consume');
  const secondSigned = await server.post(`/api/v1/authorizations/${encodeURIComponent(second)}/sign`, {
    decision: 'approve', scope: 'mission',
  });
  assert.equal((await server.post(`/api/v1/authorizations/${second}/approve`, {
    approverKid: secondSigned.body.approverKid, scope: 'mission', signature: secondSigned.body.signature,
  })).body.decision, 'APPROVED_MISSION', 'المعرّف الخام (نقاطا الترقيم) يفسَّر كما يفسَّر المرمَّز');
  const spent = await server.post(`/api/v1/authorizations/${encodeURIComponent(second)}/consume`, {
    resource: 'terminal:exec', action: 'exec', target: 'echo d110-encoded-consume',
  });
  assert.equal(spent.status, 200);
  assert.equal(spent.body.decision, 'CONSUMED');
});

test('D1.10 layer 1+4: الجدار لا يُخفي الثغرة — موقَّع بلا مصرّح = 401، و{} مع المفتاح = قرار DENY', async (t) => {
  const server = await startIsolatedServer(t, undefined, undefined, { env: { NEXA_API_KEY: KEY } });
  const auth = { Authorization: `Bearer ${KEY}` };
  const requested = await server.raw({
    method: 'POST', path: '/api/v1/authorizations/request', headers: auth,
    body: { resource: 'terminal:exec', action: 'exec', target: 'echo d110-perimeter-vs-authorization' },
  });
  assert.equal(requested.status, 200, 'الهوية الصحيحة توصل الطلب إلى السياسة');
  const approvalId = requested.body.approvalId;

  // Perfectly signed, zero identity: the wall answers first, deliberately.
  const good = sign({ approvalId, verb: 'approve', scope: 'once' });
  const anonymous = await server.raw({
    method: 'POST', path: `/api/v1/authorizations/${approvalId}/approve`,
    body: { approverKid: OPERATOR.kid, scope: 'once', signature: good.signature },
  });
  assert.equal(anonymous.status, 401, 'توقيع صالح لا يشتري هوية');

  // Identity present, decision absent: the answer must be an authorization DENY
  // (400), not a transport rejection — otherwise this "fix" is only a mask.
  const authenticated = await server.raw({
    method: 'POST', path: `/api/v1/authorizations/${approvalId}/approve`, headers: auth, body: {},
  });
  assert.equal(authenticated.status, 400);
  assert.equal(authenticated.body.code, 'NEXA_E_SCHEMA');
  const run = await server.raw({
    method: 'POST', path: '/api/v1/terminal/execute', headers: auth,
    body: { program: 'echo', args: ['d110-perimeter-vs-authorization'], approvalId },
  });
  assert.equal(run.status, 400);
  assert.equal(run.body.code, 'NEXA_E_APPROVAL_STATE');

  // And the honest path through both layers works end to end.
  const signed = await server.raw({
    method: 'POST', path: `/api/v1/authorizations/${approvalId}/sign`, headers: auth,
    body: { decision: 'approve', scope: 'once' },
  });
  assert.equal(signed.status, 200);
  const approved = await server.raw({
    method: 'POST', path: `/api/v1/authorizations/${approvalId}/approve`, headers: auth,
    body: { approverKid: signed.body.approverKid, scope: 'once', signature: signed.body.signature },
  });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.decision, 'APPROVED_ONCE');
});

test('D1.10.8: ترميز مشوّه = DENY، لا بحث في الدفتر بمعرّف غير مُفسَّر', async (t) => {
  const server = await startIsolatedServer(t);
  // A lone '%' is not a valid escape; http.request keeps the byte sequence raw
  // (fetch would re-encode it and the test would prove nothing).
  const malformed = await server.raw({
    method: 'POST', path: '/api/v1/authorizations/urn:nexa:approval:%zz/approve', body: {},
  });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.code, 'NEXA_E_SCHEMA');
  const traversal = await server.raw({
    method: 'POST', path: '/api/v1/authorizations/a%2Fb%2E%2E/c/approve', body: {},
  });
  assert.ok(traversal.status === 400 || traversal.status === 404, 'نسق المسار لا يوسّع نطاق البحث');
});

test('D1.10 layer 4 (unit): العقد نقي — فك ترميز، نطاق، ومجال توقيع منفصل', () => {
  const id = 'urn:nexa:approval:ZW5jb2RlZC1pZA';
  assert.deepEqual(parseApprovalRoute(`/api/v1/authorizations/${id}/approve`), { approvalId: id, verb: 'approve' });
  assert.deepEqual(parseApprovalRoute(`/api/v1/authorizations/${encodeURIComponent(id)}/deny`), { approvalId: id, verb: 'deny' });
  assert.throws(() => parseApprovalRoute('/api/v1/authorizations/bad%zz/approve'), (e) => (
    e instanceof ApprovalContractError && e.code === 'NEXA_E_SCHEMA'
  ));
  assert.throws(() => parseApprovalRoute('/api/v1/authorizations/a%2Fb/approve'), /safe path segment/);
  assert.throws(() => parseApprovalRoute('/api/v1/authorizations/x/merge'), (e) => e.status === 404);

  const bytes = decisionBytes({ approvalId: id, verb: 'approve', scope: 'once', approverKid: OPERATOR.kid });
  assert.ok(bytes.subarray(0, APPROVAL_DECISION_DOMAIN.length).toString('utf8') === APPROVAL_DECISION_DOMAIN,
    'المجال يسبق الحمولات: لا توقيع بلا فصل إصدار');
  // One canonical spelling: the same decision written two ways signs the same bytes.
  assert.deepEqual(bytes, decisionBytes({
    approvalId: id, verb: 'approve', approverKid: OPERATOR.kid, scope: 'once', reason: null,
  }));
  assert.notDeepEqual(bytes, decisionBytes({ approvalId: id, verb: 'deny', scope: 'once', approverKid: OPERATOR.kid }));

  const signed = sign({ approvalId: id, verb: 'approve', scope: 'once' });
  assert.equal(verifyApprovalDecision(signed.payload, signed.signature), true);
  assert.equal(verifyApprovalDecision({ ...signed.payload, scope: 'mission' }, signed.signature), false);
  assert.equal(verifyApprovalDecision({ ...signed.payload, approvalId: `${id}x` }, signed.signature), false);
  assert.equal(verifyApprovalDecision(signed.payload, signed.signature.slice(0, -2) + 'AA'), false);

  // The demo seed stays the default: this commit must not break a deploy that
  // pinned it. Rotation is NEXA_OPERATOR_SEED's job, and it is deterministic.
  assert.equal(OPERATOR.usingDemoSeed, true);
  assert.equal(createDashboardOperator({ env: {} }).kid, OPERATOR.kid);
  const rotated = createDashboardOperator({ env: { NEXA_OPERATOR_SEED: '7d'.repeat(32) } });
  assert.notEqual(rotated.kid, OPERATOR.kid);
  assert.equal(rotated.usingDemoSeed, false);
  assert.equal(DEMO_OPERATOR_SEED.length, 64);
});
