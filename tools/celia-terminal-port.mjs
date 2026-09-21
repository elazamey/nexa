/**
 * Celia Terminal Port — v13-2. The first REAL execution NEXA runs.
 *
 * Runs allowlisted programs inside a sandboxed jail (a private directory) and
 * returns structured, hash-committed results: stdout/stderr + exitCode +
 * duration + a filesystem diff of the jail, addressed by an evidenceRef.
 *
 * TWO SANDBOX MODES (auto-detected, same contract):
 *
 *   'os'     — unshare(userns+mountns) + busybox chroot. The wrapper is a
 *              CONSTANT script; user input enters only as positional
 *              parameters (sh -c SCRIPT JAIL PROG ARGS… → $0=JAIL, $@=PROG
 *              ARGS), so there is no injection surface into the wrapper. The
 *              kernel makes the jail root the only filesystem: absolute
 *              escapes ENOENT, not merely "refused by policy".
 *   'policy' — hosts without userns/busybox (e.g. the Windows host until its
 *              adapter lands): no-shell direct spawn + allowlist + argument
 *              validation + cwd pinning. A policy-level jail: refusals, not
 *              kernel containment.
 *
 * BOTH MODES share the hard rules (the vector contract):
 *   - never a shell for the caller: program + args array, spawned directly;
 *   - program must be a bare name on the allowlist (no paths, no structure);
 *   - arguments: relative paths only — `..` segments and absolute paths are
 *     refused (NEXA_E_TERMINAL_JAIL); control characters/newlines refused;
 *   - minimal environment: PATH (fixed system dirs) + HOME=jail + LANG —
 *     nothing else crosses to the child;
 *   - timeout kills the whole process group (detached spawn, kill -PGID);
 *   - expectedTarget (the approval token) must equal the canonical command —
 *     the executed command is the approved command, byte for byte.
 *
 * Async on purpose: real processes take real time. The protocol envelope
 * handler stays sync; the terminal runs in the server/mission layer, which is
 * async (same pattern as the CoW workspace port).
 *
 * Honesty note (v13 doc §40): in 'os' mode the jail is a kernel fact; in
 * 'policy' mode the allowlist keeps the surface to declared programs — a
 * compromised allowlisted binary is out of the port's guarantee scope. The
 * Windows host's adapter (PowerShell jobs) implements this same interface.
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, statSync, readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';

const UNSHARE = '/usr/bin/unshare';
const DASH = '/bin/sh';

/** Busybox applets usable in 'os' mode (the chroot root sees only these). */
const BUSYBOX_APPLETS = Object.freeze([
  'ls', 'cat', 'head', 'tail', 'wc', 'echo', 'sh', 'sleep', 'rm', 'env',
  'pwd', 'mkdir', 'cp', 'mv', 'grep', 'sort', 'uniq', 'uname', 'date', 'df', 'du',
]);

/** Extra programs available only in 'policy' mode (not busybox applets). */
const POLICY_ONLY_PROGRAMS = Object.freeze(['node', 'npm']);

const MINIMAL_ENV = Object.freeze({
  PATH: '/usr/local/bin:/usr/bin:/bin',
  LANG: 'C',
});

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_OUTPUT_BYTES = 1_000_000;
const MAX_ARGS = 100;
const MAX_ARG_BYTES = 4096;
const MAX_HASH_FILE_BYTES = 2_000_000;
const MAX_TREE_FILES = 5000;
const MAX_TREE_DEPTH = 12;

const sha256hex = (data) => createHash('sha256').update(data).digest('hex');
const runId = () => `run:${randomBytes(8).toString('base64url')}`;

/**
 * Canonical form of a command: the string the approval binds to.
 * Human-readable AND unambiguous enough for the exact-match contract:
 * `program` + space + args joined by spaces. (The approval is granted for the
 * descriptor it was shown; consuming a different descriptor is a
 * NEXA_E_APPROVAL_TARGET, enforced here and by the approval ledger upstream.)
 */
export function canonicalTarget(program, args) {
  return args.length > 0 ? `${program} ${args.join(' ')}` : program;
}

/** Canonical diff form (sorted arrays, fixed key order) — the digest commits to this. */
export function canonicalDiff({ added, changed, removed }) {
  return JSON.stringify({
    added: [...added].sort(),
    changed: [...changed].sort(),
    removed: [...removed].sort(),
  });
}

/** Snapshot a jail tree: relpath → sha256hex (or `size:<n>` for large files). */
function snapshotTree(root, skipNames = new Set()) {
  const map = new Map();
  let count = 0;
  const walk = (dir, rel, depth) => {
    if (depth > MAX_TREE_DEPTH || count >= MAX_TREE_FILES) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (count >= MAX_TREE_FILES) return;
      if (skipNames.has(entry.name)) continue;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs, relPath, depth + 1);
      } else if (entry.isFile()) {
        count += 1;
        let size = 0;
        try {
          size = statSync(abs).size;
        } catch {
          continue;
        }
        if (size > MAX_HASH_FILE_BYTES) {
          map.set(relPath, `size:${size}`);
        } else {
          try {
            map.set(relPath, sha256hex(readFileSync(abs)));
          } catch {
            map.set(relPath, 'unreadable');
          }
        }
      }
    }
  };
  walk(root, '', 0);
  return map;
}

function diffTrees(pre, post) {
  const added = [];
  const removed = [];
  const changed = [];
  for (const [path, hash] of post) {
    if (!pre.has(path)) added.push(path);
    else if (pre.get(path) !== hash) changed.push(path);
  }
  for (const path of pre.keys()) {
    if (!post.has(path)) removed.push(path);
  }
  return { added, removed, changed };
}

/** Argument validation: relative paths only, no control characters. */
function validateArgs(args) {
  if (!Array.isArray(args) || args.length > MAX_ARGS) {
    throw { code: 'NEXA_E_SCHEMA', message: `args must be an array of ≤ ${MAX_ARGS} strings` };
  }
  for (const arg of args) {
    if (typeof arg !== 'string' || arg.length > MAX_ARG_BYTES) {
      throw { code: 'NEXA_E_SCHEMA', message: 'args must be strings ≤ 4096 bytes' };
    }
    if (arg.includes('\n') || arg.includes('\r') || arg.includes('\0')) {
      throw { code: 'NEXA_E_SCHEMA', message: 'control characters are not allowed in arguments' };
    }
    const segments = arg.split(sep);
    if (segments.includes('..')) {
      throw { code: 'NEXA_E_TERMINAL_JAIL', message: `argument "${arg}" tries to escape the jail (.. segment)` };
    }
    if (arg.startsWith('/')) {
      throw { code: 'NEXA_E_TERMINAL_JAIL', message: `argument "${arg}" is an absolute path — only relative paths (inside the jail) are allowed` };
    }
  }
}

/** Program validation: bare name on the allowlist. */
function validateProgram(program, allowedPrograms) {
  if (typeof program !== 'string' || !/^[a-z][a-z0-9_-]*$/.test(program)) {
    throw { code: 'NEXA_E_SCHEMA', message: `program must be a bare lowercase name (got ${JSON.stringify(program)})` };
  }
  if (!allowedPrograms.includes(program)) {
    throw { code: 'NEXA_E_TERMINAL_UNALLOWED', message: `program "${program}" is not in the allowlist [${allowedPrograms.join(', ')}]` };
  }
}

/**
 * The constant wrapper for 'os' mode. $BUSYBOX is inlined (port-owned, not
 * user input); user input enters only as positional parameters. NOTE: in
 * `sh -c` mode `shift` does not touch $0 — it drops $1 — so the program is
 * captured before the single shift (verified against dash).
 */
const osWrapper = (busyboxPath) =>
  'J="$0"; P="$1"; shift; ' +
  'mount --bind "$J" "$J" || exit 90; ' +
  `touch "$J/busybox"; mount --bind ${JSON.stringify(busyboxPath)} "$J/busybox" || exit 91; ` +
  '"$J/busybox" chroot "$J" /busybox "$P" "$@"';

export function createTerminalPort({
  jailRoot,
  allowedPrograms,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxOutputBytes = MAX_OUTPUT_BYTES,
  busyboxPath = '/usr/bin/busybox',
  sandbox = 'auto',
} = {}) {
  const defaultTimeout = timeoutMs;
  if (typeof jailRoot !== 'string' || jailRoot.length === 0) {
    throw new Error('jailRoot is required');
  }
  mkdirSync(jailRoot, { recursive: true });

  // Auto-detect the OS sandbox: userns must work AND busybox must exist.
  let mode = sandbox;
  if (mode === 'auto') {
    let ok = false;
    if (existsSync(UNSHARE) && existsSync(busyboxPath)) {
      const probe = spawnSync(UNSHARE, ['-U', '-r', 'true'], { stdio: 'ignore' });
      ok = probe.status === 0;
    }
    mode = ok ? 'os' : 'policy';
  }
  if (mode !== 'os' && mode !== 'policy') {
    throw new Error(`unknown sandbox mode ${mode}`);
  }
  const programs = allowedPrograms ?? (mode === 'os' ? [...BUSYBOX_APPLETS] : [...BUSYBOX_APPLETS, ...POLICY_ONLY_PROGRAMS]);

  const statsState = { runs: 0, timedOut: 0, refusals: 0 };

  const exec = (descriptor, { timeoutMs: timeoutArg = defaultTimeout, expectedTarget, evidenceRef } = {}) =>
    new Promise((resolve, reject) => {
      const refuse = (code, message) => {
        statsState.refusals += 1;
        const error = new Error(message);
        error.code = code;
        reject(error);
      };

      let program;
      let args;
      let target;
      try {
        program = descriptor?.program;
        args = descriptor?.args ?? [];
        validateProgram(program, programs);
        validateArgs(args);
        target = canonicalTarget(program, args);
        if (expectedTarget !== undefined && expectedTarget !== target) {
          return refuse('NEXA_E_APPROVAL_TARGET', `command ${JSON.stringify(target)} does not match the approved target ${JSON.stringify(expectedTarget)}`);
        }
        if (!Number.isSafeInteger(timeoutArg) || timeoutArg < 10 || timeoutArg > 10 * 60_000) {
          return refuse('NEXA_E_SCHEMA', `timeout must be a safe integer in [10, 600000] ms (got ${timeoutArg})`);
        }
      } catch (e) {
        return refuse(e.code, e.message);
      }

      // Snapshot before the run.
      const pre = snapshotTree(jailRoot, mode === 'os' ? new Set(['busybox']) : new Set());

      let command;
      let spawnArgs;
      if (mode === 'os') {
        command = UNSHARE;
        spawnArgs = ['-U', '-r', '-m', '--', DASH, '-c', osWrapper(busyboxPath), jailRoot, program, ...args];
      } else {
        command = program;
        spawnArgs = [...args];
      }

      const child = spawn(command, spawnArgs, {
        cwd: mode === 'os' ? '/' : jailRoot,
        env: { ...MINIMAL_ENV, HOME: jailRoot },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true, // own process group → the timeout kill reaches every descendant
      });

      const startedAt = Date.now();
      let timedOut = false;
      let stdout = '';
      let stderr = '';
      let stdoutTruncated = false;
      let stderrTruncated = false;
      let settled = false;

      const timer = setTimeout(() => {
        timedOut = true;
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          try {
            child.kill('SIGKILL');
          } catch {
            /* already gone */
          }
        }
      }, timeoutArg);

      const capAppend = (current, data) => {
        const next = current + data.toString('utf8');
        if (Buffer.byteLength(next, 'utf8') > maxOutputBytes) {
          return { text: Buffer.from(next, 'utf8').subarray(0, maxOutputBytes).toString('utf8'), truncated: true };
        }
        return { text: next, truncated: false };
      };
      child.stdout.on('data', (data) => {
        if (stdoutTruncated) return;
        const next = capAppend(stdout, data);
        stdout = next.text;
        stdoutTruncated = next.truncated;
      });
      child.stderr.on('data', (data) => {
        if (stderrTruncated) return;
        const next = capAppend(stderr, data);
        stderr = next.text;
        stderrTruncated = next.truncated;
      });

      const finish = (code, signal) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        const post = snapshotTree(jailRoot, mode === 'os' ? new Set(['busybox']) : new Set());
        const { added, removed, changed } = diffTrees(pre, post);
        statsState.runs += 1;
        if (timedOut) statsState.timedOut += 1;
        const id = evidenceRef ?? runId();
        const diff = {
          added,
          removed,
          changed,
          digest: `sha256:${sha256hex(Buffer.from(canonicalDiff({ added, removed, changed }), 'utf8'))}`,
        };
        resolve({
          ok: true,
          runId: id,
          sandbox: mode,
          program,
          args,
          target,
          exitCode: timedOut ? null : code,
          timedOut,
          durationMs: Date.now() - startedAt,
          stdout,
          stderr,
          stdoutTruncated,
          stderrTruncated,
          stdoutHash: `sha256:${sha256hex(Buffer.from(stdout, 'utf8'))}`,
          stderrHash: `sha256:${sha256hex(Buffer.from(stderr, 'utf8'))}`,
          diff,
          evidenceRef: `evidence:terminal:${id}`,
        });
      };

      child.on('error', (err) => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          statsState.refusals += 1;
          const error = new Error(`spawn failed: ${err.message}`);
          error.code = 'NEXA_E_HANDLER';
          reject(error);
        }
      });
      child.on('close', (code, signal) => finish(code, signal));
    });

  return {
    exec,
    get sandbox() {
      return mode;
    },
    stats() {
      return {
        ...statsState,
        sandbox: mode,
        jailRoot,
        allowedPrograms: [...programs],
        timeoutMs,
      };
    },
  };
}
