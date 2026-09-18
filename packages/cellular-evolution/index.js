/**
 * @nexa/cellular-evolution — how the cellular layer changes, and how it refuses to.
 *
 * Division specializes; fusion produces a new immutable version; quarantine is terminal.
 * Nothing in this package activates anything: it plans, it checks, and it hands the
 * decision to the Evolution Gate that already exists.
 */
export { specialize, childSpec } from './src/division.js';
export { planFusion, runFusion, FUSION_STAGES } from './src/fusion.js';
export { Quarantine, QUARANTINE_STATES } from './src/quarantine.js';
