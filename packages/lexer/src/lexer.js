/**
 * Lexer for `.nex` — NEXA's human-readable wire syntax.
 *
 * The canonical wire format is NEXA-C14N (see packages/ast); `.nex` exists so that
 * operators can read, diff and hand-write envelopes without a JSON toolchain. The
 * two forms are losslessly interconvertible; only the canonical form is signed.
 */
import { NexaError } from '../../ast/index.js';
import { TOKEN, token } from './token.js';

const IDENT_START = /[\p{L}_]/u;
const IDENT_PART = /[\p{L}\p{N}_.-]/u;
const DOTTED = /[\p{L}\p{N}_.-]/u;

const ESCAPES = Object.freeze({
  n: '\n',
  t: '\t',
  r: '\r',
  '"': '"',
  '\\': '\\',
  '/': '/',
  b: '\b',
  f: '\f',
});

/**
 * @param {string} source
 * @returns {{type: string, value: string, line: number, column: number}[]} tokens, NEWLINEs included, EOF last
 */
export function tokenize(source) {
  if (typeof source !== 'string') {
    throw new NexaError('NEXA_E_PARSE', 'source must be a string');
  }
  const tokens = [];
  let index = 0;
  let line = 1;
  let column = 1;

  const peek = (offset = 0) => source[index + offset];
  const advance = () => {
    const char = source[index];
    index += 1;
    if (char === '\n') {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
    return char;
  };

  while (index < source.length) {
    const char = peek();

    if (char === '\r') {
      advance();
      continue;
    }
    if (char === ' ' || char === '\t') {
      advance();
      continue;
    }
    if (char === '\n') {
      tokens.push(token(TOKEN.NEWLINE, '\n', line, column));
      advance();
      continue;
    }
    if (char === '#') {
      while (index < source.length && peek() !== '\n') advance();
      continue;
    }
    if (char === '{') {
      tokens.push(token(TOKEN.LBRACE, '{', line, column));
      advance();
      continue;
    }
    if (char === '}') {
      tokens.push(token(TOKEN.RBRACE, '}', line, column));
      advance();
      continue;
    }
    if (char === '[') {
      tokens.push(token(TOKEN.LBRACKET, '[', line, column));
      advance();
      continue;
    }
    if (char === ']') {
      tokens.push(token(TOKEN.RBRACKET, ']', line, column));
      advance();
      continue;
    }
    if (char === '"') {
      const startLine = line;
      const startColumn = column;
      advance(); // opening quote
      let text = '';
      let closed = false;
      while (index < source.length) {
        const current = peek();
        if (current === '"') {
          advance();
          closed = true;
          break;
        }
        if (current === '\n') {
          throw new NexaError('NEXA_E_PARSE', 'unterminated string literal', { line: startLine, column: startColumn });
        }
        if (current === '\\') {
          advance();
          const escape = advance();
          if (escape === 'u') {
            const hex = source.slice(index, index + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
              throw new NexaError('NEXA_E_PARSE', 'invalid \\u escape; expected four hex digits', { line, column });
            }
            text += String.fromCharCode(Number.parseInt(hex, 16));
            index += 4;
            column += 4;
            continue;
          }
          const mapped = ESCAPES[escape];
          if (mapped === undefined) {
            throw new NexaError('NEXA_E_PARSE', `unknown escape sequence \\${escape}`, { line, column });
          }
          text += mapped;
          continue;
        }
        text += advance();
      }
      if (!closed) {
        throw new NexaError('NEXA_E_PARSE', 'unterminated string literal', { line: startLine, column: startColumn });
      }
      tokens.push(token(TOKEN.STRING, text, startLine, startColumn));
      continue;
    }
    if (char === '@') {
      const startLine = line;
      const startColumn = column;
      advance();
      let name = '';
      while (index < source.length && DOTTED.test(peek())) name += advance();
      if (name.length === 0 || !IDENT_START.test(name[0])) {
        throw new NexaError('NEXA_E_PARSE', 'directive name must start with a letter', { line: startLine, column: startColumn });
      }
      tokens.push(token(TOKEN.DIRECTIVE, name, startLine, startColumn));
      continue;
    }
    if (char === '-' || (char >= '0' && char <= '9')) {
      const startLine = line;
      const startColumn = column;
      let text = '';
      if (char === '-') text += advance();
      if (!(peek() >= '0' && peek() <= '9')) {
        throw new NexaError('NEXA_E_PARSE', 'a minus sign must be followed by a digit', { line: startLine, column: startColumn });
      }
      while (index < source.length && peek() >= '0' && peek() <= '9') text += advance();
      if (peek() === '.' && peek(1) >= '0' && peek(1) <= '9') {
        text += advance();
        while (index < source.length && peek() >= '0' && peek() <= '9') text += advance();
        tokens.push(token(TOKEN.VERSION, text, startLine, startColumn));
        continue;
      }
      tokens.push(token(TOKEN.INTEGER, text, startLine, startColumn));
      continue;
    }
    if (IDENT_START.test(char)) {
      const startLine = line;
      const startColumn = column;
      let name = '';
      while (index < source.length && IDENT_PART.test(peek())) name += advance();
      tokens.push(token(TOKEN.IDENT, name, startLine, startColumn));
      continue;
    }
    throw new NexaError('NEXA_E_PARSE', `unexpected character ${JSON.stringify(char)}`, { line, column });
  }

  tokens.push(token(TOKEN.EOF, '', line, column));
  return tokens;
}
