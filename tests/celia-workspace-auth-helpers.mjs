// Separate fixture so the original RED test remains byte-for-byte unchanged.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync, lstatSync, mkdtempSync, readFileSync,
  readdirSync, readlinkSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { initializeCommitConsumptionStore } from '../tools/celia-commit-consumption-store.mjs';
import { workspaceCommitRoot } from '../tools/celia-workspace-commit-port.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const bootstrap = fileURLToPath(new URL('./fixtures/celia-http-child.mjs', import.meta.url));

export function snapshot(root, prefix = '', result = new Map()) {
  for (const name of readdirSync(join(root, prefix)).sort()) {
    const relative = join(prefix, name);
    const path = join(root, relative);
    const stat = lstatSync(path, { bigint: true });
    // atime is intentionally excluded: snapshot reads may update it. Mutation
    // metadata (including nanosecond mtime/ctime), ownership and mode are checked.
    result.set(`${relative}::metadata`, JSON.stringify(
      [stat.mode, stat.uid, stat.gid, stat.size, stat.ino, stat.nlink, stat.mtimeNs, stat.ctimeNs],
      (_, value) => typeof value === 'bigint' ? value.toString() : value
    ));
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

export function copySources(root) {
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
  return root;
}

/** Throwaway source root, removed with the test. Needed by boot-time tests that
 *  spawn the server directly instead of through the readiness fixture. */
export function isolatedRoot(t, prefix = 'nexa-isolated-') {
  const root = mkdtempSync(join(tmpdir(), prefix));
  copySources(root);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

/**
 * Environment for a spawned server: no inherited credentials, NODE_OPTIONS or
 * live service URLs. `extra` wins, so a test can pin NODE_ENV / NEXA_API_KEY.
 */
export function minimalEnv(extra = {}) {
  const env = { PORT: '0', SUPABASE_URL: 'mock://integration-test', SUPABASE_ANON_KEY: 'mock-key' };
  for (const name of ['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR']) {
    if (process.env[name]) env[name] = process.env[name];
  }
  return Object.assign(env, extra);
}

/** repository-relative path of the test transport bootstrap (patches listen). */
export const httpChildBootstrap = bootstrap;
export const repositoryRoot = repository;
export const serverEntry = join(repository, 'tools/celia-dashboard-server.mjs');

export async function startIsolatedServer(t, config, commitConfig, options = {}) {
  // root is resolved from the server's import.meta.url, not cwd. Copy sources
  // rather than importing the checkout's server, which would write into it.
  const root = mkdtempSync(join(tmpdir(), 'nexa-celia-http-'));
  const stateDirectory = commitConfig === undefined ? undefined : mkdtempSync(join(tmpdir(), 'nexa-commit-state-'));
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
      if (stateDirectory) rmSync(stateDirectory, { recursive: true, force: true });
    }
  });

  copySources(root);

  // Deliberately do not inherit credentials, NODE_OPTIONS or live service URLs.
  // Perimeter/deploy-layer tests pin the runtime env (a key, NODE_ENV) through
  // options.env without changing any existing caller.
  const env = minimalEnv(options.env ?? {});
  if (stateDirectory) {
    initializeCommitConsumptionStore({ directory: stateDirectory, root, targetRoot: workspaceCommitRoot(root) });
    env.CELIA_COMMIT_STATE_DIR = stateDirectory;
  }
  if (config !== undefined) env.CELIA_WORKSPACE_WRITE_AUTH = JSON.stringify(config);
  if (commitConfig !== undefined) env.CELIA_WORKSPACE_COMMIT_AUTH = JSON.stringify(commitConfig);
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

  async function post(path, body, headers = {}) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      // Identity and capability, if any, are inside the signed body authorization.
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
      redirect: 'error',
    });
    return { status: response.status, body: await response.json() };
  }
  async function get(path, headers = {}) {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      headers,
      signal: AbortSignal.timeout(5_000),
      redirect: 'error',
    });
    return { status: response.status, body: await response.json() };
  }

  // Byte-exact transport for contracts that live in the path itself (approval
  // ids are URIs; a test that proves percent-decoding must not let fetch
  // re-encode the sequence first) and for cookie/header-level assertions that
  // the fetch helpers above deliberately do not surface.
  const { request } = await import('node:http');
  function raw({ method = 'GET', path, headers = {}, body } = {}) {
    return new Promise((resolve, reject) => {
      const payload = body === undefined || body === null
        ? undefined
        : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
      const req = request({
        host: '127.0.0.1', port, method, path,
        headers: {
          ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}),
          ...headers,
        },
        agent: false,
      }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed = null;
          try { parsed = text.length > 0 ? JSON.parse(text) : null; } catch { /* non-JSON body */ }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            text,
            body: parsed ?? { raw: text },
          });
        });
      });
      req.on('error', reject);
      req.setTimeout(5_000, () => req.destroy(new Error('raw request timed out')));
      if (payload) req.write(payload);
      req.end();
    });
  }

  return { root, port, post, get, raw };
}

