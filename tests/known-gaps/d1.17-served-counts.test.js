import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startIsolatedServer } from '../celia-workspace-auth-helpers.mjs';

/**
 * known-gap D1.17 (O09) — أعداد مُروَّاة تُخدم وتُزرَع وتُطبع.
 * ⚠️ نجاح هذا الاختبار = إعادة إنتاج الفشل الحالي، لا دليل سلامة.
 * يُزال هذا الملف في نفس تغيير إغلاق D1.17.
 *
 * تذكرة الأعداد (O04) أغلقت الادعاءات في الوثائق وبوابة النشر؛ هذه نفس الفئة على السطح
 * الذي يخدمه السيرفر — أي ما يقرأه operator حيًّا:
 * `/api/celia/state` يعيد `tests:'314/314'` و`promotion:'5/5 READY'` من حرف ثابت في
 * `mockState`، بينما شقيقه `/api/v1/system/status` يقيس فعلًا عبر `getPosture()` — فيفسّر
 * operator الرقمين معًا كأنهما تليمترية. والأرقام نفسها متناقضة داخل الملف (314 في الحالة،
 * 501 في سجل الإقلاع)، وتُزرَع كذلك في beliefs/ذكريات المحرك فتصير «معرفة» لا عرضًا.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const SERVER = 'tools/celia-dashboard-server.mjs';

test('known-gap D1.17 (O09): /api/celia/state يخدم عدد اختبارات وحكم ترقية مروَّيين بالنص', async (t) => {
  const server = await startIsolatedServer(t);
  const res = await server.get('/api/celia/state');
  assert.equal(res.status, 200);
  // الوضع الحالي: الحرف نفسه في الـ payload، لا قراءة، لا تاريخ، لا مصدر
  assert.equal(res.body.status.tests, '314/314', 'الوضع الحالي: عدد مُروّى من mockState (سطر 740)');
  assert.equal(res.body.status.promotion, '5/5 READY', 'الوضع الحالي: حكم ترقية مُهدى (سطر 741)');
  assert.equal(res.body.status.gates, '6 CLOSED');
  assert.equal(
    JSON.stringify(res.body.status).includes('100%'),
    true,
    'الوضع الحالي: نثر تسويقي («100% fix»/«100% proof») داخل حقل حالة يُقرأ تليمترية'
  );
});

test('known-gap D1.17 (O09): سجل الإقلاع يطبع عددًا مختلفًا عمّا يخدمه، ولا يقيس شيئًا', () => {
  const src = read(SERVER);
  assert.ok(
    /Tests: 501\/501/.test(src),
    'الوضع الحالي: سطر الإقلاع يروّي «Tests: 501/501» (سطر 3124) بينما الحالة المخدمة تقول 314/314'
  );
  assert.ok(
    src.includes("tests: '314/314'"),
    'الوضع الحالي: الحرفان معًا في نفس الملف — لا رقم يُقرأ من قياس أو من سجل'
  );
  // لا شيء في الملف يسأل baseline أو posture عن العدد قبل طباعته
  const statusLines = src.split('\n').filter(l => /mockState\.status|status\.tests\s*=/.test(l));
  assert.deepEqual(statusLines, [], 'الوضع الحالي: mockState.status لا يُحدَّث من أي قياس إطلاقًا');
});

test('known-gap D1.17 (O09): الأرقام تُزرَع في beliefs وذكريات المحرك فتصير معرفة', () => {
  const src = read(SERVER);
  assert.ok(
    /condition:\s*\{\s*gates:\s*'6 CLOSED',\s*tests:\s*'314\/314'/.test(src),
    'الوضع الحالي: belief مزروع (سطر 663) يحمل العدد المروّى شرطًا له'
  );
  assert.ok(
    src.includes('Security gates 6 CLOSED, 314 tests, 2 LLM vectors BLOCKED'),
    'الوضع الحالي: ذاكرة دلالية مزروعة (سطر 690) تنصّ على العدد نفسه'
  );
  assert.ok(
    src.includes("pasteSaving: '48.5%'") && src.includes('PASTE 48.5% latency saved'),
    'الوضع الحالي: نسبة أداء غير مقاسة تُزرَع كحقل مقيس وفي نص ذاكرة'
  );
});

test('known-gap D1.17 (O09): الواجهة تُروّي العدد نفسه بياناتٍ أولية', () => {
  const dash = read('dashboard/src/components/NexaDashboard.jsx');
  assert.ok(
    dash.includes("testsPass: '314/314'"),
    'الوضع الحالي: بيانات أولية للمكوّن (سطر 252) تحمل العدد — وتُعرض قبل أي response'
  );
  const dag = read('dashboard/src/components/DagVisualizer.jsx');
  assert.ok(
    dag.includes('48.5% latency reduction'),
    'الوضع الحالي: نسبة غير مقاسة مطبوعة في الواجهة كثابت'
  );
});
