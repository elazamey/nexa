/**
 * NEXA v0.7 — Time-Travel & Replay DSL (ReplayDSL)
 * Query and replay temporal phases, fork & diverge without full restart.
 * 
 * REPLAY WORKFLOW "task_id_992"
 *   REWIND TO STEP "Node_2_PatchAST"
 *   OVERRIDE INPUT "model_temperature" = 0.2
 *   BRANCH AS "experiment_fix_v2"
 *   EXECUTE UNTIL "Node_4_Verify";
 */

export function parseReplayDSL(input) {
  const normalized = input.replace(/\s+/g, ' ').trim();

  const workflowMatch = normalized.match(/REPLAY WORKFLOW\s+["'](.+?)["']/i);
  if (!workflowMatch) throw new Error('ReplayDSL: REPLAY WORKFLOW "task_id" required');

  const workflowId = workflowMatch[1];

  const rewindMatch = normalized.match(/REWIND TO STEP\s+["'](.+?)["']/i);
  const rewindTo = rewindMatch ? rewindMatch[1] : null;

  const overrides = [];
  const overrideRegex = /OVERRIDE INPUT\s+["'](.+?)["']\s*=\s*([^\s]+(?:\s+[^\s]+)*?)(?=\s+BRANCH|\s+EXECUTE|;|$)/gi;
  let m;
  while ((m = overrideRegex['exec'](normalized)) !== null) {
    overrides.push({ input: m[1], value: parseValue(m[2]) });
  }

  const branchMatch = normalized.match(/BRANCH AS\s+["'](.+?)["']/i);
  const branchAs = branchMatch ? branchMatch[1] : null;

  const untilMatch = normalized.match(/EXECUTE UNTIL\s+["'](.+?)["']/i);
  const executeUntil = untilMatch ? untilMatch[1] : null;

  return {
    type: 'Replay',
    workflowId,
    rewindTo,
    overrides,
    branchAs,
    executeUntil,
    raw: input
  };
}

function parseValue(v) {
  v = v.trim().replace(/;$/, '');
  if (/^["'].*["']$/.test(v)) return v.slice(1, -1);
  if (/^\d+(\.\d+)?$/.test(v)) return parseFloat(v);
  if (v === 'true') return true;
  if (v === 'false') return false;
  return v;
}

export function compileReplayDSL(input) {
  const parsed = parseReplayDSL(input);

  const plan = {
    operation: 'replay',
    workflowId: parsed.workflowId,
    rewindTo: parsed.rewindTo,
    overrides: parsed.overrides,
    branchAs: parsed.branchAs,
    executeUntil: parsed.executeUntil,
    execution: {
      steps: [
        `Replay workflow ${parsed.workflowId}`,
        parsed.rewindTo ? `Rewind to step ${parsed.rewindTo}` : 'Rewind to start',
        ...parsed.overrides.map(o => `Override ${o.input} = ${o.value}`),
        parsed.branchAs ? `Branch as ${parsed.branchAs}` : 'No branch',
        parsed.executeUntil ? `Execute until ${parsed.executeUntil}` : 'Execute to end',
        'No LLM calls for steps before rewind — deterministic replay'
      ],
      timeTravel: true,
      deterministic: true
    }
  };

  return {
    ok: true,
    dsl: input,
    parsed,
    plan,
    metrics: {
      workflowId: parsed.workflowId,
      rewindTo: parsed.rewindTo,
      overrides: parsed.overrides.length,
      hasBranch: !!parsed.branchAs,
      claim: 'Instant debugging, fork & diverge without full restart'
    }
  };
}

export function validateReplayDSL(input) {
  try {
    parseReplayDSL(input);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
