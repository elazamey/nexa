/**
 * Parser: `.nex` text -> NEXA document AST.
 *
 *   nexa 0.1
 *   @type CALL
 *   @id urn:nexa:msg:abc
 *   ...
 *   body {
 *     resource "tool:echo"
 *     action "call"
 *     args { text "hi" }
 *   }
 *   sig {
 *     alg ed25519
 *     kid nexa:key:ed25519:z...
 *     val <base64url>
 *   }
 *
 * The AST is a plain object; `toEnvelope` maps it onto the envelope schema.
 */
import { NexaError } from '../../ast/index.js';
import { TOKEN, tokenize } from '../../lexer/index.js';

const HEADER_BY_DIRECTIVE = Object.freeze({
  type: 'type',
  id: 'id',
  from: 'from',
  to: 'to',
  ts: 'ts',
  exp: 'exp',
  nonce: 'nonce',
  cap: 'cap',
  in_reply_to: 'in_reply_to',
});

const BLOCKS = Object.freeze(['body', 'sig']);

class Cursor {
  constructor(tokens, source) {
    this.tokens = tokens.filter((item) => item.type !== TOKEN.NEWLINE);
    this.source = source;
    this.index = 0;
  }

  peek(offset = 0) {
    return this.tokens[Math.min(this.index + offset, this.tokens.length - 1)];
  }

  next() {
    const current = this.peek();
    if (current.type !== TOKEN.EOF) this.index += 1;
    return current;
  }

  expect(type, what) {
    const current = this.peek();
    if (current.type !== type) {
      throw new NexaError(
        'NEXA_E_PARSE',
        `expected ${what ?? type}, found ${current.type === TOKEN.EOF ? 'end of input' : JSON.stringify(current.value)}`,
        { line: current.line, column: current.column },
      );
    }
    return this.next();
  }

  fail(message) {
    const current = this.peek();
    throw new NexaError('NEXA_E_PARSE', message, { line: current.line, column: current.column });
  }
}

function parseValue(cursor) {
  const current = cursor.peek();
  switch (current.type) {
    case TOKEN.STRING:
      return cursor.next().value;
    case TOKEN.INTEGER: {
      const text = cursor.next().value;
      const value = Number(text);
      if (!Number.isSafeInteger(value)) {
        cursor.fail(`integer ${text} is outside the safe range`);
      }
      return value;
    }
    case TOKEN.IDENT: {
      // Bare words are strings — unless they are one of the three reserved values.
      const word = cursor.next().value;
      if (word === 'null') return null;
      if (word === 'true') return true;
      if (word === 'false') return false;
      return word;
    }
    case TOKEN.VERSION:
      cursor.fail('NEXA has no floating-point values; only safe integers are allowed');
      return undefined;
    case TOKEN.LBRACE:
      return parseObject(cursor);
    case TOKEN.LBRACKET:
      return parseArray(cursor);
    default:
      cursor.fail(`expected a value, found ${current.type === TOKEN.EOF ? 'end of input' : JSON.stringify(current.value)}`);
      return undefined;
  }
}

function parseObject(cursor) {
  cursor.expect(TOKEN.LBRACE, '{');
  const object = {};
  while (cursor.peek().type !== TOKEN.RBRACE) {
    if (cursor.peek().type === TOKEN.EOF) cursor.fail('unterminated object literal');
    const keyToken = cursor.peek();
    if (keyToken.type !== TOKEN.IDENT && keyToken.type !== TOKEN.STRING) {
      cursor.fail(`expected an object key, found ${JSON.stringify(keyToken.value)}`);
    }
    cursor.next();
    const key = keyToken.value;
    if (Object.hasOwn(object, key)) {
      throw new NexaError('NEXA_E_PARSE', `duplicate key ${JSON.stringify(key)}`, {
        line: keyToken.line,
        column: keyToken.column,
      });
    }
    object[key] = parseValue(cursor);
  }
  cursor.expect(TOKEN.RBRACE, '}');
  return object;
}

function parseArray(cursor) {
  cursor.expect(TOKEN.LBRACKET, '[');
  const items = [];
  while (cursor.peek().type !== TOKEN.RBRACKET) {
    if (cursor.peek().type === TOKEN.EOF) cursor.fail('unterminated array literal');
    items.push(parseValue(cursor));
  }
  cursor.expect(TOKEN.RBRACKET, ']');
  return items;
}

/**
 * @param {string} source
 * @returns {{version: string, headers: object, blocks: object}}
 */
export function parseDocument(source) {
  const cursor = new Cursor(tokenize(source), source);
  const versionToken = cursor.peek();
  if (versionToken.type !== TOKEN.IDENT || versionToken.value !== 'nexa') {
    cursor.fail('a .nex document must begin with "nexa <version>"');
  }
  cursor.next();
  const versionNode = cursor.peek();
  if (versionNode.type !== TOKEN.VERSION && versionNode.type !== TOKEN.STRING) {
    cursor.fail('the version must look like 0.1');
  }
  const version = String(cursor.next().value);

  const headers = {};
  const blocks = {};
  for (;;) {
    const current = cursor.peek();
    if (current.type === TOKEN.EOF) break;
    if (current.type === TOKEN.DIRECTIVE) {
      const name = cursor.next().value;
      if (!Object.hasOwn(HEADER_BY_DIRECTIVE, name)) {
        cursor.fail(`unknown directive @${name}`);
      }
      if (Object.hasOwn(headers, name)) {
        cursor.fail(`duplicate directive @${name}`);
      }
      headers[name] = parseValue(cursor);
      continue;
    }
    if (current.type === TOKEN.IDENT && BLOCKS.includes(current.value)) {
      const name = cursor.next().value;
      if (Object.hasOwn(blocks, name)) {
        cursor.fail(`duplicate block ${name}`);
      }
      blocks[name] = parseObject(cursor);
      continue;
    }
    cursor.fail(`expected a directive or block, found ${JSON.stringify(current.value)}`);
  }
  return { version, headers, blocks };
}

/** @param {{version: string, headers: object, blocks: object}} document @returns {object} envelope */
export function toEnvelope(document) {
  const { version, headers, blocks } = document;
  if (version !== '0.1') {
    throw new NexaError('NEXA_E_SCHEMA', `unsupported .nex version: ${version}`);
  }
  if (blocks.body === undefined) {
    throw new NexaError('NEXA_E_SCHEMA', 'a .nex document must contain a body block');
  }
  const forEnvelope = {
    nexa: version,
    type: headers.type,
    id: headers.id,
    from: headers.from,
    to: headers.to,
    ts: headers.ts,
    exp: headers.exp,
    nonce: headers.nonce,
  };
  if (headers.cap !== undefined) forEnvelope.cap = headers.cap;
  if (headers.in_reply_to !== undefined) forEnvelope.in_reply_to = headers.in_reply_to;
  forEnvelope.body = blocks.body;
  if (blocks.sig !== undefined) forEnvelope.sig = blocks.sig;
  return forEnvelope;
}

/**
 * @param {string} source
 * @returns {object} envelope (structure not yet validated — run validateEnvelope)
 */
export function parseNex(source) {
  return toEnvelope(parseDocument(source));
}
