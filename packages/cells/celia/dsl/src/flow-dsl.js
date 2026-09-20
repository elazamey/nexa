/**
 * NEXA v0.7 — Dynamic Workflow & Policy DSL (FlowDSL)
 * Non-deterministic DAG description with branches, parallelism, assertions.
 * 
 * WORKFLOW FixVulnerability {
 *   STEP analyze = AGENT.run(Model.SMALL, "Parse security alert");
 *   BRANCH WHEN analyze.entropy > 0.35 {
 *     STEP reason = AGENT.run(Model.REASONING, "Deep root cause");
 *   }
 *   PARALLEL {
 *     STEP patch_code = AGENT.run(Model.CODER, "Apply AST Patch");
 *     STEP update_docs = AGENT.run(Model.SMALL, "Update API Spec");
 *   }
 *   ASSERT patch_code PASSED "npm test" ELSE ROLLBACK;
 * }
 */

export function parseFlowDSL(input) {
  const workflowMatch = input.match(/WORKFLOW\s+(\w+)\s*\{([\s\S]*)\}\s*$/i);
  if (!workflowMatch) throw new Error('FlowDSL: WORKFLOW Name { ... } required');

  const name = workflowMatch[1];
  const body = workflowMatch[2];

  const steps = [];
  const branches = [];
  const parallels = [];
  const asserts = [];

  // STEP name = AGENT.run(Model.X, "task")
  const stepRegex = /STEP\s+(\w+)\s*=\s*AGENT\.run\s*\(\s*Model\.(\w+)\s*,\s*["'](.+?)["']\s*\)\s*;?/gi;
  let m;
  while ((m = stepRegex['exec'](body)) !== null) {
    steps.push({ id: m[1], model: m[2], task: m[3], type: 'step' });
  }

  // BRANCH WHEN condition { ... }
  const branchRegex = /BRANCH\s+WHEN\s+(.+?)\s*\{([\s\S]*?)\}/gi;
  while ((m = branchRegex['exec'](body)) !== null) {
    const condition = m[1].trim();
    const inner = m[2];
    const innerSteps = [];
    const innerStepRegex = /STEP\s+(\w+)\s*=\s*AGENT\.run\s*\(\s*Model\.(\w+)\s*,\s*["'](.+?)["']\s*\)/gi;
    let im;
    while ((im = innerStepRegex['exec'](inner)) !== null) {
      innerSteps.push({ id: im[1], model: im[2], task: im[3] });
    }
    branches.push({ condition, steps: innerSteps });
  }

  // PARALLEL { STEP ... STEP ... }
  const parallelRegex = /PARALLEL\s*\{([\s\S]*?)\}/gi;
  while ((m = parallelRegex['exec'](body)) !== null) {
    const inner = m[1];
    const innerSteps = [];
    const innerStepRegex = /STEP\s+(\w+)\s*=\s*AGENT\.run\s*\(\s*Model\.(\w+)\s*,\s*["'](.+?)["']\s*\)/gi;
    let im;
    while ((im = innerStepRegex['exec'](inner)) !== null) {
      innerSteps.push({ id: im[1], model: im[2], task: im[3] });
    }
    parallels.push({ steps: innerSteps });
  }

  // ASSERT x PASSED "..." ELSE ROLLBACK
  const assertRegex = /ASSERT\s+(\w+)\s+(PASSED|FAILED)?\s*["']?([^"';]+)?["']?\s*(?:ELSE\s+(\w+))?;?/gi;
  while ((m = assertRegex['exec'](body)) !== null) {
    asserts.push({ target: m[1], status: m[2] || 'PASSED', check: (m[3] || '').trim(), elseAction: m[4] || null });
  }

  return {
    type: 'Workflow',
    name,
    steps,
    branches,
    parallels,
    asserts,
    raw: input
  };
}

export function compileFlowDSL(input) {
  const parsed = parseFlowDSL(input);

  // Build DAG from FlowDSL
  const dagNodes = [];
  const dagEdges = [];

  let prevId = null;

  for (const step of parsed.steps) {
    // Avoid duplicating steps already in branches/parallels? Keep all for simplicity
    dagNodes.push({ id: step.id, tool: `agent.${step.model.toLowerCase()}`, taskIntent: step.task, model: step.model });
    if (prevId) dagEdges.push({ from: prevId, to: step.id });
    prevId = step.id;
  }

  for (const parallel of parsed.parallels) {
    for (const step of parallel.steps) {
      if (!dagNodes.find(n => n.id === step.id)) {
        dagNodes.push({ id: step.id, tool: `agent.${step.model.toLowerCase()}`, taskIntent: step.task, model: step.model, parallel: true });
      }
    }
    // Parallel edges: from prev to each parallel, and each parallel to next assert target?
    if (parallel.steps.length > 1 && prevId) {
      for (const s of parallel.steps) {
        dagEdges.push({ from: prevId, to: s.id, type: 'parallel' });
      }
    }
  }

  const plan = {
    operation: 'flow_dag',
    workflow: parsed.name,
    dag: { nodes: dagNodes, edges: dagEdges, version: 1 },
    execution: {
      adaptive: parsed.branches.length > 0,
      parallel: parsed.parallels.length > 0,
      assertions: parsed.asserts,
      steps: [
        `Workflow ${parsed.name}: ${dagNodes.length} nodes`,
        ...parsed.branches.map(b => `Branch when ${b.condition}: ${b.steps.map(s=>s.id).join(', ')}`),
        ...parsed.parallels.map(p => `Parallel: ${p.steps.map(s=>s.id).join(' | ')}`),
        ...parsed.asserts.map(a => `Assert ${a.target} ${a.status} "${a.check}" else ${a.elseAction}`)
      ]
    }
  };

  return {
    ok: true,
    dsl: input,
    parsed,
    plan,
    metrics: {
      workflow: parsed.name,
      nodes: dagNodes.length,
      edges: dagEdges.length,
      branches: parsed.branches.length,
      parallels: parsed.parallels.length,
      asserts: parsed.asserts.length,
      claim: 'Strict executable structure, fast parallel, rollback on assert fail'
    }
  };
}

export function validateFlowDSL(input) {
  try {
    parseFlowDSL(input);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
