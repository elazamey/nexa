/**
 * Lexer for `.nexa` modules.
 *
 * Newlines are tokens: statements are line-structured, so the parser needs to see
 * them. Inside `( … )` the parser skips them, which is what lets a call be wrapped
 * across lines without a semicolon.
 */
import { OmegaError } from './errors.js';

export const TOKEN = Object.freeze({
  IDENT: 'IDENT', // possibly dotted: fs.read, github.repository.read
  STRING: 'STRING', // "double quoted", no newlines
  INT: 'INT', // -?[0-9]+  (Ω has no floating point)
  DURATION: 'DURATION', // 30s, 10m, 2h, 500ms
  HANDLE: 'HANDLE', // vault://gemini — a secret *handle*, never a secret
  LBRACE: '{',
  RBRACE: '}',
  LPAREN: '(',
  RPAREN: ')',
  COMMA: ',',
  COLON: ':',
  EQ: '=',
  EQEQ: '==',
  NEQ: '!=',
  LT: '<',
  LE: '<=',
  GT: '>',
  GE: '>=',
  PLUS: '+',
  MINUS: '-',
  ARROW: '->',
  NEWLINE: 'NEWLINE',
  EOF: 'EOF',
});

const PUNCT = Object.freeze({
  '{': TOKEN.LBRACE,
  '}': TOKEN.RBRACE,
  '(': TOKEN.LPAREN,
  ')': TOKEN.RPAREN,
  ',': TOKEN.COMMA,
  ':': TOKEN.COLON,
  '+': TOKEN.PLUS,
});

const IDENT_START = /[\p{L}_]/u;
const IDENT_PART = /[\p{L}\p{N}_-]/u;
const DIGIT = /[0-9]/;

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

const DURATION_UNITS = Object.freeze({ ms: 1, s: 1000, m: 60_000, h: 3_600_000 });

/** Schemes a `secret` may name. Ω can hold a handle; it cannot hold a key. */
export const HANDLE_SCHEMES = Object.freeze(['vault', 'kms', 'envelope']);

/**
 * @param {string} source
 * @returns {{type: string, value: string, line: number, column: number, offset: number}[]}
 */
export function tokenize(source) {
  if (typeof source !== 'string') {
    throw new OmegaError('OMEGA_E_PARSE', 'source must be a string');
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
  const push = (type, value, atLine, atColumn, offset) => {
    tokens.push({ type, value, line: atLine, column: atColumn, offset });
  };

  while (index < source.length) {
    const char = peek();
    const startLine = line;
    const startColumn = column;
    const startOffset = index;

    if (char === '\r') {
      advance();
      continue;
    }
    if (char === ' ' || char === '\t') {
      advance();
      continue;
    }
    if (char === '\n') {
      push(TOKEN.NEWLINE, '\n', startLine, startColumn, startOffset);
      advance();
      continue;
    }
    if (char === '#') {
      while (index < source.length && peek() !== '\n') advance();
      continue;
    }
    if (Object.hasOwn(PUNCT, char)) {
      push(PUNCT[char], char, startLine, startColumn, startOffset);
      advance();
      continue;
    }
    if (char === '=') {
      advance();
      if (peek() === '=') {
        advance();
        push(TOKEN.EQEQ, '==', startLine, startColumn, startOffset);
      } else {
        push(TOKEN.EQ, '=', startLine, startColumn, startOffset);
      }
      continue;
    }
    if (char === '!') {
      advance();
      if (peek() !== '=') {
        throw new OmegaError('OMEGA_E_PARSE', '`!` must be followed by `=` (the only negation of a comparison is `!=`)', { line: startLine, column: startColumn });
      }
      advance();
      push(TOKEN.NEQ, '!=', startLine, startColumn, startOffset);
      continue;
    }
    if (char === '<' || char === '>') {
      advance();
      const isLess = char === '<';
      if (peek() === '=') {
        advance();
        push(isLess ? TOKEN.LE : TOKEN.GE, `${char}=`, startLine, startColumn, startOffset);
      } else {
        push(isLess ? TOKEN.LT : TOKEN.GT, char, startLine, startColumn, startOffset);
      }
      continue;
    }
    if (char === '-') {
      advance();
      if (peek() === '>') {
        advance();
        push(TOKEN.ARROW, '->', startLine, startColumn, startOffset);
        continue;
      }
      if (!DIGIT.test(peek() ?? '')) {
        push(TOKEN.MINUS, '-', startLine, startColumn, startOffset);
        continue;
      }
      let text = '-';
      while (DIGIT.test(peek() ?? '')) text += advance();
      push(TOKEN.INT, text, startLine, startColumn, startOffset);
      continue;
    }
    if (DIGIT.test(char)) {
      let text = '';
      while (DIGIT.test(peek() ?? '')) text += advance();
      if (peek() === '.' && DIGIT.test(peek(1) ?? '')) {
        throw new OmegaError('OMEGA_E_PARSE', 'Ω has no floating point; only integers', { line: startLine, column: startColumn });
      }
      let unit = '';
      for (const candidate of ['ms', 's', 'm', 'h']) {
        if (source.startsWith(candidate, index) && !IDENT_PART.test(source[index + candidate.length] ?? '')) {
          unit = candidate;
          break;
        }
      }
      if (unit === '') {
        push(TOKEN.INT, text, startLine, startColumn, startOffset);
      } else {
        for (let step = 0; step < unit.length; step += 1) advance();
        push(TOKEN.DURATION, `${text}${unit}`, startLine, startColumn, startOffset);
      }
      continue;
    }
    if (char === '"') {
      advance();
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
          throw new OmegaError('OMEGA_E_PARSE', 'unterminated string literal', { line: startLine, column: startColumn });
        }
        if (current === '\\') {
          advance();
          const escape = advance();
          if (escape === 'u') {
            const hex = source.slice(index, index + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
              throw new OmegaError('OMEGA_E_PARSE', 'invalid \\u escape; expected four hex digits', { line, column });
            }
            text += String.fromCharCode(Number.parseInt(hex, 16));
            index += 4;
            column += 4;
            continue;
          }
          const mapped = ESCAPES[escape];
          if (mapped === undefined) {
            throw new OmegaError('OMEGA_E_PARSE', `unknown escape sequence \\${escape}`, { line, column });
          }
          text += mapped;
          continue;
        }
        text += advance();
      }
      if (!closed) {
        throw new OmegaError('OMEGA_E_PARSE', 'unterminated string literal', { line: startLine, column: startColumn });
      }
      push(TOKEN.STRING, text, startLine, startColumn, startOffset);
      continue;
    }
    if (IDENT_START.test(char)) {
      let text = '';
      for (;;) {
        if (!IDENT_PART.test(peek() ?? '')) break;
        text += advance();
      }
      // Dotted names are a single token: `github.repository.read`. A dot only joins
      // when the next segment starts like an identifier, so `a.` stays an error.
      while (peek() === '.' && IDENT_START.test(peek(1) ?? '')) {
        text += advance();
        while (IDENT_PART.test(peek() ?? '')) text += advance();
      }
      // A secret *handle* is one token: `vault://gemini`. It is the only way to name a
      // credential, and it is a reference — the value lives in the vault, not here.
      if (HANDLE_SCHEMES.includes(text) && peek() === ':' && peek(1) === '/' && peek(2) === '/') {
        advance();
        advance();
        advance();
        let name = '';
        while (/[A-Za-z0-9._/-]/.test(peek() ?? '')) name += advance();
        if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(name)) {
          throw new OmegaError('OMEGA_E_SECRET_LITERAL', `invalid secret handle: ${text}://${name}`, { line: startLine, column: startColumn });
        }
        push(TOKEN.HANDLE, `${text}://${name}`, startLine, startColumn, startOffset);
        continue;
      }
      push(TOKEN.IDENT, text, startLine, startColumn, startOffset);
      continue;
    }
    throw new OmegaError('OMEGA_E_PARSE', `unexpected character ${JSON.stringify(char)}`, { line: startLine, column: startColumn });
  }

  push(TOKEN.EOF, '', line, column, index);
  return tokens;
}

/** @param {string} text e.g. "10m" @returns {number} milliseconds. Throws on a bad unit. */
export function durationToMs(text) {
  const match = text.match(/^(-?[0-9]+)(ms|s|m|h)$/);
  if (match === null) {
    throw new OmegaError('OMEGA_E_PARSE', `invalid duration: ${text}`);
  }
  const amount = Number.parseInt(match[1], 10);
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new OmegaError('OMEGA_E_SCHEMA', `duration must be a positive integer: ${text}`);
  }
  return amount * DURATION_UNITS[match[2]];
}

export { DURATION_UNITS };
