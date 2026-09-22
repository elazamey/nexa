/**
 * P03 cut-point child. Runs the REAL committer against a disposable root and
 * announces named cut points on stderr. The parent kills at a named point, so
 * no test races a setTimeout. The child never kills itself: SIGKILL must come
 * from outside, as it would in a real crash.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { basename, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(process.argv[2]);
const stateDirectory = resolve(process.argv[3]);
const cutPoint = process.argv[4];
assert.ok(basename(root).startsWith('nexa-p03-'));

const announce = (name, detail = {}) => {
  fs.writeSync(2, `CUT ${name} ${JSON.stringify(detail)}\n`);
  // Park forever at the requested point so the parent can SIGKILL a live,
  // mid-transaction process. Never proceed past it.
  if (name === cutPoint) { fs.writeSync(2, `PARKED ${name}\n`); while (true) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000); }
};

const { createTransactionalWorkspacePort } = await import(pathToFileURL(join(root, 'tools/celia-workspace-port.mjs')));
const { createWorkspaceCommitter } = await import(pathToFileURL(join(root, 'tools/celia-workspace-commit-port.mjs')));

// Cut points around the repository writes themselves.
const originalWrite = fs.writeFileSync;
fs.writeFileSync = function (path, ...args) {
  const relative = String(path).startsWith(root + '/') ? String(path).slice(root.length + 1) : null;
  const isTarget = relative && !relative.startsWith('.nexa/') && /\.(txt|bin)$/.test(relative);
  if (isTarget) announce('before-root-write', { path: relative });
  const out = originalWrite.call(fs, path, ...args);
  if (isTarget) announce('after-root-write', { path: relative });
  return out;
};
syncBuiltinESMExports();

const payload = JSON.parse(fs.readFileSync(process.env.P03_REQUEST_FILE, 'utf8'));
const port = createTransactionalWorkspacePort({ root });
await port.createWorkspace('p03-fixture', { workspaceId: payload.request.workspaceId });
const commit = createWorkspaceCommitter({
  root, workspacePort: port, config: payload.config, stateDirectory,
  intentHooks: (name, detail) => announce(`intent:${name}`, detail),
});
fs.writeSync(2, 'READY\n');
// The workspace port logs to stdout, so the machine-readable result goes to a
// dedicated file the parent reads after exit. Never parse a shared stream.
const report = value => fs.writeFileSync(process.env.P03_RESULT_FILE, JSON.stringify(value));
try {
  const result = commit(payload.request);
  report({ outcome: 'ALLOW', result });
} catch (error) {
  report({ outcome: error.status === 503 ? 'UNAVAILABLE' : 'DENY', status: error.status ?? null, code: error.code ?? error.message });
}
