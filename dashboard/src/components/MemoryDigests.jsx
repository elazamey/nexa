import React from 'react';

export function MemoryDigests({ memory }) {
  return (
    <div className="card">
      <div className="card-header">
        Memory Digests — Digest-Only, Evidence-Bound
        <span className="count">{memory.length} digests</span>
      </div>
      <div className="card-body" style={{padding: 0}}>
        {memory.length === 0 ? (
          <div className="log" style={{padding: '12px'}}>No memory yet — Supabase RLS + JSONB</div>
        ) : (
          memory.map((m, i) => (
            <div key={i} className="memory-item">
              <div>
                <span className={`tier ${m.tier}`}>{m.tier}</span>
                <span style={{marginLeft: '8px', fontFamily: 'monospace'}}>{m.digest?.slice(0,16)}...</span>
              </div>
              <div style={{textAlign: 'right'}}>
                <div style={{fontSize: '10px', color: '#a1a1aa'}}>{m.owner_kid?.slice(0,16)}...</div>
                <div style={{fontSize: '9px', color: '#71717a'}}>{m.evidence_ref?.slice(0,8)}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
