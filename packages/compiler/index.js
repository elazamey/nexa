/**
 * @nexa/compiler — the NEXA Ω compiler.
 *
 * Pure by construction: parse → analyse (types + authority) → lower to IR → hash.
 * No clock, no randomness, no I/O, no ambient authority. `compile()` is the whole API
 * a caller normally needs.
 */
export { compile } from './src/compile.js';
export { parseProgram, RESERVED_WORDS, MEMORY_TIERS } from './src/parser.js';
export { tokenize, TOKEN, durationToMs, DURATION_UNITS } from './src/lexer.js';
export {
  OmegaError,
  OMEGA_ERROR_CODES,
  Diagnostic,
  SEVERITIES,
  sortDiagnostics,
  formatDiagnostic,
  hasErrors,
  asOmegaError,
} from './src/errors.js';
export {
  BUILTIN_NAMESPACES,
  RESERVED_NAMESPACES,
  isResource,
  isConcreteResource,
  hasWildcard,
  matchScope,
  matchResource,
  coversResource,
  coversCall,
  namespaceOf,
  resolveCapref,
} from './src/caprefs.js';
export {
  TYPE_TABLE,
  SECRECY_RANK,
  TRUST_RANK,
  SINKS,
  typeAttrs,
  isKnownType,
  describeAttrs,
  assignable,
  joinAttrs,
  checkSink,
  attrsFromInstrument,
  isSecret,
  isVerified,
} from './src/security-types.js';
export { analyze, secretEgressAllows, SINK_RESOURCES } from './src/analyzer.js';
export {
  OMEGA_IR_VERSION,
  OMEGA_IR_DOMAIN,
  lowerToIr,
  irHash,
  irBytes,
  explain,
  gateFor,
} from './src/ir.js';
