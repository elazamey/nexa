/**
 * NEXA v0.7 — Multi-Modal Pipeline DSL (MediaPipe)
 * Routing multi-modal data (Images, Audio, AST, Embeddings) via fast pipelines.
 * 
 * PIPE ProcessUIBugReport {
 *   INPUT raw_image: ImageStream;
 *   STEP crop = IMAGE.crop_to_element(raw_image, selector: "#error-modal");
 *   STEP OCR = VISION.extract_text(crop);
 *   STEP AST_MAP = REPO.find_component_by_text(OCR.text);
 *   EMIT TO_AGENT { visual_features: crop.embedding, target_component: AST_MAP.file_path };
 * }
 */

export function parseMediaPipeDSL(input) {
  const pipeMatch = input.match(/PIPE\s+(\w+)\s*\{([\s\S]*)\}\s*$/i);
  if (!pipeMatch) throw new Error('MediaPipe DSL: PIPE Name { ... } required');

  const name = pipeMatch[1];
  const body = pipeMatch[2];

  const inputs = [];
  const inputRegex = /INPUT\s+(\w+)\s*:\s*(\w+)\s*;?/gi;
  let m;
  while ((m = inputRegex['exec'](body)) !== null) {
    inputs.push({ name: m[1], type: m[2] });
  }

  const steps = [];
  const stepRegex = /STEP\s+(\w+)\s*=\s*([\w\.]+)\s*\(([^)]*)\)\s*;?/gi;
  while ((m = stepRegex['exec'](body)) !== null) {
    steps.push({ id: m[1], func: m[2], args: parseArgs(m[3]) });
  }

  const emitMatch = body.match(/EMIT TO_AGENT\s*\{([\s\S]*?)\}/i);
  const emit = emitMatch ? parseEmit(emitMatch[1]) : null;

  return {
    type: 'MediaPipe',
    name,
    inputs,
    steps,
    emit,
    raw: input
  };
}

function parseArgs(argsStr) {
  const args = {};
  const parts = argsStr.split(',').map(s => s.trim()).filter(Boolean);
  for (const part of parts) {
    const kv = part.match(/(\w+)\s*:\s*(.+)/);
    if (kv) args[kv[1]] = kv[2].trim().replace(/["']/g, '');
    else {
      // positional
      args[`arg${Object.keys(args).length}`] = part.replace(/["']/g, '');
    }
  }
  return args;
}

function parseEmit(emitStr) {
  const fields = {};
  const parts = emitStr.split(',').map(s => s.trim()).filter(Boolean);
  for (const part of parts) {
    const kv = part.match(/(\w+)\s*:\s*(.+)/);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  return fields;
}

export function compileMediaPipeDSL(input) {
  const parsed = parseMediaPipeDSL(input);

  const plan = {
    operation: 'mediapipe',
    pipe: parsed.name,
    inputs: parsed.inputs,
    steps: parsed.steps,
    emit: parsed.emit,
    execution: {
      steps: [
        `Pipe ${parsed.name}: ${parsed.inputs.length} inputs, ${parsed.steps.length} steps`,
        ...parsed.inputs.map(i => `Input ${i.name}: ${i.type}`),
        ...parsed.steps.map(s => `Step ${s.id} = ${s.func}(${JSON.stringify(s.args)})`),
        parsed.emit ? `Emit to agent: ${JSON.stringify(parsed.emit)}` : 'No emit'
      ],
      multimodal: true,
      zeroCopy: false
    }
  };

  return {
    ok: true,
    dsl: input,
    parsed,
    plan,
    metrics: {
      pipe: parsed.name,
      inputs: parsed.inputs.length,
      steps: parsed.steps.length,
      hasEmit: !!parsed.emit,
      claim: 'Fast multi-modal processing outside main conversation'
    }
  };
}

export function validateMediaPipeDSL(input) {
  try {
    parseMediaPipeDSL(input);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
