/** Token kinds for the .nex syntax. */
export const TOKEN = Object.freeze({
  DIRECTIVE: 'DIRECTIVE', // @name or @name.sub
  IDENT: 'IDENT', // bare key inside a value block
  STRING: 'STRING', // "double quoted"
  INTEGER: 'INTEGER', // -?[0-9]+
  VERSION: 'VERSION', // [0-9]+\.[0-9]+  (document header only; floats are never values)
  LBRACE: '{',
  RBRACE: '}',
  LBRACKET: '[',
  RBRACKET: ']',
  NEWLINE: 'NEWLINE',
  EOF: 'EOF',
});

/** @param {string} type @param {string} value @param {number} line @param {number} column */
export function token(type, value, line, column) {
  return { type, value, line, column };
}
