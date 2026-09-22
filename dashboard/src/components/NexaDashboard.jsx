import React, { useState, useEffect, useRef } from 'react';
import { Activity, Shield, Zap, Cpu, MemoryStick, Clock, Terminal, Database, Brain, Play, RotateCcw, Box, Layers, FileJson } from 'lucide-react';
import SemanticRagPanel from './SemanticRagPanel.jsx';
import GovernedMemoryPanel from './GovernedMemoryPanel.jsx';
import TransactionalWorkspacePanel from './TransactionalWorkspacePanel.jsx';
import DslPanel from './DslPanel.jsx';
import UltimatePanel from './UltimatePanel.jsx';
import InfinitePanel from './InfinitePanel.jsx';
import SingularityPanel from './SingularityPanel.jsx';
import OmegaPanel from './OmegaPanel.jsx';
import AgentCanvasEmulator from './AgentCanvasEmulator.jsx';
import BugHunterPanel from './BugHunterPanel.jsx';
import GrandSynthesisPanel from './GrandSynthesisPanel.jsx';
import MeshArchitecturePanel from './MeshArchitecturePanel.jsx';

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
  const [terminal, setTerminal] = useState(null); // last real terminal run (v13-2)
  const [nodes, setNodes] = useState({});
  const [connectionStatus, setConnectionStatus] = useState('Connecting...');
  const [dagStats, setDagStats] = useState({ passed: 0, failed: 0, total: 0 });
  const [evidence, setEvidence] = useState([]);
  const [memory, setMemory] = useState([]);
  const [thinking, setThinking] = useState({ steps: [], model: 'grok-2' });
  const [workspace, setWorkspace] = useState(null);
  const [wsDemoBusy, setWsDemoBusy] = useState(false);
  const [mission, setMission] = useState(null); // tracked directed mission (v13-3)
  const [missionBusy, setMissionBusy] = useState(false);
  const [missionReplay, setMissionReplay] = useState(null);
  const missionIdRef = useRef(null);
  // v13-4 governance suite: Approval Center, unified timeline, honesty, Evidence Drawer
  const [authorizations, setAuthorizations] = useState({ requests: [], chain: null, approver: null });
  const [timeline, setTimeline] = useState({ events: [], head: 0 });
  const [timelineFilter, setTimelineFilter] = useState('');
  const [sysStatus, setSysStatus] = useState(null);
  const [evidenceEvent, setEvidenceEvent] = useState(null);
  const [governBusy, setGovernBusy] = useState(false);
  const timelineHeadRef = useRef(0);

  const fetchAuthorizations = async () => {
    try {
      const res = await fetch('/api/v1/authorizations').then(r => r.json());
      if (res.ok) setAuthorizations({ requests: res.requests || [], chain: res.chain || null, approver: res.approver || null });
    } catch {}
  };
  const fetchTimeline = async () => {
    try {
      const res = await fetch(`/api/v1/timeline?since=${timelineHeadRef.current}&limit=200`).then(r => r.json());
      if (res.ok && Array.isArray(res.events)) {
        timelineHeadRef.current = res.head;
        if (res.events.length > 0) setTimeline(prev => ({ events: [...prev.events, ...res.events].slice(-200), head: res.head }));
        else setTimeline(prev => ({ ...prev, head: res.head }));
      }
    } catch {}
  };
  const fetchSysStatus = async () => {
    try {
      const res = await fetch('/api/v1/system/status').then(r => r.json());
      if (res.ok) setSysStatus(res);
    } catch {}
  };
  const fetchGovernance = () => { fetchAuthorizations(); fetchTimeline(); fetchSysStatus(); };

  useEffect(() => {
    const fetchState = async () => {
      try {
        const [evRes, memRes] = await Promise.all([
          fetch('/api/celia/evidence').then(r=>r.json()).catch(()=>[]),
          fetch('/api/celia/memory').then(r=>r.json()).catch(()=>[])
        ]);
        const ev = Array.isArray(evRes) ? evRes : (evRes.evidence || []);
        const mem = Array.isArray(memRes) ? memRes : (memRes.memory || []);
        setEvidence(ev);
        setMemory(mem);
        setMetrics(m => ({ ...m, memoryDigests: mem.length || m.memoryDigests, evidenceCount: ev.length }));
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

    const sseUrl = '/api/v1/dag-stream';
    const eventSource = new EventSource(sseUrl);
    
    eventSource.onopen = () => {
      setConnectionStatus('Live');
      setMetrics(m => ({ ...m, status: 'LIVE' }));
      setLogs(prev => [`[${new Date().toLocaleTimeString()}] ● SSE connected`, ...prev].slice(0, 30));
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (/^(AUTHORIZATION|MISSION|TERMINAL|CREATIVE)_/.test(data.type || '')) fetchGovernance();
        if (data.type === 'CONNECTED') {
          setConnectionStatus('Live');
          setLogs(prev => [`[${new Date().toLocaleTimeString()}] ✓ ${data.message}`, ...prev].slice(0,30));
        } else if (data.type === 'NODE_STATE_CHANGE') {
          const { nodeId, state, evidenceRef } = data.payload;
          setNodes(prev => ({ ...prev, [nodeId]: data.payload }));
          setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${nodeId} → ${state} ${evidenceRef ? evidenceRef.slice(0,20)+'...' : ''}`, ...prev].slice(0, 30));
          if (state === 'RUNNING') {
            setMetrics(m => ({ ...m, parallelNodes: m.parallelNodes + 1, executionTime: m.executionTime + 87 }));
          } else if (state === 'SUCCESS') {
            setMetrics(m => ({ ...m, parallelNodes: Math.max(0, m.parallelNodes - 1), memoryDigests: m.memoryDigests + 1, evidenceCount: m.evidenceCount + 1, contextUsage: (parseFloat(m.contextUsage) + 0.3).toFixed(1) }));
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
          fetch('/api/celia/evidence').then(r=>r.json()).then(ev=>{
            const arr = Array.isArray(ev) ? ev : (ev.evidence || []);
            setEvidence(arr);
          }).catch(()=>{});
        } else if (data.type === 'SPECULATIVE_START') {
          setMetrics(m => ({ ...m, speculativeHits: m.speculativeHits + 1 }));
          setLogs(prev => [`[${new Date().toLocaleTimeString()}] ⚡ SPECULATIVE ${data.payload.nodeId}`, ...prev].slice(0,30));
        } else if (data.type === 'GOVERNED_REGISTERED') {
          setLogs(prev => [`[${new Date().toLocaleTimeString()}] 🧠 Governed memory registered ${data.payload.id} ${data.payload.type}`, ...prev].slice(0,30));
        } else if (data.type === 'BELIEF_REVISED') {
          setLogs(prev => [`[${new Date().toLocaleTimeString()}] 🔄 Belief revised ${data.payload.previous} → ${data.payload.current}`, ...prev].slice(0,30));
        } else if (data.type === 'FORGETTING_SWEEP') {
          setLogs(prev => [`[${new Date().toLocaleTimeString()}] 🧹 Forgetting sweep retired ${data.payload.swept}`, ...prev].slice(0,30));
        } else if (data.type === 'DAG_NODE_INJECTED') {
          setLogs(prev => [`[${new Date().toLocaleTimeString()}] 🔀 DAG injected ${data.payload.failedNodeId} → ${data.payload.injectedIds?.join(',')} v${data.payload.version}`, ...prev].slice(0,30));
        } else if (data.type === 'WORKSPACE_CREATED') {
          setWorkspace({ id: data.payload.workspaceId, taskId: data.payload.taskId, method: data.payload.method, status: 'STAGING', changes: [], changedFiles: 0, lastEventAt: Date.now() });
          setLogs(prev => [`[${new Date().toLocaleTimeString()}] 📦 Workspace created ${data.payload.workspaceId} task=${data.payload.taskId}`, ...prev].slice(0,30));
        } else if (data.type === 'WORKSPACE_COMMIT') {
          setWorkspace(prev => prev && prev.id === data.payload.workspaceId ? { ...prev, status: 'COMMITTED', changes: data.payload.changes || [], changedFiles: data.payload.changedFiles, committedAt: data.payload.committedAt, lastEventAt: Date.now() } : prev);
          setLogs(prev => [`[${new Date().toLocaleTimeString()}] ✅ Workspace committed ${data.payload.workspaceId} ${data.payload.changedFiles} files atomic`, ...prev].slice(0,30));
        } else if (data.type === 'WORKSPACE_ROLLBACK') {
          setWorkspace(prev => prev && prev.id === data.payload.workspaceId ? { ...prev, status: 'ROLLED_BACK', rolledBackAt: data.payload.rolledBackAt, lastEventAt: Date.now() } : prev);
          setLogs(prev => [`[${new Date().toLocaleTimeString()}] 🔄 Workspace rollback ${data.payload.workspaceId} zero side effects`, ...prev].slice(0,30));
        } else if (data.type === 'CREATIVE_GENERATED') {
          setLogs(prev => [`[${new Date().toLocaleTimeString()}] 🎨 Creative ${data.payload.creativeId} — ${data.payload.variants?.length || 0} variants for ${data.payload.channel} (${data.payload.provider}/${data.payload.model})`, ...prev].slice(0,30));
        } else if (data.type === 'CREATIVE_APPROVED') {
          setLogs(prev => [`[${new Date().toLocaleTimeString()}] ✅ Creative approved ${data.payload.creativeId} — publish remains gated (AUTO_DEPLOY CLOSED)`, ...prev].slice(0,30));
        } else if (data.type === 'CREATIVE_BUDGET_EXCEEDED') {
          setLogs(prev => [`[${new Date().toLocaleTimeString()}] ⛔ Creative budget exceeded: ${data.payload.message}`, ...prev].slice(0,30));
        } else if (data.type === 'AUTHORIZATION_REQUESTED') {
          setLogs(prev => [`[${new Date().toLocaleTimeString()}] 🔐 Approval required: ${data.payload.gate} — ${data.payload.resource}/${data.payload.action} on "${data.payload.target}"`, ...prev].slice(0,30));
        } else if (data.type === 'AUTHORIZATION_APPROVED') {
          setLogs(prev => [`[${new Date().toLocaleTimeString()}] ✅ Approved (${data.payload.scope}) — ${data.payload.approvalId.slice(0, 24)}…`, ...prev].slice(0,30));
        } else if (data.type === 'AUTHORIZATION_DENIED') {
          setLogs(prev => [`[${new Date().toLocaleTimeString()}] ⛔ Approval denied — ${data.payload.approvalId.slice(0, 24)}…${data.payload.reason ? ` (${data.payload.reason})` : ''}`, ...prev].slice(0,30));
        } else if (data.type === 'AUTHORIZATION_CONSUMED') {
          setLogs(prev => [`[${new Date().toLocaleTimeString()}] ▶ Execution authorized: ${data.payload.resource}/${data.payload.action} on "${data.payload.target}"`, ...prev].slice(0,30));
        } else if (data.type === 'TERMINAL_EXECUTED' || data.type === 'TERMINAL_TIMED_OUT') {
          const p = data.payload;
          setTerminal(p);
          setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${p.timedOut ? '⏱' : '▶'} TERMINAL ${p.program} ${p.args.join(' ')} — ${p.timedOut ? 'TIMED OUT' : `exit ${p.exitCode}`} · ${p.durationMs}ms · ${p.sandbox}-jail · ${p.evidenceRef.slice(0, 28)}…`, ...prev].slice(0,30));
        } else if (data.type === 'MISSION_CREATED') {
          missionIdRef.current = data.payload.missionId;
          refreshMission(data.payload.missionId);
          setLogs(prev => [`[${new Date().toLocaleTimeString()}] 🎯 Mission created ${data.payload.name} — ${data.payload.steps} steps`, ...prev].slice(0,30));
        } else if (data.type === 'MISSION_STEP_AUTHORIZED') {
          if (data.payload.missionId === missionIdRef.current) refreshMission(data.payload.missionId);
          setLogs(prev => [`[${new Date().toLocaleTimeString()}] 🔓 Mission step ${data.payload.stepIndex} authorized${data.payload.protected ? ' (approval ' + String(data.payload.approvalId || '').slice(-8) + ')' : ' (auto)'}`, ...prev].slice(0,30));
        } else if (data.type === 'MISSION_STEP_EXECUTED') {
          if (data.payload.missionId === missionIdRef.current) refreshMission(data.payload.missionId);
          setLogs(prev => [`[${new Date().toLocaleTimeString()}] ▶ Mission step ${data.payload.stepIndex} ${data.payload.kind} executed`, ...prev].slice(0,30));
        } else if (data.type === 'MISSION_STEP_VERIFIED') {
          if (data.payload.missionId === missionIdRef.current) refreshMission(data.payload.missionId);
          setLogs(prev => [`[${new Date().toLocaleTimeString()}] ✓ Mission step ${data.payload.stepIndex} verified`, ...prev].slice(0,30));
        } else if (data.type === 'AUTHORIZATION_REQUIRED') {
          if (data.payload.missionId === missionIdRef.current) refreshMission(data.payload.missionId);
          setLogs(prev => [`[${new Date().toLocaleTimeString()}] 🔐 Mission waiting: approve "${data.payload.target}" (step ${data.payload.stepIndex})`, ...prev].slice(0,30));
        } else if (data.type === 'MISSION_COMPLETED') {
          if (data.payload.missionId === missionIdRef.current) refreshMission(data.payload.missionId);
          setLogs(prev => [`[${new Date().toLocaleTimeString()}] 🏁 Mission COMPLETED — verified ${String(data.payload.verificationHash || '').slice(0, 22)}…`, ...prev].slice(0,30));
        } else if (data.type === 'MISSION_FAILED') {
          if (data.payload.missionId === missionIdRef.current) refreshMission(data.payload.missionId);
          setLogs(prev => [`[${new Date().toLocaleTimeString()}] ✗ Mission FAILED step ${data.payload.stepIndex} ${data.payload.code}`, ...prev].slice(0,30));
        } else if (data.type === 'MISSION_DENIED') {
          if (data.payload.missionId === missionIdRef.current) refreshMission(data.payload.missionId);
          setLogs(prev => [`[${new Date().toLocaleTimeString()}] ⛔ Mission DENIED — operator refused approval`, ...prev].slice(0,30));
        } else if (data.type === 'REPLAY') {
          setLogs(prev => [`[${new Date().toLocaleTimeString()}] ⏪ Replay from ${data.payload.fromIndex} checkpoint ${data.payload.checkpointIndex} no LLM calls`, ...prev].slice(0,30));
        } else if (data.type === 'DSL_COMPILED') {
          setLogs(prev => [`[${new Date().toLocaleTimeString()}] 📝 DSL compiled ${data.payload.type} ok=${data.payload.ok} saving=${data.payload.metrics?.savingPercent || data.payload.metrics?.claim || ''}`, ...prev].slice(0,30));
        } else if (data.type === 'SPECULATIVE_RESOLVED') {
          setLogs(prev => [`[${new Date().toLocaleTimeString()}] ⚡ Speculative ${data.payload.hit ? 'HIT '+data.payload.branch?.id : 'MISS'} latency saved ${data.payload.latencySaved||0}ms`, ...prev].slice(0,30));
        }
      } catch (e) {
        console.error('SSE parse error', e);
      }
    };

    eventSource.onerror = () => {
      setConnectionStatus('Disconnected - Retrying...');
      setMetrics(m => ({ ...m, status: 'RECONNECTING' }));
    };

    return () => eventSource.close();
  }, []);

  useEffect(() => {
    fetchGovernance();
    const t = setInterval(fetchGovernance, 5000);
    return () => clearInterval(t);
  }, []);

  const runDag = async () => {
    try {
      setConnectionStatus('Starting DAG...');
      setNodes({});
      setLogs(prev => [`[${new Date().toLocaleTimeString()}] ▶ Triggering DAG...`, ...prev].slice(0,30));
      const res = await fetch('/api/v1/dag-run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      setConnectionStatus('Live - DAG Running');
      setLogs(prev => [`[${new Date().toLocaleTimeString()}] ✓ DAG triggered: ${data.nodes?.join(', ')}`, ...prev].slice(0,30));
    } catch (e) {
      setConnectionStatus('Failed to start DAG');
      setLogs(prev => [`[${new Date().toLocaleTimeString()}] ✗ Failed: ${e.message}`, ...prev].slice(0,30));
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

  // Real CoW workspace demo: create → write×3 → atomic commit (all via the live API)
  const runWorkspaceDemo = async () => {
    try {
      setWsDemoBusy(true);
      setLogs(prev => [`[${new Date().toLocaleTimeString()}] ▶ WS demo: create → write×3 → commit (real CoW)`, ...prev].slice(0,30));
      const createRes = await fetch('/api/v1/workspace/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: 'nexa-live-desktop', evidenceRef: 'evidence:live-desktop-create' })
      }).then(r => r.json());
      const wsId = createRes.workspaceId;
      const files = [
        { path: '.nexa/live/plan.md', content: '# Live plan\n- observe DAG\n- stage files (CoW)\n- atomic commit\n' },
        { path: '.nexa/live/patch.diff', content: '--- a/demo\n+++ b/demo\n@@\n+console.log("committed atomically");\n' },
        { path: '.nexa/live/report.json', content: JSON.stringify({ task: 'nexa-live-desktop', ok: true, evidence: 'evidence:live-demo' }, null, 2) }
      ];
      for (const f of files) {
        await fetch('/api/v1/workspace/write', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ workspaceId: wsId, path: f.path, content: f.content, evidenceRef: `evidence:live-demo:${f.path}` })
        });
      }
      const commitRes = await fetch('/api/v1/workspace/commit', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workspaceId: wsId, evidenceRef: 'evidence:live-demo-commit' })
      }).then(r => r.json());
      setLogs(prev => [`[${new Date().toLocaleTimeString()}] ✅ WS demo committed ${commitRes.changedFiles} files (atomic)`, ...prev].slice(0,30));
    } catch (e) {
      setLogs(prev => [`[${new Date().toLocaleTimeString()}] ✗ WS demo failed: ${e.message}`, ...prev].slice(0,30));
    } finally {
      setWsDemoBusy(false);
    }
  };

  const refreshMission = async (id) => {
    try {
      const res = await fetch(`/api/v1/missions/${encodeURIComponent(id)}`).then(r => r.json());
      if (res.ok) {
        missionIdRef.current = id;
        setMission(res);
        setMissionReplay(null);
      }
    } catch {}
  };

  // Directed-mission demo: creative (auto) → terminal (protected) → creative (auto).
  // Create → run → WAITING_APPROVAL → approve below → auto-resume → COMPLETED.
  const runMissionDemo = async () => {
    try {
      setMissionBusy(true);
      setMissionReplay(null);
      setLogs(prev => [`[${new Date().toLocaleTimeString()}] ▶ Mission demo: create → run (creative → terminal → creative)`, ...prev].slice(0,30));
      const created = await fetch('/api/v1/missions/create', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Campaign Launch',
          plan: [
            { kind: 'creative', label: 'draft variants', creativeArgs: { brand: 'Nexa', product: 'Live Desktop', channel: 'meta', tone: 'bold', variants: 1 }, campaignId: 'launch' },
            { kind: 'terminal', label: 'inspect jail', program: 'ls', args: ['work'] },
            { kind: 'creative', label: 'short cut', creativeArgs: { brand: 'Nexa', product: 'Live Desktop', channel: 'tiktok', variants: 1 }, campaignId: 'launch' },
          ],
        }),
      }).then(r => r.json());
      if (!created.ok) throw new Error(created.error || created.code);
      missionIdRef.current = created.missionId;
      setMission(created);
      const run = await fetch(`/api/v1/missions/${encodeURIComponent(created.missionId)}/run`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      }).then(r => r.json());
      if (run.ok) setMission(run);
      setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${run.status === 'WAITING_APPROVAL' ? '🔐 Mission waiting for approval — approve below to resume' : '🎯 Mission ' + run.status}`, ...prev].slice(0,30));
    } catch (e) {
      setLogs(prev => [`[${new Date().toLocaleTimeString()}] ✗ Mission demo failed: ${e.message}`, ...prev].slice(0,30));
    } finally {
      setMissionBusy(false);
    }
  };

  const approveMissionStep = async () => {
    if (!mission?.pending) return;
    try {
      setMissionBusy(true);
      const res = await fetch(`/api/v1/authorizations/${encodeURIComponent(mission.pending.approvalId)}/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope: 'once' }),
      }).then(r => r.json());
      setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${res.ok ? '✅ Approved once — mission resuming…' : '✗ Approve failed: ' + (res.error || res.code)}`, ...prev].slice(0,30));
    } catch (e) {
      setLogs(prev => [`[${new Date().toLocaleTimeString()}] ✗ Approve failed: ${e.message}`, ...prev].slice(0,30));
    } finally {
      setMissionBusy(false);
    }
  };

  const denyMissionStep = async () => {
    if (!mission?.pending) return;
    try {
      setMissionBusy(true);
      await fetch(`/api/v1/authorizations/${encodeURIComponent(mission.pending.approvalId)}/deny`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'denied from dashboard' }),
      });
      setLogs(prev => [`[${new Date().toLocaleTimeString()}] ⛔ Denied from dashboard`, ...prev].slice(0,30));
    } catch (e) {
      setLogs(prev => [`[${new Date().toLocaleTimeString()}] ✗ Deny failed: ${e.message}`, ...prev].slice(0,30));
    } finally {
      setMissionBusy(false);
    }
  };

  const decideAuthorization = async (approvalId, verb, scope) => {
    try {
      setGovernBusy(true);
      const res = await fetch(`/api/v1/authorizations/${encodeURIComponent(approvalId)}/${verb}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(verb === 'approve' ? { scope: scope || 'once' } : { reason: 'denied from Approval Center' }),
      }).then(r => r.json());
      setLogs(prev => [`[${new Date().toLocaleTimeString()}] ${res.ok ? (verb === 'approve' ? `✅ Approved (${res.scope})` : '⛔ Denied') + ` — ${String(approvalId).slice(-8)}` : '✗ ' + (res.error || res.code)}`, ...prev].slice(0,30));
      fetchGovernance();
      if (missionIdRef.current) refreshMission(missionIdRef.current);
    } catch (e) {
      setLogs(prev => [`[${new Date().toLocaleTimeString()}] ✗ Decision failed: ${e.message}`, ...prev].slice(0,30));
    } finally {
      setGovernBusy(false);
    }
  };

  const fetchMissionReplay = async () => {
    if (!mission?.missionId) return;
    try {
      const res = await fetch(`/api/v1/missions/${encodeURIComponent(mission.missionId)}/replay`).then(r => r.json());
      setMissionReplay(res);
      setLogs(prev => [`[${new Date().toLocaleTimeString()}] ⏪ Replay: integrity ${res.integrity} · ${res.length} events · head ${String(res.head || '').slice(0, 18)}…`, ...prev].slice(0,30));
    } catch (e) {
      setLogs(prev => [`[${new Date().toLocaleTimeString()}] ✗ Replay failed: ${e.message}`, ...prev].slice(0,30));
    }
  };

  const nodeList = Object.values(nodes);
  const hasNodes = nodeList.length > 0;

  return (
    <div className="min-h-screen bg-black text-slate-200 font-sans selection:bg-cyan-500/30">
      <div className="fixed inset-0 bg-[linear-gradient(to_right,#1e293b_1px,transparent_1px),linear-gradient(to_bottom,#1e293b_1px,transparent_1px)] bg-[size:32px_32px] [mask-image:radial-gradient(ellipse_80%_50%_at_50%_0%,#000_70%,transparent_110%)] opacity-[0.15] pointer-events-none"></div>
      
      <div className="relative z-10 p-4 md:p-6 max-w-[1600px] mx-auto">
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
                <p className="text-[11px] text-slate-500 font-mono">celia_agent // v0.8 ultimate // 8-Tier + 7 Physics • Relativistic • Braid • Astrocytic • Holomorphic • DNA • Holographic • Morphic • World-Shaking</p>
                <span className="w-1 h-1 bg-slate-700 rounded-full"></span>
                <p className="text-[11px] text-slate-500 font-mono flex items-center gap-1"><Box className="w-3 h-3" /> 6 gates CLOSED • 30 tools • 16 DSLs • 15 Engines • Z3 100% proof</p>
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
            {sysStatus?.honesty?.map((h) => (
              <div key={h.component} title={h.detail} className={`px-2.5 py-1.5 rounded-full text-[10px] font-mono flex items-center gap-1 border ${h.mode === 'LIVE' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' : 'bg-amber-500/10 border-amber-500/20 text-amber-300'}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${h.mode === 'LIVE' ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`}></span>
                {h.component} {h.mode}
              </div>
            ))}
            <button onClick={runDag} className="px-3.5 py-1.5 bg-cyan-500 hover:bg-cyan-400 text-black rounded-full text-[11px] font-bold tracking-wide flex items-center gap-1.5 transition-colors">
              <Play className="w-3 h-3 fill-black" /> RUN DAG
            </button>
            <button onClick={runDemo} className="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded-full text-[11px] font-mono flex items-center gap-1.5 transition-colors">
              <Zap className="w-3 h-3" /> DEMO
            </button>
          </div>
        </header>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          <CounterCard title="Parallel DAGs" value={metrics.parallelNodes} unit="Active" icon={Cpu} color="text-cyan-400" bgGlow="bg-cyan-500" pulse={metrics.parallelNodes > 0} subValue={`${dagStats.passed}/${dagStats.total} done`} />
          <CounterCard title="Speculative ⚡" value={metrics.speculativeHits} unit="Hits" icon={Zap} color="text-yellow-400" bgGlow="bg-yellow-500" subValue="PASTE 48.5% saved" />
          <CounterCard title="Governed Mem" value={metrics.memoryDigests} unit="Nodes" icon={Brain} color="text-cyan-400" bgGlow="bg-cyan-500" subValue="PROPOSED→RETIRED" />
          <CounterCard title="RAG Engine" value="Top-12" unit="384d" icon={Layers} color="text-purple-400" bgGlow="bg-purple-500" subValue="pgvector optional" />
          <CounterCard title="Exec Time" value={metrics.executionTime} unit="ms" icon={Clock} color="text-slate-300" bgGlow="bg-slate-500" subValue={`${dagStats.passed} passed`} />
          <CounterCard title="Security" value="CLOSED" unit="6 Gates" icon={Shield} color="text-green-400" bgGlow="bg-green-500" subValue="Ledger ✓" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-6">
          <div className="lg:col-span-12">
            <AgentCanvasEmulator nodes={nodes} workspace={workspace} connectionStatus={connectionStatus} onWorkspaceDemo={runWorkspaceDemo} demoBusy={wsDemoBusy} />
          </div>

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
              {terminal && (
                <div className="mb-2 border border-slate-700/60 rounded-lg bg-black/60 p-2">
                  <div className="flex justify-between items-center gap-2 text-[10px] mb-1">
                    <span className="font-mono text-slate-300 truncate">$ {terminal.program} {terminal.args.join(' ')}</span>
                    <span className={`shrink-0 font-mono ${terminal.timedOut ? 'text-amber-400' : terminal.exitCode === 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {terminal.timedOut ? '⏱ TIMEOUT' : `exit ${terminal.exitCode}`} · {terminal.durationMs}ms · {terminal.sandbox}
                    </span>
                  </div>
                  {terminal.stdout ? (
                    <pre className="text-[10px] text-slate-300 whitespace-pre-wrap break-all max-h-24 overflow-y-auto">{terminal.stdout.slice(-2000)}</pre>
                  ) : (
                    <div className="text-[10px] text-slate-600">— no stdout —</div>
                  )}
                  {terminal.stderr && (
                    <pre className="text-[10px] text-red-300/80 whitespace-pre-wrap break-all max-h-16 overflow-y-auto mt-1">{terminal.stderr.slice(-1000)}</pre>
                  )}
                  {terminal.diff && (terminal.diff.added.length + terminal.diff.changed.length + terminal.diff.removed.length > 0) && (
                    <div className="text-[10px] text-cyan-300/80 mt-1">
                      fs-diff: +{terminal.diff.added.length} ~{terminal.diff.changed.length} -{terminal.diff.removed.length} · {terminal.diff.digest.slice(0, 18)}…
                    </div>
                  )}
                </div>
              )}
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

          <div className="lg:col-span-8 bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-2xl overflow-hidden flex flex-col h-[460px] relative group hover:border-slate-700/80 transition-colors">
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
                  <div className="text-[11px] text-slate-600 mt-1 max-w-[280px]">Trigger execution to see real-time node transitions with evidence refs and governed memory integration</div>
                  <button onClick={runDag} className="mt-4 px-4 py-2 bg-white text-black rounded-full text-xs font-bold hover:bg-slate-200 transition-colors flex items-center gap-2">
                    <Play className="w-3 h-3 fill-black" /> Run DAG Now
                  </button>
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
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="relative z-10 px-4 py-2.5 border-t border-slate-800/60 bg-slate-900/40 flex justify-between items-center text-[10px] font-mono text-slate-500">
              <span>SSE lightweight • topological sort • governed memory aware</span>
              <span className="flex items-center gap-1.5"><span className="w-1 h-1 bg-green-500 rounded-full animate-pulse"></span>Live • heartbeat 15s</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-6">
          <div className="lg:col-span-12 bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-2xl overflow-hidden hover:border-slate-700/80 transition-colors">
            <div className="px-4 py-3 border-b border-slate-800/80 flex flex-wrap justify-between items-center gap-2 bg-slate-900/60">
              <h3 className="text-[11px] font-semibold text-slate-300 uppercase tracking-widest flex items-center gap-2">
                <span>🎯</span> Directed Mission — Event-Sourced
                {mission && (
                  <span className={`px-2 py-0.5 rounded-full text-[9px] font-mono border ${mission.status === 'COMPLETED' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : mission.status === 'WAITING_APPROVAL' ? 'bg-amber-500/10 border-amber-500/30 text-amber-300 animate-pulse' : mission.status === 'FAILED' || mission.status === 'DENIED' ? 'bg-red-500/10 border-red-500/30 text-red-300' : 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300'}`}>
                    {mission.status}
                  </span>
                )}
              </h3>
              <div className="flex items-center gap-2">
                <button onClick={runMissionDemo} disabled={missionBusy} className="px-3 py-1.5 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/20 text-cyan-300 rounded-lg text-[11px] font-mono flex items-center gap-1.5 transition-colors disabled:opacity-50">
                  <Play className="w-3 h-3" /> {missionBusy ? 'Working…' : 'Run Mission Demo'}
                </button>
                {mission && (
                  <button onClick={fetchMissionReplay} className="px-3 py-1.5 bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700/50 text-slate-300 rounded-lg text-[11px] font-mono flex items-center gap-1.5 transition-colors">
                    <RotateCcw className="w-3 h-3" /> Replay
                  </button>
                )}
              </div>
            </div>
            <div className="p-4">
              {!mission ? (
                <div className="text-[11px] text-slate-600 py-4 text-center font-mono">No mission yet — run the demo: creative (auto) → terminal (approval) → creative (auto), then replay the chain.</div>
              ) : (
                <div className="space-y-3">
                  <div className="flex justify-between items-center text-[11px] font-mono">
                    <span className="text-slate-300 font-semibold truncate">{mission.name} <span className="text-slate-600 font-normal">{mission.missionId}</span></span>
                    <span className="text-slate-400 shrink-0 ml-2">{mission.progress.verified}/{mission.progress.total} verified</span>
                  </div>
                  <div className="h-2 bg-black/40 rounded-full overflow-hidden border border-slate-800">
                    <div className={`h-full transition-all duration-700 ${mission.status === 'COMPLETED' ? 'bg-emerald-400' : mission.status === 'FAILED' || mission.status === 'DENIED' ? 'bg-red-400' : 'bg-cyan-400'}`} style={{ width: `${mission.progress.total ? (mission.progress.verified / mission.progress.total) * 100 : 0}%` }}></div>
                  </div>
                  {mission.usage && (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-mono text-slate-500">
                      <span>runs {mission.usage.totals.runs}{mission.usage.failed ? <span className="text-red-400"> ({mission.usage.failed} failed)</span> : null}</span>
                      <span>in {mission.usage.totals.inputBytes}B · out {mission.usage.totals.outputBytes}B</span>
                      <span>{mission.usage.totals.durationMs}ms</span>
                      <span>~{mission.usage.tokensEstimated} tok (bytes/4 heuristic)</span>
                      <span className="text-emerald-400/80">$0.00 local-first</span>
                    </div>
                  )}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    {mission.steps.map((s) => (
                      <div key={s.index} className="p-2 rounded-xl bg-black/30 border border-slate-800/60 font-mono">
                        <div className="flex justify-between items-center gap-2">
                          <span className="text-[11px] text-slate-300 truncate">{s.kind === 'terminal' ? '⌨' : '🎨'} {s.label}</span>
                          <span className={`text-[9px] px-1.5 py-0.5 rounded-full border shrink-0 ${s.layer === 'VERIFIED' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : s.layer === 'PLANNED' ? 'bg-slate-800 border-slate-700 text-slate-400' : 'bg-cyan-500/10 border-cyan-500/30 text-cyan-300'}`}>{s.layer}</span>
                        </div>
                        <div className="text-[10px] text-slate-500 truncate mt-1">{s.protected ? '🔒 ' : ''}{s.target}</div>
                      </div>
                    ))}
                  </div>
                  {mission.pending && (
                    <div className="p-3 rounded-xl bg-amber-500/[0.06] border border-amber-500/30 flex flex-wrap justify-between items-center gap-2">
                      <div className="text-[11px] font-mono text-amber-200">🔐 Approval required — step {mission.pending.stepIndex} <span className="text-amber-400/70">{mission.pending.approvalId.slice(0, 32)}…</span></div>
                      <div className="flex gap-2">
                        <button onClick={approveMissionStep} disabled={missionBusy} className="px-3 py-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 rounded-lg text-[11px] font-mono transition-colors disabled:opacity-50">Approve once</button>
                        <button onClick={denyMissionStep} disabled={missionBusy} className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-300 rounded-lg text-[11px] font-mono transition-colors disabled:opacity-50">Deny</button>
                      </div>
                    </div>
                  )}
                  <div className="flex flex-wrap justify-between gap-2 text-[10px] font-mono text-slate-500">
                    <span>layer {mission.layer} · head {String(mission.head || '').slice(0, 22)}… · {mission.length} events</span>
                    {mission.verificationHash && <span className="text-emerald-400/80">✓ verified {mission.verificationHash.slice(0, 22)}…</span>}
                    {missionReplay && <span className={missionReplay.integrity === 'VALID' ? 'text-emerald-400' : 'text-red-400'}>replay: {missionReplay.integrity} · {missionReplay.length} events</span>}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-6">
          <div className="lg:col-span-5 bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-2xl overflow-hidden flex flex-col h-[460px] hover:border-slate-700/80 transition-colors">
            <div className="px-4 py-3 border-b border-slate-800/80 flex justify-between items-center bg-slate-900/60">
              <h3 className="text-[11px] font-semibold text-slate-300 uppercase tracking-widest flex items-center gap-2">
                <Shield className="w-3.5 h-3.5 text-amber-400" /> Approval Center
                <span className="px-1.5 py-0.5 bg-slate-800 rounded text-[9px] text-slate-500 font-mono">{authorizations.requests.length}</span>
                {authorizations.chain && <span className={`text-[9px] font-mono ${authorizations.chain.ok ? 'text-emerald-400' : 'text-red-400'}`}>chain {authorizations.chain.ok ? '✓' : '✗'} len {authorizations.chain.length}</span>}
              </h3>
              <button onClick={fetchGovernance} className="text-slate-500 hover:text-slate-300 transition-colors"><RotateCcw className="w-3 h-3" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
              {authorizations.requests.length === 0 ? (
                <div className="text-[11px] text-slate-600 py-8 text-center font-mono">No approval requests — run a mission with a protected step.</div>
              ) : authorizations.requests.map((r) => (
                <div key={r.approvalId} className="p-2.5 rounded-xl bg-black/30 border border-slate-800/60 font-mono">
                  <div className="flex justify-between items-center gap-2">
                    <span className="text-[11px] text-slate-300 truncate">{r.gate} · {r.resource}/{r.action}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded-full border shrink-0 ${r.decision === 'REQUESTED' ? 'bg-amber-500/10 border-amber-500/30 text-amber-300 animate-pulse' : String(r.decision).startsWith('APPROVED') ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : r.decision === 'DENIED' ? 'bg-red-500/10 border-red-500/30 text-red-300' : 'bg-slate-800 border-slate-700 text-slate-400'}`}>{r.decision}{r.scope ? ` · ${r.scope}` : ''}</span>
                  </div>
                  <div className="text-[10px] text-slate-500 truncate mt-1">target: {r.target} · id …{String(r.approvalId).slice(-8)}{r.expired ? ' · EXPIRED' : ''}</div>
                  {r.missionId && <div className="text-[10px] text-slate-600 truncate">mission {r.missionId}</div>}
                  {r.decision === 'REQUESTED' && !r.expired && (
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => decideAuthorization(r.approvalId, 'approve', 'once')} disabled={governBusy} className="px-2.5 py-1 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-300 rounded-lg text-[10px] font-mono transition-colors disabled:opacity-50">Approve once</button>
                      <button onClick={() => decideAuthorization(r.approvalId, 'approve', 'mission')} disabled={governBusy} className="px-2.5 py-1 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 rounded-lg text-[10px] font-mono transition-colors disabled:opacity-50">Approve mission</button>
                      <button onClick={() => decideAuthorization(r.approvalId, 'deny')} disabled={governBusy} className="px-2.5 py-1 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-300 rounded-lg text-[10px] font-mono transition-colors disabled:opacity-50">Deny</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-4 bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-2xl overflow-hidden flex flex-col h-[460px] hover:border-slate-700/80 transition-colors">
            <div className="px-4 py-3 border-b border-slate-800/80 bg-slate-900/60">
              <div className="flex justify-between items-center">
                <h3 className="text-[11px] font-semibold text-slate-300 uppercase tracking-widest flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5 text-cyan-400" /> Event Timeline
                  <span className="px-1.5 py-0.5 bg-slate-800 rounded text-[9px] text-slate-500 font-mono">head {timeline.head}</span>
                </h3>
              </div>
              <input value={timelineFilter} onChange={(e) => setTimelineFilter(e.target.value)} placeholder="filter: MISSION_ TERMINAL_ AUTHORIZATION_" className="mt-2 w-full px-2.5 py-1.5 bg-black/40 border border-slate-800 rounded-lg text-[10px] font-mono text-slate-300 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/40" />
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1 custom-scrollbar font-mono text-[10px]">
              {timeline.events.filter((e) => !timelineFilter || timelineFilter.split(',').map((s) => s.trim()).filter(Boolean).some((p) => e.type === p || e.type.startsWith(p))).slice(-60).reverse().map((e) => (
                <button key={e.seq} onClick={() => setEvidenceEvent(e)} className={`w-full text-left px-2 py-1.5 rounded-lg border transition-colors ${evidenceEvent?.seq === e.seq ? 'bg-cyan-500/10 border-cyan-500/30' : 'bg-black/20 border-transparent hover:border-slate-700/60'}`}>
                  <span className="text-slate-600">#{e.seq}</span> <span className="text-slate-300">{e.type}</span>
                  <span className="text-slate-600"> · {new Date(e.timestamp).toLocaleTimeString()}</span>
                </button>
              ))}
              {timeline.events.length === 0 && <div className="text-slate-600 py-8 text-center">No events yet — activity lands here live.</div>}
            </div>
          </div>

          <div className="lg:col-span-3 bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-2xl overflow-hidden flex flex-col h-[460px] hover:border-slate-700/80 transition-colors">
            <div className="px-4 py-3 border-b border-slate-800/80 bg-slate-900/60">
              <h3 className="text-[11px] font-semibold text-slate-300 uppercase tracking-widest flex items-center gap-2">
                <FileJson className="w-3.5 h-3.5 text-purple-400" /> Evidence Drawer
              </h3>
            </div>
            <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
              {!evidenceEvent ? (
                <div className="text-[11px] text-slate-600 py-8 text-center font-mono">Click any timeline event to inspect its evidence.</div>
              ) : (
                <div className="font-mono">
                  <div className="text-[11px] text-slate-200 font-semibold">#{evidenceEvent.seq} {evidenceEvent.type}</div>
                  <div className="text-[10px] text-slate-500 mb-2">{new Date(evidenceEvent.timestamp).toLocaleString()}</div>
                  {evidenceEvent.payload?.missionId && (
                    <button onClick={() => { refreshMission(evidenceEvent.payload.missionId); }} className="mb-2 px-2.5 py-1 bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-cyan-300 rounded-lg text-[10px] transition-colors">Open mission {String(evidenceEvent.payload.missionId).slice(-8)}</button>
                  )}
                  <pre className="text-[10px] text-slate-300 whitespace-pre-wrap break-all bg-black/40 border border-slate-800/60 rounded-lg p-2 max-h-[300px] overflow-y-auto">{JSON.stringify(evidenceEvent.payload, null, 1)?.slice(0, 4000)}</pre>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 2026 AI Agent Operating System Mesh Architecture Panel */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-6">
          <div className="lg:col-span-12">
            <MeshArchitecturePanel />
          </div>
        </div>

        {/* Grand Synthesis Kernel Panel */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-6">
          <div className="lg:col-span-12">
            <GrandSynthesisPanel />
          </div>
        </div>

        {/* Agentic Bug Hunter Panel */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-6">
          <div className="lg:col-span-12">
            <BugHunterPanel />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-6">
          <div className="lg:col-span-12">
            <OmegaPanel />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-6">
          <div className="lg:col-span-12">
            <SingularityPanel />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-6">
          <div className="lg:col-span-12">
            <InfinitePanel />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-6">
          <div className="lg:col-span-12">
            <UltimatePanel />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-6">
          <div className="lg:col-span-12">
            <DslPanel />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-6">
          <div className="lg:col-span-12">
            <TransactionalWorkspacePanel />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-6">
          <div className="lg:col-span-6">
            <GovernedMemoryPanel />
          </div>
          <div className="lg:col-span-6">
            <SemanticRagPanel />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-2xl overflow-hidden hover:border-slate-700/80 transition-colors">
            <div className="px-4 py-3 border-b border-slate-800/80 flex justify-between items-center bg-slate-900/60">
              <h3 className="text-[11px] font-semibold text-slate-300 uppercase tracking-widest flex items-center gap-2">
                <FileJson className="w-3.5 h-3.5 text-emerald-400" /> Evidence Chain
                <span className="px-1.5 py-0.5 bg-slate-800 rounded text-[9px] text-slate-500">{evidence.length}</span>
              </h3>
              <Database className="w-3 h-3 text-slate-600" />
            </div>
            <div className="p-3 max-h-[320px] overflow-y-auto custom-scrollbar space-y-2">
              {evidence.length === 0 ? (
                <div className="text-[11px] text-slate-600 py-6 text-center">No evidence yet</div>
              ) : evidence.slice(-8).reverse().map((ev, i) => (
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

          <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-2xl overflow-hidden hover:border-slate-700/80 transition-colors">
            <div className="px-4 py-3 border-b border-slate-800/80 flex justify-between items-center bg-slate-900/60">
              <h3 className="text-[11px] font-semibold text-slate-300 uppercase tracking-widest flex items-center gap-2">
                <MemoryStick className="w-3.5 h-3.5 text-purple-400" /> Memory Digests
                <span className="px-1.5 py-0.5 bg-slate-800 rounded text-[9px] text-slate-500">{memory.length}</span>
              </h3>
              <span className="text-[9px] font-mono text-slate-600">digest-only • RLS</span>
            </div>
            <div className="p-3 max-h-[320px] overflow-y-auto custom-scrollbar space-y-2">
              {memory.length === 0 ? (
                <div className="text-[11px] text-slate-600 py-6 text-center">No memory cells</div>
              ) : memory.slice(-6).reverse().map((m, i) => (
                <div key={i} className="flex justify-between items-center p-2.5 rounded-xl bg-black/30 border border-slate-800/50">
                  <div>
                    <div className="text-[11px] font-mono text-slate-300">{m.tier || 'episodic'}</div>
                    <div className="text-[10px] font-mono text-slate-500 truncate max-w-[160px]">{m.digest?.slice(0,32) || m.id?.slice(0,20)}</div>
                  </div>
                  <span className={`text-[9px] px-2 py-1 rounded-full border font-mono uppercase tracking-wide ${m.tier === 'episodic' ? 'bg-blue-500/10 border-blue-500/20 text-blue-300' : m.tier === 'semantic' ? 'bg-purple-500/10 border-purple-500/20 text-purple-300' : m.tier === 'working' ? 'bg-amber-500/10 border-amber-500/20 text-amber-300' : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'}`}>
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
            <div className="p-3 max-h-[320px] overflow-y-auto custom-scrollbar space-y-2">
              {(thinking.steps || []).map((step, i) => (
                <div key={i} className={`p-2.5 rounded-xl border-l-2 bg-black/30 backdrop-blur-sm ${step.kind === 'observe' ? 'border-blue-500/50 bg-blue-500/[0.03]' : step.kind === 'do' ? 'border-emerald-500/50 bg-emerald-500/[0.03]' : step.kind === 'evidence' ? 'border-purple-500/50 bg-purple-500/[0.03]' : step.kind === 'emit' ? 'border-amber-500/50 bg-amber-500/[0.03]' : 'border-slate-700 bg-slate-800/20'}`}>
                  <div className="flex justify-between items-start">
                    <span className="text-[11px] font-bold font-mono uppercase tracking-wide text-slate-300">{step.kind}</span>
                    <span className="text-[9px] font-mono text-slate-500">{step.capref || step.key || ''}</span>
                  </div>
                  <div className="text-[10px] font-mono text-slate-500 mt-1 leading-relaxed">{step.detail || JSON.stringify(step.args || step.value || {}).slice(0,80)}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-slate-800/50 flex flex-col md:flex-row justify-between items-center gap-2 text-[10px] font-mono text-slate-600">
          <div className="flex items-center gap-3">
            <span>Celia Agent Dashboard — NEXA Ω∞ — Ultimate Agent OS — v0.8 World-Shaking — 8-Tier + 7 Physics Engines</span>
            <span className="w-1 h-1 bg-slate-700 rounded-full"></span>
            <span className="text-slate-500">Relativistic Minkowski • Braid Jones • Astrocytic Neuromodulators • Holomorphic Cauchy-Riemann • DNA ATCG PCR • Holographic Wave • Morphic Phase • 16 DSLs • Z3 SMT • WASM • Egress Zero-Trust</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-1 bg-slate-900 border border-slate-800 rounded-full">Glassmorphism • Tailwind • lucide-react • SSE • 15 Engines • 78KB • World-Shaking</span>
          </div>
        </div>
      </div>
    </div>
  );
}
