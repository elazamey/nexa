/**
 * Division — a general cell specializes, and each child gets **only** the capabilities it
 * needs.
 *
 * The rule that has teeth: `specialize()` will refuse to hand a child a capability the
 * parent never had (`OMEGA_E_CELL_AMPLIFY`), because division that widens authority is not
 * division, it is privilege escalation through refactoring.
 */
import { OmegaError } from '../../compiler/index.js';

/**
 * @param {object} input
 * @param {object} input.parent the cell being divided; its name is the general role
 * @param {Array<{name: string, capabilities: string[], justify: string, kind?: string}>} input.children
 *   `capabilities` are `resource:action` names the child keeps
 * @returns {{division: string, parent: string, children: object[]}}
 */
export function specialize({ parent, children }) {
  if (typeof parent?.name !== 'string') throw new OmegaError('OMEGA_E_SCHEMA', 'division needs a parent cell');
  if (!Array.isArray(children) || children.length < 2) {
    throw new OmegaError('OMEGA_E_SCHEMA', 'division produces at least two children');
  }
  const parentCapabilities = new Set(parent.receptors.map((receptor) => `cell:${parent.name}:${receptor}`));
  const seen = new Set();
  const born = children.map((child) => {
    if (typeof child?.name !== 'string' || !/^[a-z][a-z0-9._-]{0,63}$/.test(child.name)) {
      throw new OmegaError('OMEGA_E_SCHEMA', 'a child cell needs a lowercase name');
    }
    if (seen.has(child.name)) throw new OmegaError('OMEGA_E_DUPLICATE', `two children are named ${child.name}`);
    seen.add(child.name);
    if (child.name === parent.name) throw new OmegaError('OMEGA_E_SCHEMA', 'a child cannot share the parent name');
    if (typeof child.justify !== 'string' || child.justify.length === 0) {
      throw new OmegaError('OMEGA_E_SCHEMA', `${child.name} must state why it exists`);
    }
    const capabilities = [...new Set(child.capabilities ?? [])].sort();
    if (capabilities.length === 0) throw new OmegaError('OMEGA_E_SCHEMA', `${child.name} must keep at least one capability`);
    for (const capability of capabilities) {
      // `cell:<parent>:<receptor>` is the parent's own right. A child named differently
      // cannot present it, so naming it here is either a mistake or an attempt to climb.
      if (capability.startsWith(`cell:${parent.name}:`) && capabilities.length > parentCapabilities.size) {
        throw new OmegaError('OMEGA_E_CELL_AMPLIFY', `${child.name} asks for more than ${parent.name} held`);
      }
      const receptor = capability.split(':').pop();
      if (!parent.receptors.includes(receptor)) {
        throw new OmegaError('OMEGA_E_CELL_AMPLIFY', `${child.name} asks for ${capability}, which ${parent.name} never had`);
      }
    }
    return {
      name: child.name,
      kind: child.kind ?? parent.kind,
      parent: parent.name,
      receptor_source: parent.nucleus.module,
      capabilities,
      justified_by: child.justify,
    };
  });
  return {
    division: `${parent.name} -> ${born.map((child) => child.name).join(', ')}`,
    parent: parent.name,
    parent_module: parent.nucleus.module,
    children: born,
  };
}

/**
 * A division is only real once each child has its own nucleus, membrane and budget.
 * This builds the cell specifications; the host turns them into cells.
 * @param {{parent: object, children: object[]}} plan
 * @param {string} childName
 * @returns {object} the specification for one child
 */
export function childSpec(plan, childName) {
  const child = plan.children.find((entry) => entry.name === childName);
  if (child === undefined) throw new OmegaError('OMEGA_E_SCHEMA', `no child ${childName} in this division`);
  const version = Number(plan.parent_module.split('@')[1]) + 1;
  return {
    name: child.name,
    kind: child.kind,
    nucleus: {
      module: `${child.name}@${version}`,
      invariants: [
        `specialisation of ${plan.parent}: ${child.justified_by}`,
        'a child takes only the capabilities it needs',
      ],
    },
    capabilities: child.capabilities,
  };
}
