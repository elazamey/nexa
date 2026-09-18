/** Directional mapping between the envelope schema and the .nex document AST. */
import { NexaError } from '../../ast/index.js';

export const HEADER_ORDER = Object.freeze([
  'type',
  'id',
  'from',
  'to',
  'ts',
  'exp',
  'nonce',
  'cap',
  'in_reply_to',
]);

export const ENVELOPE_KEYS = Object.freeze([
  'nexa',
  'type',
  'id',
  'from',
  'to',
  'ts',
  'exp',
  'nonce',
  'cap',
  'in_reply_to',
  'body',
  'sig',
]);

/**
 * @param {object} envelope
 * @returns {{version: string, headers: object, blocks: object}}
 */
export function fromEnvelope(envelope) {
  if (typeof envelope !== 'object' || envelope === null || Array.isArray(envelope)) {
    throw new NexaError('NEXA_E_SCHEMA', 'only an envelope object can be printed as .nex');
  }
  for (const key of Object.keys(envelope)) {
    if (!ENVELOPE_KEYS.includes(key)) {
      throw new NexaError('NEXA_E_SCHEMA', `cannot print unknown envelope field: ${key}`);
    }
  }
  const headers = {};
  for (const key of HEADER_ORDER) {
    if (envelope[key] !== undefined) headers[key] = envelope[key];
  }
  const blocks = { body: envelope.body ?? {} };
  if (envelope.sig !== undefined) blocks.sig = envelope.sig;
  return { version: envelope.nexa ?? '0.1', headers, blocks };
}
