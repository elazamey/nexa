import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  readdirSync, readlinkSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = fileURLToPath(new URL('../', import.meta.url));
const bootstrap = fileURLToPath(new URL('./fixtures/celia-http-child.mjs', import.meta.url));

function snapshot(root, prefix = '', result = new Map()) {
  for (const name of readdirSync(join(root, prefix)).sort()) {
    const relative = join(prefix, name);
    const path = join(root, relative);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      result.set(relative, `link:${readlinkSync(path)}`);
    } else if (stat.isDirectory()) {
      result.set(relative, 'directory');
      snapshot(root, relative, result);
    } else {
      result.set(relative, createHash('sha256').update(readFileSync(path)).digest('hex'));
    }
  }
  return result;
}

async function startIsolatedServer(t) {
  // root is resolved from the server's import.meta.url, not cwd. Copy sources
  // rather than importing the checkout's server, which would write into it.
  const root = mkdtempSync(join(tmpdir(), 'nexa-celia-http-'));
  let child;
  let closed;
  t.after(async () => {
    try {
      if (child && child.exitCode === null && child.signalCode === null) {
        child.kill('SIGTERM');
        const force = setTimeout(() => child.kill('SIGKILL'), 2_000);
        try { await closed; } finally { clearTimeout(force); }
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  for (const area of ['packages', 'adapters', 'tools']) {
    cpSync(join(repository, area), join(root, area), {
      recursive: true,
      filter(path) {
        const stat = lstatSync(path);
        if (stat.isSymbolicLink()) return false;
        const name = basename(path);
        if (name.startsWith('.') || name === 'node_modules') return false;
        return stat.isDirectory() || /\.(?:m?js)$/.test(name) || name === 'package.json';
      },
    });
  }
  cpSync(join(repository, 'package.json'), join(root, 'package.json'));

  // Deliberately do not inherit credentials, NODE_OPTIONS or live service URLs.
  const env = { PORT: '0', SUPABASE_URL: 'mock://integration-test', SUPABASE_ANON_KEY: 'mock-key' };
  for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR']) {
    if (process.env[name]) env[name] = process.env[name];
  }
  child = spawn(process.execPath, [bootstrap, join(root, 'tools/celia-dashboard-server.mjs')], {
    cwd: root, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  closed = new Promise(resolve => child.once('close', resolve));
  let logs = '';
  for (const stream of [child.stdout, child.stderr]) {
    stream.on('data', chunk => { logs = (logs + chunk).slice(-8_000); });
  }
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(new Error(`Celia startup timed out\n${logs}`)), 10_000);
    const onError = error => finish(error);
    const onExit = (code, signal) => finish(new Error(`Celia exited before readiness (${code}/${signal})\n${logs}`));
    const onMessage = message => {
      if (message.type === 'ready' && Number.isInteger(message.port) && message.port > 0) {
        finish(null, message.port);
      }
    };
    function finish(error, value) {
      clearTimeout(timer);
      child.off('error', onError);
      child.off('exit', onExit);
      child.off('message', onMessage);
      if (error) reject(error); else resolve(value);
    }
    child.once('error', onError);
    child.once('exit', onExit);
    child.on('message', onMessage);
  });

  async function post(path, body) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      // No Authorization, Cookie, capability or evidence is supplied.
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
      redirect: 'error',
    });
    return { status: response.status, body: await response.json() };
  }
  return { root, post };
}

test('workspace HTTP: unauthenticated write is denied without filesystem changes', { timeout: 25_000 }, async t => {
  const { root, post } = await startIsolatedServer(t);

  // Legacy setup only: create an existing workspace through the current API.
  // This is NOT an assertion that anonymous creation is acceptable. When create
  // is secured, replace this setup with an authorized fixture; never skip it or
  // let a rejected setup count as a passing write-authorization test.
  const created = await post('/api/v1/workspace/create', { taskId: 'unauthorized-write-test' });
  assert.equal(created.status, 200, 'setup must create a workspace before testing write authorization');
  assert.equal(created.body.ok, true);
  const { workspaceId } = created.body;
  assert.match(workspaceId, /^ws_unauthorized-write-test_[a-z0-9]+$/);

  const file = 'authorization-canary.txt';
  const staging = join(root, '.nexa', 'staging', workspaceId);
  mkdirSync(staging, { recursive: true });
  writeFileSync(join(root, file), 'original repository content\n');
  writeFileSync(join(staging, file), 'original staged content\n');
  const before = snapshot(root);

  const response = await post('/api/v1/workspace/write', {
    workspaceId, path: file, content: 'UNAUTHORIZED OVERWRITE\n',
  });
  const after = snapshot(root);
  const changedPaths = [...new Set([...before.keys(), ...after.keys()])]
    .filter(path => before.get(path) !== after.get(path)).sort();

  t.diagnostic(`Anonymous write returned HTTP ${response.status}; changed paths: ${JSON.stringify(changedPaths)}`);
  // Check denial AND side effects together: returning an error after writing is
  // still a security failure. A 404/500 or startup failure is not a valid denial.
  assert.deepEqual({
    denied: response.status === 401 || response.status === 403,
    reportsSuccess: response.body.ok === true,
    changedPaths,
  }, {
    denied: true,
    reportsSuccess: false,
    changedPaths: [],
  }, 'unauthenticated workspace/write must return 401/403 and leave staging and repository unchanged');
});
