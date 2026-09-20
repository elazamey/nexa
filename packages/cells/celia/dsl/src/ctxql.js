/**
 * NEXA v0.7 — Context Query Language (CtxQL)
 * Semantic query for precise AST context, not random reads.
 * 
 * SELECT AST.Function.Body FROM Repo WHERE imports("jsonwebtoken") AND complexity > 10 LIMIT TOKENS 1200
 */

export function parseCtxQL(query) {
  const normalized = query.replace(/\s+/g, ' ').trim();
  
  // Very simple SQL-like parser via regex
  const selectMatch = normalized.match(/SELECT\s+(.+?)\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+?))?(?:\s+LIMIT\s+(.+))?$/i);
  if (!selectMatch) throw new Error(`CtxQL parse failed: expected SELECT ... FROM ... [WHERE ...] [LIMIT ...], got: ${query.slice(0,80)}`);

  const [, selectClause, fromClause, whereClause, limitClause] = selectMatch;

  const fields = selectClause.split(',').map(s => s.trim()).filter(Boolean);
  const where = whereClause ? parseWhere(whereClause) : [];
  const limit = limitClause ? parseLimit(limitClause) : null;

  return {
    type: 'CtxQL',
    select: fields,
    from: fromClause,
    where,
    limit,
    raw: query
  };
}

function parseWhere(whereStr) {
  const conditions = whereStr.split(/\s+AND\s+/i).map(s => s.trim());
  return conditions.map(cond => {
    // imports("jsonwebtoken")
    const importsMatch = cond.match(/imports\s*\(\s*[\"'](.+?)[\"']\s*\)/i);
    if (importsMatch) return { type: 'imports', value: importsMatch[1] };

    // complexity > 10
    const compMatch = cond.match(/(\w+(?:\.\w+)*)\s*(>=|<=|>|<|==|!=|=)\s*(.+)/);
    if (compMatch) {
      return { type: 'comparison', field: compMatch[1], op: compMatch[2], value: parseValue(compMatch[3]) };
    }

    return { type: 'raw', value: cond };
  });
}

function parseLimit(limitStr) {
  const tokensMatch = limitStr.match(/TOKENS\s+(\d+)/i);
  if (tokensMatch) return { type: 'tokens', value: parseInt(tokensMatch[1]) };
  const entriesMatch = limitStr.match(/(\d+)\s*(?:ENTRIES|ROWS)?/i);
  if (entriesMatch) return { type: 'entries', value: parseInt(entriesMatch[1]) };
  return { type: 'raw', value: limitStr };
}

function parseValue(v) {
  v = v.trim();
  if (/^["'].*["']$/.test(v)) return v.slice(1, -1);
  if (/^\d+$/.test(v)) return parseInt(v);
  if (/^\d+\.\d+$/.test(v)) return parseFloat(v);
  return v;
}

export function compileCtxQL(query) {
  const parsed = parseCtxQL(query);
  
  // Generate execution plan
  const plan = {
    operation: 'ctx_query',
    target: parsed.from,
    projection: parsed.select,
    filters: parsed.where,
    budget: parsed.limit,
    execution: {
      steps: [
        `Scan ${parsed.from} for ${parsed.select.join(', ')}`,
        ...parsed.where.map(w => `Filter: ${JSON.stringify(w)}`),
        parsed.limit ? `Limit: ${parsed.limit.type} ${parsed.limit.value}` : 'No limit'
      ],
      tokenAware: parsed.limit?.type === 'tokens',
      astLevel: true
    }
  };

  return {
    ok: true,
    query,
    parsed,
    plan,
    metrics: {
      fields: parsed.select.length,
      filters: parsed.where.length,
      tokenBudget: parsed.limit?.type === 'tokens' ? parsed.limit.value : null,
      claim: 'Precise AST-level context, no prompt flooding'
    }
  };
}

export function validateCtxQL(query) {
  try {
    parseCtxQL(query);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
