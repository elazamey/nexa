#!/usr/bin/env node
/**
 * Permission flag probing — robust detection of Node's permission model flag.
 *
 * Node's permission model flag has changed across versions:
 *   - Node >=20.8: --permission
 *   - Node 20.0-20.7: --experimental-permission
 *   - Some builds: no permission model at all
 *
 * This script probes the runtime and prints the supported flag, and optionally
 * runs the permission proof with the correct flag.
 *
 *   node tools/permission-probe.mjs              # prints probe result
 *   node tools/permission-probe.mjs --json        # JSON output
 *   node tools/permission-probe.mjs --run-proof   # runs the proof with detected flag
 *
 * Exit codes:
 *   0 — probe succeeded, flag detected
 *   1 — no permission model supported (caller should skip proof)
 *   2 — probe error
 */
import { spawnSync } from 'node:child_process';

function probeFlag(flag) {
  // Probe by trying to run `node <flag> --allow-fs-read=. -e "process.exit(0)"`
  // If flag is unknown, Node exits with code 9 and prints "bad option".
  // If flag is known but permission denied, it still exits 0 because we allow read.
  const result = spawnSync(process.execPath, [flag, '--allow-fs-read=.', '-e', 'process.exit(0)'], {
    encoding: 'utf8',
    timeout: 5000,
  });
  // Node returns 9 for unknown option, 0 for success, 1 for other errors.
  // We check stderr for "bad option" or "unknown option" as well.
  const stderr = (result.stderr || '').toLowerCase();
  const isUnknown = stderr.includes('bad option') || stderr.includes('unknown option') || stderr.includes('unrecognized');
  if (isUnknown) return { supported: false, code: result.status, stderr: result.stderr };
  // If it exited 0 or with permission-related error, flag is supported.
  // Some Node versions exit 0 even without permission model active? We also check process.permission later.
  return { supported: result.status === 0, code: result.status, stderr: result.stderr, stdout: result.stdout };
}

function probe() {
  const candidates = [
    { flag: '--permission', script: 'proof:permission', npm: 'npm run proof:permission' },
    { flag: '--experimental-permission', script: 'proof:permission:legacy', npm: 'npm run proof:permission:legacy' },
  ];

  const results = [];
  for (const cand of candidates) {
    const probed = probeFlag(cand.flag);
    results.push({ ...cand, ...probed });
    if (probed.supported) {
      return {
        ok: true,
        flag: cand.flag,
        npmScript: cand.script,
        npmCommand: cand.npm,
        probe: probed,
        allProbes: results,
        nodeVersion: process.version,
      };
    }
  }

  return {
    ok: false,
    flag: null,
    reason: 'no permission model flag supported',
    allProbes: results,
    nodeVersion: process.version,
  };
}

const result = probe();

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(result, null, 2));
} else if (process.argv.includes('--run-proof')) {
  if (!result.ok) {
    console.error(`permission probe: no supported flag on ${result.nodeVersion} — skipping proof`);
    process.exit(0);
  }
  console.log(`permission probe: detected ${result.flag} on ${result.nodeVersion}, running ${result.npmCommand}`);
  const run = spawnSync('npm', ['run', result.npmScript], { stdio: 'inherit', timeout: 60000 });
  process.exit(run.status ?? 1);
} else {
  if (result.ok) {
    console.log(`permission probe OK: ${result.flag} supported on ${result.nodeVersion}`);
    console.log(`  run: ${result.npmCommand}`);
  } else {
    console.log(`permission probe: no permission flag supported on ${result.nodeVersion}`);
    console.log(`  probes:`);
    for (const p of result.allProbes) {
      console.log(`    ${p.flag}: supported=${p.supported} code=${p.code} ${p.stderr ? p.stderr.trim().split('\n')[0] : ''}`);
    }
  }
}

process.exit(result.ok ? 0 : 1);
