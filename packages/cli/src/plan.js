/**
 * `plan(argv)` — argv to a command plan, and nothing else.
 *
 * The CLI package is pure: it never reads a file, never writes a byte and never exits.
 * `tools/nexa.mjs` is the thin shell that performs the I/O the plan asks for. That
 * separation is what lets the whole command surface be tested in memory.
 */
import { OmegaError } from '../../compiler/index.js';

export const COMMANDS = Object.freeze({
  check: {
    usage: 'nexa check <module.nexa> [--json]',
    summary: 'parse, type-check and authority-check a module; print diagnostics',
    flags: ['json'],
    file: true,
  },
  compile: {
    usage: 'nexa compile <module.nexa> [--json]',
    summary: 'compile to Ω IR and print its hash (the manifest commitment)',
    flags: ['json'],
    file: true,
  },
  explain: {
    usage: 'nexa explain <module.nexa> [--json]',
    summary: 'print the authority table: agents, grants, providers, calls and closed gates',
    flags: ['json'],
    file: true,
  },
  run: {
    usage: 'nexa run <module.nexa> --mission <name> [--json] [--approve]',
    summary: 'execute a mission against a kernel host, then show the transcript and the verdict',
    flags: ['json', 'approve'],
    values: ['mission'],
    file: true,
  },
  gate: {
    usage: 'nexa gate <candidate.json> [--parent <parent.json>] [--checks <checks.json>] [--json]',
    summary: 'run the deterministic Evolution Gate over a signed manifest',
    flags: ['json'],
    values: ['parent', 'checks'],
    file: true,
  },
  version: {
    usage: 'nexa version',
    summary: 'print the Ω language and runtime versions',
    flags: ['json'],
    file: false,
  },
});

/**
 * @param {string[]} argv arguments after the program name
 * @returns {{ok: true, command: string, file: string|null, options: object} | {ok: false, message: string, usage: string[]}}
 */
export function plan(argv) {
  const usage = Object.values(COMMANDS).map((entry) => entry.usage);
  if (!Array.isArray(argv)) {
    return { ok: false, message: 'argv must be an array', usage };
  }
  const [command, ...rest] = argv;
  if (command === undefined || command === 'help' || command === '--help' || command === '-h') {
    return { ok: false, message: 'no command given', usage };
  }
  if (!Object.hasOwn(COMMANDS, command)) {
    return { ok: false, message: `unknown command ${JSON.stringify(command)}`, usage };
  }
  const spec = COMMANDS[command];
  const options = {};
  const positional = [];
  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (token.startsWith('--')) {
      const name = token.slice(2);
      if (name.length === 0) return { ok: false, message: 'empty flag', usage };
      if (spec.flags.includes(name)) {
        options[name] = true;
        continue;
      }
      if ((spec.values ?? []).includes(name)) {
        const value = rest[index + 1];
        if (value === undefined || value.startsWith('--')) {
          return { ok: false, message: `--${name} needs a value`, usage };
        }
        options[name] = value;
        index += 1;
        continue;
      }
      return { ok: false, message: `${command} does not take --${name}`, usage };
    }
    positional.push(token);
  }
  if (positional.length > 1) {
    return { ok: false, message: `${command} takes one file, got ${positional.length}`, usage };
  }
  if (spec.file && positional.length === 0) {
    return { ok: false, message: `${command} needs a file`, usage };
  }
  if (command === 'run' && options.mission === undefined) {
    return { ok: false, message: 'run needs --mission <name>', usage };
  }
  return { ok: true, command, file: positional[0] ?? null, options };
}

/** @param {string} message @returns {OmegaError} */
export function usageError(message) {
  return new OmegaError('OMEGA_E_SCHEMA', message);
}
