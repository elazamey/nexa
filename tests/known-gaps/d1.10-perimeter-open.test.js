import test from 'node:test';
import assert from 'node:assert/strict';
import { startIsolatedServer } from '../celia-workspace-auth-helpers.mjs';

/**
 * known-gap D1.10 (O02) — محيط HTTP بلا مصادقة: سلسلة الموافقة مفتوحة.
 * ⚠️ نجاح هذا الاختبار = إعادة إنتاج الفشل الحالي، لا دليل سلامة.
 * يُزال هذا الملف في نفس تغيير إغلاق D1.10.
 * ملاحظة: السلسلة تتوقف عند approve — لا تنفيذ هنا (يكفي إثبات أن الموافقة
 * تُمنح بلا سر لتُفتح كل البوابات اللاحقة بما فيها terminal/execute).
 */

test('known-gap D1.10 (O02): طلب approval عبر HTTP بلا أي سر ينجح', async (t) => {
  const server = await startIsolatedServer(t);
  const req = await server.post('/api/v1/authorizations/request', {
    resource: 'terminal:exec', action: 'exec', target: 'echo perimeter-probe',
  });
  assert.equal(req.status, 200, 'الوضع الحالي: request مفتوح لأي متصل');
  assert.ok(typeof req.body.approvalId === 'string' && req.body.approvalId.length > 0);
});

test('known-gap D1.10 (O02): approve بلا هوية تُقبل كهوية المشغّل الموثوق', async (t) => {
  const server = await startIsolatedServer(t);
  const req = await server.post('/api/v1/authorizations/request', {
    resource: 'terminal:exec', action: 'exec', target: 'echo perimeter-probe',
  });
  const approvalId = req.body.approvalId;
  // لا approverKid ولا توقيع ولا أي سر — مجرد POST فارغ. («:» صالح في المسار، يُرسل خامًا.)
  const approved = await server.post(`/api/v1/authorizations/${approvalId}/approve`, {});
  assert.equal(approved.status, 200, 'الوضع الحالي: approve بلا سر تُقبل (default kid + فحص سلسلة)');
  assert.match(approved.body.decision, /^APPROVED_/);
});

test('known-gap D1.10 (O02): المسار لا يفك ترميز المعرف — نداء الواجهة (encoded) يفشل', async (t) => {
  const server = await startIsolatedServer(t);
  const req = await server.post('/api/v1/authorizations/request', {
    resource: 'terminal:exec', action: 'exec', target: 'echo perimeter-probe',
  });
  const approvalId = req.body.approvalId;
  // الواجهة (NexaDashboard.jsx) ترمّز المعرف دائمًا؛ الخادم لا يفك الترميز (split خام).
  const encoded = await server.post(`/api/v1/authorizations/${encodeURIComponent(approvalId)}/approve`, {});
  assert.equal(encoded.status, 400, 'الوضع الحالي: approve بالمعرف المرمّز 400 — عقد مكسور مع الواجهة');
});
