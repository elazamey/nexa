import React, { useState } from 'react';
import { Cpu, Server, Network, Database, Shield, Terminal, Globe, RefreshCw, CheckCircle, Lock, Play, Activity } from 'lucide-react';

export default function MeshArchitecturePanel() {
  const [selectedLayer, setSelectedLayer] = useState('runtimes');
  const [isRouting, setIsRouting] = useState(false);
  const [prompt, setPrompt] = useState('Implement fast Ed25519 signature validation');
  const [routeResult, setRouteResult] = useState(null);

  const runtimes = [
    { name: 'Ollama', endpoint: 'http://localhost:11434', priority: 1, status: 'ONLINE', models: 'qwen3-coder:7b, deepseek-coder:6.7b, qwen2.5:14b' },
    { name: 'llama.cpp', endpoint: 'http://localhost:8080', priority: 2, status: 'ONLINE', models: 'phi-4:mini, gemma-2-2b:q4' },
    { name: 'vLLM', endpoint: 'http://localhost:8000', priority: 3, status: 'STANDBY', models: 'Qwen2.5-Coder-32B-Instruct' },
    { name: 'SGLang', endpoint: 'http://localhost:30000', priority: 4, status: 'STANDBY', models: 'DeepSeek-V3-Quantized' }
  ];

  const layers = [
    { id: 'runtimes', title: '1. Local Model Mesh', icon: Cpu, desc: 'Ollama, llama.cpp, vLLM & SGLang (Zero-Cost / Free-First)' },
    { id: 'protocols', title: '2. Multi-Protocol Tools', icon: Network, desc: 'MCP (Model Context Protocol), A2A & OpenAPI' },
    { id: 'memory', title: '3. Temporal Knowledge Graph', icon: Database, desc: 'Graphiti-style 4-Tier Memory with Causal Provenance' },
    { id: 'computer', title: '4. Computer Use & Sandbox', icon: Terminal, desc: 'Gated Terminal, Playwright Browser & Safe Filesystem' },
    { id: 'governance', title: '5. NEXA Governance & Ledger', icon: Shield, desc: 'Default-Deny, OPA/Cedar Policy & Ed25519 Signed Chain' }
  ];

  const handleExecuteRoute = () => {
    setIsRouting(true);
    setTimeout(() => {
      setIsRouting(false);
      setRouteResult({
        model: 'deepseek-coder:6.7b',
        runtime: 'Ollama (Local / CPU+RAM)',
        cost: '$0.00 (Zero-Cost)',
        latency: '78ms',
        decision: 'ALLOW (Passed Policy Gate)',
        signature: 'ed25519:6a19f...9c0b'
      });
    }, 1000);
  };

  return (
    <div className="space-y-6 text-slate-100">
      {/* Header */}
      <div className="bg-slate-900/80 backdrop-blur border border-emerald-500/30 rounded-xl p-5 shadow-2xl">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg text-emerald-400">
              <Server className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h2 className="text-xl font-bold bg-gradient-to-r from-emerald-400 via-teal-400 to-cyan-400 bg-clip-text text-transparent">
                NEXA Free-First 2026 AI Agent Operating System
              </h2>
              <p className="text-xs text-slate-400">
                Model Mesh + Multi-Protocol (MCP/A2A) + Temporal Knowledge Graph + Ed25519 Governance
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="px-3 py-1 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-lg text-xs font-mono font-bold flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
              Zero-Cost Local Mode Active
            </span>
          </div>
        </div>

        {/* 5-Layer Selector Bar */}
        <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-2 mt-6 pt-5 border-t border-slate-800">
          {layers.map(l => {
            const Icon = l.icon;
            const isSelected = selectedLayer === l.id;
            return (
              <button
                key={l.id}
                onClick={() => setSelectedLayer(l.id)}
                className={`p-3 rounded-lg text-left transition-all border ${
                  isSelected
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300 shadow-lg shadow-emerald-950/40'
                    : 'bg-slate-950/60 border-slate-800/80 text-slate-400 hover:text-slate-200 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center gap-2 font-semibold text-xs mb-1">
                  <Icon className="w-4 h-4 text-emerald-400" />
                  {l.title}
                </div>
                <div className="text-[10px] text-slate-500 truncate">{l.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Layer Content */}
      {selectedLayer === 'runtimes' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {runtimes.map(r => (
              <div key={r.name} className="bg-slate-900/60 border border-slate-800 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-sm text-slate-100 flex items-center gap-2">
                    <Cpu className="w-4 h-4 text-emerald-400" />
                    {r.name}
                  </span>
                  <span className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                    r.status === 'ONLINE' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30' : 'bg-slate-800 text-slate-400'
                  }`}>
                    {r.status}
                  </span>
                </div>
                <div className="text-xs text-slate-400 font-mono">Endpoint: {r.endpoint}</div>
                <div className="text-xs text-cyan-300 font-mono bg-slate-950/60 p-2 rounded border border-slate-800/60">
                  Models: {r.models}
                </div>
              </div>
            ))}
          </div>

          {/* Interactive Router Test */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-3">
            <div className="text-sm font-bold text-slate-200">Interactive Model-Agnostic Router:</div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="flex-1 bg-slate-950/80 border border-slate-700 rounded-lg px-3 py-2 text-sm text-cyan-300 focus:outline-none focus:border-emerald-500"
              />
              <button
                onClick={handleExecuteRoute}
                disabled={isRouting}
                className="px-4 py-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 rounded-lg text-sm font-semibold transition-all flex items-center gap-2 justify-center"
              >
                {isRouting ? <Activity className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                Route Query
              </button>
            </div>

            {routeResult && (
              <div className="mt-4 p-4 bg-slate-950/90 border border-emerald-500/30 rounded-lg grid grid-cols-2 md:grid-cols-4 gap-3 text-xs font-mono">
                <div>
                  <div className="text-slate-500">Selected Model</div>
                  <div className="text-emerald-400 font-bold">{routeResult.model}</div>
                </div>
                <div>
                  <div className="text-slate-500">Runtime & Cost</div>
                  <div className="text-cyan-400 font-bold">{routeResult.cost}</div>
                </div>
                <div>
                  <div className="text-slate-500">Policy Decision</div>
                  <div className="text-emerald-300 font-bold">{routeResult.decision}</div>
                </div>
                <div>
                  <div className="text-slate-500">Signed Receipt</div>
                  <div className="text-purple-400 truncate">{routeResult.signature}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {selectedLayer === 'protocols' && (
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
            <Network className="w-4 h-4 text-cyan-400" />
            Active Protocol Adapters (MCP + A2A + OpenAPI)
          </h3>
          <p className="text-xs text-slate-400">
            NEXA decouples tool connectivity from execution authority: MCP and OpenAPI tools provide the nervous system, while NEXA Policy provides the cryptographically enforced gatekeeper.
          </p>
        </div>
      )}

      {selectedLayer === 'memory' && (
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
            <Database className="w-4 h-4 text-purple-400" />
            Temporal Knowledge Graph & 4-Tier Memory
          </h3>
          <p className="text-xs text-slate-400">
            Graphiti-style temporal relations track entity mutations across time with cryptographic SHA-256 digests and provenance attribution.
          </p>
        </div>
      )}

      {selectedLayer === 'computer' && (
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
            <Terminal className="w-4 h-4 text-amber-400" />
            Computer Use & Micro-Sandbox Execution
          </h3>
          <p className="text-xs text-slate-400">
            Gated Terminal, Playwright browser interactions, and atomic filesystem diffs executed with path-traversal safeguards and zero side-effects on host state.
          </p>
        </div>
      )}

      {selectedLayer === 'governance' && (
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-3">
          <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
            <Shield className="w-4 h-4 text-emerald-400" />
            Zero-Trust Governance & Ed25519 Evidence Ledger
          </h3>
          <p className="text-xs text-slate-400">
            Every action requires explicit capability tokens, evaluates against OPA/Cedar policies, and commits signed receipts into an immutable hash-chained ledger.
          </p>
        </div>
      )}
    </div>
  );
}
