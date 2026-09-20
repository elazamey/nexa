// H3's separate OS process. Runs only against the hardening fixture's temp root.
import assert from 'node:assert/strict';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const [root, file, content] = process.argv.slice(2);
assert.ok(basename(root).startsWith('nexa-commit-hardening-'));
assert.equal(realpathSync(root), resolve(root));
assert.ok(['a.txt', 'b.txt'].includes(file));
const target = join(root, file);
const before = readFileSync(target, 'utf8');
writeFileSync(target, content);
const after = readFileSync(target, 'utf8');
process.stdout.write(JSON.stringify({ pid: process.pid, before, after }));
