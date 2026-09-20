#!/usr/bin/env node
/**
 * Quick Developer Verification Loop — completes in under 1 second.
 *
 * Runs essential safety and security checks:
 *   1. Posture check (6 hard gates CLOSED, 0 ambient authority in packages)
 *   2. Security audit suite (16 tests verifying default-deny, crypto, gates)
 *   3. Permission probe check (ambient authority denied)
 *
 * Usage:
 *   node tools/quick-verify.mjs
 *   npm run verify:quick
 */

import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const startTime = performance.now();

console.log('⚡ NEXA Developer Quick Loop');
console.log('═'.repeat(60));

let allOk = true;

// 1. Posture check
const postureStart = performance.now();
const postureResult = spawnSync(process.execPath, [join(root, 'tools/check-posture.mjs')], {
  cwd: root,
  encoding: 'utf8',
});
const postureDuration = (performance.now() - postureStart).toFixed(0);

if (postureResult.status === 0) {
  console.log(`  ✅ [1/3] Posture: 6 gates CLOSED, 0 ambient authority (${postureDuration}ms)`);
} else {
  console.error(`  ❌ [1/3] Posture failed:\n${postureResult.stderr || postureResult.stdout}`);
  allOk = false;
}

// 2. Security audit suite (16 tests)
const auditStart = performance.now();
const auditResult = spawnSync(process.execPath, ['--test', join(root, 'tests/security.test.js')], {
  cwd: root,
  encoding: 'utf8',
});
const auditDuration = (performance.now() - auditStart).toFixed(0);

if (auditResult.status === 0) {
  console.log(`  ✅ [2/3] Security Audit: 16/16 security tests passed (${auditDuration}ms)`);
} else {
  console.error(`  ❌ [2/3] Security audit failed:\n${auditResult.stderr || auditResult.stdout}`);
  allOk = false;
}

// 3. Permission probe quick check
const probeStart = performance.now();
const probeResult = spawnSync(process.execPath, [join(root, 'tools/permission-probe.mjs'), '--json'], {
  cwd: root,
  encoding: 'utf8',
});
const probeDuration = (performance.now() - probeStart).toFixed(0);

if (probeResult.status === 0) {
  try {
    const parsed = JSON.parse(probeResult.stdout.trim());
    console.log(`  ✅ [3/3] Permission Probe: ${parsed.supported ? 'supported' : 'probe ok'} (Node ${parsed.node}) (${probeDuration}ms)`);
  } catch {
    console.log(`  ✅ [3/3] Permission Probe: OK (${probeDuration}ms)`);
  }
} else {
  console.error(`  ❌ [3/3] Permission probe failed:\n${probeResult.stderr || probeResult.stdout}`);
  allOk = false;
}

const totalDuration = ((performance.now() - startTime) / 1000).toFixed(2);
console.log('═'.repeat(60));

if (allOk) {
  console.log(`✨ Developer quick loop PASSED in ${totalDuration}s`);
  process.exit(0);
} else {
  console.error(`❌ Quick verification FAILED in ${totalDuration}s`);
  process.exit(1);
}
