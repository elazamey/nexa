/**
 * NEXA v0.7 — Delta State Synchronization DSL (StateDiff DSL)
 * Records state deltas instead of full snapshots, fast rollback, low storage.
 * 
 * DELTA_COMMIT #84920 {
 *   TARGET_ENV "sandbox_main";
 *   OP MODIFIED_FILE "src/index.ts" ATTR lines_added (+12), lines_removed (-3);
 *   OP INJECT_ENV_VAR "CACHE_ENABLED" = "true";
 *   OP MUTATE_VARIABLE "AgentStatus" FROM "THINKING" TO "EXECUTING";
 *   CHECKSUM "sha256_e8f9a012";
 * }
 */

export function parseStateDiffDSL(input) {
  const commitMatch = input.match(/DELTA_COMMIT\s+#?(\w+)\s*\{([\s\S]*)\}\s*$/i);
  if (!commitMatch) throw new Error('StateDiff DSL: DELTA_COMMIT #id { ... } required');

  const id = commitMatch[1];
  const body = commitMatch[2];

  const envMatch = body.match(/TARGET_ENV\s+["'](.+?)["']/i);
  const targetEnv = envMatch ? envMatch[1] : 'default';

  const ops = [];
  const opRegex = /OP\s+(\w+)\s+["'](.+?)["'](?:\s+ATTR\s+(.+?))?(?:\s*=\s*["'](.+?)["'])?(?:\s+FROM\s+["'](.+?)["']\s+TO\s+["'](.+?)["'])?\s*;/gi;
  let m;
  while ((m = opRegex.exec(body)) !== null) {
    const op = {
      type: m[1],
      target: m[2],
      attr: m[3] ? parseAttr(m[3]) : null,
      value: m[4] || null,
      from: m[5] || null,
      to: m[6] || null
    };
    ops.push(op);
  }

  // Also parse simpler OP without regex complexity
  if (ops.length === 0) {
    const lines = body.split(';').map(s => s.trim()).filter(Boolean);
    for (const line of lines) {
      if (line.startsWith('TARGET_ENV') || line.startsWith('CHECKSUM')) continue;
      const simpleMatch = line.match(/OP\s+(\w+)\s+["'](.+?)["'](.*)/i);
      if (simpleMatch) {
        ops.push({ type: simpleMatch[1], target: simpleMatch[2], extra: simpleMatch[3].trim() });
      }
    }
  }

  const checksumMatch = body.match(/CHECKSUM\s+["'](.+?)["']/i);
  const checksum = checksumMatch ? checksumMatch[1] : null;

  return {
    type: 'DeltaCommit',
    id,
    targetEnv,
    ops,
    checksum,
    raw: input
  };
}

function parseAttr(attrStr) {
  const attrs = {};
  const pairs = attrStr.split(',').map(s => s.trim());
  for (const pair of pairs) {
    const kv = pair.match(/(\w+)\s*\(?\s*([+-]?\d+)?\s*\)?/);
    if (kv) attrs[kv[1]] = kv[2] ? parseInt(kv[2]) : true;
  }
  return attrs;
}

export function compileStateDiffDSL(input) {
  const parsed = parseStateDiffDSL(input);

  const plan = {
    operation: 'delta_commit',
    id: parsed.id,
    targetEnv: parsed.targetEnv,
    ops: parsed.ops,
    checksum: parsed.checksum,
    execution: {
      steps: [
        `Delta commit #${parsed.id} target ${parsed.targetEnv}`,
        ...parsed.ops.map(op => `OP ${op.type} ${op.target}${op.value ? ` = ${op.value}` : ''}${op.from ? ` FROM ${op.from} TO ${op.to}` : ''}${op.attr ? ` ATTR ${JSON.stringify(op.attr)}` : ''}`),
        parsed.checksum ? `Checksum ${parsed.checksum}` : 'No checksum',
        'Fast rollback via inverse ops, no full snapshot'
      ],
      rollback: true,
      storageOptimized: true
    }
  };

  return {
    ok: true,
    dsl: input,
    parsed,
    plan,
    metrics: {
      id: parsed.id,
      ops: parsed.ops.length,
      hasChecksum: !!parsed.checksum,
      claim: 'Fast rollback, reduced storage vs full snapshots'
    }
  };
}

export function validateStateDiffDSL(input) {
  try {
    parseStateDiffDSL(input);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Generate inverse ops for rollback
export function inverseOps(parsed) {
  return parsed.ops.map(op => {
    if (op.type === 'MODIFIED_FILE') return { type: 'RESTORE_FILE', target: op.target };
    if (op.type === 'INJECT_ENV_VAR') return { type: 'REMOVE_ENV_VAR', target: op.target };
    if (op.type === 'MUTATE_VARIABLE') return { type: 'MUTATE_VARIABLE', target: op.target, from: op.to, to: op.from };
    return { type: `UNDO_${op.type}`, target: op.target };
  }).reverse();
}
