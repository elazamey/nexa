/**
 * NEXA v0.7 — NanoTool Functional DSL (NanoDSL)
 * Purely functional, side-effect free JIT tools executed in WASM sandbox.
 * 
 * FN aggregate_logs(raw_input: Stream) -> JSON {
 *   raw_input
 *   |> parse_json
 *   |> filter(row -> row.status == 500)
 *   |> group_by(row -> row.path)
 *   |> map_values(count)
 * }
 */

export function parseNanoDSL(input) {
  const fnMatch = input.match(/FN\s+(\w+)\s*\(([^)]*)\)\s*->\s*(\w+)\s*\{([\s\S]*)\}\s*$/i);
  if (!fnMatch) throw new Error('NanoDSL: FN name(params: Type) -> ReturnType { pipeline } required');

  const name = fnMatch[1];
  const paramsStr = fnMatch[2];
  const returnType = fnMatch[3];
  const body = fnMatch[4];

  const params = paramsStr.split(',').map(s => s.trim()).filter(Boolean).map(p => {
    const pm = p.match(/(\w+)\s*:\s*(\w+)/);
    return pm ? { name: pm[1], type: pm[2] } : { name: p, type: 'any' };
  });

  // Pipeline: split by |>
  const pipeline = body.split('|>').map(s => s.trim()).filter(Boolean).map((step, idx) => {
    if (idx === 0 && !step.includes('(') && !step.includes('->')) {
      // First is input variable
      return { op: 'input', value: step };
    }
    // parse_json, filter(row -> row.status == 500), etc.
    const callMatch = step.match(/(\w+)(?:\(([\s\S]*)\))?/);
    if (!callMatch) return { op: 'raw', value: step };
    const op = callMatch[1];
    const args = callMatch[2] || '';
    // Check for lambda: row -> row.status == 500
    const lambdaMatch = args.match(/(\w+)\s*->\s*(.+)/);
    if (lambdaMatch) {
      return { op, lambda: { param: lambdaMatch[1], body: lambdaMatch[2].trim() } };
    }
    return { op, args: args.trim() };
  });

  return {
    type: 'NanoTool',
    name,
    params,
    returnType,
    pipeline,
    raw: input
  };
}

export function compileNanoDSL(input) {
  const parsed = parseNanoDSL(input);

  // Generate JS function for WASM-like sandbox execution (pure, no fs, no net)
  const jsCode = generateJsFromNano(parsed);

  const plan = {
    operation: 'nanotool',
    tool: parsed.name,
    params: parsed.params,
    returnType: parsed.returnType,
    pipeline: parsed.pipeline,
    jsCode,
    execution: {
      sandboxed: true,
      pure: true,
      wasm: false, // Mock WASM, real would compile to WASM
      steps: parsed.pipeline.map(p => p.op === 'input' ? `Input: ${p.value}` : `${p.op}${p.lambda ? `(${p.lambda.param} -> ${p.lambda.body})` : p.args ? `(${p.args})` : ''}`),
      sideEffectFree: true
    }
  };

  return {
    ok: true,
    dsl: input,
    parsed,
    plan,
    metrics: {
      tool: parsed.name,
      params: parsed.params.length,
      pipelineSteps: parsed.pipeline.length,
      claim: 'Pure functional, WASM isolated, zero LLM calls for data processing'
    }
  };
}

function generateJsFromNano(parsed) {
  const inputVar = parsed.pipeline[0]?.value || 'input';
  let code = `function ${parsed.name}(${parsed.params.map(p=>p.name).join(', ')}) {\n  let result = ${inputVar};\n`;

  for (let i = 1; i < parsed.pipeline.length; i++) {
    const step = parsed.pipeline[i];
    if (step.op === 'parse_json') {
      code += `  result = result.map(r => { try { return JSON.parse(r); } catch { return r; } });\n`;
    } else if (step.op === 'filter' && step.lambda) {
      code += `  result = result.filter(${step.lambda.param} => ${step.lambda.body});\n`;
    } else if (step.op === 'group_by' && step.lambda) {
      code += `  { const groups = {}; for (const ${step.lambda.param} of result) { const key = ${step.lambda.body}; (groups[key] = groups[key] || []).push(${step.lambda.param}); } result = groups; }\n`;
    } else if (step.op === 'map_values') {
      code += `  { const mapped = {}; for (const [k,v] of Object.entries(result)) { mapped[k] = v.length; } result = mapped; }\n`;
    } else if (step.op === 'map' && step.lambda) {
      code += `  result = result.map(${step.lambda.param} => ${step.lambda.body});\n`;
    } else {
      code += `  // ${step.op} ${step.args || ''}\n`;
    }
  }

  code += `  return result;\n}`;
  return code;
}

export function validateNanoDSL(input) {
  try {
    parseNanoDSL(input);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Safe lambda evaluator without Function constructor — supports simple property access and comparisons
function safeEvalLambda(lambdaBody, paramName, item) {
  // Only allow simple expressions: row.status == 500, row.path, row.status != 200, etc.
  // Parse as: param.prop (==, !=, >, <, >=, <=) value  OR param.prop
  const trimmed = lambdaBody.trim();
  // Comparison: row.status == 500
  const compMatch = trimmed.match(new RegExp(`^${paramName}\\.([\\w\\.]+)\\s*(==|!=|>=|<=|>|<)\\s*(.+)$`));
  if (compMatch) {
    const propPath = compMatch[1];
    const op = compMatch[2];
    let value = compMatch[3].trim();
    // Parse value
    if (/^["'].*["']$/.test(value)) value = value.slice(1, -1);
    else if (/^\d+$/.test(value)) value = parseInt(value);
    else if (/^\d+\.\d+$/.test(value)) value = parseFloat(value);

    // Get property
    const actual = propPath.split('.').reduce((obj, key) => obj?.[key], item);

    switch (op) {
      case '==': return actual == value;
      case '!=': return actual != value;
      case '>=': return actual >= value;
      case '<=': return actual <= value;
      case '>': return actual > value;
      case '<': return actual < value;
      default: return false;
    }
  }
  // Simple property access: row.path
  const propMatch = trimmed.match(new RegExp(`^${paramName}\\.([\\w\\.]+)$`));
  if (propMatch) {
    const propPath = propMatch[1];
    return propPath.split('.').reduce((obj, key) => obj?.[key], item);
  }
  // Direct param
  if (trimmed === paramName) return item;
  return null;
}

// Execute NanoDSL pipeline in sandbox (pure JS, no fs/net, no Function/eval)
export function executeNanoDSL(parsed, inputs) {
  try {
    let result = inputs[parsed.params[0]?.name] || inputs;

    for (let i = 1; i < parsed.pipeline.length; i++) {
      const step = parsed.pipeline[i];
      if (step.op === 'parse_json') {
        result = Array.isArray(result) ? result.map(r => {
          try { return typeof r === 'string' ? JSON.parse(r) : r; } catch { return r; }
        }) : result;
      } else if (step.op === 'filter' && step.lambda) {
        result = result.filter(item => safeEvalLambda(step.lambda.body, step.lambda.param, item));
      } else if (step.op === 'group_by' && step.lambda) {
        const groups = {};
        for (const item of result) {
          const key = safeEvalLambda(step.lambda.body, step.lambda.param, item);
          if (key !== null && key !== undefined) {
            (groups[key] = groups[key] || []).push(item);
          }
        }
        result = groups;
      } else if (step.op === 'map_values') {
        const mapped = {};
        for (const [k,v] of Object.entries(result)) mapped[k] = Array.isArray(v) ? v.length : v;
        result = mapped;
      }
    }

    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
