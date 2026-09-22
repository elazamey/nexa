import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

/**
 * Guard: evidence-frozen — D1.1 (الطبقة المنهجية)
 * أدلة docs/evidence/** مجمّدة تاريخيًا (45 ملفًا عند إعادة البناء 2026-09-22).
 * أي تعديل/إضافة/حذف لهذه الملفات يكسر هذا الحارس عمدًا — التحديث الواعي
 * للقائمة يقتضي قرارًا موثقًا في تذكرة، لا تسللًا.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const EVIDENCE_DIR = path.join(ROOT, 'docs', 'evidence');

const FROZEN_MANIFEST = {
  "docs/evidence/celia-library-input-lock.json": "99325f47be8b4b83fe39a40968a70ea4d14bd5b5c41d13257b78f748d0acc3b2",
  "docs/evidence/celia-library-verification.json": "7bd4ee181795e5010856982e0a7b422d9d1cfcb1c47510bb59f151503deb3daf",
  "docs/evidence/celia-library/full-verify.txt": "65356b3af6b08010d7f4a791a555ad7f0e63b94d687194ba0f4435e5a7a8084a",
  "docs/evidence/celia-library/security.tap": "f66128a2f126ab78c8819f0a68d09e125410df7d815acec01bcbf8505f51c3b3",
  "docs/evidence/celia-library/targeted.tap": "d4c7ea749b9acedb30a4bdcddae663f73382a4e633fa984d9286806552e67d99",
  "docs/evidence/h2-atomicity/SHA256SUMS": "2590da17f4dbfe61df8aa5ee689c833ccf0bd91735a441762658199fe8ec261f",
  "docs/evidence/h2-atomicity/advisory-regression.tap": "9f1bbf236b425759ff9d77adfc03b02970f94e98c5c2e52a02514d2608b06071",
  "docs/evidence/h2-atomicity/after-verify.txt": "962890791bd9dc7e1f532243a29fbe75321c0e31737f158b6306c545711f856a",
  "docs/evidence/h2-atomicity/baseline-verify.txt": "c0f184a2bc03d41f823b858e74de0648fbccd78a43b0b7dc06ea7fb49a507b8a",
  "docs/evidence/h2-atomicity/before.json": "ba18896c121590fc1bfd33460cdda55b1f146e775f918c85749cfced1253ab5b",
  "docs/evidence/h2-atomicity/comparison.json": "e89fc0389c2069dc5b13f18229bce17f9774222df3a4aec8270543c3b3deeab1",
  "docs/evidence/h2-atomicity/diff-check.txt": "8ff3b7eb0740bfde523425e43da8985234e0909ee1e8e2fb6bccb2e77a14b9b4",
  "docs/evidence/h2-atomicity/extended-final.tap": "4c163ee59fb7e3127bc755bb456839b6b0d2e6261d285dc394f02f628420c10a",
  "docs/evidence/h2-atomicity/extended-green.tap": "778b67a5bcf2291d35edfc427d351e1f31248509d6953e486d2567d9e0708c92",
  "docs/evidence/h2-atomicity/hardening-final.tap": "9f233be83f9fc2eebbc0fee88b5b38ef809884bd42e1af0baa9be0733dc6fe34",
  "docs/evidence/h2-atomicity/intermediate-security-68.tap": "eec662246dd423b8d0be3e9719cdb22831e4f2572db3a27bf5bfd8872a3de91c",
  "docs/evidence/h2-atomicity/intermediate-verify-437.txt": "20d488a76937b0c4b69425ff47d79c634159129fdd18f5365ab8a32eaefc9bc7",
  "docs/evidence/h2-atomicity/manifest.json": "ab3c33498af4ed4f13a1f96f58bdc41ee6a92c27d6ed5901ab2711d9dc4bbe8c",
  "docs/evidence/h2-atomicity/manifest.sha256": "fa968251ba66b704d0a161a60d18983a516e054c8e2a005c5c9a42cb123cd212",
  "docs/evidence/h2-atomicity/mode-green.tap": "2c099593848ebf282f186f7084910119ac96be04abcbf58a9c65cd92c6935773",
  "docs/evidence/h2-atomicity/mode-red.tap": "bef425a2d5c0c447f00e23eb7e6b48c4d27937ff84c499d1d30a7c812fbf2740",
  "docs/evidence/h2-atomicity/original-green.tap": "a02007db263826a288b54e59521acb6b69d51b21a0adc9bab76040505098bdb6",
  "docs/evidence/h2-atomicity/original-red.tap": "7262352ccfe5a5c6164b0bf7b8271c22485f0fbc3148f3db6c774509d1497d9d",
  "docs/evidence/h2-atomicity/persistence-boundaries.tap": "b005cb28a1ba9a6875cbe5e1b27ab3275a9229e8a7a2be5347042a2dc4907eaa",
  "docs/evidence/h2-atomicity/port-before.txt": "d81329a284c0038c70c8e9124a0d10d88e469a4adcf95b4485b1170bb122fd74",
  "docs/evidence/h2-atomicity/previous-boundaries.tap": "c5e3d956e83100d3ed4339d758259612db78293d79a645f5175081dad1acd5f9",
  "docs/evidence/h2-atomicity/provenance.json": "e8e934367aa3938ac4ad1d2765a3c55c66a75187dc64e451d9437dec8638e63d",
  "docs/evidence/h2-atomicity/remote-tree.json": "3ab3e1f072898bbeb98b1eb67e0a76b8f009a8e5d6951918d18b70dec980c3cf",
  "docs/evidence/h2-atomicity/runs.json": "e3bc94311bfb0216bb66df581e7a6cf74003968026376d7871eb1a19f7cb49b9",
  "docs/evidence/h2-atomicity/security-regression.tap": "adaa55bf372efbf9272c3d6491258ae154605d3f0d8cb0e0a81e44a10657afda",
  "docs/evidence/h2-atomicity/source.patch": "c0477e594a9f514ac24deb60d3f29b8884147e5f60ee91a455ccf489bb2b0ed3",
  "docs/evidence/workspace-write-recheck-2026-09-20/01-write.tap": "300124170db3ec753b659ecb0baea8fe29a7c61d5fea6cf477637355678cd0f6",
  "docs/evidence/workspace-write-recheck-2026-09-20/02-boundary-regression.stderr.txt": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "docs/evidence/workspace-write-recheck-2026-09-20/02-boundary-regression.stdout.txt": "fe6e9916c251a37b3e7cee20999d8a890b5576fcbb54e0facdb9b289be3da95b",
  "docs/evidence/workspace-write-recheck-2026-09-20/03-advisory-regression.stderr.txt": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  "docs/evidence/workspace-write-recheck-2026-09-20/03-advisory-regression.stdout.txt": "a30898042439066284f0ac4d727f4cd1f74d531bedc46fe914ee9a40523551f0",
  "docs/evidence/workspace-write-recheck-2026-09-20/04-full-verify.stderr.txt": "ea1459f5efae90125f581fb4ad7a08d389754aa1861589940e246843f777cae8",
  "docs/evidence/workspace-write-recheck-2026-09-20/04-full-verify.stdout.txt": "5a12c0d2391eada12ed051e37ba405ec353b2afae29f0edff3c2620ec82b456d",
  "docs/evidence/workspace-write-recheck-2026-09-20/SHA256SUMS": "24bdad0156bc6202ade61374788a95ae23a5f837c368f7ec201b2bb40b044eea",
  "docs/evidence/workspace-write-recheck-2026-09-20/comparison.json": "e6e1eed8668d115db625c5645dca0ea3b3b76ab1710cc1d526b6d7cdca9e67f0",
  "docs/evidence/workspace-write-recheck-2026-09-20/initial-test-boundary-lock.json": "d694b790a5ceffd036096f425d54b127acbd2d746fffc4bed9a94047e1f94ca6",
  "docs/evidence/workspace-write-recheck-2026-09-20/manifest.json": "7294afcd7c4b0b283b93c82f4604d58aee132fc58659893662364fb7c4709fc6",
  "docs/evidence/workspace-write-recheck-2026-09-20/runs.json": "5c65632f215b2ba0a01795ab4d4e2739c948aa698fad1891daca509ef805cfd8",
  "docs/evidence/workspace-write-recheck-2026-09-20/source-lock.json": "f51dcbfb5eaf76c6811cc5542b92c8e2f0c91073d84d02ce3e6a5678a8c5d316",
  "docs/evidence/workspace-write-recheck-2026-09-20/verification.json": "17e81344f5668e934def8b403bad1c1cabbb5d7c641b0c0ec3af2c627fed4650"
};

function sha256OfFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function listEvidenceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else out.push(path.relative(ROOT, p).split(path.sep).join('/'));
    }
  };
  walk(EVIDENCE_DIR);
  return out;
}

test('Guard D1.1/evidence: لا إضافات ولا حذف في ملفات الأدلة المجمدة', () => {
  const current = listEvidenceFiles();
  const frozen = Object.keys(FROZEN_MANIFEST);
  const added = current.filter(f => !frozen.includes(f));
  const removed = frozen.filter(f => !current.includes(f));
  assert.deepEqual(added, [], 'ملفات أدلة أُضيفت — الأدلة مجمّدة تاريخيًا');
  assert.deepEqual(removed, [], 'ملفات أدلة حُذفت — الأدلة مجمّدة تاريخيًا');
  assert.equal(current.length, 45, 'العدد المتوقع للملفات المجمدة 45');
});

test('Guard D1.1/evidence: محتوى كل ملف دليل مطابق للهاش المجمد', () => {
  const current = listEvidenceFiles();
  for (const rel of current) {
    const actual = sha256OfFile(path.join(ROOT, rel));
    assert.equal(actual, FROZEN_MANIFEST[rel], `تغيّر محتوى ملف الدليل المجمد: ${rel}`);
  }
});
