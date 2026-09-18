/**
 * `compile(source) → { ok, diagnostics, module, ir, hash }`
 *
 * The whole compiler is this one function: parse, analyse, lower, hash. It is pure —
 * no clock, no randomness, no filesystem — so the same source always produces the same
 * IR and the same hash, which is what makes a module hash a meaningful thing to sign.
 */
import { Diagnostic, OmegaError, sortDiagnostics } from './errors.js';
import { parseProgram } from './parser.js';
import { analyze } from './analyzer.js';
import { explain, findUnlowered, irHash, lowerToIr, OMEGA_IR_VERSION } from './ir.js';

/** @param {unknown} cause @returns {Diagnostic} */
function toDiagnostic(cause, path) {
  if (cause instanceof OmegaError) {
    const { line, column } = cause.details ?? {};
    return new Diagnostic({
      code: cause.code,
      message: cause.message,
      loc: line === undefined ? null : { line, column: column ?? 0 },
      details: cause.details,
    });
  }
  return new Diagnostic({
    code: 'OMEGA_E_SCHEMA',
    message: `${path}: ${cause instanceof Error ? cause.message : String(cause)}`,
    loc: null,
  });
}

/**
 * @param {string} source
 * @param {{path?: string}} [options]
 * @returns {{ok: boolean, diagnostics: Diagnostic[], module: object|null, ir: object|null, hash: string|null, version: number}}
 */
export function compile(source, { path = '<source>' } = {}) {
  let program = null;
  try {
    program = parseProgram(source, { path });
  } catch (cause) {
    return {
      ok: false,
      diagnostics: [toDiagnostic(cause, path)],
      module: null,
      ir: null,
      hash: null,
      version: OMEGA_IR_VERSION,
    };
  }

  let analyzed;
  try {
    analyzed = analyze(program, { path });
  } catch (cause) {
    return {
      ok: false,
      diagnostics: [toDiagnostic(cause, path)],
      module: null,
      ir: null,
      hash: null,
      version: OMEGA_IR_VERSION,
    };
  }

  const diagnostics = sortDiagnostics(analyzed.diagnostics);
  if (!analyzed.ok) {
    return { ok: false, diagnostics, module: analyzed.module, ir: null, hash: null, version: OMEGA_IR_VERSION };
  }

  const ir = lowerToIr(analyzed.module);
  const unlowered = findUnlowered(ir);
  if (unlowered.length > 0) {
    // A hole in the IR is a compiler defect, and it is reported as one instead of
    // becoming a run-time surprise in an unrelated mission.
    diagnostics.push(new Diagnostic({
      code: 'OMEGA_E_SCHEMA',
      message: `the compiler cannot lower ${unlowered.map((entry) => entry.source_kind).join(', ')}: this is a compiler defect, not a module error`,
      loc: null,
      details: { unlowered },
    }));
    return { ok: false, diagnostics: sortDiagnostics(diagnostics), module: analyzed.module, ir: null, hash: null, version: OMEGA_IR_VERSION };
  }
  return {
    ok: true,
    diagnostics,
    module: analyzed.module,
    ir,
    hash: irHash(ir),
    explanation: explain(ir),
    version: OMEGA_IR_VERSION,
  };
}
