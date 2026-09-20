/**
 * NEXA v0.7 — Vector & Memory Query Language (MemLang)
 * Manages episodic & semantic memory with decay control.
 * 
 * FETCH EPISODIC MEMORY
 *   FOR AGENT "coder_v2"
 *   MATCH EMBEDDING("fix authentication token error")
 *   WHERE similarity >= 0.82 AND created_at > NOW() - 7d AND decay_score < 0.3
 *   REINFORCE IMPORTANCE (+0.1)
 *   LIMIT 3 ENTRIES;
 */

export function parseMemLang(input) {
  const normalized = input.replace(/\s+/g, ' ').trim();

  const fetchMatch = normalized.match(/FETCH\s+(\w+)\s+MEMORY/i);
  if (!fetchMatch) throw new Error('MemLang: FETCH <TIER> MEMORY required');

  const tier = fetchMatch[1].toLowerCase();

  const agentMatch = normalized.match(/FOR AGENT\s+["'](.+?)["']/i);
  const agent = agentMatch ? agentMatch[1] : null;

  const embeddingMatch = normalized.match(/MATCH EMBEDDING\s*\(\s*["'](.+?)["']\s*\)/i);
  const embeddingQuery = embeddingMatch ? embeddingMatch[1] : null;

  const whereMatch = normalized.match(/WHERE\s+(.+?)(?:\s+REINFORCE|\s+LIMIT|;|$)/i);
  const where = whereMatch ? parseWhere(whereMatch[1]) : [];

  const reinforceMatch = normalized.match(/REINFORCE IMPORTANCE\s*\(\s*([+-]?[\d\.]+)\s*\)/i);
  const reinforce = reinforceMatch ? parseFloat(reinforceMatch[1]) : null;

  const limitMatch = normalized.match(/LIMIT\s+(\d+)\s+ENTRIES/i);
  const limit = limitMatch ? parseInt(limitMatch[1]) : null;

  return {
    type: 'MemLang',
    tier,
    agent,
    embeddingQuery,
    where,
    reinforce,
    limit,
    raw: input
  };
}

function parseWhere(whereStr) {
  const conditions = whereStr.split(/\s+AND\s+/i).map(s => s.trim());
  return conditions.map(cond => {
    const comp = cond.match(/(\w+)\s*(>=|<=|>|<|==|=)\s*(.+)/);
    if (comp) {
      return { field: comp[1], op: comp[2], value: parseValue(comp[3]) };
    }
    return { raw: cond };
  });
}

function parseValue(v) {
  v = v.trim();
  if (/^["'].*["']$/.test(v)) return v.slice(1, -1);
  if (/NOW\(\)\s*-\s*(\d+)([dhm])/.test(v)) {
    const m = v.match(/NOW\(\)\s*-\s*(\d+)([dhm])/);
    const num = parseInt(m[1]);
    const unit = m[2];
    const ms = unit === 'd' ? num*86400000 : unit === 'h' ? num*3600000 : num*60000;
    return { type: 'relative_time', ms, original: v };
  }
  if (/^\d+(\.\d+)?$/.test(v)) return parseFloat(v);
  return v;
}

export function compileMemLang(input) {
  const parsed = parseMemLang(input);

  const plan = {
    operation: 'memory_query',
    tier: parsed.tier,
    agent: parsed.agent,
    embedding: parsed.embeddingQuery,
    filters: parsed.where,
    reinforce: parsed.reinforce,
    limit: parsed.limit,
    execution: {
      steps: [
        `Fetch ${parsed.tier} memory${parsed.agent ? ` for agent ${parsed.agent}` : ''}`,
        parsed.embeddingQuery ? `Vector search: "${parsed.embeddingQuery}"` : 'No embedding query',
        ...parsed.where.map(w => `Filter: ${w.field} ${w.op} ${JSON.stringify(w.value)}`),
        parsed.reinforce ? `Reinforce importance by ${parsed.reinforce}` : 'No reinforce',
        parsed.limit ? `Limit ${parsed.limit} entries` : 'No limit'
      ],
      decayControl: parsed.where.some(w => w.field === 'decay_score'),
      similarityThreshold: parsed.where.find(w => w.field === 'similarity')?.value || 0.7
    }
  };

  return {
    ok: true,
    dsl: input,
    parsed,
    plan,
    metrics: {
      tier: parsed.tier,
      hasEmbedding: !!parsed.embeddingQuery,
      filters: parsed.where.length,
      limit: parsed.limit,
      claim: 'Reduces vector search cost, precise decay control'
    }
  };
}

export function validateMemLang(input) {
  try {
    parseMemLang(input);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
