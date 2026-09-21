/**
 * NEXA error taxonomy.
 *
 * Every failure in the protocol is a machine-readable code. Codes are stable:
 * peers branch on them, evidence records them, and DENY envelopes carry them.
 */
export const ERROR_CODES = Object.freeze({
  // framing / syntax
  NEXA_E_PARSE: 'syntax error in .nex text',
  NEXA_E_SCHEMA: 'value does not match the NEXA schema',
  // canonicalization
  NEXA_E_C14N_TYPE: 'value is not canonicalizable (unsupported type)',
  NEXA_E_C14N_NUMBER: 'only safe integers are allowed in v0.1',
  NEXA_E_C14N_STRING: 'string contains an unpaired surrogate',
  NEXA_E_C14N_FORM: 'input is not in NEXA-C14N canonical form',
  // crypto / signature
  NEXA_E_KEY: 'malformed key material',
  NEXA_E_SIG: 'signature verification failed',
  NEXA_E_SIG_ALG: 'unsupported signature algorithm',
  // freshness / replay
  NEXA_E_REPLAY: 'nonce or message id already seen',
  NEXA_E_EXPIRED: 'envelope expired',
  NEXA_E_CLOCK: 'timestamp outside the accepted clock skew',
  NEXA_E_TTL: 'envelope lifetime exceeds the maximum TTL',
  NEXA_E_TOO_LARGE: 'message exceeds a protocol size limit',
  // identity / trust
  NEXA_E_UNTRUSTED: 'issuer is not in the trust store',
  NEXA_E_IDENTITY: 'identity document is invalid',
  // capability
  NEXA_E_CAP_MISSING: 'no capability presented',
  NEXA_E_CAP_INVALID: 'capability token is invalid',
  NEXA_E_CAP_EXPIRED: 'capability expired or not yet valid',
  NEXA_E_CAP_AMPLIFY: 'delegation would amplify authority',
  NEXA_E_CAP_USES: 'capability use budget exhausted',
  NEXA_E_CAP_AUDIENCE: 'capability is not addressed to this endpoint',
  NEXA_E_CAP_REVOKED: 'capability revoked',
  // policy / gates
  NEXA_E_POLICY: 'policy denied the request',
  NEXA_E_GATE: 'request blocked by a closed v0.1 hard gate',
  NEXA_E_NO_HANDLER: 'no handler registered for the requested resource',
  NEXA_E_HANDLER: 'handler failed',
  // approval protocol (v13-1)
  NEXA_E_POLICY_IMMUTABLE: 'policy root is immutable — no approval channel exists for it',
  NEXA_E_APPROVAL_MISSING: 'no approval found for this id',
  NEXA_E_APPROVAL_STATE: 'approval is not in a decidable or spendable state',
  NEXA_E_APPROVAL_USED: 'approval already consumed',
  NEXA_E_APPROVAL_TARGET: 'execution target does not match the approved target',
  NEXA_E_APPROVAL_SCOPE: 'execution is outside the approval scope',
  NEXA_E_APPROVAL_EXPIRED: 'approval expired',
  NEXA_E_APPROVAL_TAMPERED: 'approval log failed tamper-evidence verification',
  // terminal execution (v13-2)
  NEXA_E_TERMINAL_JAIL: 'command would escape the allowed working directory',
  NEXA_E_TERMINAL_UNALLOWED: 'program is not in the terminal allowlist',
});

export class NexaError extends Error {
  /**
   * @param {keyof typeof ERROR_CODES} code
   * @param {string} message
   * @param {object} [details]
   */
  constructor(code, message, details = undefined) {
    if (!Object.hasOwn(ERROR_CODES, code)) {
      throw new Error(`unknown NEXA error code: ${String(code)}`);
    }
    super(message);
    this.name = 'NexaError';
    this.code = code;
    this.summary = ERROR_CODES[code];
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

/**
 * Wraps a non-NexaError into one, preserving the original message.
 * @param {unknown} cause
 * @param {keyof typeof ERROR_CODES} code
 */
export function asNexaError(cause, code = 'NEXA_E_SCHEMA') {
  if (cause instanceof NexaError) return cause;
  const message = cause instanceof Error ? cause.message : String(cause);
  return new NexaError(code, message);
}
