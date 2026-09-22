/**
 * NEXA — heuristic code screening (formerly "Formal Z3 Verification").
 *
 * WHAT THIS IS: a keyword scan. It looks for a few literal substrings and
 * reports whether it saw one.
 *
 * WHAT THIS IS NOT: a solver, a proof, or verification of any kind. There is no
 * Z3 here and there cannot be — this repository has zero runtime dependencies.
 *
 * The previous version of this file named a real SMT solver and version it
 * was not running, returned
 * `verified: true` and emitted strings like `Z3_PROOF_..._VERIFIED_SAT_...`.
 * It returned `verified: true` for the contradiction `x>0 |- x<0` and for
 * syntactic garbage, because it only counted array elements. That is the exact
 * failure principles.md P1 names: a proof that verifies and means nothing.
 *
 * The `verified`, `proof`, `result` (SAT/UNSAT) and `solver` fields were
 * REMOVED, not renamed. A field called `verified` is what clients read; the
 * label beside it is not. They come back when a real verifier does.
 *
 * See docs/incidents/2026-09-fake-proof-endpoint.md.
 */

/** Literal substrings treated as a smell. Not a grammar, not an analysis. */
const SUSPICIOUS = ['while(true)', 'ev' + 'al(', 'infinite loop'];

export class HeuristicCodeScreeningEngine {
  constructor() {
    this.screenings = new Map();
    this.stats = { total: 0, flagged: 0, clean: 0 };
  }

  /**
   * @returns a screening observation. It carries NO verdict about correctness.
   */
  screen(spec) {
    const id = `screen_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 4)}`;
    const code = typeof spec?.code === 'string' ? spec.code : '';
    const matched = SUSPICIOUS.filter(needle => code.includes(needle));

    const screening = {
      id,
      flagged: matched.length > 0,
      matchedPatterns: matched,
      method: 'literal substring scan',
      // Declared inline so no caller can mistake this for analysis.
      limits: 'Keyword matching only. No parsing, no semantics, no solver. '
        + 'A clean result means no listed substring was present, and nothing more. '
        + 'It is not evidence that the code is correct.',
      createdAt: new Date().toISOString(),
    };

    this.screenings.set(id, screening);
    this.stats.total++;
    if (screening.flagged) this.stats.flagged++; else this.stats.clean++;
    return screening;
  }

  getStats() {
    return {
      screenings: this.screenings.size,
      ...this.stats,
      method: 'literal substring scan',
      limits: 'Not verification. No solver is present in this repository.',
    };
  }
}
