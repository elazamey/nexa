#!/usr/bin/env node
/**
 * Pinned Google vectors.
 *
 * Regenerates `spec/vectors/google.json`. It pins what must never drift silently in the Google
 * organ: the verification order and the step that refuses in each scene, the key sources and the
 * one-refresh rule, the scope table with the phase each row belongs to, the class of every
 * operation and the ceilings, the approval state machine, the vault's contract, the backoff
 * schedule, and the identity-forgery reports.
 *
 * What is deliberately **not** pinned:
 *
 *   · **capability ids** and the ledger chain head — they hash a capability minted fresh per
 *     call, which is a property, not noise (the same decision is pinned in
 *     `spec/vectors/cellular.json`);
 *   · **tokens, subjects and emails** — only their hashes exist in the vectors, because only
 *     their hashes exist in the system.
 *
 *   node tools/google-vectors.mjs
 *   node tools/google-vectors.mjs --check   (compare, do not write)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createIdentity } from '../packages/identity/index.js';
import { OmegaLedger, verifyOmegaChain } from '../packages/runtime/index.js';
import {
  GOOGLE_KEY_SOURCES,
  GOOGLE_OPERATIONS,
  GOOGLE_SCOPE_TABLE,
  GOOGLE_SERVICE_CELLS,
  RISK_CLASSES,
  ROLE_CEILINGS,
  RECOVERY_OPERATIONS,
  SCOPE_TABLE_FIELDS,
  APPROVAL_FIELDS,
  DEFAULT_LIMITS,
  SECRET_PATTERNS,
  createApprovalStore,
  createJwksSource,
  createLimiter,
  createTokenVault,
  googleOperation,
  narrowestScope,
  operationDigest,
  payloadDigest,
  scanForSecretMaterial,
} from '../packages/cells/google/gateway/index.js';
import {
  BREAK_GLASS_MAX_MS,
  EMAIL_DOMAIN,
  NONCE_DOMAIN,
  SUBJECT_DOMAIN,
  VERIFICATION_STEPS,
  buildGoogleIdentityTissue,
  subHash,
} from '../packages/cells/google/identity/index.js';
import { runGoogleAttackSuite } from './google-attacks.mjs';
import { OFFLINE_CLIENT_ID, OFFLINE_T0, offlineClaims, offlineJwks, signOfflineToken } from './google-fixtures.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const clock = () => OFFLINE_T0;
const SUBJECT = '110169484474386276334';
const ATTACKER = '107691523809123456789';

// --- one live identity path, exercised offline ----------------------------------------
const operator = createIdentity({ label: 'nexa.operator', kind: 'agent', seed: '11'.repeat(32) });
const ownerKey = createIdentity({ label: 'nexa.owner', kind: 'agent', seed: '22'.repeat(32) });
const ledger = new OmegaLedger({ actor: operator, clock });
let issued = 0;
const google = buildGoogleIdentityTissue({
  clock,
  ledger,
  operator,
  clientId: OFFLINE_CLIENT_ID,
  jwks: createJwksSource({ seed: offlineJwks(['offline-key-1', 'offline-key-2']), clock }),
  generate: () => `challenge-${String((issued += 1)).padStart(12, '0')}`,
});
const challenge = google.begin();
const login = google.login({ token: signOfflineToken(offlineClaims({ nonce: challenge })), nonce: challenge });
if (login.ok !== true) throw new Error(`the vector run could not log in: ${login.code} ${login.step}`);

/** @param {string} scene @param {string} reason @returns {{scene: string, code: string, step: string}} */
const refusalOf = (scene, reason) => {
  const { google: organ, nonce, token } = refusalFor(reason);
  const outcome = organ.login({ token, nonce });
  if (outcome.ok === true) throw new Error(`the vector scene ${scene} was not refused`);
  return { scene, code: outcome.code, step: outcome.step };
};

/** Every refusal scene runs on its own organ: a spent challenge must not silence the next scene. */
function refusalFor(reason) {
  const organ = build();
  const nonce = organ.begin();
  const claims = offlineClaims({ nonce });
  const token = {
    'issuer-lookalike': () => signOfflineToken({ ...claims, iss: 'https://accounts.google.com.evil.example' }),
    'audience-of-another-client': () => signOfflineToken({ ...claims, aud: 'attacker.apps.googleusercontent.com' }),
    'authorized-party-is-another-client': () => signOfflineToken({ ...claims, aud: [OFFLINE_CLIENT_ID, 'attacker.apps.googleusercontent.com'], azp: 'attacker.apps.googleusercontent.com' }),
    'expired-token': () => signOfflineToken({ ...claims, exp: claims.iat - 1 }),
    'token-not-yet-valid': () => signOfflineToken({ ...claims, iat: claims.iat + 3_600 }),
    'no-subject': () => signOfflineToken({ ...claims, sub: undefined }),
    'signature-of-an-unpublished-key': () => signOfflineToken(claims, { kid: 'offline-key-3' }),
    'alg-none': () => {
      const header = Buffer.from(JSON.stringify({ alg: 'none', kid: 'offline-key-1' }), 'utf8').toString('base64url');
      const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url');
      return `${header}.${payload}.`;
    },
    'challenge-from-another-session': () => signOfflineToken({ ...claims, nonce: 'challenge-000000000099' }),
  }[reason];
  if (token === undefined) throw new Error(`unknown refusal scene: ${reason}`);
  return { google: organ, nonce, token: token() };
}

/** @returns {object} a fresh organ and the challenge generator, for the scenes above */
function build() {
  let counter = 0;
  const organ = buildGoogleIdentityTissue({
    clock,
    ledger: null,
    operator,
    clientId: OFFLINE_CLIENT_ID,
    jwks: createJwksSource({ seed: offlineJwks(['offline-key-1', 'offline-key-2']), clock }),
    generate: () => `challenge-${String((counter += 1)).padStart(12, '0')}`,
  });
  return {
    begin: () => organ.begin(),
    login: ({ token, nonce }) => organ.login({ token, nonce }),
  };
}

// --- bindings, approvals, vault, quota, egress ----------------------------------------
const bindingOrgan = buildGoogleIdentityTissue({
  clock,
  ledger,
  operator,
  clientId: OFFLINE_CLIENT_ID,
  jwks: createJwksSource({ seed: offlineJwks(['offline-key-1', 'offline-key-2']), clock }),
  generate: () => `challenge-${String((issued += 1)).padStart(12, '0')}`,
});
const binding = bindingOrgan.bindOwner({ sub_hash: login.principal.sub_hash, nexa_kid: ownerKey.kid, expires_at: '2027-09-18T12:00:00Z' });
const approvalRecords = [];
const approvals = createApprovalStore({ clock, record: (fields) => { approvalRecords.push(fields); return { hash: `sha256:${'e'.repeat(43)}`, seq: approvalRecords.length - 1 }; } });
const approval = approvals.grant({ operation: 'gmail.send', resource: 'net:google.gmail', action: 'send', owner_binding: binding.sub_hash, signer: ownerKey.kid });
const approvalOutcomes = {};
try {
  approvals.consume({ approval_id: approval.approval_id, resource: 'net:google.drive', action: 'read' });
  approvalOutcomes['approval-for-another-operation'] = 'ALLOW';
} catch (error) {
  approvalOutcomes['approval-for-another-operation'] = error.code;
}
approvals.consume({ approval_id: approval.approval_id, resource: 'net:google.gmail', action: 'send' });
try {
  approvals.consume({ approval_id: approval.approval_id, resource: 'net:google.gmail', action: 'send' });
  approvalOutcomes['replayed-approval'] = 'ALLOW';
} catch (error) {
  approvalOutcomes['replayed-approval'] = error.code;
}

const SUB = subHash(SUBJECT);
const vault = createTokenVault({
  clock,
  record: (fields) => { approvalRecords.push(fields); },
  secrets: {
    [`${SUB}|gmail`]: { access_token: 'ya29.a0AfH6SMBexampleaccessstokenvalue', refresh_token: '1//0eXamplerefreshtokenvalue', scopes: ['https://www.googleapis.com/auth/gmail.send'], expires_at: '2026-09-18T12:04:00Z' },
  },
});
const handle = vault.handleFor({ sub_hash: SUB, service: 'gmail', presenter: 'google.gmail' });
const vaultOutcomes = {};
try {
  vault.resolve({ handle, presenter: 'google.drive' });
  vaultOutcomes['handle-presented-by-another-cell'] = 'ALLOW';
} catch (error) {
  vaultOutcomes['handle-presented-by-another-cell'] = error.code;
}
try {
  vault.resolve({ handle, presenter: 'google.gmail' });
  vaultOutcomes['expired-with-no-refresh-port'] = 'ALLOW';
} catch (error) {
  vaultOutcomes['expired-with-no-refresh-port'] = error.code;
}

const quotaRecords = [];
const limiter = createLimiter({ clock, baseDelayMs: 1_000, maxDelayMs: 8_000, random: () => 0, record: (fields) => quotaRecords.push(fields) });
const backoff = [1, 2, 3, 4, 5, 6].map(() => limiter.observe({ service: 'gmail', status: 429 }).retry_after_ms);
const quotaOutcomes = {};
try {
  limiter.schedule({ service: 'gmail' });
  quotaOutcomes['call-while-backing-off'] = 'ALLOW';
} catch (error) {
  quotaOutcomes['call-while-backing-off'] = error.code;
}

const scan = scanForSecretMaterial({ authorization: 'Bearer ya29.a0AfH6SMBexampleaccessstokenvalue', body: 'nothing here' });

const payload = {
  nexa: '0.1',
  layer: 'google-identity',
  generated_by: 'tools/google-vectors.mjs',
  identity: {
    domain_separators: { subject: SUBJECT_DOMAIN, email: EMAIL_DOMAIN, nonce: NONCE_DOMAIN },
    stored_identity: 'sha256("NEXA/google1 subject\\u0000" || sub)',
    subject_hash: login.principal.sub_hash,
    verification_steps: [...VERIFICATION_STEPS],
    verified_checks: login.ok === true ? ['shape', 'signature', 'issuer', 'audience+azp', 'window', 'nonce', 'subject', 'email'] : [],
    principal_fields: Object.keys(login.principal).sort(),
    evidence: { records: ledger.length, chain_ok: verifyOmegaChain(ledger.entries()).ok, head_pinned: false },
  },
  refusals: [
    refusalOf('issuer-lookalike', 'issuer-lookalike'),
    refusalOf('audience-of-another-client', 'audience-of-another-client'),
    refusalOf('authorized-party-is-another-client', 'authorized-party-is-another-client'),
    refusalOf('expired-token', 'expired-token'),
    refusalOf('token-not-yet-valid', 'token-not-yet-valid'),
    refusalOf('no-subject', 'no-subject'),
    refusalOf('signature-of-an-unpublished-key', 'signature-of-an-unpublished-key'),
    refusalOf('alg-none', 'alg-none'),
    refusalOf('challenge-from-another-session', 'challenge-from-another-session'),
  ],
  membrane: {
    crossing: {
      kind: google.crossings()[0].kind,
      decision: google.crossings()[0].decision,
      from: google.crossings()[0].from,
      cell: google.crossings()[0].cell,
      receptor: google.crossings()[0].receptor,
      payload_digest: google.crossings()[0].detail.payload_digest ?? null,
    },
    contract: google.describe().contract,
  },
  jwks: {
    sources: Object.fromEntries(Object.entries(GOOGLE_KEY_SOURCES).map(([name, source]) => [name, { uri: source.uri, issuers: [...source.issuers], alg: source.alg, enabled: source.enabled !== false }])),
    policy: 'pinned by issuer, untrusted until validated, one refresh per unknown kid, then refuse',
    live: { source: google.jwks.describe().source, keys: google.jwks.describe().keys, kids: google.jwks.describe().kids },
  },
  scopes: {
    fields: [...SCOPE_TABLE_FIELDS],
    rules: ['No Cell → No Scope', 'No Action → No Scope', 'No documented question → No Scope'],
    phases: ['G0', 'G1', 'G2', 'G3', 'G4'],
    rows: GOOGLE_SCOPE_TABLE.map((row) => ({ cell: row.cell, action: row.action, scope: row.full_scope_uri, google: row.google_classification, v1_required: row.v1_required, approval_class: row.approval_class, phase: row.phase, rung: row.rung })),
    narrowest: (() => {
      const row = narrowestScope({ cell: 'google.drive', action: 'read.metadata', phase: 'G2' });
      return { cell: row.cell, action: row.action, scope: row.full_scope_uri, phase: row.phase, rung: row.rung };
    })(),
  },
  classes: {
    ladder: [...RISK_CLASSES],
    operations: GOOGLE_OPERATIONS.map((row) => ({ operation: row.operation, resource: row.resource, action: row.action, class: row.class, scope: row.scope === null ? null : `${row.scope.cell}.${row.scope.action}` })),
    cells: Object.fromEntries(Object.entries(GOOGLE_SERVICE_CELLS).map(([name, cell]) => [name, cell.max_class])),
    role_ceilings: { ...ROLE_CEILINGS },
    recovery_operations: [...RECOVERY_OPERATIONS],
    break_glass_max_ms: BREAK_GLASS_MAX_MS,
  },
  approvals: {
    fields: [...APPROVAL_FIELDS],
    operation_digest: operationDigest({ resource: 'net:google.gmail', action: 'send', scope: null }),
    single_use: approval.single_use,
    approval_id_shape: approval.approval_id.replace(/:[^:]+$/, ':<n>'),
    records: approvalRecords.slice(0, 1).map((record) => ({ kind: record.kind, decision: record.decision, resource: record.resource, action: record.action })),
    outcomes: approvalOutcomes,
  },
  token_vault: {
    handle: { handle: handle.handle, presenter: handle.presenter, has_material: ['access_token', 'refresh_token'].some((field) => Object.hasOwn(handle, field)) },
    refresh_margin_ms: 300_000,
    outcomes: vaultOutcomes,
  },
  quota: {
    default_limits: { calls: DEFAULT_LIMITS.default.calls, window_ms: DEFAULT_LIMITS.default.window_ms },
    backoff_ms: backoff,
    outcomes: quotaOutcomes,
    records: quotaRecords.slice(0, 1).map((record) => ({ kind: record.kind, decision: record.decision, resource: record.resource, action: record.action })),
  },
  egress: {
    patterns: SECRET_PATTERNS.map((pattern) => pattern.kind),
    scan: { clean: scan.clean, findings: scan.findings.map((finding) => ({ path: finding.path, kind: finding.kind })) },
    payload_digest: payloadDigest({ to: 'owner@example.com', subject: 'hello' }),
  },
  bindings: {
    active: { binding: binding.binding, role: binding.role, method: binding.method, created_by: binding.created_by === operator.kid ? 'operator' : 'unknown', sub_hash: binding.sub_hash, expires_at: binding.expires_at },
    fields: ['binding', 'sub_hash', 'nexa_kid', 'role', 'created_by', 'created_at', 'expires_at', 'method', 'reason', 'changes', 'sig'],
  },
  attacks: runGoogleAttackSuite().map((attack) => ({ id: attack.id, category: attack.category, blocked: attack.blocked, code: attack.code, step: attack.detail?.step ?? null })),
  /** What the identity path must never do, restated as the vectors a reader can check. The set
   *  is the closure record's (spec/google/closure-g0.md, § 2): record, vector and code must
   *  agree. */
  invariants: {
    identity_anchor: 'sub',
    email: 'display metadata',
    stored_identity: 'sha256("NEXA/google1 subject\u0000" || sub)',
    identity_authority_split: 'Google proves identity; NEXA decides authority',
    capability_subject: 'the service cell',
    owner_identity: 'never the capability subject; a login never creates a binding',
    class_source: 'resource, action and scope — never the cell’s opinion',
    class_d_requires: ['capability', 'policy', 'explicit owner approval'],
    no_write_before_evidence: 'an approval is in evidence before it authorizes, and is consumed with the call',
    break_glass: 'a bounded recovery state, never a second owner',
  },
};

const target = join(root, 'spec/vectors/google.json');
const text = `${JSON.stringify(payload, null, 2)}\n`;
if (process.argv.includes('--check')) {
  const current = readFileSync(target, 'utf8');
  if (current !== text) {
    process.stderr.write('google vectors are out of date: run `node tools/google-vectors.mjs`\n');
    process.exit(1);
  }
  process.stdout.write('google vectors are in sync\n');
} else {
  writeFileSync(target, text);
  process.stdout.write(`wrote spec/vectors/google.json (${text.length} bytes, ${payload.refusals.length} refusals, ${payload.scopes.rows.length} scope rows, ${payload.attacks.length} attacks)\n`);
}

// Re-exported so the vector run itself is usable as a probe in tests and reports.
export { payload as googleVectors };
