import React, { useEffect, useState } from 'react';

export default function DagVisualizer() {
  const [nodes, setNodes] = useState({});
  const [connectionStatus, setConnectionStatus] = useState('Connecting...');
  const [dagStats, setDagStats] = useState({ passed: 0, failed: 0, total: 0 });

  useEffect(() => {
    // التعامل مع الـ Edge cases مثل انقطاع الاتصال - relative URL for E2B preview
    const eventSource = new EventSource('/api/v1/dag-stream');

    eventSource.onopen = () => {
      setConnectionStatus('Live');
      console.log('[DagVisualizer] SSE connected');
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'CONNECTED') {
          setConnectionStatus('Live');
          console.log('[DagVisualizer] CONNECTED:', data.message);
        } else if (data.type === 'HEARTBEAT') {
          // Keep alive, no UI change
        } else if (data.type === 'NODE_STATE_CHANGE') {
          setNodes(prev => ({
            ...prev,
            [data.payload.nodeId]: data.payload
          }));
        } else if (data.type === 'DAG_START') {
          setNodes({});
          setDagStats({ passed: 0, failed: 0, total: data.payload.nodes || 0 });
          console.log('[DagVisualizer] DAG_START', data.payload);
        } else if (data.type === 'DAG_COMPLETE') {
          setDagStats(prev => ({ ...prev, passed: data.payload.passed, failed: data.payload.failed }));
          console.log('[DagVisualizer] DAG_COMPLETE', data.payload);
        } else if (data.type === 'SPECULATIVE_START') {
          console.log('[DagVisualizer] SPECULATIVE_START', data.payload.nodeId);
          setNodes(prev => ({
            ...prev,
            [data.payload.nodeId]: { ...prev[data.payload.nodeId], speculative: true, state: 'RUNNING', evidenceRef: data.payload.evidenceRef }
          }));
        } else if (data.type === 'NODE_COMPLETE') {
          // Already handled by NODE_STATE_CHANGE, but update stats
          if (data.payload.state === 'SUCCESS') {
            setDagStats(prev => ({ ...prev, passed: prev.passed + 1 }));
          }
        }
      } catch (e) {
        console.error('[DagVisualizer] Failed to parse SSE data', e, event.data);
      }
    };

    eventSource.onerror = (err) => {
      console.error('[DagVisualizer] SSE error', err);
      setConnectionStatus('Disconnected - Retrying...');
      // EventSource will auto-retry
      setTimeout(() => {
        if (eventSource.readyState === EventSource.CLOSED) {
          setConnectionStatus('Reconnecting...');
        }
      }, 1000);
    };

    return () => {
      console.log('[DagVisualizer] Closing SSE');
      eventSource.close();
    };
  }, []);

  const runDag = async () => {
    try {
      setConnectionStatus('Starting DAG...');
      setNodes({});
      const res = await fetch('/api/v1/dag-run', { method: 'POST' });
      const data = await res.json();
      console.log('[DagVisualizer] DAG run triggered', data);
      setConnectionStatus('Live - DAG Running');
    } catch (e) {
      console.error('[DagVisualizer] Failed to trigger DAG', e);
      setConnectionStatus('Failed to start DAG');
    }
  };

  const getStateColor = (state) => {
    switch(state) {
      case 'SUCCESS': return 'bg-green-900 text-green-300 border-green-700';
      case 'RUNNING': return 'bg-blue-900 text-blue-300 border-blue-700 animate-pulse';
      case 'FAILED': return 'bg-red-900 text-red-300 border-red-700';
      case 'PENDING': return 'bg-yellow-900 text-yellow-300 border-yellow-700';
      default: return 'bg-gray-700 text-gray-300 border-gray-600';
    }
  };

  return (
    <div className="card">
      <div className="card-header">
        <div style={{display: 'flex', alignItems: 'center', gap: '8px'}}>
          <span>NEXA DAG Executor — Real-time SSE</span>
          <span style={{fontSize: '10px', background: '#0a0a0b', padding: '2px 6px', borderRadius: '4px'}}>
            {dagStats.passed}/{dagStats.total} passed
          </span>
        </div>
        <div style={{display: 'flex', gap: '8px', alignItems: 'center'}}>
          <span className={`count ${connectionStatus === 'Live' ? 'ok' : ''}`} style={{
            background: connectionStatus === 'Live' ? '#14532d' : '#422006',
            color: connectionStatus === 'Live' ? '#4ade80' : '#fbbf24',
            border: `1px solid ${connectionStatus === 'Live' ? '#22c55e' : '#eab308'}`
          }}>
            {connectionStatus}
          </span>
          <button onClick={runDag} style={{
            padding: '4px 10px',
            background: '#22c55e',
            color: 'black',
            border: 'none',
            borderRadius: '6px',
            fontSize: '11px',
            cursor: 'pointer',
            fontWeight: 600
          }}>
            ▶ Run DAG
          </button>
        </div>
      </div>
      
      <div className="card-body">
        {Object.keys(nodes).length === 0 ? (
          <div className="log">
            No DAG nodes yet — click "Run DAG" to start parallel execution with speculative layer.
            <br/><br/>
            DAG Structure:
            <br/>discover
            <br/>├── inspect-repo (parallel)
            <br/>├── inspect-docs (parallel)
            <br/>└── inspect-runtime (parallel)
            <br/>     └── analyze (critical)
            <br/>          └── verify (speculative)
            <br/><br/>
            SSE: /api/v1/dag-stream — lightweight, uni-directional, no external libs
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4" style={{display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px'}}>
            {Object.entries(nodes).map(([id, node]) => (
              <div key={id} className="p-3 bg-slate-800 rounded border" style={{
                padding: '12px',
                background: '#1a1a1e',
                borderRadius: '8px',
                border: '1px solid #2a2a30'
              }}>
                <div style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                  <span style={{fontWeight: 'bold', fontSize: '12px'}}>{id}</span>
                  <span className={`px-2 py-1 rounded text-xs ${getStateColor(node.state)}`} style={{
                    padding: '2px 8px',
                    borderRadius: '12px',
                    fontSize: '10px',
                    border: '1px solid',
                    ...(node.state === 'SUCCESS' ? {background: '#14532d', color: '#4ade80', borderColor: '#22c55e'} :
                        node.state === 'RUNNING' ? {background: '#1e3a5f', color: '#60a5fa', borderColor: '#3b82f6'} :
                        node.state === 'FAILED' ? {background: '#450a0a', color: '#f87171', borderColor: '#ef4444'} :
                        {background: '#422006', color: '#fbbf24', borderColor: '#eab308'})
                  }}>
                    {node.state}
                    {node.speculative && ' ⚡'}
                  </span>
                </div>
                {node.evidenceRef && (
                  <div style={{marginTop: '8px', fontSize: '10px', color: '#a1a1aa', wordBreak: 'break-all'}}>
                    Evidence: {node.evidenceRef.slice(0,24)}...
                  </div>
                )}
                {node.timestamp && (
                  <div style={{marginTop: '4px', fontSize: '9px', color: '#71717a'}}>
                    {new Date(node.timestamp).toLocaleTimeString()} {node.speculative ? '(speculative)' : ''}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <div style={{marginTop: '12px', padding: '8px', background: '#0a0a0b', borderRadius: '6px', fontSize: '10px', color: '#71717a'}}>
          <div>🔌 SSE: Server-Sent Events — lightweight, uni-directional, no external libs</div>
          <div>⚡ Speculative: start B while A runs (PASTE 48.5% latency reduction)</div>
          <div>🔀 Parallel: max 3 nodes per level, topological sort</div>
          <div>🛡️ Edge cases: auto-reconnect on disconnect, heartbeat every 15s</div>
        </div>
      </div>
    </div>
  );
}
