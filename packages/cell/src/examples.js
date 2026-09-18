/**
 * A working Tissue, Organ and Organism — the shapes from the directive, made executable.
 *
 * This exists so the cellular layer is not a promise in a document: the same module that
 * `npm run demo:cellular` prints is the module the tests exercise. It is a *sample*
 * organism, not a claim about a production one.
 *
 * Every step here is a real membrane crossing: the tissue mints, the destination verifies,
 * a payload is type-checked, the call is budgeted, the work happens and the evidence lands
 * in the ledger with a hash and a signature.
 */
import { canonicalBytes } from '../../ast/index.js';
import { OmegaError } from '../../compiler/index.js';
import { createIdentity } from '../../identity/index.js';
import { createGuarantor } from './guarantor.js';
import { createCell } from './cell.js';
import { createTissue, seedFor } from './tissue.js';
import { createOrgan } from './organ.js';
import { createOrganism } from './organism.js';

/** A deterministic local memory: digests only, never values. */
function localMemory() {
  const items = new Map();
  return {
    remember(key, value) {
      const digest = `sha256:${Buffer.from(canonicalBytes({ key, value })).toString('base64url').slice(0, 43)}`;
      items.set(key, digest);
      return digest;
    },
    recall(key) {
      return items.get(key) ?? null;
    },
    size() {
      return items.size;
    },
  };
}

/**
 * A receptor returns a value or throws a registered Ω error. There is no third option and
 * no partial success: a cell that cannot answer says why, in the shared vocabulary, and the
 * membrane records the refusal.
 */

/**
 * @param {{clock?: () => Date, ledger?: object}} [input]
 * @returns {{operator: object, guarantor: object, cells: Record<string, object>, tissues: Record<string, object>,
 *            organs: Record<string, object>, organism: object, mission: Function}}
 */
export function buildCodingOrganism({ clock = () => new Date(), ledger = null } = {}) {
  const operator = createIdentity({ label: 'nexa.operator', kind: 'agent', seed: seedFor('nexa.operator@demo') });
  const guarantor = createGuarantor({ operator, clock, ledger });
  const memory = localMemory();

  const cellFor = (name, receptors, nucleus) => createCell({
    name,
    identity: createIdentity({ label: name, kind: 'agent', seed: seedFor(name) }),
    nucleus,
    receptors,
    port: { verify: (token, input) => guarantor.verify(token, input), record: (entry) => guarantor.record(entry) },
    clock,
  });

  const planner = cellFor('planner', {
    plan: {
      description: 'produce a plan; never a decision',
      accepts: ['request'],
      handler: ({ payload }) => ({ steps: ['plan', 'code', 'test', 'review'], request_digest: memory.remember('plan.request', payload) }),
    },
  }, { module: 'planner@1', invariants: ['plans are proposals, not authority'] });

  const coder = cellFor('coder', {
    implement: {
      description: 'turn a plan into a patch',
      accepts: ['steps'],
      handler: ({ payload }) => ({ patch: `patch(${payload.steps.length} steps)`, patch_digest: memory.remember('patch', payload.steps) }),
    },
  }, { module: 'coder@1', invariants: ['a patch is data, never an applied write'] });

  const tester = cellFor('tester', {
    run: {
      description: 'run the tests against a patch',
      accepts: ['patch'],
      handler: ({ payload }) => {
        if (typeof payload.patch !== 'string' || payload.patch.length === 0) {
          throw new OmegaError('OMEGA_E_SCHEMA', 'a test needs a patch');
        }
        return { tests: 12, passed: 12, verdict: 'PASS' };
      },
    },
  }, { module: 'tester@1', invariants: ['tests report, they do not decide'] });

  const reviewer = cellFor('reviewer', {
    review: {
      description: 'review the evidence of a change',
      accepts: ['tests', 'patch', 'patch_digest'],
      handler: ({ payload }) => ({ verdict: payload.tests.passed === payload.tests.tests ? 'APPROVE' : 'REJECT', reviewed: payload.patch_digest ?? null }),
    },
  }, { module: 'reviewer@1', invariants: ['review produces an opinion, never a verdict'] });

  const archivist = cellFor('archivist', {
    remember: {
      description: 'write a digest into local memory',
      accepts: ['value', 'value_digest'],
      handler: ({ payload }) => ({ digest: memory.remember('value', payload.value ?? payload.value_digest) }),
    },
    recall: {
      description: 'read a digest from local memory',
      accepts: ['key'],
      requires: ['owner'],
      handler: ({ payload }) => ({ digest: memory.recall(payload.key) }),
    },
  }, { module: 'archivist@1', invariants: ['memory holds digests, never values'] });

  const watcher = cellFor('watcher', {
    report: {
      description: 'report an anomaly — evidence, not a verdict',
      accepts: ['signal'],
      handler: ({ payload }) => ({ anomaly: payload.signal, severity: 'observed' }),
    },
  }, { module: 'watcher@1', invariants: ['observations are OBSERVED, never VERIFIED'] });

  const coding = createTissue({
    name: 'coding',
    operator,
    guarantor,
    cells: [planner, coder, tester, reviewer],
    routes: [
      { from: 'planner', to: 'coder', receptor: 'implement' },
      { from: 'coder', to: 'tester', receptor: 'run' },
      { from: 'tester', to: 'reviewer', receptor: 'review' },
    ],
    entryPoints: [{ to: 'planner', receptor: 'plan', as: 'plan' }],
    clock,
  });

  const memoryTissue = createTissue({
    name: 'memory',
    operator,
    guarantor,
    cells: [archivist],
    entryPoints: [
      { to: 'archivist', receptor: 'remember', as: 'remember' },
      { to: 'archivist', receptor: 'recall', as: 'recall' },
    ],
    clock,
  });

  const securityTissue = createTissue({
    name: 'security',
    operator,
    guarantor,
    cells: [watcher],
    entryPoints: [{ to: 'watcher', receptor: 'report', as: 'report' }],
    clock,
  });

  const software = createOrgan({
    name: 'software',
    operator,
    tissues: [coding],
    entryPoints: [{ to: 'coding.planner', receptor: 'plan', as: 'plan' }],
    clock,
  });

  const memoryOrgan = createOrgan({
    name: 'memory',
    operator,
    tissues: [memoryTissue],
    entryPoints: [{ to: 'memory.archivist', receptor: 'remember', as: 'remember' }],
    clock,
  });

  const securityOrgan = createOrgan({
    name: 'security',
    operator,
    tissues: [securityTissue],
    entryPoints: [{ to: 'security.watcher', receptor: 'report', as: 'report' }],
    clock,
  });

  const organism = createOrganism({
    name: 'nexa',
    operator,
    organs: [software, memoryOrgan, securityOrgan],
    // The one cross-organ route the coding tissue needs: its reviewer writes the digest
    // into the memory organ. Declared *before* traffic — a route added later would be a
    // topology change at run time, and the guarantor refuses to widen once sealed.
    routes: [{ from: { organ: 'software', cell: 'reviewer' }, to: { organ: 'memory', cell: 'archivist' }, receptor: 'remember' }],
    clock,
  });

  coding.cell('planner').activate();
  coder.activate();
  tester.activate();
  reviewer.activate();
  archivist.activate();
  watcher.activate();

  /**
   * The CODING TISSUE walk from the directive: Planner → Coder → Tester → Reviewer → Evidence.
   * @param {{request: string}} input
   */
  function mission({ request }) {
    const transcript = [];
    const plan = coding.send({ from: 'planner', to: 'coder', receptor: 'implement', payload: { steps: [request] } });
    transcript.push({ hop: 'planner → coder.implement', result: plan.ok ? plan.value : plan.code });
    if (!plan.ok) return { ok: false, transcript, code: plan.code };

    const tests = coding.send({ from: 'coder', to: 'tester', receptor: 'run', payload: { patch: plan.value.patch } });
    transcript.push({ hop: 'coder → tester.run', result: tests.ok ? tests.value : tests.code });
    if (!tests.ok) return { ok: false, transcript, code: tests.code };

    const review = coding.send({
      from: 'tester',
      to: 'reviewer',
      receptor: 'review',
      payload: { tests: tests.value, patch_digest: plan.value.patch_digest },
    });
    transcript.push({ hop: 'tester → reviewer.review', result: review.ok ? review.value : review.code });
    if (!review.ok) return { ok: false, transcript, code: review.code };

    // Cross-organ traffic goes through the organism: one place decides whether one organ's
    // cell may reach another organ's cell.
    const stamped = organism.send({
      from: { organ: 'software', cell: 'reviewer' },
      to: { organ: 'memory', cell: 'archivist' },
      receptor: 'remember',
      payload: { value_digest: plan.value.patch_digest },
    });
    transcript.push({ hop: 'reviewer → archivist.remember', result: stamped.ok ? stamped.value : stamped.code });

    return {
      ok: stamped.ok,
      transcript,
      sample: organism.sample(),
      evidence: organism.evidence(),
      usage: organism.usage(),
    };
  }

  return { operator, guarantor, cells: { planner, coder, tester, reviewer, archivist, watcher }, tissues: { coding, memory: memoryTissue, security: securityTissue }, organs: { software, memory: memoryOrgan, security: securityOrgan }, organism, mission };
}
