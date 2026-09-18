/**
 * The Ω error taxonomy.
 *
 * One table for the whole layer — compile time, run time and evolution — so that a
 * transcript, a diagnostic and a gate verdict all speak the same vocabulary. Kernel
 * failures keep their own `NEXA_E_*` codes and are never rewritten into these: a gate
 * refusal stays a gate refusal.
 */
export const OMEGA_ERROR_CODES = Object.freeze({
  // --- source / structure -------------------------------------------------
  OMEGA_E_PARSE: 'the source does not match the Ω grammar',
  OMEGA_E_SCHEMA: 'a declaration is missing a required field or names an unknown one',
  OMEGA_E_DUPLICATE: 'two declarations share a name',
  OMEGA_E_UNBOUND: 'a name is used before it is bound',
  OMEGA_E_IMMUTABLE: 'a `let` binding cannot be reassigned with `set` (bound names are immutable)',
  OMEGA_E_UNKNOWN_INSTRUMENT: 'the call or capability reference does not resolve',
  OMEGA_E_UNKNOWN_PROVIDER: 'a provider reference does not resolve',
  OMEGA_E_RESOURCE_WILDCARD: 'a call site produced a wildcard resource (patterns belong in allow-lists)',
  OMEGA_E_TYPE: 'the value is not assignable to the declared type',
  OMEGA_E_SECRET_EGRESS: 'a secret value reached a public sink',
  OMEGA_E_SECRET_LITERAL: 'a secret literal appears in the source (only vault:// handles are allowed)',
  OMEGA_E_EVIDENCE_UNTRUSTED: 'only verified values may be promoted to evidence',
  OMEGA_E_SANITIZER_UNTRUSTED: 'declassification requires a sanitizer declared `trust verified`',
  OMEGA_E_CAP_MISSING: 'the acting agent does not cover this call',
  OMEGA_E_MULTIPLE_EMIT: 'a mission has more than one `emit`',
  OMEGA_E_NO_MISSION: 'no mission with that name exists in the module',
  OMEGA_E_KERNEL_IMMUTABLE: 'the kernel, verifier, policy engine and capability authority are not evolvable',
  OMEGA_E_SIGNATURE: 'a signature did not verify',
  OMEGA_E_MANIFEST: 'the version manifest is malformed or fails verification',

  // --- run time -----------------------------------------------------------
  OMEGA_E_GRANT_MISSING: 'no grant authorizes this call',
  OMEGA_E_APPROVAL_REQUIRED: 'the grant requires an approval that was not supplied',
  OMEGA_E_CONTRACT_UNMET: 'a `require evidence` contract has no evidence',
  OMEGA_E_ASSERT: 'an `assert` statement failed at run time',
  OMEGA_E_FAILED: 'the mission executed a `fail` statement',
  OMEGA_E_CIRCUIT_OPEN: 'the circuit breaker isolated a failing resource',
  OMEGA_E_BUDGET: 'a mission budget (steps, time or calls) was exhausted',
  OMEGA_E_PLANNER_REFUSED: 'the injected planner refused the plan',
  OMEGA_E_PROVIDER_UNAVAILABLE: 'no provider satisfies the strategy and cost policy',
  OMEGA_E_SECRET_UNAVAILABLE: 'the vault could not resolve a secret handle',
  OMEGA_E_CHAIN_BROKEN: 'the Ω evidence chain does not verify',
  OMEGA_E_LEDGER: 'the Ω ledger refused to append a record',
  OMEGA_E_SEALED_MISUSE: 'a sealed value was used somewhere other than a secret-accepting instrument',

  // --- evolution ----------------------------------------------------------
  OMEGA_E_GATE_STAGE: 'an Evolution Gate stage failed',
  OMEGA_E_CANARY_INCOMPLETE: 'the canary window has not collected enough clean observations',
  OMEGA_E_QUARANTINED: 'a quarantined candidate may not be activated; promote a new version instead',
  OMEGA_E_NOT_ACTIVATOR: 'the calling identity is not allowed to activate versions',
  OMEGA_E_VERSION_UNKNOWN: 'the version is not in the registry',
  OMEGA_E_VERSION_DUPLICATE: 'the version already exists in the registry (versions are immutable)',
  OMEGA_E_CAP_AMPLIFY: 'the candidate adds authority its parent did not have',

  // --- learning, replay, healing and the adversarial suite ----------------
  // Every refusal in the system carries a code, because an error without a code cannot
  // be classified, receipted, tested, or counted in a posture report.
  OMEGA_E_OBSERVATION: 'the learning layer was handed data it cannot observe',
  OMEGA_E_HYPOTHESIS: 'a hypothesis is malformed, or names a target it may not name',
  OMEGA_E_UNPROVEN: 'a claim was promoted to a proven state without evidence',
  OMEGA_E_EPISTEMIC: 'a claim was moved between epistemic states in a direction that is not allowed',
  OMEGA_E_KNOWLEDGE: 'the knowledge store refused the entry',
  OMEGA_E_KNOWLEDGE_UNKNOWN: 'no knowledge entry with that id exists',
  OMEGA_E_KNOWLEDGE_INVALIDATED: 'an invalidated belief cannot be resurrected; state a new claim instead',
  OMEGA_E_BENCHMARK: 'a benchmark suite or run is malformed, or two runs are not comparable',
  OMEGA_E_BENCHMARK_REGRESSION: 'a candidate fails a task its baseline passed',
  OMEGA_E_BENCHMARK_NONDETERMINISTIC: 'the same benchmark run produced a different result twice',
  OMEGA_E_REPLAY: 'a replay plan is malformed or names an unknown mission',
  OMEGA_E_REPLAY_MISMATCH: 'a replayed run decided differently from the run it replays',
  OMEGA_E_LEARNER_AUTHORITY: 'a learner tried to apply a change: learning proposes, the gate decides',
  OMEGA_E_HEAL: 'the self-healer was handed a failure it cannot classify',
  OMEGA_E_ADVERSARIAL: 'the adversarial suite is malformed or names an unknown category',
  OMEGA_E_ADVERSARIAL_UNMODELLED: 'an attack failed with an error the system does not model',
  OMEGA_E_UNKNOWN: 'a failure arrived without a code',
  OMEGA_E_NO_RESULT: 'a call has no result record: the transcript is incomplete',

  // --- the cellular layer -------------------------------------------------
  // A cell refuses in the vocabulary of the membrane, so a refusal reads the same whether
  // it came from a receptor, a contract or a lifecycle. Nucleus violations keep their own
  // codes: an immutable nucleus is not a membrane problem.
  OMEGA_E_MEMBRANE: 'a message did not cross the membrane: malformed, unsigned or misaddressed',
  OMEGA_E_IDENTITY: 'the sender identity is missing or malformed',
  OMEGA_E_RECEPTOR: 'the addressed receptor does not exist on this cell',
  OMEGA_E_ROUTE: 'the contract does not declare this route between these cells',
  OMEGA_E_POLICY: 'the receptor policy refused the message (audience, tenant or role)',
  OMEGA_E_LIFECYCLE: 'the cell lifecycle does not allow this transition',
  OMEGA_E_ISOLATED: 'the cell is isolated: it does not serve traffic',
  OMEGA_E_HANDLER: 'a receptor or handler threw an error that carries no Ω code',
  OMEGA_E_HOMEOSTASIS: 'the homeostasis policy is malformed or names an unknown signal',
  OMEGA_E_CELL_AMPLIFY: 'a cell, tissue or organ tried to hold authority it was not granted',

  // --- the Google organ: identity, provider access, recovery --------------
  // A Google refusal is a refusal like any other, and it says which question failed. The
  // identity codes separate the *token* (shape, signature, issuer, audience, window) from the
  // *challenge* (a nonce), because they are different attacks with different controls; the
  // break-glass codes separate the four ways a recovery state can be illegal, so a refusal
  // names the rule rather than reporting "malformed" and leaving the reader to guess.
  OMEGA_E_IDENTITY_TOKEN: 'an ID token did not verify against the pinned key source (shape, signature, issuer or audience)',
  OMEGA_E_NONCE: 'the single-use challenge is missing, expired, or was already spent',
  OMEGA_E_SCOPE: 'the requested OAuth scope is not documented for this cell, action and phase',
  OMEGA_E_QUOTA: 'the provider quota is exhausted, or the service is backing off or already in flight',
  OMEGA_E_TOKEN: 'vault material is missing, expired beyond refresh, or the handle names another holder',
  OMEGA_E_BINDING_EXISTS: 'a second live binding was offered for one subject; revoke first, on the record',
  OMEGA_E_BREAKGLASS_UNBOUNDED: 'a break-glass binding has no finite expiry, or one beyond its ceiling',
  OMEGA_E_BREAKGLASS_ROLE: 'break-glass was asked to be something other than a recovery state',
  OMEGA_E_BREAKGLASS_REASON: 'a break-glass binding carries no reason, so it is not auditable',
  OMEGA_E_BREAKGLASS_CHAIN: 'a break-glass binding was chained onto another, or delegated',
  OMEGA_E_CLASS_CEILING: 'the operation is above the ceiling its cell or role may reach',
  OMEGA_E_APPROVAL_CONSUMED: 'a single-use approval was presented twice',

  // --- warnings (not failures) -------------------------------------------
  OMEGA_W_UNUSED_CAPABILITY: 'an agent allows a capability no call site uses',
  OMEGA_W_NO_PLAN: 'the mission declares no plan',
  OMEGA_W_NO_OBSERVE: 'the mission observes nothing',
  OMEGA_W_DEAD_BINDING: 'a binding is never used',
  OMEGA_W_ALWAYS_TRUE: 'an assert is provably true at compile time',
});

export const SEVERITIES = Object.freeze({ ERROR: 'error', WARNING: 'warning' });
const WARNING_CODES = new Set(
  Object.keys(OMEGA_ERROR_CODES).filter((code) => code.startsWith('OMEGA_W_')),
);

export class OmegaError extends Error {
  /**
   * @param {keyof typeof OMEGA_ERROR_CODES} code
   * @param {string} message
   * @param {object} [details]
   */
  constructor(code, message, details = undefined) {
    if (!Object.hasOwn(OMEGA_ERROR_CODES, code)) {
      throw new Error(`unknown Ω error code: ${String(code)}`);
    }
    super(message);
    this.name = 'OmegaError';
    this.code = code;
    this.summary = OMEGA_ERROR_CODES[code];
    if (details !== undefined) this.details = details;
  }

  toJSON() {
    return {
      code: this.code,
      message: this.message,
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}

/** @param {unknown} cause @param {keyof typeof OMEGA_ERROR_CODES} code */
export function asOmegaError(cause, code = 'OMEGA_E_SCHEMA') {
  if (cause instanceof OmegaError) return cause;
  const message = cause instanceof Error ? cause.message : String(cause);
  return new OmegaError(code, message);
}

/**
 * A source-located remark. Diagnostics are values, not exceptions, so one compile can
 * report everything that is wrong instead of the first thing it tripped over.
 */
export class Diagnostic {
  /**
   * @param {object} input
   * @param {string} input.code
   * @param {string} input.message
   * @param {{line: number, column: number}|null} [input.loc]
   * @param {object} [input.details]
   */
  constructor({ code, message, loc = null, details = undefined }) {
    if (!Object.hasOwn(OMEGA_ERROR_CODES, code)) {
      throw new Error(`unknown Ω diagnostic code: ${String(code)}`);
    }
    this.code = code;
    this.severity = WARNING_CODES.has(code) ? SEVERITIES.WARNING : SEVERITIES.ERROR;
    this.message = message;
    this.loc = loc;
    if (details !== undefined) this.details = details;
  }

  get summary() {
    return OMEGA_ERROR_CODES[this.code];
  }

  toJSON() {
    return {
      code: this.code,
      severity: this.severity,
      message: this.message,
      ...(this.loc === null ? {} : { line: this.loc.line, column: this.loc.column }),
      ...(this.details === undefined ? {} : { details: this.details }),
    };
  }
}

/** Deterministic order: by line, then column, then code. @param {Diagnostic[]} list */
export function sortDiagnostics(list) {
  return [...list].sort((a, b) => {
    const lineA = a.loc?.line ?? 0;
    const lineB = b.loc?.line ?? 0;
    if (lineA !== lineB) return lineA - lineB;
    const columnA = a.loc?.column ?? 0;
    const columnB = b.loc?.column ?? 0;
    if (columnA !== columnB) return columnA - columnB;
    return a.code.localeCompare(b.code);
  });
}

/** @param {Diagnostic} diagnostic @param {{path?: string}} [context] @returns {string} */
export function formatDiagnostic(diagnostic, { path = '<source>' } = {}) {
  const where = diagnostic.loc === null ? path : `${path}:${diagnostic.loc.line}:${diagnostic.loc.column}`;
  return `${where}: ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`;
}

/** @param {Diagnostic[]} diagnostics */
export function hasErrors(diagnostics) {
  return diagnostics.some((diagnostic) => diagnostic.severity === SEVERITIES.ERROR);
}
