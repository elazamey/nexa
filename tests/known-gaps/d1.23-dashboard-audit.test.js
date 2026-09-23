import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * known-gap D1.23 — لا بوابة npm audit لمسار الداشبورد؛ القياس في self-model/evidence/d1.23-advisories.txt.
 * ⚠️ نجاح هذا الاختبار = تسجيل حالة معلّقة. يُزال أو يُقلَب في تغيير الحسم (ترقية/عتبة/قبول موثّق).
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('known-gap D1.23: لا خطوة audit اعتماديات للداشبورد في أي workflow', () => {
  const dir = path.join(ROOT, '.github/workflows');
  const users = [];
  for (const f of fs.readdirSync(dir)) {
    const t = read(path.join('.github/workflows', f)).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    if (/npm\s+audit/.test(t)) users.push(f);
  }
  assert.deepEqual(users, [], `خطوة npm audit موجودة (${users.join(', ')}) — حُسِمت D1.23؟ أزل المُعيد في نفس التغيير`);
  // واللفخ المرجّح: «npm run audit» في ci.yml هو مجموعة الأمان الداخلية للمشروع، لا npm audit
  const script = JSON.parse(read('package.json')).scripts.audit;
  assert.ok(!/npm audit/.test(script), `npm run audit صار npm audit — راجع هذه الفرضية (${script})`);
  assert.match(script, /--test tests\/security\.test\.js/, 'npm run audit لم يعد مجموعة الأمان الداخلية');
});

test('known-gap D1.23: الأدلة مُثبَتة والتذكرة مفتوحة — لا قبول صامت', () => {
  const ev = read('self-model/evidence/d1.23-advisories.txt');
  assert.match(ev, /severity=high/, 'لا high مقاس في الدليل — القياس ناقص');
  assert.match(ev, /vite/, 'الدليل لا يسمّي vite');
  const lock = JSON.parse(read('dashboard/package-lock.json'));
  const vite = lock.packages['node_modules/vite']?.version;
  assert.ok(vite, 'لا vite في القفل — تغيّر مسار البناء؟');
  const gaps = JSON.parse(read('self-model/gaps.json')).gaps;
  const open = gaps.find((g) => g.id === 'D1.23');
  assert.ok(open && !open.enforced, `D1.23 غير مفتوحة (${open ? open.enforced : 'مفقودة'}) مع أن vite ${vite} بلا بوابة`);
});
