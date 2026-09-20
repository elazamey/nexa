import React from 'react';

export function EvidenceChain({ evidence }) {
  return (
    <div className="card">
      <div className="card-header">
        Evidence Chain — Hash-Chained Ledger
        <span className="count">{evidence.length} records</span>
      </div>
      <div className="card-body">
        {evidence.length === 0 ? (
          <div className="log">No evidence yet — run celia-demo to generate</div>
        ) : (
          evidence.map((e, i) => (
            <div key={i} className="evidence-item">
              <div className="hash">{e.hash?.slice(0,32)}...{e.hash?.slice(-8)}</div>
              <div className="meta">
                <span className="kind">{e.kind}</span>
                <span>prev: {e.prev_hash?.slice(0,8) || 'genesis'}</span>
                <span>{new Date(e.created_at || Date.now()).toLocaleTimeString()}</span>
              </div>
              {e.payload && (
                <div className="log" style={{marginTop: '6px'}}>
                  {JSON.stringify(e.payload).slice(0,120)}...
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
