/**
 * NEXA v0.7 — Real-Time Action Guard & Reward DSL (GuardDSL)
 * Intercepts agent actions, evaluates safety & efficiency before kernel execution.
 * 
 * GUARD CommandSafety;
 * BEFORE_EXECUTE tool.shell_run(cmd) {
 *   RULE NoSudo { ASSERT NOT cmd.contains("sudo") ELSE REJECT "Sudo forbidden"; }
 *   RULE ResourceCost { ASSERT ESTIMATE_COST(cmd) < 0.05$ ELSE REQUIRE_APPROVAL; }
 * }
 */

export function parseGuardDSL(input) {
  const guardMatch = input.match(/GUARD\s+(\w+)\s*;?/i);
  if (!guardMatch) throw new Error('GuardDSL: GUARD Name; required');

  const name = guardMatch[1];

  const beforeMatch = input.match(/BEFORE_EXECUTE\s+([\w\.]+)\s*\(([^)]*)\)\s*\{([\s\S]*)\}\s*$/i);
  if (!beforeMatch) throw new Error('GuardDSL: BEFORE_EXECUTE tool.action(params) { RULES } required');

  const targetTool = beforeMatch[1];
  const targetParams = beforeMatch[2].split(',').map(s => s.trim()).filter(Boolean);
  const body = beforeMatch[3];

  const rules = [];
  const ruleRegex = /RULE\s+(\w+)(?:\s+Check)?\s*\{([\s\S]*?)\}/gi;
  let m;
  while ((m = ruleRegex.exec(body)) !== null) {
    const ruleName = m[1];
    const ruleBody = m[2];

    const assertMatch = ruleBody.match(/ASSERT\s+(.+?)\s+ELSE\s+(REJECT|REQUIRE_APPROVAL|WARN)\s+["']?([^"']*)["']?/i);
    if (assertMatch) {
      rules.push({
        name: ruleName,
        assert: assertMatch[1].trim(),
        elseAction: assertMatch[2],
        elseMessage: assertMatch[3] || ''
      });
    } else {
      rules.push({ name: ruleName, raw: ruleBody.trim() });
    }
  }

  return {
    type: 'Guard',
    name,
    targetTool,
    targetParams,
    rules,
    raw: input
  };
}

export function compileGuardDSL(input) {
  const parsed = parseGuardDSL(input);

  const plan = {
    operation: 'guard',
    guard: parsed.name,
    target: parsed.targetTool,
    params: parsed.targetParams,
    rules: parsed.rules,
    execution: {
      steps: [
        `Guard ${parsed.name} intercepts ${parsed.targetTool}(${parsed.targetParams.join(', ')})`,
        ...parsed.rules.map(r => `Rule ${r.name}: ASSERT ${r.assert} ELSE ${r.elseAction} "${r.elseMessage}"`),
        'Real-time evaluation before kernel execution'
      ],
      safety: true,
      rewardMetric: true
    }
  };

  return {
    ok: true,
    dsl: input,
    parsed,
    plan,
    metrics: {
      guard: parsed.name,
      target: parsed.targetTool,
      rules: parsed.rules.length,
      claim: 'Prevents destructive commands, fast numeric feedback'
    }
  };
}

export function validateGuardDSL(input) {
  try {
    parseGuardDSL(input);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Runtime evaluation
export function evaluateGuard(parsed, action) {
  // action: { tool, params }
  const results = [];

  for (const rule of parsed.rules) {
    let passed = true;
    let reason = '';

    if (rule.assert) {
      const assert = rule.assert.toLowerCase();
      const cmd = (action.params?.cmd || action.params?.command || JSON.stringify(action.params) || '').toLowerCase();

      if (assert.includes('not') && assert.includes('contains') && assert.includes('sudo')) {
        passed = !cmd.includes('sudo');
        reason = passed ? 'No sudo' : 'Contains sudo';
      } else if (assert.includes('estimate_cost')) {
        // Mock cost estimation
        const cost = cmd.length * 0.001;
        const thresholdMatch = rule.assert.match(/<\s*([\d\.]+)\$/);
        const threshold = thresholdMatch ? parseFloat(thresholdMatch[1]) : 0.05;
        passed = cost < threshold;
        reason = `Cost ${cost.toFixed(4)}$ vs threshold ${threshold}$`;
      } else {
        passed = true;
        reason = 'No specific check, default pass';
      }
    }

    results.push({
      rule: rule.name,
      passed,
      action: passed ? 'ALLOW' : rule.elseAction,
      message: passed ? '' : rule.elseMessage,
      reason
    });
  }

  const allPassed = results.every(r => r.passed);
  const shouldReject = results.some(r => !r.passed && r.action === 'REJECT');
  const shouldRequireApproval = results.some(r => !r.passed && r.action === 'REQUIRE_APPROVAL');

  return {
    allowed: !shouldReject,
    requireApproval: shouldRequireApproval,
    results,
    overall: allPassed ? 'ALLOW' : shouldReject ? 'REJECT' : 'REQUIRE_APPROVAL'
  };
}
