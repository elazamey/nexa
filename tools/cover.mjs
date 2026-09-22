#!/usr/bin/env node
/** Run the complete Node test suite with V8 coverage enabled. */
import { spawnSync } from 'node:child_process';

const result = spawnSync(process.execPath, ['--experimental-test-coverage', '--test'], {
  stdio: 'inherit',
  shell: false,
});
if (result.error) { console.error(`coverage: ${result.error.message}`); process.exit(1); }
process.exit(result.status ?? 1);
