#!/usr/bin/env node
/**
 * Metrics enforcement — read-only verification that documentation matches measured reality.
 *
 * Strict requirements:
 * - Read-only: never writes files, only reads and spawns measurement commands.
 * - Windows-safe: uses `npm.cmd` on win32, no `shell: true`.
 * - TAP parsing: validates `# tests`, `# fail` / `# ok` from node --test output.
 * - No default values: throws if an expected metric is missing.
 * - Order-insensitive matching: doc block lines can appear in any order.
 *
 * Usage:
 *   node tools/check-metrics.mjs
 *   npm run metrics
 */

import { readFileSync } from 'fs';
import { spawnSync } from 'child_process';
import { join } from 'path';

const isWin = process.platform === 'win32';
const npm = isWin ? 'npm.cmd' : 'npm';
const cwd = process.cwd();

// Execute npm command safely without shell:true
function runCommand(args) {
  const res = spawnSync(npm, args, { cwd, encoding: 'utf8', shell: false });
  const stdout = res.stdout || '';
  const stderr = res.stderr || '';
  const combined = `${stdout}\n${stderr}`;
  if (res.error) {
    throw new Error(`Failed to run npm ${args.join(' ')}: ${res.error.message}`);
  }
  // If command itself failed (non-zero) we still want its output for parsing,
  // but we will detect failures via TAP / metric parsing. However, if status is non-zero
  // and no output, surface it.
  if (res.status !== 0 && combined.trim().length === 0) {
    throw new Error(`Command npm ${args.join(' ')} failed with status ${res.status} and no output`);
  }
  return combined;
}

// Extract NEXA_METRIC key=number from tool output — no defaults, explicit throw
function getMetric(output, key) {
  const regex = new RegExp(`NEXA_METRIC\\s+${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*(\\d+)`);
  const match = output.match(regex);
  if (!match) {
    throw new Error(`Missing expected metric: NEXA_METRIC ${key}\nOutput was:\n${output.slice(-2000)}`);
  }
  return match[1];
}

// Parse TAP output from `node --test`
// Expects lines like:
// # tests 314
// # pass 314
// # fail 0
// or # ok at end
function parseTAP(output) {
  const testsMatch = output.match(/^# tests\s+(\d+)/m);
  const failMatch = output.match(/^# fail\s+(\d+)/m);
  const passMatch = output.match(/^# pass\s+(\d+)/m);
  const okMatch = output.match(/^# ok/m);

  if (!testsMatch) {
    throw new Error(`TAP output missing '# tests N'\nOutput was:\n${output.slice(-3000)}`);
  }

  const totalTests = testsMatch[1];
  const fails = failMatch ? parseInt(failMatch[1], 10) : null;
  const passes = passMatch ? parseInt(passMatch[1], 10) : null;

  // Valid TAP must explicitly have either # fail or # ok
  if (failMatch === null && okMatch === null) {
    throw new Error(`Invalid TAP output: explicitly missing '# fail' or '# ok'\nOutput was:\n${output.slice(-3000)}`);
  }

  if (fails !== null && fails > 0) {
    throw new Error(`Tests failed: ${fails} failures detected in TAP output`);
  }

  // Additional safety: if both pass and tests are present, they should match when fail=0
  if (fails === 0 && passes !== null && String(passes) !== totalTests) {
    // Not fatal if TAP reports suites differently, but warn via throw if mismatch is obvious
    // For strictness, we require pass count to equal tests when fail=0 if both present
    // However some runners report only top-level; we allow if okMatch exists.
    if (!okMatch && passes !== parseInt(totalTests, 10)) {
      throw new Error(`TAP inconsistency: # tests ${totalTests} but # pass ${passes} with # fail 0`);
    }
  }

  return totalTests;
}

console.log('Gathering measurements...');

let testOut, auditOut, attacksOut, googleOut, postureOut;
try {
  testOut = runCommand(['test']);
} catch (e) {
  console.error(`❌ Failed to run npm test: ${e.message}`);
  process.exit(1);
}
try {
  auditOut = runCommand(['run', 'audit']);
} catch (e) {
  console.error(`❌ Failed to run npm run audit: ${e.message}`);
  process.exit(1);
}
try {
  attacksOut = runCommand(['run', 'attacks']);
} catch (e) {
  console.error(`❌ Failed to run npm run attacks: ${e.message}`);
  process.exit(1);
}
try {
  googleOut = runCommand(['run', 'attacks:google']);
} catch (e) {
  console.error(`❌ Failed to run npm run attacks:google: ${e.message}`);
  process.exit(1);
}
try {
  postureOut = runCommand(['run', 'posture']);
} catch (e) {
  console.error(`❌ Failed to run npm run posture: ${e.message}`);
  process.exit(1);
}

let actualMetrics;
try {
  actualMetrics = {
    'Total tests': parseTAP(testOut),
    'Security tests': parseTAP(auditOut),
    'Ω attacks': getMetric(attacksOut, 'omega_blocked'),
    'Google identity attacks': getMetric(googleOut, 'google_blocked'),
    'Closed gates': getMetric(postureOut, 'closed_gates'),
  };
} catch (e) {
  console.error(`❌ Metric extraction failed: ${e.message}`);
  process.exit(1);
}

console.log('Measured metrics:');
for (const [k, v] of Object.entries(actualMetrics)) {
  console.log(`  - ${k}: ${v}`);
}

// Verify docs — read-only
const docs = ['README.md', 'SECURITY.md'];
let isFailed = false;

for (const doc of docs) {
  let content;
  try {
    content = readFileSync(join(cwd, doc), 'utf8');
  } catch (e) {
    console.error(`❌ Could not read ${doc}: ${e.message}`);
    isFailed = true;
    continue;
  }

  const blockMatch = content.match(/<!-- NEXA_METRICS:START -->([\s\S]*?)<!-- NEXA_METRICS:END -->/);
  if (!blockMatch) {
    console.error(`❌ ${doc} is missing the NEXA_METRICS block (<!-- NEXA_METRICS:START --> ... <!-- NEXA_METRICS:END -->).`);
    isFailed = true;
    continue;
  }

  const blockContent = blockMatch[1];

  for (const [key, expectedValue] of Object.entries(actualMetrics)) {
    // Order-insensitive search: find line "- Key: number" anywhere in block
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`-\\s*${escapedKey}\\s*:\\s*(\\d+)`);
    const match = blockContent.match(regex);

    if (!match) {
      console.error(`❌ ${doc} is missing the metric line for: ${key}`);
      isFailed = true;
    } else if (match[1] !== expectedValue) {
      console.error(`❌ ${doc} mismatch on '${key}'. Measured: ${expectedValue}, Documented: ${match[1]}`);
      isFailed = true;
    } else {
      console.log(`✓ ${doc} ${key}: ${match[1]}`);
    }
  }
}

if (isFailed) {
  console.error('\n❌ Metrics check failed: docs do not match measured reality.');
  process.exit(1);
} else {
  console.log('\n✓ Metrics check passed: docs match measured reality.');
}
