/**
 * @nexa/evidence — hash-chained decision log + signed receipts.
 */
export {
  EVIDENCE_DOMAIN,
  GENESIS_PREV,
  EVIDENCE_KINDS,
  DECISIONS,
  recordPayload,
  computeRecordHash,
  validateRecordShape,
  EvidenceLog,
  verifyEvidenceChain,
  evidenceId,
} from './src/chain.js';
export {
  RECEIPT_DOMAIN,
  RECEIPT_FIELDS,
  RECEIPT_DECISIONS,
  receiptPayload,
  createReceipt,
  verifyReceipt,
  matchReceiptToRecord,
} from './src/receipt.js';
