/**
 * Delegation (attenuation) and verification.
 *
 * The one rule that makes capabilities safe:
 *   a child grant must be a SUBSET of its parent, on every axis —
 *   resource scope, actions, time window, use budget, depth, and constraints.
 *
 * `attenuate()` refuses to produce a child that widens anything; `verifyCapability()`
 * re-checks the same property from the wire, because a token arriving over the
 * network may have been built by someone else entirely.
 */
import {
  NexaError,
  canonicalBytes,
  compareInstant,
  parseInstant,
  validateSignature,
} from '../../ast/index.js';
import {
  KeyPair,
  publicKeyFromKeyId,
  randomId,
  verifyBytes,
} from '../../crypto/index.js';
import {
  capabilityDepth,
  capabilityIdOf,
  capabilityPayload,
  delegationPayload,
  normalizeCaveats,
  normalizeConstraints,
  validateCapabilityShape,
} from './token.js';

/** Child scope must be the parent scope or nested below it. */
export function isResourceSubset(parentResource, childResource) {
  if (parentResource === childResource) return true;
  if (!parentResource.includes(':')) return false;
  return childResource.startsWith(`${parentResource}:`) || childResource.startsWith(`${parentResource}.`);
}

/** @param {string[]} parentActions @param {string[]} childActions */
export function areActionsSubset(parentActions, childActions) {
  const allowed = new Set(parentActions);
  return childActions.every((action) => allowed.has(action));
}

/**
 * Constraint narrowing: numbers may only decrease, strings must match exactly,
 * arrays must be subsets.
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function isConstraintSubset(parentConstraints, childConstraints) {
  for (const [key, childValue] of Object.entries(childConstraints)) {
    const parentValue = parentConstraints[key];
    if (parentValue === undefined) {
      return { ok: false, reason: `constraint "${key}" was introduced by the child` };
    }
    if (typeof childValue === 'number') {
      if (typeof parentValue !== 'number') {
        return { ok: false, reason: `constraint "${key}" changed type` };
      }
      if (childValue > parentValue) {
        return { ok: false, reason: `constraint "${key}" was relaxed (${parentValue} -> ${childValue})` };
      }
      continue;
    }
    if (typeof childValue === 'string') {
      if (childValue !== parentValue) {
        return { ok: false, reason: `constraint "${key}" changed value` };
      }
      continue;
    }
    if (!Array.isArray(parentValue)) {
      return { ok: false, reason: `constraint "${key}" changed type` };
    }
    const allowed = new Set(parentValue);
    for (const item of childValue) {
      if (!allowed.has(item)) {
        return { ok: false, reason: `constraint "${key}" added value "${item}"` };
      }
    }
  }
  return { ok: true };
}

/**
 * @param {object} parent
 * @param {object} childInput
 * @param {{keys: KeyPair, kid: string}} [childInput.delegator]
 */
function assertNoAmplification(parent, childInput, delegatorKid) {
  if (![parent.subject, parent.issuer].includes(delegatorKid)) {
    throw new NexaError(
      'NEXA_E_CAP_AMPLIFY',
      'only the capability subject (or its issuer) may delegate it',
      { delegator: delegatorKid, allowed: [parent.subject, parent.issuer] },
    );
  }
  if (!isResourceSubset(parent.resource, childInput.resource)) {
    throw new NexaError('NEXA_E_CAP_AMPLIFY', `resource scope widened: ${parent.resource} -> ${childInput.resource}`);
  }
  if (!areActionsSubset(parent.actions, childInput.actions)) {
    throw new NexaError('NEXA_E_CAP_AMPLIFY', 'action set widened', {
      parent: parent.actions,
      child: childInput.actions,
    });
  }
  if ((parent.caveats.max_depth ?? 0) <= 0) {
    throw new NexaError('NEXA_E_CAP_AMPLIFY', 'parent capability is not delegable (max_depth is 0)');
  }
  const childCaveats = normalizeCaveats(childInput.caveats, { now: parseInstant(parent.caveats.nbf) });
  if (compareInstant(childCaveats.nbf, parent.caveats.nbf) < 0) {
    throw new NexaError('NEXA_E_CAP_AMPLIFY', 'child starts earlier than its parent');
  }
  if (compareInstant(childCaveats.exp, parent.caveats.exp) > 0) {
    throw new NexaError('NEXA_E_CAP_AMPLIFY', 'child expires later than its parent');
  }
  if (childCaveats.max_uses > parent.caveats.max_uses) {
    throw new NexaError('NEXA_E_CAP_AMPLIFY', 'child use budget exceeds its parent');
  }
  if (childCaveats.max_depth > (parent.caveats.max_depth ?? 0) - 1) {
    throw new NexaError('NEXA_E_CAP_AMPLIFY', 'child delegation depth exceeds its parent');
  }
  const constraints = normalizeConstraints(childInput.constraints);
  const narrowing = isConstraintSubset(parent.constraints, constraints);
  if (!narrowing.ok) {
    throw new NexaError('NEXA_E_CAP_AMPLIFY', narrowing.reason);
  }
  return { childCaveats, constraints };
}

/**
 * Creates a delegated (attenuated) capability signed by the holder.
 * @param {object} parentToken
 * @param {object} input
 * @param {{keys: KeyPair, kid: string}} input.delegator
 * @param {string} input.subject
 * @param {string} input.resource
 * @param {string[]} input.actions
 * @param {object} input.caveats
 * @param {object} [input.constraints]
 * @param {string} [input.id]
 * @param {string} [input.note]
 * @returns {object} child token embedding its parent
 */
export function attenuate(parentToken, {
  delegator,
  subject,
  resource,
  actions,
  caveats,
  constraints,
  id,
  note,
}) {
  validateCapabilityShape(parentToken);
  if (!(delegator?.keys instanceof KeyPair)) {
    throw new NexaError('NEXA_E_KEY', 'delegator must carry a KeyPair');
  }
  const input = { resource, actions, caveats, constraints };
  const { childCaveats, constraints: normalizedConstraints } = assertNoAmplification(
    parentToken,
    input,
    delegator.kid,
  );
  for (const action of actions) {
    if (typeof action !== 'string' || !/^[a-z][a-z0-9_-]{0,31}$/.test(action)) {
      throw new NexaError('NEXA_E_CAP_INVALID', `invalid action: ${String(action)}`);
    }
  }
  const uniqueActions = [...new Set(actions)].sort();
  const child = {
    nexa: '0.1',
    id: id === undefined ? randomId('urn:nexa:cap:') : capabilityIdOf({ id }),
    issuer: delegator.kid,
    subject,
    resource,
    actions: uniqueActions,
    caveats: childCaveats,
    constraints: normalizedConstraints,
    ...(note === undefined ? {} : { note }),
  };
  const payload = delegationPayload(child, parentToken);
  return {
    ...child,
    proof: {
      kind: 'chain',
      parent: parentToken,
      alg: 'ed25519',
      kid: delegator.kid,
      val: delegator.keys.sign(payload),
    },
  };
}

/**
 * Verifies a capability end-to-end: signatures, chain linkage, attenuation,
 * revocation, freshness, audience, and use budget.
 * @param {object} token
 * @param {object} [options]
 * @param {string} [options.audience] required subject (the endpoint's own kid)
 * @param {Date} [options.now]
 * @param {Set<string>|string[]} [options.revoked]
 * @param {(id: string) => number} [options.uses] number of times a capability id was already used
 * @param {string} [options.action] requested action
 * @param {string} [options.resource] requested resource
 * @returns {{ok: true, grant: object}}
 */
export function verifyCapability(token, options = {}) {
  validateCapabilityShape(token);
  const now = options.now ?? new Date();
  const revoked = toSet(options.revoked);
  const uses = typeof options.uses === 'function' ? options.uses : () => 0;

  const links = [];
  let cursor = token;
  for (;;) {
    links.unshift(cursor);
    if (cursor.proof.kind !== 'chain') break;
    cursor = cursor.proof.parent;
    if (links.length > 16) {
      throw new NexaError('NEXA_E_CAP_INVALID', 'capability chain is unreasonably deep');
    }
  }

  const nowMs = now.getTime();
  let effectiveExp = null;
  let effectiveNbf = null;
  let remainingUses = Number.POSITIVE_INFINITY;
  let rootDepthBudget = null;

  for (let index = 0; index < links.length; index += 1) {
    const link = links[index];
    const parent = index === 0 ? null : links[index - 1];
    if (parent !== null) validateCapabilityShape(link); // embedded parents are untrusted input too

    // --- signature ---
    if (link.proof.kind === 'ed25519') {
      const ok = verifyBytes(publicKeyFromKeyId(link.proof.kid), capabilityPayload(link), link.proof.val);
      if (!ok) throw new NexaError('NEXA_E_SIG', `capability ${link.id} has an invalid issuer signature`);
    } else {
      // The delegation signature covers the child's fields *and* a hash of the exact
      // parent it was derived from, so a child cannot be re-parented under a more
      // permissive token after the fact.
      const payload = delegationPayload(link, parent);
      const ok = verifyBytes(publicKeyFromKeyId(link.proof.kid), payload, link.proof.val);
      if (!ok) {
        throw new NexaError('NEXA_E_SIG', `capability ${link.id} has an invalid delegation signature`);
      }
    }

    // --- linkage + attenuation ---
    if (parent !== null) {
      if (![parent.subject, parent.issuer].includes(link.issuer)) {
        throw new NexaError('NEXA_E_CAP_AMPLIFY', `capability ${link.id} was not delegated by its parent's subject`);
      }
      if (!isResourceSubset(parent.resource, link.resource)) {
        throw new NexaError('NEXA_E_CAP_AMPLIFY', `capability ${link.id} widened its resource scope`);
      }
      if (!areActionsSubset(parent.actions, link.actions)) {
        throw new NexaError('NEXA_E_CAP_AMPLIFY', `capability ${link.id} widened its action set`);
      }
      const narrowing = isConstraintSubset(parent.constraints, link.constraints);
      if (!narrowing.ok) {
        throw new NexaError('NEXA_E_CAP_AMPLIFY', `capability ${link.id}: ${narrowing.reason}`);
      }
      if (compareInstant(link.caveats.nbf, parent.caveats.nbf) < 0) {
        throw new NexaError('NEXA_E_CAP_AMPLIFY', `capability ${link.id} starts before its parent`);
      }
      if (compareInstant(link.caveats.exp, parent.caveats.exp) > 0) {
        throw new NexaError('NEXA_E_CAP_AMPLIFY', `capability ${link.id} outlives its parent`);
      }
      if (link.caveats.max_uses > parent.caveats.max_uses) {
        throw new NexaError('NEXA_E_CAP_AMPLIFY', `capability ${link.id} has a larger budget than its parent`);
      }
      if ((link.caveats.max_depth ?? 0) >= (parent.caveats.max_depth ?? 0)) {
        throw new NexaError('NEXA_E_CAP_AMPLIFY', `capability ${link.id} can be delegated deeper than its parent`);
      }
    }

    // --- revocation ---
    if (revoked.has(link.id)) {
      throw new NexaError('NEXA_E_CAP_REVOKED', `capability ${link.id} is revoked`);
    }

    // --- freshness ---
    const nbfMs = parseInstant(link.caveats.nbf);
    const expMs = parseInstant(link.caveats.exp);
    if (nowMs < nbfMs) {
      throw new NexaError('NEXA_E_CAP_EXPIRED', `capability ${link.id} is not yet valid`);
    }
    if (nowMs >= expMs) {
      throw new NexaError('NEXA_E_CAP_EXPIRED', `capability ${link.id} has expired`);
    }
    effectiveNbf = effectiveNbf === null || nbfMs > effectiveNbf ? nbfMs : effectiveNbf;
    effectiveExp = effectiveExp === null || expMs < effectiveExp ? expMs : effectiveExp;

    // --- use budget ---
    const used = uses(link.id);
    const left = link.caveats.max_uses - used;
    if (left <= 0) {
      throw new NexaError('NEXA_E_CAP_USES', `capability ${link.id} exhausted its use budget`, {
        max_uses: link.caveats.max_uses,
        used,
      });
    }
    remainingUses = Math.min(remainingUses, left);
  }

  const root = links[0];
  rootDepthBudget = root.caveats.max_depth ?? 0;
  const depth = capabilityDepth(token);
  if (depth > rootDepthBudget) {
    throw new NexaError('NEXA_E_CAP_AMPLIFY', 'capability chain is deeper than its root allows');
  }

  // --- audience ---
  if (options.audience !== undefined && token.subject !== options.audience) {
    throw new NexaError('NEXA_E_CAP_AUDIENCE', 'capability is addressed to a different subject', {
      expected: options.audience,
      actual: token.subject,
    });
  }
  const delegateTo = token.constraints.delegate_to;
  if (Array.isArray(delegateTo) && options.audience !== undefined && !delegateTo.includes(options.audience)) {
    throw new NexaError('NEXA_E_CAP_AUDIENCE', 'capability constrains who may use it');
  }

  // --- requested scope ---
  if (options.action !== undefined && !token.actions.includes(options.action)) {
    throw new NexaError('NEXA_E_POLICY', `capability does not grant action "${options.action}"`, {
      granted: token.actions,
    });
  }
  if (options.resource !== undefined && options.resource !== token.resource
      && !isResourceSubset(token.resource, options.resource)) {
    throw new NexaError('NEXA_E_POLICY', `capability does not cover resource "${options.resource}"`, {
      granted: token.resource,
    });
  }

  return {
    ok: true,
    grant: {
      id: token.id,
      issuer: root.issuer,
      holder: token.subject,
      delegator: token.issuer,
      resource: token.resource,
      actions: [...token.actions],
      constraints: { ...token.constraints },
      depth,
      max_depth: rootDepthBudget,
      nbf: new Date(effectiveNbf).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      exp: new Date(effectiveExp).toISOString().replace(/\.\d{3}Z$/, 'Z'),
      remaining_uses: remainingUses,
      chain: links.map((link) => link.id),
    },
  };
}

/** @param {Set<string>|string[]|undefined} value */
function toSet(value) {
  if (value === undefined) return new Set();
  if (value instanceof Set) return value;
  return new Set(value);
}

/** Re-exported for callers that need signature checks on revocation records. */
export { verifyBytes, validateSignature };
