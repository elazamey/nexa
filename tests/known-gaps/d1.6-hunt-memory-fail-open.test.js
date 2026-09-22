import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HuntMemory } from '../../src/security/agentic-hunter.js';

/**
 * known-gap D1.6 (A11) — HuntMemory fail-open: ابتلاع الفساد وأخطاء الكتابة بصمت.
 * ⚠️ نجاح هذا الاختبار = إعادة إنتاج الفشل الحالي، لا دليل سلامة.
 * يُزال هذا الملف في نفس تغيير إغلاق D1.6.
 */

test('known-gap D1.6 (A11): JSON فاسد → ذاكرة فارغة صامتة بلا أي إشارة فشل', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-known-gap-d16-'));
  const badPath = path.join(dir, 'hunt-memory.json');
  fs.writeFileSync(badPath, '{ هذا ليس JSON صالحًا ((( ', 'utf8');

  let memory;
  let threw = false;
  try {
    memory = new HuntMemory(badPath);
  } catch {
    threw = true;
  }

  // الوضع الحالي: لا خطأ، ذاكرة فارغة كأن شيئًا لم يكن — فقدان صامت للجلسات السابقة
  assert.equal(threw, false, 'الوضع الحالي: لا يرمي خطأ عند الفساد (hunt-memory.js:20-23)');
  assert.deepEqual(memory.memory.sessions, [], 'الوضع الحالي: جلسات سابقة ضاعت بصمت');
  assert.equal(memory.memory.loadError, undefined, 'الوضع الحالي: لا توجد أي إشارة فشل قابلة للفحص');

  fs.rmSync(dir, { recursive: true, force: true });
});

test('known-gap D1.6 (A11): معرفات الجلسات بـ Date.now() — تصادمية وقابلة للفقد', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexa-known-gap-d16b-'));
  const storePath = path.join(dir, 'hunt-memory.json');
  const memory = new HuntMemory(storePath);
  memory.recordSession({ target: 'a.example.com' });

  const raw = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  // الوضع الحالي: المعرف طابع زمني خام — لا هوية محتوى
  assert.match(raw.sessions[0].id, /^session_\d+$/, 'الوضع الحالي: id زمني لا مشتق من المحتوى');

  fs.rmSync(dir, { recursive: true, force: true });
});
