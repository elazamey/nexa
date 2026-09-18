/**
 * MCP <-> NEXA bridge.
 *
 * MCP is JSON-RPC 2.0 plus a tool surface. NEXA is signed envelopes plus a
 * decision. The bridge maps one onto the other *without weakening either*:
 *
 *   inbound  tools/call  -> NEXA CALL envelope -> endpoint decision -> JSON-RPC result/error
 *   outbound tools/list  -> only resources that are ungated, registered, and policy-allowed
 *
 * Consequences worth stating plainly:
 *   - A JSON-RPC call with no capability token is denied (`NEXA_E_CAP_MISSING`),
 *     exactly as a bare envelope would be.
 *   - A tool whose name maps to a gated namespace is never advertised and never
 *     dispatched; the refusal happens before policy, so no rule can expose it.
 *   - Denials carry the NEXA error code and the signed receipt in `error.data`, so a
 *     JSON-RPC client can prove what happened to an auditor.
 */
import { NexaError, MESSAGE_ID_PATTERN } from '../../../packages/ast/index.js';
import { GATE_STATE, checkGates, gatePosture } from '../../../packages/policy/src/gates.js';
import { verifyReceipt } from '../../../packages/evidence/src/receipt.js';
import { Endpoint } from '../../../packages/protocol/index.js';

export const JSON_RPC_VERSION = '2.0';

export const RPC_ERRORS = Object.freeze({
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
  NEXA_DENIED: -32001,
  NEXA_UNREACHABLE: -32002,
});

const MCP_METHODS = Object.freeze([
  'initialize',
  'tools/list',
  'tools/call',
  'nexa/posture',
  'nexa/evidence',
]);

/** `tool:echo` -> `tool_echo` */
export function toolNameFor(resource) {
  const name = String(resource).replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase();
  if (name.length === 0) {
    throw new NexaError('NEXA_E_SCHEMA', `cannot derive an MCP tool name from ${String(resource)}`);
  }
  return `nexa_${name}`;
}

/** @param {string} toolName @param {string[]} resources */
export function resourceForTool(toolName, resources) {
  const matches = resources.filter((resource) => toolNameFor(resource) === toolName);
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new NexaError('NEXA_E_SCHEMA', `tool name ${toolName} is ambiguous`, { matches });
  }
  return matches[0];
}

export class McpBridge {
  #endpoint;

  #exposed;

  /**
   * @param {object} input
   * @param {Endpoint} input.endpoint
   * @param {string[]} [input.expose] resources to advertise; default: every registered resource
   * @param {number} [input.maxArgsBytes]
   */
  constructor({ endpoint, expose, maxArgsBytes = 8192 }) {
    if (endpoint === undefined || typeof endpoint.receive !== 'function') {
      throw new NexaError('NEXA_E_SCHEMA', 'the MCP bridge needs a NEXA endpoint');
    }
    this.#endpoint = endpoint;
    this.maxArgsBytes = maxArgsBytes;
    this.#exposed = expose ?? endpoint.resources();
    for (const resource of this.#exposed) {
      if (!endpoint.hasHandler(resource)) {
        throw new NexaError('NEXA_E_NO_HANDLER', `cannot expose ${resource}: no handler registered`);
      }
      const verdict = checkGates({ resource, action: 'call' });
      if (!verdict.allowed) {
        throw new NexaError('NEXA_E_GATE', `cannot expose ${resource}: ${verdict.reason}`, {
          gate: verdict.gate,
        });
      }
    }
    this.#exposed = [...new Set(this.#exposed)].sort();
  }

  /** @returns {string[]} */
  get exposed() {
    return [...this.#exposed];
  }

  /** @returns {object} MCP-shaped posture report */
  posture() {
    return {
      nexa: '0.1',
      endpoint: this.#endpoint.kid,
      gates: gatePosture(),
      tools: this.#exposed.map((resource) => toolNameFor(resource)),
      note: 'all gates are closed; the bridge refuses to advertise anything behind them',
    };
  }

  /**
   * Handles one JSON-RPC message. Never throws for protocol-level faults: JSON-RPC
   * errors are returned, because throwing would drop the proof of the denial.
   * @param {object} message
   * @param {object} [context]
   * @param {{identity: object, keys: object, kid: string}} [context.caller] required for tools/call
   * @param {object} [context.capability] capability token to present
   * @param {() => Date} [context.clock] clock for the synthesized caller endpoint
   * @param {Endpoint} [context.callerEndpoint] reuse an existing caller endpoint (preferred)
   * @returns {object} JSON-RPC response
   */
  handleRpc(message, context = {}) {
    const id = message?.id ?? null;
    try {
      if (message === null || typeof message !== 'object' || Array.isArray(message)) {
        return this.#error(id, RPC_ERRORS.INVALID_REQUEST, 'a JSON-RPC message must be an object');
      }
      if (message.jsonrpc !== JSON_RPC_VERSION) {
        return this.#error(id, RPC_ERRORS.INVALID_REQUEST, 'jsonrpc must be "2.0"');
      }
      if (typeof message.method !== 'string' || !MCP_METHODS.includes(message.method)) {
        return this.#error(id, RPC_ERRORS.METHOD_NOT_FOUND, `unknown method ${String(message.method)}`);
      }
      if (id !== null && (typeof id !== 'string' || !MESSAGE_ID_PATTERN.test(id))
          && !Number.isSafeInteger(id)) {
        return this.#error(null, RPC_ERRORS.INVALID_REQUEST, 'id must be a string urn or an integer');
      }
      if (message.params !== undefined && (typeof message.params !== 'object' || message.params === null)) {
        return this.#error(id, RPC_ERRORS.INVALID_PARAMS, 'params must be an object');
      }

      switch (message.method) {
        case 'initialize':
          return this.#result(id, {
            protocolVersion: '2026-09-18',
            serverInfo: { name: 'nexa', version: '0.1.0' },
            capabilities: { tools: { listChanged: false }, nexa: { posture: true, evidence: true } },
          });
        case 'nexa/posture':
          return this.#result(id, this.posture());
        case 'tools/list':
          return this.#result(id, {
            tools: this.#exposed.map((resource) => ({
              name: toolNameFor(resource),
              description: `NEXA resource ${resource} (capability required; gates closed)`,
              inputSchema: { type: 'object', additionalProperties: true },
            })),
          });
        case 'nexa/evidence': {
          const entries = this.#endpoint.evidence.entries();
          const limit = Number.isSafeInteger(message.params?.limit) ? message.params.limit : 20;
          return this.#result(id, {
            length: entries.length,
            head: this.#endpoint.evidence.head?.hash ?? null,
            records: entries.slice(-limit),
          });
        }
        case 'tools/call':
          return this.#toolsCall(id, message.params ?? {}, context);
        default:
          return this.#error(id, RPC_ERRORS.METHOD_NOT_FOUND, `unknown method ${message.method}`);
      }
    } catch (cause) {
      const error = cause instanceof NexaError ? cause : new NexaError('NEXA_E_HANDLER', String(cause?.message ?? cause));
      return this.#error(id, RPC_ERRORS.INTERNAL, error.message, { nexa_code: error.code });
    }
  }

  /**
   * @param {number|string|null} id
   * @param {object} params
   * @param {{caller?: object, capability?: object}} context
   */
  #toolsCall(id, params, context) {
    if (typeof params.name !== 'string') {
      return this.#error(id, RPC_ERRORS.INVALID_PARAMS, 'params.name is required');
    }
    const args = params.arguments ?? {};
    if (typeof args !== 'object' || args === null || Array.isArray(args)) {
      return this.#error(id, RPC_ERRORS.INVALID_PARAMS, 'params.arguments must be an object');
    }
    const resource = resourceForTool(params.name, this.#exposed);
    if (resource === null) {
      return this.#error(id, RPC_ERRORS.METHOD_NOT_FOUND, `unknown tool ${params.name}`);
    }
    const verdict = checkGates({ resource, action: 'call' });
    if (!verdict.allowed) {
      return this.#error(id, RPC_ERRORS.NEXA_DENIED, verdict.reason, {
        nexa_code: 'NEXA_E_GATE',
        gate: verdict.gate,
        state: GATE_STATE[verdict.gate],
      });
    }
    if (context.caller === undefined) {
      return this.#error(id, RPC_ERRORS.NEXA_DENIED, 'tools/call requires a caller identity', {
        nexa_code: 'NEXA_E_UNTRUSTED',
      });
    }

    // Build a real NEXA envelope from the JSON-RPC call and let the endpoint decide.
    const callerEndpoint = context.callerEndpoint instanceof Endpoint
      ? context.callerEndpoint
      : new Endpoint({
        identity: context.caller,
        policy: this.#endpoint.policy,
        // Clock injection keeps the bridge usable in deterministic tests and in
        // systems where time is supplied by the host, not by Date.now().
        ...(context.clock === undefined ? {} : { clock: context.clock }),
      });
    if (!callerEndpoint.trust.isTrusted(this.#endpoint.kid)) {
      try {
        callerEndpoint.trust.pin(this.#endpoint.identity.document);
      } catch (cause) {
        return this.#error(id, RPC_ERRORS.NEXA_DENIED, 'cannot pin the peer endpoint identity', {
          nexa_code: cause.code ?? 'NEXA_E_IDENTITY',
        });
      }
    }
    const envelope = callerEndpoint.call({
      to: this.#endpoint.kid,
      resource,
      action: 'call',
      args,
      ...(context.capability === undefined ? {} : { capability: context.capability }),
    });
    const decision = this.#endpoint.receive(envelope);
    if (decision.decision !== 'ALLOW') {
      return this.#error(
        id,
        RPC_ERRORS.NEXA_DENIED,
        decision.reply?.body?.message ?? 'denied',
        {
          nexa_code: decision.code,
          details: decision.reply?.body?.details ?? null,
          receipt: decision.receipt === null ? null : { ...decision.receipt },
        },
      );
    }
    const body = decision.reply.body;
    return this.#result(id, {
      content: [{ type: 'text', text: typeof body.value === 'string' ? body.value : JSON.stringify(body.value) }],
      structuredContent: body.value,
      nexa: {
        decision: decision.decision,
        ref: body.ref,
        receipt: body.receipt === undefined ? null : verifyReceipt(body.receipt).summary,
      },
    });
  }

  /** @param {number|string|null} id @param {object} result */
  #result(id, result) {
    return { jsonrpc: JSON_RPC_VERSION, id, result };
  }

  /** @param {number|string|null} id @param {number} code @param {string} message @param {object} [data] */
  #error(id, code, message, data) {
    return {
      jsonrpc: JSON_RPC_VERSION,
      id,
      error: { code, message, ...(data === undefined ? {} : { data: data ?? null }) },
    };
  }
}
