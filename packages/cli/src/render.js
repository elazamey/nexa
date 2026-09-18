/**
 * Renderers. Pure functions from a structured result to text, so that a command's
 * output can be asserted in a test without running a process.
 */
import { formatDiagnostic } from '../../compiler/index.js';

/** @param {Array<{toString: Function}>} diagnostics @param {string} path */
export function renderDiagnostics(diagnostics, path) {
  return diagnostics.map((diagnostic) => `  ${formatDiagnostic(diagnostic, { path })}`).join('\n');
}

/** @param {object} compiled @param {{path: string, json?: boolean}} options */
export function renderCheck(compiled, { path, json = false }) {
  if (json) {
    return JSON.stringify({
      ok: compiled.ok,
      path,
      hash: compiled.hash,
      diagnostics: compiled.diagnostics.map((diagnostic) => diagnostic.toJSON()),
    }, null, 2);
  }
  const lines = [];
  if (compiled.diagnostics.length > 0) lines.push(renderDiagnostics(compiled.diagnostics, path));
  const errors = compiled.diagnostics.filter((diagnostic) => diagnostic.severity === 'error').length;
  const warnings = compiled.diagnostics.length - errors;
  if (compiled.ok) {
    lines.push(`${path}: ok — ${warnings} warning(s), ir ${compiled.hash}`);
  } else {
    lines.push(`${path}: refused — ${errors} error(s), ${warnings} warning(s)`);
  }
  return lines.filter((line) => line.length > 0).join('\n');
}

/** @param {object} compiled @param {{path: string, json?: boolean}} options */
export function renderCompile(compiled, { path, json = false }) {
  if (json) return JSON.stringify(compiled.ir, null, 2);
  const ir = compiled.ir;
  const lines = [
    `module     ${path}`,
    `ir         version ${ir.ir}`,
    `ir_hash    ${compiled.hash}`,
    `agents     ${ir.agents.map((agent) => agent.name).join(', ') || '-'}`,
    `missions   ${ir.missions.map((mission) => mission.name).join(', ') || '-'}`,
    `proposals  ${ir.proposals.map((proposal) => `${proposal.module}: ${proposal.from} → ${proposal.to}`).join(', ') || '-'}`,
    `limits     ${Object.entries(ir.limits).map(([key, value]) => `${key}=${value}`).join(' ') || 'none'}`,
  ];
  return lines.join('\n');
}

/** @param {object} explanation @param {{path: string, json?: boolean}} options */
export function renderExplain(explanation, { path, json = false }) {
  if (json) return JSON.stringify(explanation, null, 2);
  const lines = [`${path}: authority table`];
  for (const agent of explanation.agents) {
    lines.push(`  agent ${agent.name} (role ${agent.role}, model ${agent.model ?? 'none'})`);
    for (const allow of agent.allows) lines.push(`    allow  ${allow}`);
    for (const deny of agent.denies) lines.push(`    deny   ${deny}`);
    if (agent.allows.length === 0 && agent.denies.length === 0) lines.push('    (no capabilities: this agent cannot act)');
  }
  if (explanation.grants.length === 0) lines.push('  grants: none — the authority will mint nothing');
  for (const grant of explanation.grants) {
    lines.push(`  grant ${grant.capability}: ${grant.actions} on ${grant.resource} for ${grant.subject} (ttl ${grant.ttl_ms}ms, ${grant.max_calls} call(s)${grant.approval === null ? '' : `, approval(${grant.approval})`})`);
  }
  for (const provider of explanation.providers) {
    lines.push(`  provider ${provider.name}: ${provider.secret} (strategy ${provider.strategy}, fallback ${provider.fallback.join(' → ') || 'none'}, max_cost ${provider.max_cost ?? 'unset'})`);
  }
  for (const mission of explanation.missions) {
    lines.push(`  mission ${mission.name} → agent ${mission.agent}`);
    lines.push(`    goal       ${mission.goal}`);
    lines.push(`    plan       ${mission.plan.join(' → ')}`);
    for (const precondition of mission.preconditions) lines.push(`    requires   ${precondition}`);
    for (const contract of mission.contracts) lines.push(`    contract   evidence "${contract}"`);
    for (const call of mission.calls) {
      const gate = call.gate === null ? '' : `  [${call.gate.gate} ${call.gate.state} — the kernel refuses this]`;
      lines.push(`    call       ${call.action} on ${call.resource}${call.declassify === true ? ' (declassification)' : ''}${gate}`);
    }
  }
  for (const proposal of explanation.evolution) {
    lines.push(`  proposal ${proposal.module} ${proposal.from} → ${proposal.to}`);
    lines.push(`    hypothesis ${proposal.hypothesis}`);
    for (const expectation of proposal.expects) lines.push(`    expect     ${expectation}`);
  }
  return lines.join('\n');
}

/** @param {object} outcome @param {{json?: boolean}} options */
export function renderRun(outcome, { json = false } = {}) {
  if (json) {
    return JSON.stringify({
      status: outcome.status,
      code: outcome.code,
      message: outcome.message,
      mission: outcome.mission,
      agent: outcome.agent,
      steps: outcome.steps,
      value: outcome.value,
      contracts: outcome.contracts,
      receipts: outcome.receipts.length,
      records: outcome.records.map((record) => ({
        seq: record.seq,
        kind: record.kind,
        decision: record.decision,
        resource: record.resource ?? null,
        action: record.action ?? null,
        detail: record.detail ?? null,
        hash: record.hash,
      })),
      head: outcome.ledger.head.hash,
    }, null, 2);
  }
  const lines = [];
  for (const record of outcome.records) {
    const where = record.resource === undefined ? '' : `${record.resource}${record.action === undefined ? '' : ` ${record.action}`}`;
    const detail = record.detail === undefined ? {} : record.detail;
    const note = detail.code ?? detail.claim ?? detail.reason ?? detail.key ?? detail.name ?? '';
    lines.push(`  ${String(record.seq).padStart(3)}  ${record.kind.padEnd(13)} ${record.decision.padEnd(5)} ${where.padEnd(24)} ${String(note).slice(0, 64)}`);
  }
  lines.push(`  verdict: ${outcome.status}${outcome.code === null ? '' : ` (${outcome.code})`}${outcome.message === null ? '' : ` — ${outcome.message}`}`);
  lines.push(`  contracts: ${outcome.contracts.map((contract) => `${contract.claim}=${contract.ok ? 'met' : 'unmet'}`).join(', ') || 'none'}`);
  lines.push(`  steps: ${outcome.steps} · records: ${outcome.records.length} · receipts: ${outcome.receipts.length} · head: ${outcome.ledger.head.hash}`);
  if (outcome.status === 'ALLOW') lines.push(`  value: ${JSON.stringify(outcome.value)}`);
  return lines.join('\n');
}

/** @param {object} verdict @param {{json?: boolean}} options */
export function renderGate(verdict, { json = false } = {}) {
  if (json) return JSON.stringify(verdict, null, 2);
  const lines = [`candidate ${verdict.candidate}${verdict.parent === null ? '' : ` ← parent ${verdict.parent}`}`];
  for (const stage of verdict.stages) {
    lines.push(`  ${stage.status === 'PASS' ? 'PASS' : 'FAIL'}  ${stage.stage.padEnd(12)} ${JSON.stringify(stage.detail ?? {}).slice(0, 90)}`);
  }
  lines.push(`  verdict: ${verdict.verdict} — ${verdict.reason}`);
  if (verdict.verdict === 'PASS') lines.push('  next: canary observations, then an explicit `activate` by an allowed identity');
  return lines.join('\n');
}

/** @param {object} info @param {{json?: boolean}} options */
export function renderVersion(info, { json = false } = {}) {
  if (json) return JSON.stringify(info, null, 2);
  return [
    `nexa omega     ${info.omega}`,
    `ir version     ${info.ir}`,
    `protocol       ${info.protocol} (unchanged by Ω)`,
    `gates          ${info.gates}`,
  ].join('\n');
}
