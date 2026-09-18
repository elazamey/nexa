import { NEXA_VERSION } from './schema.js';

/**
 * Create a canonical, unsigned NEXA message skeleton.
 * Callers (protocol / parser) supply id, nonce and timestamps so that this
 * package stays free of random-number and clock dependencies (pure + testable).
 * @param {object} input
 * @returns {object} envelope without `sig`
 */
export function buildUnsignedMessage({
  type,
  id,
  from,
  to,
  ts,
  exp,
  nonce,
  cap,
  in_reply_to,
  body,
}) {
  const envelope = { nexa: NEXA_VERSION, type, id, from, to, ts, exp, nonce };
  if (cap !== undefined) envelope.cap = cap;
  if (in_reply_to !== undefined) envelope.in_reply_to = in_reply_to;
  envelope.body = body;
  return envelope;
}
