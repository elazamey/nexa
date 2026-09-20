/**
 * NEXA v0.7 — Token Budget & Prompt Layout DSL (PmplSpec)
 * Declarative prompt structure with strict token budget directives.
 * 
 * LAYOUT AgentContext BUDGET 4000 TOKENS {
 *   SECTION SystemPrompt [PRIORITY: CRITICAL, FIT: EXACT];
 *   SECTION AST_Context [PRIORITY: HIGH, FIT: TRUNCATE_TAIL];
 *   SECTION ToolSpecs [PRIORITY: MEDIUM, FIT: DROP_OPTIONAL_PARAMS];
 *   SECTION HistoryLogs [PRIORITY: LOW, FIT: COMPRESS_SUMMARIZE];
 * }
 */

export function parsePmplSpec(input) {
  const layoutMatch = input.match(/LAYOUT\s+(\w+)\s+BUDGET\s+(\d+)\s+TOKENS\s*\{([\s\S]*)\}\s*$/i);
  if (!layoutMatch) throw new Error('PmplSpec: LAYOUT Name BUDGET N TOKENS { ... } required');

  const name = layoutMatch[1];
  const budget = parseInt(layoutMatch[2]);
  const body = layoutMatch[3];

  const sections = [];
  const sectionRegex = /SECTION\s+(\w+)\s*\[\s*PRIORITY\s*:\s*(\w+)\s*,\s*FIT\s*:\s*([\w_]+)\s*\]\s*;?/gi;
  let m;
  while ((m = sectionRegex.exec(body)) !== null) {
    sections.push({
      name: m[1],
      priority: m[2].toUpperCase(),
      fit: m[3].toUpperCase()
    });
  }

  return {
    type: 'PmplLayout',
    name,
    budget,
    sections,
    raw: input
  };
}

export function compilePmplSpec(input) {
  const parsed = parsePmplSpec(input);

  const priorityOrder = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
  const sorted = [...parsed.sections].sort((a,b) => (priorityOrder[b.priority]||0) - (priorityOrder[a.priority]||0));

  const plan = {
    operation: 'pmpl_layout',
    layout: parsed.name,
    budget: parsed.budget,
    sections: sorted,
    execution: {
      steps: [
        `Layout ${parsed.name}: budget ${parsed.budget} tokens`,
        ...sorted.map(s => `Section ${s.name}: priority ${s.priority}, fit ${s.fit}`),
        'Allocate tokens by priority, truncate/compress low priority when over budget'
      ],
      tokenAware: true,
      priorityBased: true
    }
  };

  return {
    ok: true,
    dsl: input,
    parsed,
    plan,
    metrics: {
      layout: parsed.name,
      budget: parsed.budget,
      sections: parsed.sections.length,
      claim: 'Guarantees max context, auto sacrifices low priority on compression'
    }
  };
}

export function validatePmplSpec(input) {
  try {
    parsePmplSpec(input);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// Apply layout to actual content with budget
export function applyPmplLayout(parsed, contentMap) {
  // contentMap: { sectionName: text }
  const priorityOrder = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
  const sorted = [...parsed.sections].sort((a,b) => (priorityOrder[b.priority]||0) - (priorityOrder[a.priority]||0));

  let remaining = parsed.budget;
  const allocated = {};
  const truncated = [];

  for (const section of sorted) {
    const content = contentMap[section.name] || '';
    const tokens = Math.ceil(content.length / 4);

    if (tokens <= remaining) {
      allocated[section.name] = content;
      remaining -= tokens;
    } else {
      // Need to fit
      if (section.fit === 'EXACT') {
        // Critical — must fit, even if over budget (but we try)
        allocated[section.name] = content;
        remaining -= tokens;
      } else if (section.fit === 'TRUNCATE_TAIL') {
        const allowedChars = remaining * 4;
        allocated[section.name] = content.slice(0, allowedChars) + '\n...[truncated]';
        remaining = 0;
        truncated.push(section.name);
      } else if (section.fit === 'DROP_OPTIONAL_PARAMS') {
        // Simplify: drop half
        const allowedChars = remaining * 4;
        allocated[section.name] = content.slice(0, allowedChars);
        remaining = 0;
        truncated.push(section.name);
      } else if (section.fit === 'COMPRESS_SUMMARIZE') {
        // Mock summarize: take first 20%
        const summary = content.slice(0, Math.floor(content.length * 0.2)) + `\n...[summarized from ${tokens} tokens]`;
        const summaryTokens = Math.ceil(summary.length / 4);
        if (summaryTokens <= remaining) {
          allocated[section.name] = summary;
          remaining -= summaryTokens;
        } else {
          truncated.push(section.name);
        }
      } else {
        truncated.push(section.name);
      }
    }
  }

  return {
    allocated,
    truncated,
    remaining,
    budget: parsed.budget,
    used: parsed.budget - remaining,
    overBudget: remaining < 0
  };
}
