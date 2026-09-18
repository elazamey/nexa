/**
 * `GOOGLE_SCOPE_TABLE` — the canonical scope constant.
 *
 * The table is the *only* place a Google OAuth scope exists in NEXA. Nothing is requested
 * because a service wanted it: a row exists because an enabled cell has a documented action
 * whose contract needs exactly that scope, said in the form of the single question the action
 * answers. The three admission rules are checked here, in code, not left to review:
 *
 *     No Cell → No Scope          a row always names the cell that owns it
 *     No Action → No Scope        a row always names the action that requires it
 *     No documented question → No Scope
 *                                 a row always names the question it answers
 *
 * Two further rules give the table teeth:
 *
 *   · **narrowest rung** — where a narrower scope answers the same question, the narrower one
 *     is rung 1 and is the one requested. `drive.file` with the Picker precedes
 *     `drive.readonly`; `gmail.metadata` precedes `gmail.readonly`; `calendar.events.readonly`
 *     precedes `calendar.readonly`.
 *   · **the provider's classification is part of the row** — `google_classification` is copied
 *     from the provider's own published scope list, never from memory, and a value that has not
 *     been re-read is marked `(to confirm)`. Google's classification and NEXA's risk class are
 *     orthogonal and **both** bind: reading a mailbox is *restricted* on Google's side while
 *     sending is only *sensitive* — the reverse of NEXA's ladder, where sending is class D.
 *
 * A scope outside this table cannot be requested by any cell, in any phase, and **no
 * configuration value can widen it**: widening is a new consent, a new evidence record and a
 * review.
 */
import { OmegaError } from '../../../../compiler/index.js';

const AUTH = 'https://www.googleapis.com/auth/';

/** The fields every row must carry: the shape the posture check and the vectors assert. */
export const SCOPE_TABLE_FIELDS = Object.freeze([
  'cell',
  'action',
  'question_answered',
  'full_scope_uri',
  'google_classification',
  'v1_required',
  'approval_class',
]);

/** @type {ReadonlyArray<Readonly<object>>} */
export const GOOGLE_SCOPE_TABLE = Object.freeze([
  // --- G0: the identity path. The ID-token scopes only, which is why they are the only
  // rows whose phase is the current one. Google's testing rules exempt exactly this subset
  // from the seven-day authorization expiry, so G0 holds no refresh token at all.
  { cell: 'google.identity', action: 'verify', question_answered: 'who is this subject?', full_scope_uri: 'openid', google_classification: 'non-sensitive', v1_required: true, approval_class: null, phase: 'G0', rung: 1 },
  { cell: 'google.identity', action: 'verify', question_answered: 'who is this subject?', full_scope_uri: `${AUTH}userinfo.email`, google_classification: 'non-sensitive', v1_required: true, approval_class: null, phase: 'G0', rung: 1 },
  { cell: 'google.identity', action: 'verify', question_answered: 'who is this subject?', full_scope_uri: `${AUTH}userinfo.profile`, google_classification: 'non-sensitive', v1_required: true, approval_class: null, phase: 'G0', rung: 1 },

  // --- G1: no OAuth at all. A restricted API key in the vault, handled like any other secret.
  { cell: 'google.gemini', action: 'invoke', question_answered: 'what does the model answer?', full_scope_uri: null, google_classification: 'n/a (api key, no oauth)', v1_required: false, approval_class: 'B', phase: 'G1', rung: 1 },

  // --- G2: reads, narrowest rung first. `drive.file` is non-sensitive and per-file; the
  // whole-account reads are restricted on Google's side and require the app to qualify.
  { cell: 'google.drive', action: 'read.metadata', question_answered: 'what files exist, and what are they called?', full_scope_uri: `${AUTH}drive.file`, google_classification: 'non-sensitive', v1_required: false, approval_class: 'A', phase: 'G2', rung: 1 },
  { cell: 'google.drive', action: 'read.metadata', question_answered: 'what files exist, and what are they called?', full_scope_uri: `${AUTH}drive.metadata.readonly`, google_classification: 'restricted', v1_required: false, approval_class: 'A', phase: 'G2', rung: 2 },
  { cell: 'google.drive', action: 'read.content', question_answered: 'what is inside this file the user chose?', full_scope_uri: `${AUTH}drive.file`, google_classification: 'non-sensitive', v1_required: false, approval_class: 'B', phase: 'G2', rung: 1 },
  { cell: 'google.drive', action: 'read.content', question_answered: 'what is inside this file the user chose?', full_scope_uri: `${AUTH}drive.readonly`, google_classification: 'restricted', v1_required: false, approval_class: 'B', phase: 'G2', rung: 2 },
  { cell: 'google.sheets', action: 'read.range', question_answered: 'what is the value in this range of the chosen sheet?', full_scope_uri: `${AUTH}drive.file`, google_classification: 'non-sensitive', v1_required: false, approval_class: 'B', phase: 'G2', rung: 1 },
  { cell: 'google.sheets', action: 'read.range', question_answered: 'what is the value in this range of the chosen sheet?', full_scope_uri: `${AUTH}spreadsheets.readonly`, google_classification: 'sensitive (to confirm)', v1_required: false, approval_class: 'B', phase: 'G2', rung: 2 },

  // --- G3: Gmail and Calendar. Reading a mailbox is *restricted*; sending is *sensitive*.
  { cell: 'google.gmail', action: 'read.message', question_answered: 'what does this message say?', full_scope_uri: `${AUTH}gmail.metadata`, google_classification: 'restricted', v1_required: false, approval_class: 'B', phase: 'G3', rung: 1 },
  { cell: 'google.gmail', action: 'read.message', question_answered: 'what does this message say?', full_scope_uri: `${AUTH}gmail.readonly`, google_classification: 'restricted', v1_required: false, approval_class: 'B', phase: 'G3', rung: 2 },
  { cell: 'google.gmail', action: 'send', question_answered: 'what message leaves the account?', full_scope_uri: `${AUTH}gmail.send`, google_classification: 'sensitive', v1_required: false, approval_class: 'D', phase: 'G3', rung: 1 },
  { cell: 'google.calendar', action: 'read.events', question_answered: 'what is on the calendar?', full_scope_uri: `${AUTH}calendar.events.readonly`, google_classification: 'sensitive (to confirm)', v1_required: false, approval_class: 'B', phase: 'G3', rung: 1 },
  { cell: 'google.calendar', action: 'read.events', question_answered: 'what is on the calendar?', full_scope_uri: `${AUTH}calendar.readonly`, google_classification: 'sensitive (to confirm)', v1_required: false, approval_class: 'B', phase: 'G3', rung: 2 },

  // --- G4: writes. A calendar write is class C — and becomes class D the moment it notifies
  // anyone else, which is the kind of judgement that has to be written down, not inferred.
  { cell: 'google.calendar', action: 'write.event', question_answered: 'what is written to the calendar?', full_scope_uri: `${AUTH}calendar.events`, google_classification: 'sensitive (to confirm)', v1_required: false, approval_class: 'C', phase: 'G4', rung: 1, note: 'class D when the event notifies attendees' },
].map((row) => Object.freeze(row)));

/** @param {string} cell @param {string} action @returns {ReadonlyArray<object>} rows, rung order */
export function scopeRows(cell, action) {
  return GOOGLE_SCOPE_TABLE
    .filter((row) => row.cell === cell && row.action === action)
    .sort((left, right) => left.rung - right.rung);
}

/** @returns {object|null} the narrowest rung that answers this cell's question in this phase */
export function narrowestScope({ cell, action, phase = 'G0' }) {
  return scopeRows(cell, action).find((row) => row.phase === phase) ?? null;
}

/**
 * The admission rule, in code. A scope that is not a row of the table — or is a row of a phase
 * that has not been approved and opened — is refused before anything is requested.
 *
 * @param {{cell: string, action: string, scope: string, phase?: string}} input
 * @returns {Readonly<object>} the admitting row
 */
export function admitScope({ cell, action, scope, phase = 'G0' }) {
  if (typeof cell !== 'string' || typeof action !== 'string' || typeof scope !== 'string') {
    throw new OmegaError('OMEGA_E_SCOPE', 'a scope request names a cell, an action and a scope');
  }
  const rows = scopeRows(cell, action);
  if (rows.length === 0) {
    throw new OmegaError('OMEGA_E_SCOPE', `${cell}.${action} has no documented question, so it may not request any scope`, { cell, action });
  }
  const row = rows.find((candidate) => candidate.full_scope_uri === scope);
  if (row === undefined) {
    throw new OmegaError('OMEGA_E_SCOPE', `${scope} is not a documented scope of ${cell}.${action}`, { cell, action, documented: rows.map((candidate) => candidate.full_scope_uri) });
  }
  if (row.phase !== phase) {
    throw new OmegaError('OMEGA_E_SCOPE', `${scope} belongs to phase ${row.phase}; phase ${phase} may not request it`, { scope, row_phase: row.phase, phase });
  }
  return row;
}

/** @param {string} phase @returns {object[]} the rows a phase is allowed to request at all */
export function phaseRows(phase) {
  return GOOGLE_SCOPE_TABLE.filter((row) => row.phase === phase);
}
