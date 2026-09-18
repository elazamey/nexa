import test from 'node:test';
import assert from 'node:assert/strict';

import { tokenize, TOKEN } from '../packages/lexer/index.js';
import { printNex, parseNex, parseDocument, printObject } from '../packages/parser/index.js';
import { canonicalize, validateEnvelope } from '../packages/ast/index.js';
import { throwsCode, world, capabilityFor } from './helpers.mjs';

test('the lexer produces the documented token stream', () => {
  const tokens = tokenize('nexa 0.1\n@type CALL\n# comment\nbody { a "b" 1 [2] { } }\n');
  assert.deepEqual(
    tokens.map((token) => token.type),
    [
      TOKEN.IDENT, TOKEN.VERSION, TOKEN.NEWLINE,
      TOKEN.DIRECTIVE, TOKEN.IDENT, TOKEN.NEWLINE,
      TOKEN.NEWLINE,
      TOKEN.IDENT, TOKEN.LBRACE, TOKEN.IDENT, TOKEN.STRING, TOKEN.INTEGER,
      TOKEN.LBRACKET, TOKEN.INTEGER, TOKEN.RBRACKET, TOKEN.LBRACE, TOKEN.RBRACE, TOKEN.RBRACE,
      TOKEN.NEWLINE, TOKEN.EOF,
    ],
  );
  const directive = tokens.find((token) => token.type === TOKEN.DIRECTIVE);
  assert.equal(directive.value, 'type');
  assert.equal(directive.line, 2);
});

test('a real call envelope survives a full text round-trip', () => {
  const scope = world();
  const capability = capabilityFor({ issuer: scope.operator, subject: scope.caller.kid });
  const envelope = scope.caller.call({ to: scope.agent.kid, resource: 'tool:echo', args: { text: 'hello "nexa"', n: -3, flag: true, tags: ['a', 'b'] }, capability });

  const text = printNex(envelope);
  const parsed = parseNex(text);
  assert.equal(canonicalize(parsed), canonicalize(envelope));
  assert.equal(printNex(parsed), text, 'printing is deterministic and idempotent');
  assert.equal(validateEnvelope(parsed).from, envelope.from);

  // The parsed form is not just equal — it still verifies, capability included.
  const decision = scope.endpoint.receive(parsed);
  assert.equal(decision.decision, 'ALLOW');
});

test('printing sorts keys so review diffs are stable', () => {
  const scope = world();
  const envelope = scope.caller.call({ to: scope.agent.kid, resource: 'tool:echo', args: { z: 1, a: 2, m: { y: 1, b: 2 } } });
  const text = printNex(envelope);
  assert.match(text, /^nexa 0\.1\n@type CALL\n@id /);

  // Top-level keys inside `body { ... }` appear in canonical order.
  const bodyLines = text.split('\n');
  const start = bodyLines.findIndex((row) => row.startsWith('body {'));
  const keys = [];
  for (const row of bodyLines.slice(start + 1)) {
    if (row === '}') break;
    // Two-space indentation, then `key value`: this is a top-level body key.
    if (/^ {2}[A-Za-z_][A-Za-z0-9_.-]* /.test(row)) keys.push(row.trim().split(' ')[0]);
  }
  assert.deepEqual(keys, [...keys].sort());
  assert.deepEqual(keys, ['action', 'args', 'resource']);
});

test('the parser refuses malformed documents with precise errors', () => {
  const cases = [
    ['', /must begin with/],
    ['nexa 0.1\n', /must contain a body block/],
    ['nexa x\nbody {}\n', /version must look like/],
    ['nexa 1.0\nbody {}\n', /unsupported .nex version/],
    ['nexa 0.1\n@bogus 1\nbody {}\n', /unknown directive @bogus/],
    ['nexa 0.1\n@type CALL\n@type CALL\nbody {}\n', /duplicate directive @type/],
    ['nexa 0.1\nbody {}\nbody {}\n', /duplicate block body/],
    ['nexa 0.1\nbody { a 1 a 2 }\n', /duplicate key/],
    ['nexa 0.1\nbody { a 1.5 }\n', /no floating-point values/],
    ['nexa 0.1\nbody { a "unterminated }\n', /unterminated string/],
    ['nexa 0.1\nbody { a "\\q" }\n', /unknown escape sequence/],
    ['nexa 0.1\nbody { a "\\u12" }\n', /invalid \\u escape/],
    ['nexa 0.1\nbody { a -}\n', /minus sign must be followed by a digit/],
    ['nexa 0.1\nbody { a $ }\n', /unexpected character/],
    ['nexa 0.1\nbody { a [1 2 }\n', /expected a value|expected \]|unterminated array/],
    ['nexa 0.1\nbody { a { b } }\n', /expected a value/],
    ['nexa 0.1\nbody\n', /expected \{/],
  ];
  for (const [source, pattern] of cases) {
    assert.throws(() => parseNex(source), pattern, `source: ${JSON.stringify(source)}`);
  }
});

test('parse errors carry line and column information', () => {
  try {
    parseNex('nexa 0.1\n@bogus 1\nbody {}\n');
    assert.fail('expected a parse error');
  } catch (error) {
    assert.equal(error.code, 'NEXA_E_PARSE');
    assert.equal(error.details.line, 2);
  }
});

test('bare words are strings; reserved words are values', () => {
  const document = parseDocument('nexa 0.1\nbody { a safe b null c true d 12 e "12" }\n');
  assert.deepEqual(document.blocks.body, { a: 'safe', b: null, c: true, d: 12, e: '12' });
});

test('control characters are escaped when printing and preserved when parsing', () => {
  const value = { s: 'line\nbreak\ttab\u0001' };
  const printed = printObject(value);
  assert.match(printed, /line\\nbreak\\ttab\\u0001/);
  const scope = world();
  const envelope = scope.caller.call({ to: scope.agent.kid, resource: 'tool:echo', args: value });
  assert.deepEqual(parseNex(printNex(envelope)).body.args, value);
});

test('the printer refuses values the data model does not allow', () => {
  throwsCode(assert, () => printNex({ nexa: '0.1', body: { a: 1.5 } }), 'NEXA_E_C14N_NUMBER');
  throwsCode(assert, () => printNex({ nexa: '0.1', body: {}, unknown_field: 1 }), 'NEXA_E_SCHEMA');
  assert.equal(printObject({}), '{}');
});
