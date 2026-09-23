/**
 * tests/bootstrap.mjs — mandatory test-output isolation (D1.9 closure).
 *
 * Loaded before every test process via `node --import ./tests/bootstrap.mjs --test`
 * (wired in package.json `test` / `audit` scripts). Redirects all hunter/memory
 * file outputs to unique per-process tmp paths so the suite never mutates
 * tracked files (dashboard/data/*) — no post-run restore needed.
 *
 * Explicit env always wins: we only fill absent values, so CI overrides keep
 * working. Production/deploy entry points (server, bughunter CLI, Pages build)
 * do not load this file and keep their dashboard/data defaults.
 *
 * NOTE: the suite entry point is `npm test` / `npm run audit`. A bare
 * `node --test` bypasses this bootstrap (documented, not supported).
 */
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scope = `nexa-test-${process.pid}`;
process.env.NEXA_HUNT_MEMORY ??= join(tmpdir(), scope, 'hunt-memory.json');
process.env.NEXA_BUG_REPORT ??= join(tmpdir(), scope, 'bug-report.json');
