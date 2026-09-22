#!/usr/bin/env node
/**
 * Refuse to build on a stale base.
 *
 * Written after the 2026-09 incident (docs/incidents/2026-09-local-revert.md),
 * where a commit was authored five commits behind the branch tip and nothing
 * local noticed: with no upstream configured, `git status` reports no "behind"
 * marker at all, and a stale base is indistinguishable from a current one.
 *
 * The rule this enforces: the absence of a warning is not evidence of being
 * current. So this asks the SERVER for the tip (`git ls-remote`, which needs no
 * refspec, no upstream and no local cache) and verifies HEAD descends from it.
 *
 * Exit codes: 0 in sync (or remote branch absent), 1 stale, 2 unknown.
 * An unreachable remote is UNKNOWN and is never reported as success.
 */
import { execFileSync } from 'node:child_process';

const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();

/**
 * P4: report uncommitted work before anything can discard it.
 *
 * Three times now, a command that looked like recovery was actually loss: a
 * stale-looking local copy, and twice `git checkout <file>` reverting a
 * mutation along with the real production change underneath it
 * (docs/incidents/2026-09-local-revert.md,
 *  docs/incidents/2026-09-fake-proof-endpoint.md).
 *
 * `git checkout -- <file>` has no undo. There is no reflog for the working
 * tree. So dirty files are named here, loudly, before any push or revert, and
 * the operator is told to run `git diff --stat` or `git stash` first.
 */
function reportDirtyFiles() {
  let status;
  try { status = git('status', '--porcelain'); }
  catch { return { known: false, files: [] }; }
  // The git() helper trims, so a leading-space code like " M" loses a column.
  // Parse on the separator instead of a fixed offset.
  const files = status.split('\n').filter(Boolean).map(line => {
    const match = /^(\S{1,2})\s+(.+)$/.exec(line.trim());
    return match ? { code: match[1], path: match[2] } : { code: '?', path: line.trim() };
  });
  const atRisk = files.filter(f => f.code.includes('M') || f.code.startsWith('??'));
  if (atRisk.length) {
    console.error('UNCOMMITTED WORK PRESENT — these files would be lost by `git checkout -- <file>`:');
    for (const f of atRisk) {
      console.error(`  ${f.code.startsWith('??') ? 'untracked' : 'modified '}  ${f.path}`);
    }
    console.error('\nBefore reverting any of them, run `git diff --stat` or `git stash`.');
    console.error('`git checkout -- <file>` is not recoverable, and it does not restore untracked files.\n');
  }
  return { known: true, files: atRisk };
}

function main() {
  const branch = process.argv[2] ?? git('rev-parse', '--abbrev-ref', 'HEAD');
  const head = git('rev-parse', 'HEAD');
  const dirty = reportDirtyFiles();
  // --strict makes the hazard blocking: refuse to report a clean sync while
  // uncommitted changes sit in the tree waiting to be clobbered.
  if (process.argv.includes('--strict') && dirty.files.length) {
    console.error(`BLOCKED: ${dirty.files.length} uncommitted file(s). Commit, stash, or pass without --strict.`);
    return 1;
  }

  let remote;
  try { remote = git('ls-remote', 'origin', `refs/heads/${branch}`); }
  catch (error) {
    console.error(`UNKNOWN: cannot reach origin (${error.code ?? error.message}).`);
    console.error('Not treated as success: an unverifiable state is not a verified one.');
    return 2;
  }

  if (!remote) {
    console.log(`OK: origin has no branch '${branch}' yet; HEAD ${head.slice(0, 7)} will create it.`);
    return 0;
  }

  const tip = remote.split(/\s+/)[0];
  if (tip === head) {
    console.log(`OK: in sync with origin/${branch} at ${head.slice(0, 7)}.`);
    return 0;
  }

  // The remote tip must be an ancestor of HEAD; otherwise the local work is
  // built on a base that is missing commits the server already has.
  let contains = false;
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', tip, head], { stdio: 'ignore' });
    contains = true;
  } catch { /* not an ancestor, or the object is not present locally */ }

  if (contains) {
    console.log(`OK: HEAD ${head.slice(0, 7)} is ahead of origin/${branch} ${tip.slice(0, 7)}.`);
    return 0;
  }

  console.error(`STALE: HEAD ${head.slice(0, 7)} does not contain origin/${branch} ${tip.slice(0, 7)}.`);
  try {
    execFileSync('git', ['fetch', '-q', 'origin', branch], { stdio: 'ignore' });
    const missing = git('log', '--oneline', `HEAD..${tip}`);
    if (missing) console.error(`\nCommits on the server that are missing locally:\n${missing}`);
  } catch { console.error('(could not list the missing commits)'); }
  console.error(`\nDo NOT merge blindly. Rebase onto the server tip:\n  git fetch origin ${branch}\n  git rebase --onto FETCH_HEAD <your-base> ${branch}`);
  return 1;
}

process.exit(main());
