import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { HuntMemory } from '../src/security/hunter/hunt-memory.js';

/**
 * Inversion test for D1.9 (O01): suite outputs are isolated to per-process tmp.
 * Removing the bootstrap (tests/bootstrap.mjs) or the NEXA_* env overrides
 * must fail this file. Production defaults are pinned unchanged by the
 * child-process probe below (env stripped = deploy behavior).
 */

test('D1.9 inversion: suite provides isolated output paths under tmp', () => {
  for (const name of ['NEXA_HUNT_MEMORY', 'NEXA_BUG_REPORT']) {
    const value = process.env[name];
    assert.ok(value, `${name} must be set by the suite bootstrap (run via npm test)`);
    assert.ok(
      path.resolve(value).startsWith(path.resolve(tmpdir()) + path.sep),
      `${name} must resolve under the OS tmp dir, got: ${value}`
    );
    assert.ok(
      value.includes(String(process.pid)),
      `${name} must be unique per test process (pid-scoped), got: ${value}`
    );
  }
  assert.notEqual(process.env.NEXA_HUNT_MEMORY, process.env.NEXA_BUG_REPORT);
});

test('D1.9 inversion: HuntMemory default honors the isolated path', () => {
  const mem = new HuntMemory(); // construction only (read); no write here
  assert.equal(mem.storagePath, path.resolve(process.env.NEXA_HUNT_MEMORY));
});

test('D1.9 inversion: library default without env is still dashboard/data (prod unchanged)', () => {
  const childEnv = { ...process.env };
  delete childEnv.NEXA_HUNT_MEMORY;
  delete childEnv.NEXA_BUG_REPORT;
  const probe = [
    "import { HuntMemory } from './src/security/hunter/hunt-memory.js';",
    'console.log(new HuntMemory().storagePath);',
  ].join('\n');
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', probe], {
    encoding: 'utf8',
    env: childEnv,
  });
  assert.equal(result.status, 0, `default-path probe failed: ${result.stderr}`);
  assert.equal(result.stdout.trim(), path.resolve('dashboard/data/hunt-memory.json'));
});
