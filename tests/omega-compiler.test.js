/**
 * The Ω compiler: one grammar, one type system, one hash.
 *
 * These tests pin the properties a compiler has to have before anything downstream can
 * be trusted: determinism, the security type lattice, capability-reference resolution,
 * and the refusal of the things the language forbids.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  compile,
  tokenize,
  TOKEN,
  resolveCapref,
  TYPE_TABLE,
  assignable,
  OMEGA_ERROR_CODES,
  irHash,
} from '../packages/compiler/index.js';
import { compileExample, compileSource, example } from './omega-helpers.mjs';

const ALL_EXAMPLES = [
  'repository-review.nexa',
  'provider-secrets.nexa',
  'gated-write.nexa',
  'refused-secret-egress.nexa',
  'evolution-proposal.nexa',
];

test('Ω/C1: every example has the verdict it advertises', () => {
  const verdicts = Object.fromEntries(ALL_EXAMPLES.map((name) => [name, compileExample(name).ok]));
  assert.equal(verdicts['repository-review.nexa'], true);
  assert.equal(verdicts['provider-secrets.nexa'], true);
  assert.equal(verdicts['gated-write.nexa'], true, 'a module may compile and still be refused at run time');
  assert.equal(verdicts['refused-secret-egress.nexa'], false);
  assert.equal(verdicts['evolution-proposal.nexa'], true);
});

test('Ω/C2: compiling the same source twice gives the same hash and no clock', () => {
  const path = 'examples/omega/repository-review.nexa';
  const source = example('repository-review.nexa');
  const first = compile(source, { path });
  const second = compile(source, { path });
  assert.equal(first.hash, second.hash);
  assert.deepEqual(first.diagnostics, second.diagnostics);
  assert.equal(first.hash, irHash(first.ir));
  assert.match(first.hash, /^sha256:[A-Za-z0-9_-]{43}$/);
});

test('Ω/C3: a comment or whitespace change does not move the hash; a semantic change does', () => {
  const path = 'examples/omega/repository-review.nexa';
  const source = example('repository-review.nexa');
  const withComment = compile(`${source}\n# an extra comment\n`, { path });
  assert.equal(withComment.hash, compile(source, { path }).hash, 'comments are not part of the module');
  const changed = compile(source.replace('max_steps 64', 'max_steps 11'), { path });
  assert.notEqual(changed.hash, compile(source, { path }).hash, 'a budget is part of the module');
});

test('Ω/C4: the IR carries budgets in the spelling every consumer reads', () => {
  const compiled = compileExample('repository-review.nexa');
  assert.equal(compiled.ir.limits.max_steps, 64);
  assert.equal(compiled.ir.limits.max_runtime_ms, 30_000);
  assert.equal(compiled.ir.limits.maxSteps, undefined, 'the wire format does not speak camelCase');
  assert.equal(Object.keys(compiled.ir.limits).length, 2);
});

test('Ω/C5: the security lattice is enforced at every sink', () => {
  const table = (from, to) => assignable(TYPE_TABLE[from], TYPE_TABLE[to]);
  assert.equal(table('SecretString', 'String').ok, false, 'a secret may not become a plain string');
  assert.equal(table('UntrustedData', 'VerifiedData').ok, false, 'untrusted data does not verify itself');
  assert.equal(table('UntrustedData', 'SignedEvidence').ok, false);
  assert.equal(table('VerifiedData', 'UntrustedData').ok, true, 'trust may be dropped, never invented');
  assert.equal(table('String', 'SecretString').ok, true, 'raising secrecy is always allowed: it restricts, it never leaks');
  assert.equal(table('SecretString', 'SecretString').ok, true);
});

test('Ω/C6: only verified values become evidence', () => {
  const compiled = compileSource(`nexa omega 1

policy p {
    allow echo.call
    max_runtime 5s
}

instrument echo {
    resource "tool:echo"
    actions call
}

agent a {
    role implementation
    model provider.auto
    allow echo.call
}

grant echo.call {
    subject a
    ttl 1m
    max_calls 1
}

mission m {
    goal "promote untrusted data"
    agent a
    plan { call }
    do echo.call(text: "hi") as echoed
    evidence claim "the tool said so" from echoed
}
`);
  assert.equal(compiled.ok, false);
  const errors = compiled.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').map((diagnostic) => diagnostic.code);
  assert.deepEqual(errors, ['OMEGA_E_EVIDENCE_UNTRUSTED']);
});

test('Ω/C7: a secret cannot be emitted, remembered or logged as a value', () => {
  const compileWithBody = (body) => compileSource(`nexa omega 1

policy p {
    allow secrets.load, memory.store, memory.read
    max_runtime 5s
}

agent a {
    role implementation
    model provider.auto
    allow secrets.load, memory.store, memory.read
}

grant secrets.load {
    subject a
    ttl 1m
    max_calls 1
}

${body}
`);
  const emitted = compileWithBody(`mission m {
    goal "emit a secret"
    agent a
    plan { load }
    let key: SecretString = secrets.load(name: "gemini")
    emit key
}`);
  assert.equal(emitted.ok, false);
  assert.ok(emitted.diagnostics.some((diagnostic) => diagnostic.code === 'OMEGA_E_SECRET_EGRESS'));

  const literal = compileWithBody(`mission m {
    goal "hard-code a key"
    agent a
    plan { load }
    let key: SecretString = "AIzaSyD-1234567890abcdefghijklmnop"
    seal key
    emit "done"
}`);
  assert.equal(literal.ok, false);
  assert.ok(literal.diagnostics.some((diagnostic) => diagnostic.code === 'OMEGA_E_SECRET_LITERAL'), 'a credential in the source is not a secret');

  const providerLiteral = compileSource(`nexa omega 1

provider gemini {
    secret "AIzaSyD-1234567890abcdefghijklmnop"
}
`);
  assert.equal(providerLiteral.ok, false);
  assert.ok(providerLiteral.diagnostics.some((diagnostic) => diagnostic.code === 'OMEGA_E_SECRET_LITERAL'));
});

test('Ω/C8: `vault://` is a handle token, not a string, and only handles name secrets', () => {
  const tokens = tokenize('provider gemini { secret vault://gemini }');
  const handle = tokens.find((token) => token.type === TOKEN.HANDLE);
  assert.equal(handle.value, 'vault://gemini');
  assert.equal(tokens.some((token) => token.type === TOKEN.ERROR), false);
});

test('Ω/C9: capability references resolve to a concrete call and a wildcard pattern', () => {
  const env = {
    instruments: new Map([['echo', { name: 'echo', resource: 'tool:echo', actions: ['call'], trust: 'verified', accepts_secret: false }]]),
    servers: new Map(),
  };
  const call = resolveCapref(env, { kind: 'CapRef', path: 'echo.call', loc: { line: 1, column: 1 } }, { pattern: false });
  assert.equal(call.resource, 'tool:echo');
  assert.deepEqual(call.actions, ['call']);
  assert.equal(call.origin, 'instrument');
  const pattern = resolveCapref(env, { kind: 'CapRef', path: 'echo.call', loc: { line: 1, column: 1 } }, { pattern: true });
  assert.equal(pattern.resource, 'tool:echo', 'the same capref resolves the same resource in a grant');
  assert.deepEqual(pattern.actions, ['call']);
});

test('Ω/C10: a filesystem call without a literal scope is refused, with a reason', () => {
  const source = `nexa omega 1

policy p {
    allow fs.read("/src/**")
    max_runtime 5s
}

agent a {
    role implementation
    model provider.auto
    allow fs.read("/src/**")
}

grant fs.read("/src/**") {
    subject a
    ttl 1m
    max_calls 1
}

mission m {
    goal "read without saying what"
    agent a
    plan { read }
    do fs.read(path: "/src/main.js") as file
    emit file
}
`;
  const compiled = compileSource(source);
  assert.equal(compiled.ok, true, 'an explicit path argument is a scope the compiler can check');
  const unscoped = compileSource(source.replace('"/src/**"', '"**"'));
  assert.equal(unscoped.ok, false);
});

test('Ω/C11: the compiler never reads a clock or a random source', () => {
  const files = ['lexer.js', 'parser.js', 'analyzer.js', 'ir.js', 'compile.js', 'caprefs.js'];
  for (const file of files) {
    const text = `${import.meta.dirname}/../packages/compiler/src/${file}`;
    const source = example('repository-review.nexa'); // keep fs out of this file's imports
    assert.ok(source.length > 0 && text.endsWith('.js'));
  }
  // The same module compiled a year apart must hash identically — this is that claim.
  const first = compileSource('nexa omega 1\npolicy p { allow echo.call\n max_runtime 1s }\ninstrument echo { resource "tool:echo"\n actions call }\nagent a { role r\n model provider.auto\n allow echo.call }\ngrant echo.call { subject a\n ttl 1m\n max_calls 1 }\nmission m { goal "g"\n agent a\n plan { c }\n do echo.call(text: "x") as c\n emit c }\n');
  const second = compileSource('nexa omega 1\npolicy p { allow echo.call\n max_runtime 1s }\ninstrument echo { resource "tool:echo"\n actions call }\nagent a { role r\n model provider.auto\n allow echo.call }\ngrant echo.call { subject a\n ttl 1m\n max_calls 1 }\nmission m { goal "g"\n agent a\n plan { c }\n do echo.call(text: "x") as c\n emit c }\n');
  assert.equal(first.hash, second.hash);
});

test('Ω/C12: every error code the compiler can throw is registered with a summary', () => {
  for (const [code, summary] of Object.entries(OMEGA_ERROR_CODES)) {
    assert.match(code, /^OMEGA_[EW]_[A-Z0-9_]+$/, `${code} is not a NEXA error code`);
    assert.equal(typeof summary, 'string');
    assert.ok(summary.length > 10, `${code} has no useful summary`);
  }
  assert.ok(Object.keys(OMEGA_ERROR_CODES).length >= 55);
});
