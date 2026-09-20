// Test-only boundary harness. Production authorization, capture and execution
// are loaded unmodified from a disposable copy. No HTTP status is synthesized.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { spawnSync } from 'node:child_process';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

assert.equal(typeof process.send, 'function', 'fixture requires IPC');
const root = resolve(process.argv[2]);
assert.ok(basename(root).startsWith('nexa-commit-hardening-'));
const externalWriter = fileURLToPath(new URL('./celia-commit-external-writer.mjs', import.meta.url));
const originalWrite = fs.writeFileSync;
let active = null;

// Instrument only the two root target writes, never verification, reads, hashes,
// policy decisions or staging writes. Production files on disk are not patched.
fs.writeFileSync = function (path, ...args) {
  const file = ['a.txt', 'b.txt'].find(name => path === join(root, name));
  if (!active || !file) return originalWrite.call(fs, path, ...args);
  if (active.mode === 'fail-second' && file === 'b.txt' && !active.faultInjected) {
    active.faultInjected = true; // a future rollback is not itself fault-injected
    active.trace.push({ kind: 'fault', file, code: 'ENOSPC' });
    const error = new Error('H2: injected disk-full at second target write');
    error.code = 'ENOSPC';
    throw error;
  }
  if (active.mode === 'external-writer' && file === 'a.txt' && !active.intervened) {
    active.intervened = true;
    // At this call site the real committer has already captured/compared all
    // hashes and consumed authority. Pause it while an independent process
    // changes the target, then resume the ORIGINAL write. No sleeps or polling.
    const writer = spawnSync(process.execPath, [externalWriter, root, file, 'external writer value\n'], {
      encoding: 'utf8', timeout: 3_000, env: process.env,
    });
    assert.ifError(writer.error);
    assert.equal(writer.status, 0, writer.stderr);
    const proof = JSON.parse(writer.stdout);
    assert.notEqual(proof.pid, process.pid);
    active.trace.push({ kind: 'external-writer', file, ...proof });
  }
  const result = originalWrite.call(fs, path, ...args);
  active.trace.push({ kind: 'write-applied', file });
  return result;
};
syncBuiltinESMExports();

const { createTransactionalWorkspacePort } = await import(pathToFileURL(join(root, 'tools/celia-workspace-port.mjs')));
const { createWorkspaceWriteAuthorizer } = await import(pathToFileURL(join(root, 'tools/celia-workspace-write-auth.mjs')));
const { createWorkspaceCommitter } = await import(pathToFileURL(join(root, 'tools/celia-workspace-commit-port.mjs')));
const port = createTransactionalWorkspacePort({ root });
let authorizeWrite;
let commit;

process.on('disconnect', () => process.exit(0));
process.on('message', async message => {
  const trace = [];
  try {
    let result;
    if (message.command === 'init') {
      assert.equal(commit, undefined, 'use a new OS process for restart');
      authorizeWrite = createWorkspaceWriteAuthorizer(message.writeConfig);
      commit = createWorkspaceCommitter({ root, workspacePort: port, config: message.commitConfig });
      // Restore only the in-memory workspace locator, through the real legacy
      // port API. Never restore or change replay/use state. This prevents an
      // absent workspace from masking H1 after a restart.
      result = await port.createWorkspace('hardening-fixture', { workspaceId: 'ws_hardening_fixture' });
    } else if (message.command === 'stage') {
      const authorization = authorizeWrite(message.input);
      const { workspaceId, path, content } = message.input;
      result = await port.writeFile(workspaceId, path, content, authorization.authorizationRef);
    } else if (message.command === 'commit') {
      assert.ok(['none', 'fail-second', 'external-writer'].includes(message.mode));
      active = { mode: message.mode, trace, intervened: false };
      try { result = commit(message.input); } finally { active = null; }
    } else {
      throw new Error('Unknown test command');
    }
    process.send({ id: message.id, outcome: 'ALLOW', result, trace, pid: process.pid });
  } catch (error) {
    active = null;
    process.send({
      id: message.id, outcome: error.status === 401 || error.status === 403 ? 'DENY' : 'ERROR',
      status: error.status ?? null, code: error.code ?? error.message, trace, pid: process.pid,
    });
  }
});
process.send({ type: 'ready', pid: process.pid });
