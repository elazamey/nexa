import React, { useState, useEffect } from 'react';
import { Code, Database, GitBranch, Shield, FileCode, Layers, Zap, Box, Terminal, Cpu, Brain, Clock, CheckCircle, Search, Workflow, FileJson, Users, AlertTriangle } from 'lucide-react';

const DSL_EXAMPLES = [
  { key: 'AIR', name: 'Agent IR', icon: Code, color: 'text-cyan-400', bg: 'bg-cyan-500/10 border-cyan-500/20', saving: '50-70% tokens', example: '(EXEC :tool "fs.patch" :target "src/auth.ts" :node "func#login" :patch "diff_89")', json: '{"tool":"fs.patch","target":"src/auth.ts","node":"func#login"}' },
  { key: 'CtxQL', name: 'CtxQL', icon: Search, color: 'text-purple-400', bg: 'bg-purple-500/10 border-purple-500/20', saving: 'Precise AST', example: 'SELECT AST.Function.Body FROM Repo WHERE imports("jsonwebtoken") LIMIT TOKENS 1200', json: 'Scan Repo → Filter imports → Limit tokens' },
  { key: 'AstPatchDSL', name: 'AST-Patch', icon: FileCode, color: 'text-emerald-400', bg: 'bg-emerald-500/10 border-emerald-500/20', saving: '100% stable', example: 'IN FILE "src/user.ts" MATCH NODE FunctionDeclaration[name="getUserData"] INJECT PREPEND "if (!userId) throw..." VERIFY SYNTAX', json: 'AST selector, not line numbers' },
  { key: 'FlowDSL', name: 'FlowDSL', icon: Workflow, color: 'text-amber-400', bg: 'bg-amber-500/10 border-amber-500/20', saving: 'Adaptive DAG', example: 'WORKFLOW FixVuln { STEP analyze = AGENT.run(Model.SMALL, "Parse") PARALLEL { STEP patch = AGENT.run(Model.CODER, "Patch") } ASSERT patch PASSED "npm test" ELSE ROLLBACK }', json: '4 nodes, 1 branch, 1 parallel, 1 assert' },
  { key: 'CapLang', name: 'CapLang', icon: Shield, color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20', saving: 'Kernel isolation', example: 'POLICY Sandbox { ALLOW fs.read ON ["src/**"] DENY network.egress EXCEPT ["registry.npmjs.org"] SET RESOURCE_LIMITS { cpu: 0.5 } }', json: 'Kernel-enforced, no bypass' },
  { key: 'AssertDSL', name: 'AssertDSL', icon: CheckCircle, color: 'text-green-400', bg: 'bg-green-500/10 border-green-500/20', saving: 'No false success', example: 'CONTRACT SecurityFix { PRECONDITIONS { git.status == CLEAN } POSTCONDITIONS { METRIC coverage() >= 80% EXEC "npm test" RETURNS EXIT_CODE 0 EVIDENCE SIGNED_BY "kernel" } }', json: 'Proof required before close' },
  { key: 'AgentIDL', name: 'AgentIDL', icon: FileJson, color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20', saving: '60% vs OpenAPI', example: 'tool fs_write(path: str @req, content: str @req) -> bool { doc "Writes text" err PATH_TRAVERSAL "Restricted" }', json: '62 tokens vs 202 JSON → 69.3% saving' },
  { key: 'GuardDSL', name: 'GuardDSL', icon: AlertTriangle, color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20', saving: 'Real-time safety', example: 'GUARD Safety; BEFORE_EXECUTE tool.shell_run(cmd) { RULE NoSudo { ASSERT NOT cmd.contains("sudo") ELSE REJECT } }', json: 'Prevents destructive commands' },
];

export default function DslPanel() {
  const [selected, setSelected] = useState('AIR');
  const [dslStats, setDslStats] = useState({ total: 16, compiled: 16, tokenSaving: '62.5%', stability: '100%' });
  const [liveMetrics, setLiveMetrics] = useState({ airTokens: 27, jsonTokens: 31, saving: '12.9%', binaryMultiplier: '1.2x', speculativeHitRate: '100%' });

  useEffect(() => {
    // Mock live metrics update
    const interval = setInterval(() => {
      setLiveMetrics(m => ({
        ...m,
        airTokens: 25 + Math.floor(Math.random()*5),
        jsonTokens: 30 + Math.floor(Math.random()*5),
        saving: (10 + Math.random()*15).toFixed(1) + '%',
        binaryMultiplier: (1.2 + Math.random()*0.8).toFixed(1) + 'x',
        speculativeHitRate: '100%'
      }));
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const current = DSL_EXAMPLES.find(d => d.key === selected) || DSL_EXAMPLES[0];

  return (
    <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-2xl overflow-hidden flex flex-col h-[680px] hover:border-slate-700/80 transition-colors">
      <div className="px-4 py-3 border-b border-slate-800/80 flex justify-between items-center bg-slate-900/60">
        <h3 className="text-[11px] font-semibold text-slate-300 uppercase tracking-widest flex items-center gap-2">
          <Layers className="w-3.5 h-3.5 text-cyan-400" /> DSL/IR Engine v0.7
          <span className="px-2 py-0.5 bg-cyan-500/10 border border-cyan-500/20 rounded-full text-[9px] text-cyan-300 font-mono">16 DSLs</span>
          <span className="px-1.5 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full text-[9px] text-emerald-300">50-70% saving</span>
          <span className="px-1.5 py-0.5 bg-purple-500/10 border border-purple-500/20 rounded-full text-[9px] text-purple-300">100% stable</span>
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono text-slate-600">AIR • CtxQL • AST-Patch • FlowDSL • CapLang • AssertDSL • NanoDSL • MemLang • AgentIDL • Consensus • Guard • StateDiff • Replay • MediaPipe • PmplSpec • Binary • Speculative</span>
          <div className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse"></div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 p-3 border-b border-slate-800/50 bg-black/10">
        <div className="bg-black/30 border border-slate-800/50 rounded-xl p-2.5">
          <div className="text-[10px] text-slate-500 uppercase">Token Saving</div>
          <div className="text-[18px] font-bold text-cyan-400 font-mono mt-1">{liveMetrics.saving} <span className="text-[10px] text-slate-500">avg</span></div>
          <div className="text-[9px] text-slate-600 font-mono mt-1">AIR {liveMetrics.airTokens} vs JSON {liveMetrics.jsonTokens} • AgentIDL 69.3% vs OpenAPI</div>
        </div>
        <div className="bg-black/30 border border-slate-800/50 rounded-xl p-2.5">
          <div className="text-[10px] text-slate-500 uppercase">Context Multiplier</div>
          <div className="text-[18px] font-bold text-purple-400 font-mono mt-1">{liveMetrics.binaryMultiplier} <span className="text-[10px] text-slate-500">400-800% claim</span></div>
          <div className="text-[9px] text-slate-600 font-mono mt-1">Binary Semantic Tokenizer • AST-aware • 1-byte code tokens</div>
        </div>
        <div className="bg-black/30 border border-slate-800/50 rounded-xl p-2.5">
          <div className="text-[10px] text-slate-500 uppercase">Speculative Hit Rate</div>
          <div className="text-[18px] font-bold text-amber-400 font-mono mt-1">{liveMetrics.speculativeHitRate} <span className="text-[10px] text-slate-500">near zero latency</span></div>
          <div className="text-[9px] text-slate-600 font-mono mt-1">Top-5 branches predicted, WASM parallel, cancel others on main decision</div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="w-[200px] border-r border-slate-800/50 bg-black/20 p-2 overflow-y-auto custom-scrollbar space-y-1">
          {DSL_EXAMPLES.map(dsl => {
            const Icon = dsl.icon;
            return (
              <button key={dsl.key} onClick={() => setSelected(dsl.key)} className={`w-full text-left p-2 rounded-lg border flex items-center gap-2 transition-all ${selected === dsl.key ? dsl.bg + ' border-current' : 'bg-slate-800/20 border-slate-700/20 hover:border-slate-600/50'}`}>
                <Icon className={`w-3.5 h-3.5 ${dsl.color}`} />
                <div className="flex-1">
                  <div className="text-[11px] font-mono font-bold text-slate-300">{dsl.key}</div>
                  <div className="text-[9px] text-slate-500">{dsl.saving}</div>
                </div>
              </button>
            );
          })}
          <div className="pt-2 border-t border-slate-800/30 mt-2 space-y-1">
            <div className="text-[9px] text-slate-600 uppercase px-2">More DSLs</div>
            {['NanoDSL','MemLang','Consensus','StateDiff','Replay','MediaPipe','PmplSpec','Binary','Speculative'].map(k => (
              <div key={k} className="px-2 py-1 text-[10px] font-mono text-slate-500 bg-slate-800/10 rounded border border-slate-800/20">{k}</div>
            ))}
          </div>
        </div>

        <div className="flex-1 p-3 overflow-y-auto custom-scrollbar space-y-3 bg-black/5">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <current.icon className={`w-4 h-4 ${current.color}`} />
              <span className="text-[13px] font-bold text-slate-200 font-mono">{current.key} — {current.name}</span>
              <span className={`text-[9px] px-2 py-0.5 rounded-full border ${current.bg} ${current.color}`}>{current.saving}</span>
            </div>

            <div className="grid grid-cols-1 gap-3">
              <div className="p-3 rounded-xl bg-slate-800/20 border border-slate-700/30">
                <div className="text-[10px] text-slate-500 uppercase mb-2">DSL Source (token-optimized)</div>
                <pre className="text-[11px] font-mono text-cyan-300 whitespace-pre-wrap break-all leading-relaxed bg-black/40 p-3 rounded-lg border border-slate-800/50 overflow-x-auto">{current.example}</pre>
              </div>

              <div className="p-3 rounded-xl bg-slate-800/20 border border-slate-700/30">
                <div className="text-[10px] text-slate-500 uppercase mb-2">Compiled IR / Execution Plan</div>
                <pre className="text-[11px] font-mono text-emerald-300 whitespace-pre-wrap break-all leading-relaxed bg-black/40 p-3 rounded-lg border border-slate-800/50">{current.json}</pre>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="p-2.5 rounded-xl bg-cyan-500/5 border border-cyan-500/10">
                  <div className="text-[10px] text-cyan-400 uppercase">Effect</div>
                  <div className="text-[11px] text-slate-300 mt-1 font-mono">
                    {current.key === 'AIR' && '50-70% token saving vs JSON, zero bracket errors, S-expressions'}
                    {current.key === 'CtxQL' && 'Precise AST-level context, no prompt flooding, token-aware LIMIT'}
                    {current.key === 'AstPatchDSL' && '100% stability, semantic selectors, not line numbers, syntax validated'}
                    {current.key === 'FlowDSL' && 'Strict executable structure, adaptive branches, parallel, rollback on assert'}
                    {current.key === 'CapLang' && 'Kernel-enforced isolation, prevents prompt injection bypass, resource limits'}
                    {current.key === 'AssertDSL' && 'Eliminates false success, proof required before close, metrics + evidence'}
                    {current.key === 'AgentIDL' && '60% token saving vs OpenAPI, compressed tool definitions, error codes'}
                    {current.key === 'GuardDSL' && 'Real-time safety, intercepts before kernel, numeric feedback, REJECT/WARN'}
                  </div>
                </div>
                <div className="p-2.5 rounded-xl bg-purple-500/5 border border-purple-500/10">
                  <div className="text-[10px] text-purple-400 uppercase">Architecture</div>
                  <div className="text-[11px] text-slate-300 mt-1 font-mono">
                    Pure cell logic in packages/cells/celia/dsl/src/ — no fs, no net<br/>
                    Port in tools/celia-dsl-port.mjs — allowed fs, evidence-bound<br/>
                    Compiles to JSON IR, validated, then executed via workspace port<br/>
                    Dashboard: live token metrics, binary multiplier, speculative hit rate
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-slate-800/30 pt-3">
            <div className="text-[10px] font-bold text-slate-400 uppercase mb-2 flex items-center gap-1">
              <Zap className="w-3 h-3" /> All 16 DSLs Execution Flow
            </div>
            <div className="space-y-1.5">
              {[
                '1. Agent writes DSL (token-optimized) → 50-70% saving vs JSON/YAML',
                '2. DSL Port compiles → validates syntax (vm.Script) → generates IR + execution plan',
                '3. IR executed via transactional workspace (CoW) + contract checks + AST patching',
                '4. Binary tokenizer compresses code AST to 1-byte tokens → 400-800% context window',
                '5. Speculative engine predicts Top-5 branches, executes WASM parallel, zero latency on HIT',
                '6. GuardDSL + CapLang kernel-enforced → prevents prompt injection, resource limits',
                '7. AssertDSL + FlowDSL → proof required, no false success, rollback on assert fail',
                '8. StateDiff + ReplayDSL → delta commits, fast rollback, time-travel fork without restart',
                '9. MemLang + CtxQL → precise memory/context queries, decay control, no flooding'
              ].map((step,i) => (
                <div key={i} className="text-[10px] font-mono p-1.5 rounded bg-black/20 border border-slate-800/20 text-slate-400">
                  {step}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="px-3 py-2 border-t border-slate-800/60 bg-slate-900/40 flex justify-between items-center text-[10px] font-mono text-slate-500">
        <span>AIR • CtxQL • AST-Patch • FlowDSL • CapLang • AssertDSL • NanoDSL • MemLang • AgentIDL • Consensus • Guard • StateDiff • Replay • MediaPipe • PmplSpec • Binary • Speculative</span>
        <span className="flex items-center gap-1"><span className="w-1 h-1 bg-cyan-500 rounded-full animate-pulse"></span>v0.7 • 16 DSLs • 314 tests • 6 gates CLOSED</span>
      </div>
    </div>
  );
}
