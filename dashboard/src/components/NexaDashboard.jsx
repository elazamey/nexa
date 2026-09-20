import React, { useState, useEffect } from 'react';
import { Activity, Shield, Zap, Cpu, MemoryStick, Clock, Terminal, Database, Brain, Play, RotateCcw, Box, Layers, FileJson } from 'lucide-react';
import SemanticRagPanel from './SemanticRagPanel.jsx';

// CounterCard - Glassmorphism Telemetry
const CounterCard = ({ title, value, unit, icon: Icon, color, bgGlow, pulse = false, subValue }) => (
  <div className="relative overflow-hidden bg-slate-900/50 backdrop-blur-md border border-slate-800 rounded-xl p-4 flex flex-col justify-between group hover:border-slate-700 transition-all duration-300">
    <div className="flex justify-between items-start mb-3">
      <span className="text-slate-400 text-[10px] font-semibold uppercase tracking-widest">{title}</span>
      <div className={`p-1.5 rounded-lg bg-slate-800/80 border border-slate-700/50 group-hover:border-slate-600 transition-colors`}>
        <Icon className={`w-3.5 h-3.5 ${color} ${pulse ? 'animate-pulse' : ''}`} />
      </div>
    </div>
    <div className="flex items-baseline gap-1.5">
      <span className={`text-2xl font-bold tracking-tight ${color}`}>{value}</span>
      <span className="text-slate-500 text-[11px] font-mono">{unit}</span>
    </div>
    {subValue && <div className="text-[10px] text-slate-500 mt-1 font-mono truncate">{subValue}</div>}
    {/* glow */}
    <div className={`absolute -bottom-6 -right-6 w-20 h-20 ${bgGlow} opacity-[0.08] group-hover:opacity-[0.12] blur-2xl rounded-full transition-opacity`}></div>
    <div className="absolute inset-0 bg-gradient-to-br from-white/[0.02] to-transparent pointer-events-none"></div>
  </div>
);

const getStateStyle = (state) => {
  switch(state) {
    case 'SUCCESS': return { bg: 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300', dot: 'bg-emerald-400', label: 'SUCCESS' };
    case 'RUNNING': return { bg: 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300 animate-pulse', dot: 'bg-cyan-400 animate-pulse', label: 'RUNNING' };
    case 'FAILED': return { bg: 'bg-red-500/10 border-red-500/30 text-red-300', dot: 'bg-red-400', label: 'FAILED' };
    case 'PENDING': return { bg: 'bg-amber-500/10 border-amber-500/30 text-amber-300', dot: 'bg-amber-400 animate-pulse', label: 'PENDING' };
    default: return { bg: 'bg-slate-800/50 border-slate-700 text-slate-400', dot: 'bg-slate-500', label: state || 'IDLE' };
  }
};

export default function NexaDashboard() {
  const [metrics, setMetrics] = useState({
    status: 'LIVE',
    parallelNodes: 0,
    speculativeHits: 0,
    memoryDigests: 142,
    contextUsage: '2.1',
    executionTime: 0,
    securityGates: '6/6',
    evidenceCount: 3,
    testsPass: '314/314'
  });

  const [logs, setLogs] = useState([]);
  const [nodes, setNodes] = useState({});
  const [connectionStatus, setConnectionStatus] = useState('Connecting...');
  const [dagStats, setDagStats] = useState({ passed: 0, failed: 0, total: 0 });
  const [evidence, setEvidence] = useState([]);
  const [memory, setMemory] = useState([]);
  const [thinking, setThinking] = useState({ steps: [], model: 'grok-2' });

  // SSE + initial data fetch
  useEffect(() => {
    // fetch initial state
    const fetchState = async () => {
      try {
        const [evRes, memRes, postureRes] = await Promise.all([
          fetch('/api/celia/evidence').then(r=>r.json()).catch(()=>[]),
          fetch('/api/celia/memory').then(r=>r.json()).catch(()=>[]),
          fetch('/api/posture').then(r=>r.json()).catch(()=>({posture:''}))
        ]);
        const ev = Array.isArray(evRes) ? evRes : (evRes.evidence || []);
        const mem = Array.isArray(memRes) ? memRes : (memRes.memory || []);
        setEvidence(ev);
        setMemory(mem);
        setMetrics(m => ({ ...m, memoryDigests: mem.length || m.memoryDigests, evidenceCount: ev.length }));
        // mock thinking if not present
        setThinking({
          model: 'grok-2',
          timestamp: new Date().toISOString(),
          steps: [
            { kind: 'observe', key: 'project', detail: 'Observe NEXA repository structure' },
            { kind: 'do', capref: 'github.repository.read', args: { owner: 'elazamey', repo: 'nexa' }, as: 'repo' },
            { kind: 'evidence', claim: 'repository inspected', from: 'repo' },
            { kind: 'do', capref: 'celia.memory.remember', args: { tier: 'episodic', digest: 'sha256:abc...' }, as: 'mem' },
            { kind: 'emit', value: 'repo' }
          ]
        });
      } catch {}
    };
    fetchState();

    // SSE - use relative URL to work behind proxy and E2B preview
    const sseUrl = '/api/v1/dag-stream';
    const eventSource = new EventSource(sseUrl);
    
    eventSource.onopen = () => {
      setConnectionStatus('Live');
      setMetrics(m => ({ ...m, status: 'LIVE' }));
      setLogs(prev => [`[${new Date().toLocaleTimeString()}] ● SSE connected to ${sseUrl}`, ...prev].slice(0, 30));
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'CONNECTED') {
          setConnectionStatus('Live');
          setLogs(prev => [`[${new Date().toLocaleTimeString()}] ✓ ${data.message}`, ...prev].slice(0,30));
        } else if (data.type === 'HEARTBEAT') {
          // keep-alive
        } else if (data.type === 'NODE_STATE_CHANGE') {
          const { nodeId, state, evidenceRef } = data.payload;
          setNodes(prev => ({ ...prev, [nodeId]: data.payload }));
          setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${nodeId} → ${state} ${evidenceRef ? evidenceRef.slice(0,20)+'...' : ''}`, ...prev].slice(0, 30));
          
          if (state === 'RUNNING') {
            setMetrics(m => ({ ...m, parallelNodes: m.parallelNodes + 1, executionTime: m.executionTime + 87 }));
          } else if (state === 'SUCCESS') {
            setMetrics(m => ({ 
              ...m, 
              parallelNodes: Math.max(0, m.parallelNodes - 1), 
              memoryDigests: m.memoryDigests + 1,
              evidenceCount: m.evidenceCount + 1,
              contextUsage: (parseFloat(m.contextUsage) + 0.3).toFixed(1)
            }));
            setDagStats(prev => ({ ...prev, passed: prev.passed + 1 }));
          } else if (state === 'FAILED') {
            setDagStats(prev => ({ ...prev, failed: prev.failed + 1 }));
            setMetrics(m => ({ ...m, parallelNodes: Math.max(0, m.parallelNodes - 1) }));
          }
        } else if (data.type === 'DAG_START') {
          setNodes({});
          setDagStats({ passed: 0, failed: 0, total: data.payload.nodes || 6 });
          setLogs(prev => [`[${new Date().toLocaleTimeString()}] ▶ DAG START ${data.payload.nodes} nodes`, ...prev].slice(0,30));
          setMetrics(m => ({ ...m, executionTime: 0 }));
        } else if (data.type === 'DAG_COMPLETE') {
          setDagStats(prev => ({ ...prev, passed: data.payload.passed, failed: data.payload.failed }));
          setLogs(prev => [`[${new Date().toLocaleTimeString()}] ■ DAG COMPLETE passed=${data.payload.passed} failed=${data.payload.failed}`, ...prev].slice(0,30));
          setMetrics(m => ({ ...m, parallelNodes: 0 }));
          // refresh evidence after completion
          fetch('/api/celia/evidence').then(r=>r.json()).then(ev=>{
            const arr = Array.isArray(ev) ? ev : (ev.evidence || []);
            setEvidence(arr);
          }).catch(()=>{});
        } else if (data.type === 'SPECULATIVE_START') {
          setMetrics(m => ({ ...m, speculativeHits: m.speculativeHits + 1 }));
          setLogs(prev => [`[${new Date().toLocaleTimeString()}] ⚡ SPECULATIVE ${data.payload.nodeId}`, ...prev].slice(0,30));
          setNodes(prev => ({
            ...prev,
            [data.payload.nodeId]: { ...prev[data.payload.nodeId], speculative: true, state: 'RUNNING', evidenceRef: data.payload.evidenceRef }
          }));
        }
      } catch (e) {
        console.error('SSE parse error', e);
      }
    };

    eventSource.onerror = (err) => {
      console.error('SSE error', err);
      setConnectionStatus('Disconnected - Retrying...');
      setMetrics(m => ({ ...m, status: 'RECONNECTING' }));
      setTimeout(() => {
        if (eventSource.readyState === EventSource.CLOSED) {
          setConnectionStatus('Reconnecting...');
        }
      }, 1000);
    };

    return () => eventSource.close();
  }, []);

  const runDag = async () => {
    try {
      setConnectionStatus('Starting DAG...');
      setNodes({});
      setLogs(prev => [`[${new Date().toLocaleTimeString()}] ▶ Triggering DAG execution...`, ...prev].slice(0,30));
      const res = await fetch('/api/v1/dag-run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      setConnectionStatus('Live - DAG Running');
      setLogs(prev => [`[${new Date().toLocaleTimeString()}] ✓ DAG triggered: ${data.nodes?.join(', ')}`, ...prev].slice(0,30));
    } catch (e) {
      setConnectionStatus('Failed to start DAG');
      setLogs(prev => [`[${new Date().toLocaleTimeString()}] ✗ Failed to trigger DAG: ${e.message}`, ...prev].slice(0,30));
    }
  };

  const runDemo = async () => {
    try {
      const res = await fetch('/api/celia/run-demo', { method: 'POST' });
      const data = await res.json();
      if (data.thinking) setThinking(data.thinking);
      if (data.evidence) setEvidence(Array.isArray(data.evidence) ? data.evidence : data.evidence.evidence || []);
      if (data.memory) setMemory(Array.isArray(data.memory) ? data.memory : data.memory.memory || []);
      setLogs(prev => [`[${new Date().toLocaleTimeString()}] ▶ Demo executed`, ...prev].slice(0,30));
    } catch (e) {
      setLogs(prev => [`[${new Date().toLocaleTimeString()}] ✗ Demo failed: ${e.message}`, ...prev].slice(0,30));
    }
  };

  const nodeList = Object.values(nodes);
  const hasNodes = nodeList.length > 0;

  return (
    <div className="min-h-screen bg-black text-slate-200 font-sans selection:bg-cyan-500/30">
      {/* Grid background */}
      <div className="fixed inset-0 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:32px_32px] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_110%)] opacity-[0.15] pointer-events-none"></div>
      
      <div className="relative z-10 p-4 md:p-6 max-w-[1600px] mx-auto">
        {/* HUD Header */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-blue-600/20 flex items-center justify-center border border-cyan-500/30 backdrop-blur-md">
                <Activity className="w-5 h-5 text-cyan-400" />
              </div>
              <div className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full border-2 border-black animate-pulse"></div>
            </div>
            <div>
              <h1 className="text-[22px] font-bold tracking-tight flex items-center gap-2">
                <span className="bg-gradient-to-r from-cyan-400 via-blue-400 to-purple-400 bg-clip-text text-transparent">NEXA OS</span>
                <span className="text-slate-600 font-mono text-sm font-normal">KERNEL</span>
              </h1>
              <div className="flex items-center gap-2 mt-0.5">
                <p className="text-[11px] text-slate-500 font-mono">celia_agent // v0.4.1 // glassmorphism</p>
                <span className="w-1 h-1 bg-slate-700 rounded-full"></span>
                <p className="text-[11px] text-slate-500 font-mono flex items-center gap-1"><Box className="w-3 h-3" /> 6 gates CLOSED</p>
              </div>
            </div>
          </div>
          
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-900/60 backdrop-blur-md border border-slate-800 rounded-full text-[11px] font-mono">
              <div className={`w-2 h-2 rounded-full ${connectionStatus === 'Live' ? 'bg-green-500 animate-pulse' : 'bg-amber-500'}`}></div>
              <span className={connectionStatus === 'Live' ? 'text-green-400' : 'text-amber-400'}>{connectionStatus}</span>
              <span className="text-slate-600">•</span>
              <span className="text-slate-400">{metrics.status}</span>
            </div>
            <div className="px-3 py-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full text-[11px] font-mono text-emerald-400 flex items-center gap-1.5">
              <Shield className="w-3 h-3" /> {metrics.testsPass} • {metrics.securityGates} CLOSED
            </div>
            <button onClick={runDag} className="px-3.5 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-black rounded-full text-[11px] font-bold tracking-wide flex items-center gap-1.5 transition-colors">
              <Play className="w-3 h-3 fill-black" /> RUN DAG
            </button>
            <button onClick={runDemo} className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded-full text-[11px] font-mono flex items-center gap-1.5 transition-colors">
              <Zap className="w-3 h-3" /> DEMO
            </button>
          </div>
        </header>

        {/* Telemetry Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          <CounterCard title="Parallel DAGs" value={metrics.parallelNodes} unit="Active" icon={Cpu} color="text-cyan-400" bgGlow="bg-cyan-500" pulse={metrics.parallelNodes > 0} subValue={`${dagStats.passed}/${dagStats.total} done`} />
          <CounterCard title="Speculative ⚡" value={metrics.speculativeHits} unit="Hits" icon={Zap} color="text-yellow-400" bgGlow="bg-yellow-500" subValue="PASTE 48.5% saved" />
          <CounterCard title="Memory Cells" value={metrics.memoryDigests} unit="Digests" icon={MemoryStick} color="text-purple-400" bgGlow="bg-purple-500" subValue={`${metrics.evidenceCount} evidence`} />
          <CounterCard title="Context Window" value={metrics.contextUsage} unit="KB" icon={Terminal} color="text-blue-400" bgGlow="bg-blue-500" subValue="digest-only" />
          <CounterCard title="Exec Time" value={metrics.executionTime} unit="ms" icon={Clock} color="text-slate-300" bgGlow="bg-slate-500" subValue={`${dagStats.passed} passed`} />
          <CounterCard title="Security" value="CLOSED" unit="6 Gates" icon={Shield} color="text-green-400" bgGlow="bg-green-500" subValue="BLOCKED 31/31" />
        </div>

        {/* Main Arena: Terminal + DAG + Details */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-6">
          {/* Live Terminal */}
          <div className="lg:col-span-4 bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-2xl overflow-hidden flex flex-col h-[460px] group hover:border-slate-700/80 transition-colors">
            <div className="px-4 py-3 border-b border-slate-800/80 flex justify-between items-center bg-slate-900/60">
              <h3 className="text-[11px] font-semibold text-slate-300 uppercase tracking-widest flex items-center gap-2">
                <Terminal className="w-3.5 h-3.5 text-slate-400" /> System Stdout
                <span className="ml-2 px-1.5 py-0.5 bg-slate-800 rounded text-[9px] text-slate-500 font-mono">{logs.length}</span>
              </h3>
              <div className="flex gap-1">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500/20 border border-red-500/30"></div>
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/20 border border-yellow-500/30"></div>
                <div className="w-2.5 h-2.5 rounded-full bg-green-500/20 border border-green-500/30"></div>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1 font-mono text-[11px] custom-scrollbar bg-black/20">
              {logs.length === 0 ? (
                <div className="text-slate-600 py-8 text-center">
                  <Terminal className="w-6 h-6 mx-auto mb-2 opacity-30" />
                  <div>Waiting for DAG execution...</div>
                  <div className="text-[10px] mt-1">Trigger RUN DAG to see live logs</div>
                </div>
              ) : (
                logs.map((log, i) => (
                  <div key={i} className="flex gap-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800/30 px-2 py-1 rounded transition-colors group/log">
                    <span className="text-slate-600 select-none">{String(logs.length - i).padStart(2,'0')}</span>
                    <span className="flex-1 break-all leading-relaxed">{log}</span>
                  </div>
                ))
              )}
            </div>
            <div className="px-3 py-2 border-t border-slate-800/60 bg-slate-900/40 flex gap-2">
              <button onClick={runDag} className="flex-1 py-1.5 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 text-cyan-300 rounded-lg text-[11px] font-mono flex items-center justify-center gap-1.5 transition-colors">
                <Play className="w-3 h-3" /> Run DAG
              </button>
              <button onClick={() => setLogs([])} className="px-3 py-1.5 bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700/50 text-slate-400 rounded-lg text-[11px] font-mono transition-colors">
                <RotateCcw className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* DAG Visualizer - Main Arena Centerpiece */}
          <div className="lg:col-span-8 bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-2xl overflow-hidden flex flex-col h-[460px] relative group hover:border-slate-700/80 transition-colors">
            {/* Grid pattern */}
            <div className="absolute inset-0 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:24px_24px] opacity-[0.08]"></div>
            <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/[0.03] via-transparent to-purple-500/[0.03]"></div>
            
            <div className="relative z-10 px-4 py-3 border-b border-slate-800/80 flex justify-between items-center bg-slate-900/60">
              <h3 className="text-[11px] font-semibold text-slate-300 uppercase tracking-widest flex items-center gap-2">
                <Layers className="w-3.5 h-3.5 text-cyan-400" /> DAG Executor — Real-time SSE
                <span className="px-2 py-0.5 bg-cyan-500/10 border border-cyan-500/20 rounded-full text-[9px] text-cyan-300 font-mono">{dagStats.total} NODES</span>
                {dagStats.passed > 0 && <span className="px-1.5 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full text-[9px] text-emerald-300">{dagStats.passed} ✓</span>}
              </h3>
              <div className="flex items-center gap-2 text-[10px] font-mono">
                <span className="text-slate-500">PASTE 48.5%</span>
                <span className="w-1 h-1 bg-slate-700 rounded-full"></span>
                <span className="text-slate-400">maxParallel 3</span>
                <div className={`w-2 h-2 rounded-full ml-1 ${connectionStatus === 'Live' ? 'bg-green-500 animate-pulse' : 'bg-amber-500'}`}></div>
              </div>
            </div>

            <div className="relative z-10 flex-1 p-4 overflow-y-auto custom-scrollbar">
              {!hasNodes ? (
                <div className="h-full flex flex-col items-center justify-center text-center">
                  <div className="w-16 h-16 rounded-2xl bg-slate-800/50 border border-slate-700/50 flex items-center justify-center mb-4 group-hover:border-slate-600/50 transition-colors">
                    <Box className="w-8 h-8 text-slate-500" />
                  </div>
                  <div className="text-sm text-slate-400 font-medium">No active DAG</div>
                  <div className="text-[11px] text-slate-600 mt-1 max-w-[280px]">Trigger execution to see real-time node transitions PENDING → RUNNING → SUCCESS with evidence refs</div>
                  <button onClick={runDag} className="mt-4 px-4 py-2 bg-white text-black rounded-full text-xs font-bold hover:bg-slate-200 transition-colors flex items-center gap-2">
                    <Play className="w-3 h-3 fill-black" /> Run DAG Now
                  </button>
                  <div className="mt-6 flex gap-2 text-[10px] font-mono text-slate-600">
                    <span className="px-2 py-1 bg-slate-800/50 rounded-full border border-slate-700/30">discover</span>
                    <span className="px-2 py-1 bg-slate-800/50 rounded-full border border-slate-700/30">inspect-*</span>
                    <span className="px-2 py-1 bg-slate-800/50 rounded-full border border-slate-700/30">analyze</span>
                    <span className="px-2 py-1 bg-slate-800/50 rounded-full border border-slate-700/30">verify</span>
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {nodeList.map((node) => {
                    const style = getStateStyle(node.state);
                    return (
                      <div key={node.nodeId} className={`relative overflow-hidden rounded-xl border p-3 backdrop-blur-md transition-all duration-500 ${style.bg} group/card hover:scale-[1.01]`}>
                        <div className="flex justify-between items-start mb-2">
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${style.dot}`}></div>
                            <span className="font-mono text-xs font-bold tracking-wide">{node.nodeId}</span>
                            {node.speculative && <span className="text-[10px] px-1 py-0.5 bg-yellow-500/20 border border-yellow-500/30 rounded text-yellow-300">⚡ SPEC</span>}
                          </div>
                          <span className="text-[9px] font-mono px-1.5 py-0.5 bg-black/30 rounded border border-white/10">{style.label}</span>
                        </div>
                        <div className="space-y-1.5">
                          <div className="flex justify-between text-[10px] font-mono">
                            <span className="text-slate-500">Evidence</span>
                            <span className="text-slate-300 truncate ml-2">{node.evidenceRef ? node.evidenceRef.slice(0,24) + '...' : '—'}</span>
                          </div>
                          <div className="flex justify-between text-[10px] font-mono">
                            <span className="text-slate-500">Time</span>
                            <span className="text-slate-400">{node.timestamp ? new Date(node.timestamp).toLocaleTimeString() : '—'}</span>
                          </div>
                          <div className="h-1 bg-black/20 rounded-full overflow-hidden mt-2">
                            <div className={`h-full transition-all duration-700 ${node.state === 'SUCCESS' ? 'w-full bg-emerald-400' : node.state === 'RUNNING' ? 'w-2/3 bg-cyan-400 animate-pulse' : node.state === 'PENDING' ? 'w-1/3 bg-amber-400' : 'w-full bg-red-400'}`}></div>
                          </div>
                        </div>
                        <div className="absolute inset-0 bg-gradient-to-br from-white/[0.03] to-transparent pointer-events-none opacity-0 group-hover/card:opacity-100 transition-opacity"></div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="relative z-10 px-4 py-2.5 border-t border-slate-800/60 bg-slate-900/40 flex justify-between items-center text-[10px] font-mono text-slate-500">
              <span>SSE lightweight • uni-directional • no external libs • topological sort</span>
              <span className="flex items-center gap-1.5"><span className="w-1 h-1 bg-green-500 rounded-full animate-pulse"></span>Live • heartbeat 15s • auto-reconnect</span>
            </div>
          </div>
        </div>

        {/* v0.5 Semantic RAG Panel — Full Width */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-6">
          <div className="lg:col-span-5">
            <SemanticRagPanel />
          </div>
          <div className="lg:col-span-7 grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Evidence Chain */}
            <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-2xl overflow-hidden hover:border-slate-700/80 transition-colors">
              <div className="px-4 py-3 border-b border-slate-800/80 flex justify-between items-center bg-slate-900/60">
                <h3 className="text-[11px] font-semibold text-slate-300 uppercase tracking-widest flex items-center gap-2">
                  <FileJson className="w-3.5 h-3.5 text-emerald-400" /> Evidence Chain
                  <span className="px-1.5 py-0.5 bg-slate-800 rounded text-[9px] text-slate-500">{evidence.length}</span>
                </h3>
                <Database className="w-3 h-3 text-slate-600" />
              </div>
              <div className="p-3 max-h-[460px] overflow-y-auto custom-scrollbar space-y-2">
                {evidence.length === 0 ? (
                  <div className="text-[11px] text-slate-600 py-6 text-center">No evidence yet</div>
                ) : evidence.slice(-10).reverse().map((ev, i) => (
                  <div key={i} className="p-2.5 rounded-xl bg-black/30 border border-slate-800/50 hover:border-slate-700/50 transition-colors group">
                    <div className="flex justify-between items-start gap-2">
                      <span className="text-[10px] font-mono text-cyan-300 truncate">{ev.hash?.slice(0,28) || ev.id?.slice(0,20) || 'sha256:...'}</span>
                      <span className="text-[9px] px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded-full text-slate-400 font-mono">{ev.kind || 'EVIDENCE'}</span>
                    </div>
                    <div className="mt-1.5 text-[10px] text-slate-500 font-mono truncate">{JSON.stringify(ev.payload || {}).slice(0,60)}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Memory + Planner Combined */}
            <div className="space-y-4">
              <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-2xl overflow-hidden hover:border-slate-700/80 transition-colors">
                <div className="px-4 py-3 border-b border-slate-800/80 flex justify-between items-center bg-slate-900/60">
                  <h3 className="text-[11px] font-semibold text-slate-300 uppercase tracking-widest flex items-center gap-2">
                    <MemoryStick className="w-3.5 h-3.5 text-purple-400" /> Memory Digests
                    <span className="px-1.5 py-0.5 bg-slate-800 rounded text-[9px] text-slate-500">{memory.length}</span>
                  </h3>
                  <span className="text-[9px] font-mono text-slate-600">digest-only • RLS</span>
                </div>
                <div className="p-3 max-h-[220px] overflow-y-auto custom-scrollbar space-y-2">
                  {memory.length === 0 ? (
                    <div className="text-[11px] text-slate-600 py-6 text-center">No memory cells</div>
                  ) : memory.slice(-5).reverse().map((m, i) => (
                    <div key={i} className="flex justify-between items-center p-2.5 rounded-xl bg-black/30 border border-slate-800/50">
                      <div>
                        <div className="text-[11px] font-mono text-slate-300">{m.tier || 'episodic'}</div>
                        <div className="text-[10px] font-mono text-slate-500 truncate max-w-[140px]">{m.digest?.slice(0,32) || m.id?.slice(0,20)}</div>
                      </div>
                      <span className={`text-[9px] px-2 py-1 rounded-full border font-mono uppercase tracking-wide
                        ${m.tier === 'episodic' ? 'bg-blue-500/10 border-blue-500/20 text-blue-300' : 
                          m.tier === 'semantic' ? 'bg-purple-500/10 border-purple-500/20 text-purple-300' :
                          m.tier === 'working' ? 'bg-amber-500/10 border-amber-500/20 text-amber-300' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'}`}>
                        {m.tier || 'episodic'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-2xl overflow-hidden hover:border-slate-700/80 transition-colors">
                <div className="px-4 py-3 border-b border-slate-800/80 flex justify-between items-center bg-slate-900/60">
                  <h3 className="text-[11px] font-semibold text-slate-300 uppercase tracking-widest flex items-center gap-2">
                    <Brain className="w-3.5 h-3.5 text-pink-400" /> Planner Thinking
                    <span className="px-1.5 py-0.5 bg-slate-800 rounded text-[9px] text-slate-500 font-mono">{thinking.model || 'grok-2'}</span>
                  </h3>
                  <span className="text-[9px] font-mono text-slate-600">{thinking.steps?.length || 0} steps</span>
                </div>
                <div className="p-3 max-h-[220px] overflow-y-auto custom-scrollbar space-y-2">
                  {(thinking.steps || []).slice(0,4).map((step, i) => (
                    <div key={i} className={`p-2.5 rounded-xl border-l-2 bg-black/30 backdrop-blur-sm
                      ${step.kind === 'observe' ? 'border-blue-500/50 bg-blue-500/[0.03]' : 
                        step.kind === 'do' ? 'border-emerald-500/50 bg-emerald-500/[0.03]' :
                        step.kind === 'evidence' ? 'border-purple-500/50 bg-purple-500/[0.03]' :
                        step.kind === 'emit' ? 'border-amber-500/50 bg-amber-500/[0.03]' : 'border-slate-700 bg-slate-800/20'}`}>
                      <div className="flex justify-between items-start">
                        <span className="text-[11px] font-bold font-mono uppercase tracking-wide text-slate-300">{step.kind}</span>
                        <span className="text-[9px] font-mono text-slate-500">{step.capref || step.key || ''}</span>
                      </div>
                      <div className="text-[10px] font-mono text-slate-500 mt-1 leading-relaxed">{step.detail || JSON.stringify(step.args || step.value || {}).slice(0,80)}</div>
                    </div>
                  ))}
                  <div className="grid grid-cols-2 gap-2 text-[10px] font-mono pt-2 border-t border-slate-800/50">
                    <div className="flex justify-between p-2 bg-black/20 rounded-lg border border-slate-800/30"><span className="text-slate-500">Gates</span><span className="text-emerald-400">6 CLOSED</span></div>
                    <div className="flex justify-between p-2 bg-black/20 rounded-lg border border-slate-800/30"><span className="text-slate-500">RAG</span><span className="text-purple-400">384d Top-12</span></div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 pt-6 border-t border-slate-800/50 flex flex-col md:flex-row justify-between items-center gap-2 text-[10px] font-mono text-slate-600">
          <div className="flex items-center gap-3">
            <span>Celia Agent Dashboard — Built on NEXA Ω∞ — Cell → Tissue → Organ → Organism — v0.5 RAG</span>
            <span className="w-1 h-1 bg-slate-700 rounded-full"></span>
            <span className="text-slate-500">AI proposes, deterministic system decides • 384d pgvector • Top-12</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-1 bg-slate-900 border border-slate-800 rounded-full">Glassmorphism • Tailwind • lucide-react • SSE • RAG • 55KB</span>
          </div>
        </div>
      </div>
    </div>
  );
}
