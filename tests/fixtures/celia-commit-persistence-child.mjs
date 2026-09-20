// Additive fault bootstrap: keep the original H1/H2/H3 worker unchanged.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { basename, join, resolve } from 'node:path';

assert.equal(typeof process.send, 'function');
const root = resolve(process.argv[2]);
assert.ok(basename(root).startsWith('nexa-commit-hardening-'));
const fault = process.env.CELIA_TEST_PERSISTENCE_FAULT;
assert.ok(['kill-before-root', 'journal-fsync-error', 'head-fsync-error', 'journal-write-error'].includes(fault));
const originalWriteFile = fs.writeFileSync;
const originalFsync = fs.fsyncSync;
const originalWrite = fs.writeSync;
const isFile = (fd, name) => {
  const a = fs.fstatSync(fd);
  const b = fs.statSync(join(process.env.CELIA_COMMIT_STATE_DIR, name));
  return a.dev === b.dev && a.ino === b.ino;
};
fs.writeFileSync = function (path, ...args) {
  if (fault === 'kill-before-root' && path === join(root, 'a.txt')) {
    // Production has returned from durable consumption; not one root byte has
    // been written. SIGKILL cannot run cleanup, rollback or shutdown handlers.
    process.kill(process.pid, 'SIGKILL');
  }
  return originalWriteFile.call(fs, path, ...args);
};
fs.fsyncSync = function (fd) {
  if ((fault === 'journal-fsync-error' && isFile(fd, 'journal.jsonl'))
      || (fault === 'head-fsync-error' && isFile(fd, 'head.json'))) {
    throw Object.assign(new Error('H1 injected fsync failure'), { code: 'EIO' });
  }
  return originalFsync.call(fs, fd);
};
fs.writeSync = function (fd, ...args) {
  if (fault === 'journal-write-error' && isFile(fd, 'journal.jsonl')) {
    throw Object.assign(new Error('H1 injected journal write failure'), { code: 'ENOSPC' });
  }
  return originalWrite.call(fs, fd, ...args);
};
syncBuiltinESMExports();
await import('./celia-commit-hardening-child.mjs');
