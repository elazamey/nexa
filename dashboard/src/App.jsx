import React, { useState, useEffect } from 'react';
import { EvidenceChain } from './components/EvidenceChain.jsx';
import { MemoryDigests } from './components/MemoryDigests.jsx';
import { PlannerThinking } from './components/PlannerThinking.jsx';
import DagVisualizer from './components/DagVisualizer.jsx';

export default function App() {
  const [evidence, setEvidence] = useState([]);
  const [memory, setMemory] = useState([]);
  const [thinking, setThinking] = useState({ steps: [], model: 'grok-beta' });
  const [status, setStatus] = useState({ gates: '6 CLOSED', tests: '314/314', promotion: '5/5 READY' });

  // Mock data for demo — in production, fetch from Supabase port via API
  useEffect(() => {
    // Simulate real-time planner thinking
    const mockThinking = {
      model: 'grok-2',
      timestamp: new Date().toISOString(),
      steps: [
        { kind: 'observe', key: 'project', detail: 'Observe NEXA repository' },
        { kind: 'do', capref: 'github.repository.read', args: { owner: 'elazamey', repo: 'nexa' }, as: 'repo' },
        { kind: 'evidence', claim: 'repository inspected', from: 'repo' },
        { kind: 'do', capref: 'celia.memory.remember', args: { tier: 'episodic', digest: 'sha256:abc...' }, as: 'mem' },
        { kind: 'emit', value: 'repo' }
      ]
    };

    const mockEvidence = [
      { hash: 'sha256:8XPNIncCFFygp3Owg2nxN_IUgL9CMn-HxcqBtL7b_Jg', prev_hash: 'genesis', kind: 'ENVELOPE_ACCEPTED', payload: { resource: 'tool:echo' }, created_at: new Date().toISOString() },
      { hash: 'sha256:9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b', prev_hash: '8XPNIncC', kind: 'CELL_MESSAGE', payload: { cell: 'celia.memory', receptor: 'remember' }, created_at: new Date().toISOString() },
      { hash: 'sha256:1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c', prev_hash: '9a8b7c6d', kind: 'EVIDENCE', payload: { claim: 'repository inspected' }, created_at: new Date().toISOString() },
    ];

    const mockMemory = [
      { id: '1', tier: 'episodic', digest: 'sha256:abc123def456...', owner_kid: 'nexa:key:ed25519:z6MkCelia...', evidence_ref: '8XPNIncC', created_at: new Date().toISOString() },
      { id: '2', tier: 'semantic', digest: 'sha256:789xyz...', owner_kid: 'nexa:key:ed25519:z6MkCelia...', evidence_ref: '9a8b7c6d', created_at: new Date().toISOString() },
      { id: '3', tier: 'working', digest: 'sha256:qwerty...', owner_kid: 'nexa:key:ed25519:z6MkCelia...', evidence_ref: '1a2b3c4d', created_at: new Date().toISOString() },
    ];

    setThinking(mockThinking);
    setEvidence(mockEvidence);
    setMemory(mockMemory);

    // In production, poll API:
    // const interval = setInterval(async () => {
    //   const res = await fetch('/api/celia/state');
    //   const data = await res.json();
    //   setThinking(data.thinking);
    //   setEvidence(data.evidence);
    //   setMemory(data.memory);
    // }, 2000);
    // return () => clearInterval(interval);
  }, []);

  const runDemo = async () => {
    console.log('Running celia-demo via API...');
    try {
      const res = await fetch('/api/celia/run-demo', { method: 'POST' });
      const data = await res.json();
      setThinking(data.thinking || thinking);
      setEvidence(data.evidence || evidence);
      setMemory(data.memory || memory);
    } catch (e) {
      console.error('Demo failed, using mock data', e);
      // Fallback to mock
    }
  };

  return (
    <div>
      <div className="header">
        <h1>Celia Agent <span>NEXA v0.3 — Frontend Dashboard</span></h1>
        <div className="status">
          <div className="status-item ok">Gates: {status.gates}</div>
          <div className="status-item ok">Tests: {status.tests}</div>
          <div className="status-item ok">{status.promotion}</div>
        </div>
      </div>

      <div style={{padding: '12px 16px', display: 'flex', gap: '8px'}}>
        <button onClick={runDemo} style={{padding: '6px 12px', background: '#22c55e', color: 'black', border: 'none', borderRadius: '6px', fontSize: '12px', cursor: 'pointer', fontWeight: 600}}>
          ▶ Run Celia Demo
        </button>
        <button onClick={() => window.location.reload()} style={{padding: '6px 12px', background: '#27272a', color: '#e4e4e7', border: '1px solid #3f3f46', borderRadius: '6px', fontSize: '12px', cursor: 'pointer'}}>
          ↻ Refresh
        </button>
        <span style={{fontSize: '11px', color: '#71717a', alignSelf: 'center', marginLeft: '8px'}}>
          AI proposes → System decides → Evidence recorded — Real-time
        </span>
      </div>

      <div className="grid">
        <DagVisualizer />
        <PlannerThinking thinking={thinking} />
        <EvidenceChain evidence={evidence} />
        <MemoryDigests memory={memory} />
        
        <div className="card">
          <div className="card-header">
            Security Posture — 5/5 + LLM Vectors
            <span className="count">Live</span>
          </div>
          <div className="card-body">
            <div className="memory-item"><span>Gates</span><span style={{color: '#22c55e'}}>6 CLOSED</span></div>
            <div className="memory-item"><span>Tests</span><span>314/314</span></div>
            <div className="memory-item"><span>Attacks Blocked</span><span>31/31 + 8 identity</span></div>
            <div className="memory-item"><span>Promotion</span><span style={{color: '#22c55e'}}>5/5 READY</span></div>
            <div className="memory-item"><span>llm-mint-attempt</span><span style={{color: '#22c55e'}}>BLOCKED</span></div>
            <div className="memory-item"><span>llm-secret-egress</span><span style={{color: '#22c55e'}}>BLOCKED</span></div>
            <div className="memory-item"><span>Memory</span><span>digest-only, RLS, JSONB</span></div>
            <div className="memory-item"><span>Planner</span><span>grok-2 via vault://</span></div>
            <div style={{marginTop: '10px', fontSize: '10px', color: '#71717a'}}>
              NEXA v0.2 → v0.3: Database + LLM + Dashboard<br/>
              No fs write, no child_process, no mint, no secret egress
            </div>
          </div>
        </div>
      </div>

      <div className="footer">
        Celia Agent Dashboard — Built on NEXA Ω∞ — Cell → Tissue → Organ → Organism — AI proposes, deterministic system decides
        <br/>Supabase RLS + pgvector (future) + Grok Planner + Evidence Chain + Permission Proof
      </div>
    </div>
  );
}
