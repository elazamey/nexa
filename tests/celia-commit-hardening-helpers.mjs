import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cpSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createIdentity } from '../packages/identity/index.js';
import { attenuate, mintCapability } from '../packages/capability/index.js';
import { buildEnvelope } from '../packages/protocol/index.js';
import { formatInstant } from '../packages/ast/index.js';
import { inspectWorkspaceCommit, workspaceCommitRoot } from '../tools/celia-workspace-commit-port.mjs';
import { workspaceCommitConstraints, workspaceCommitIntent, workspaceCommitResource } from '../tools/celia-workspace-commit-auth.mjs';
import { workspaceWriteIntent, workspaceWriteResource } from '../tools/celia-workspace-write-auth.mjs';

import { initializeCommitConsumptionStore } from '../tools/celia-commit-consumption-store.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const childScript = fileURLToPath(new URL('./fixtures/celia-commit-hardening-child.mjs', import.meta.url));

async function startBoundary(root, writeConfig, commitConfig, stateDirectory, fault) {
  // No live service credentials or NODE_OPTIONS inherited by either process.
  const env = {};
  for (const key of ['PATH', 'SystemRoot', 'WINDIR', 'TMPDIR', 'TEMP', 'TMP']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  if (stateDirectory) env.CELIA_COMMIT_STATE_DIR = stateDirectory;
  if (fault) env.CELIA_TEST_PERSISTENCE_FAULT = fault;
  const script = fault ? fileURLToPath(new URL('./fixtures/celia-commit-persistence-child.mjs', import.meta.url)) : childScript;
  const child = spawn(process.execPath, [script, root], { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  const closed = new Promise(resolve => child.once('close', resolve));
  let logs = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { logs = (logs + chunk).slice(-8000); });
  function waitFor(matches) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error(`Boundary timeout\n${logs}`)), 8_000);
      const onMessage = value => { if (matches(value)) finish(null, value); };
      const onError = error => finish(error);
      const onExit = (code, signal) => finish(new Error(`Boundary exited (${code}/${signal})\n${logs}`));
      function finish(error, value) {
        clearTimeout(timer);
        child.off('message', onMessage);
        child.off('error', onError);
        child.off('exit', onExit);
        if (error) reject(error); else resolve(value);
      }
      child.on('message', onMessage);
      child.once('error', onError);
      child.once('exit', onExit);
    });
  }
  async function stop() {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      const timer = setTimeout(() => child.kill('SIGKILL'), 2_000);
      try { await closed; } finally { clearTimeout(timer); }
    } else {
      await closed;
    }
  }
  let sequence = 0;
  async function command(command, payload = {}) {
    assert.ok(child.connected, 'fixture process must be running');
    const id = ++sequence;
    const answer = waitFor(message => message.id === id);
    child.send({ id, command, ...payload });
    return answer;
  }
  try {
    const ready = await waitFor(message => message.type === 'ready');
    const registered = await command('init', { writeConfig, commitConfig });
    assert.equal(registered.outcome, 'ALLOW', JSON.stringify(registered));
    assert.equal(registered.result.workspaceId, 'ws_hardening_fixture');
    return { pid: ready.pid, command, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

export async function hardeningFixture(t, { fault, provision = true, configured = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'nexa-commit-hardening-'));
  const stateDirectory = mkdtempSync(join(tmpdir(), 'nexa-commit-state-'));
  let boundary;
  t.after(async () => {
    try { if (boundary) await boundary.stop(); }
    finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(stateDirectory, { recursive: true, force: true });
    }
  });
  for (const area of ['packages', 'adapters', 'tools']) {
    cpSync(join(repository, area), join(root, area), {
      recursive: true,
      filter(path) {
        const stat = lstatSync(path);
        const name = basename(path);
        return !stat.isSymbolicLink() && !name.startsWith('.') && name !== 'node_modules'
          && (stat.isDirectory() || /\.(?:m?js)$/.test(name) || name === 'package.json');
      },
    });
  }
  cpSync(join(repository, 'package.json'), join(root, 'package.json'));
  const issuer = createIdentity({ label: 'hardening-issuer' });
  const caller = createIdentity({ label: 'hardening-principal' });
  const audience = createIdentity({ label: 'hardening-audience' });
  const common = { audience: audience.kid, capabilityIssuers: [issuer.kid] };
  const writeConfig = { ...common, rules: [{ id: 'stage', effect: 'ALLOW', resource: 'workspace:*', actions: ['write'], subjects: [caller.kid] }] };
  const commitConfig = { ...common, rules: [{ id: 'apply', effect: 'ALLOW', resource: 'workspace_commit:*', actions: ['commit'], subjects: [caller.kid] }] };
  if (provision) initializeCommitConsumptionStore({ directory: stateDirectory, root, targetRoot: workspaceCommitRoot(root) });
  boundary = await startBoundary(root, writeConfig, commitConfig, configured ? stateDirectory : undefined, fault);
  const workspaceId = 'ws_hardening_fixture';
  const staging = join(root, '.nexa', 'staging', workspaceId);
  const original = { 'a.txt': 'base A\n', 'b.txt': 'base B\n' };
  const approved = { 'a.txt': 'approved A\n', 'b.txt': 'approved B\n' };
  for (const path of Object.keys(original)) {
    writeFileSync(join(root, path), original[path], { mode: 0o600 });
    const input = { workspaceId, path, content: approved[path] };
    const capability = mintCapability({ issuer, subject: caller.kid, resource: workspaceWriteResource(workspaceId, path), actions: ['write'] });
    const authorization = buildEnvelope({
      sender: caller, to: audience.kid, type: 'CALL', capability: capability.id,
      body: { resource: capability.resource, action: 'write', args: workspaceWriteIntent(input), capability },
    });
    const written = await boundary.command('stage', { input: { ...input, authorization } });
    assert.equal(written.outcome, 'ALLOW', JSON.stringify(written));
    assert.equal(readFileSync(join(staging, path), 'utf8'), approved[path]);
    assert.equal(readFileSync(join(root, path), 'utf8'), original[path]);
  }
  writeFileSync(join(root, 'untouched.txt'), 'unrelated\n', { mode: 0o600 });
  function describe() {
    const { targetRoot, changeSetHash, expectedBaseHash } = inspectWorkspaceCommit({ root, workspaceId });
    return { workspaceId, targetRoot, changeSetHash, expectedBaseHash };
  }
  const descriptor = describe();
  function freshRequest(capability) {
    capability ??= mintCapability({
      issuer, subject: caller.kid, resource: workspaceCommitResource(descriptor), actions: ['commit'],
      constraints: workspaceCommitConstraints(descriptor),
      caveats: { max_uses: 1, max_depth: 0, exp: formatInstant(Date.now() + 300_000) },
    });
    const authorization = buildEnvelope({
      sender: caller, to: audience.kid, type: 'CALL', capability: capability.id, ttlSeconds: 300,
      body: { resource: capability.resource, action: 'commit', args: workspaceCommitIntent(descriptor), capability },
    });
    return { ...descriptor, authorization };
  }
  const request = freshRequest();
  return {
    root, staging, original, approved, request, describe, stateDirectory, freshRequest,
    delegatedRequests(maxUses = 1, count = 2) {
      const parent = mintCapability({
        issuer, subject: caller.kid, resource: workspaceCommitResource(descriptor), actions: ['commit'],
        constraints: workspaceCommitConstraints(descriptor),
        caveats: { max_uses: maxUses, max_depth: 1, exp: formatInstant(Date.now() + 300_000) },
      });
      const requests = Array.from({ length: count }, () => freshRequest(attenuate(parent, {
        delegator: caller, subject: caller.kid, resource: parent.resource, actions: parent.actions,
        constraints: parent.constraints, caveats: { ...parent.caveats, max_uses: 1, max_depth: 0 },
      })));
      return { parent, requests };
    },
    commitRequest(input) { return boundary.command('commit', { input, mode: 'none' }); },
    get pid() { return boundary.pid; },
    commit(mode = 'none') { return boundary.command('commit', { input: request, mode }); },
    async restart() {
      await boundary.stop();
      // Same disk, identity configuration, audience and workspace ID, new OS
      // process. No re-signing, token renewal or replay-state manipulation.
      boundary = await startBoundary(root, writeConfig, commitConfig, configured ? stateDirectory : undefined);
    },
    contents() { return Object.fromEntries(Object.keys(original).map(path => [path, readFileSync(join(root, path), 'utf8')])); },
    restoreBase() { for (const [path, content] of Object.entries(original)) writeFileSync(join(root, path), content); },
  };
}
