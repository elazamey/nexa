/**
 * @nexa/cli — the Ω command surface, as pure functions.
 *
 * `plan(argv)` decides what to do; `render*` decides how it looks. Nothing here reads a
 * file, writes a byte or exits a process — `tools/nexa.mjs` is the shell that does.
 */
export { COMMANDS, plan, usageError } from './src/plan.js';
export {
  renderDiagnostics,
  renderCheck,
  renderCompile,
  renderExplain,
  renderRun,
  renderGate,
  renderVersion,
} from './src/render.js';
