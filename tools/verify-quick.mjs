#!/usr/bin/env node
/** Fast local feedback loop: cheap posture checks followed by the test suite. */
import { spawnSync } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const commands = [
  ['posture', ['run', 'posture']],
  ['tests', ['test', '--', '--test-reporter=dot']],
];
for (const [name, args] of commands) {
  const result = spawnSync(npm, args, { stdio: 'inherit', shell: false });
  if (result.error) { console.error(`verify:quick: ${name}: ${result.error.message}`); process.exit(1); }
  if (result.status !== 0) { console.error(`verify:quick: ${name} failed`); process.exit(result.status ?? 1); }
}
console.log('✓ quick verification passed');
