import React from 'react';

export function PlannerThinking({ thinking }) {
  const { steps, refuse, model, timestamp } = thinking || { steps: [], model: 'grok-beta' };

  return (
    <div className="card">
      <div className="card-header">
        Planner Thinking — AI Proposes, System Decides
        <span className="count">{model} {timestamp ? new Date(timestamp).toLocaleTimeString() : ''}</span>
      </div>
      <div className="card-body">
        {refuse ? (
          <div className="planner-step refuse">
            <div className="action">❌ Refused</div>
            <div className="detail">{refuse.reason}</div>
            <div className="log" style={{marginTop: '6px', color: '#f87171'}}>
              Refusal is evidence — recorded in ledger
            </div>
          </div>
        ) : steps?.length === 0 ? (
          <div className="log">Waiting for planner — Grok will propose steps here in real-time</div>
        ) : (
          steps.map((step, i) => (
            <div key={i} className={`planner-step ${step.kind || step.action || 'do'}`}>
              <div className="action">
                {i+1}. {step.kind || step.action} {step.target ? `→ ${step.target}` : ''} {step.capref ? `(${step.capref})` : ''}
              </div>
              <div className="detail">
                {step.args ? JSON.stringify(step.args).slice(0,100) : ''}
                {step.claim ? `claim: "${step.claim}"` : ''}
                {step.as ? `as ${step.as}` : ''}
              </div>
              {step.sanitized && (
                <div className="log" style={{color: '#fbbf24', marginTop: '4px'}}>
                  ⚠️ Sanitized: {step.sanitized}
                </div>
              )}
            </div>
          ))
        )}
        
        <div style={{marginTop: '12px', padding: '8px', background: '#0a0a0b', borderRadius: '6px', fontSize: '10px', color: '#71717a'}}>
          <div>🔒 Security: mintCapability filtered, secret egress blocked, vault:// only</div>
          <div>📝 Evidence: every step → CELL_MESSAGE + payload_digest</div>
          <div>🚫 Gates: REAL_EXECUTION CLOSED, no fs write, no child_process</div>
        </div>
      </div>
    </div>
  );
}
