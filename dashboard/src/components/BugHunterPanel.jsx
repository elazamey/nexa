import React, { useState } from 'react';
import { Shield, Bug, Search, CheckCircle, AlertTriangle, Lock, Cpu, Globe, Key, FileText, ChevronRight, RefreshCw, Zap } from 'lucide-react';

export default function BugHunterPanel() {
  const [target, setTarget] = useState('target.com');
  const [isRunning, setIsRunning] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');

  const [stats, setStats] = useState({
    surfaceScore: 92,
    subdomains: 14,
    endpoints: 28,
    scannedFindings: 8,
    passedSevenGate: 6,
    chainsSynthesized: 2,
    certifiedReceipts: 6
  });

  const [findings, setFindings] = useState([
    {
      id: 'FIND-001',
      title: 'Insecure Direct Object Reference (BOLA) in Billing Invoices',
      severity: 'HIGH',
      cwe: 'CWE-639',
      endpoint: '/api/v1/billing/invoices/:id',
      gateStatus: '7/7 PASSED',
      receiptHash: 'c8a4df591a...38b',
      signature: 'ed25519:verified',
      impact: 'Allows unauthorized cross-tenant extraction of financial invoices.'
    },
    {
      id: 'FIND-002',
      title: 'Exploitable CORS Origin Reflection with Credentials',
      severity: 'HIGH',
      cwe: 'CWE-942',
      endpoint: '/api/v1/user/profile',
      gateStatus: '7/7 PASSED',
      receiptHash: '7f91a2bc0e...99c',
      signature: 'ed25519:verified',
      impact: 'Attacker domains can read private user profiles in victim session.'
    },
    {
      id: 'FIND-003',
      title: 'Server-Side Request Forgery via Callback Webhook',
      severity: 'HIGH',
      cwe: 'CWE-918',
      endpoint: '/api/v1/webhooks/test?url=',
      gateStatus: '7/7 PASSED',
      receiptHash: 'e102f901ab...4d2',
      signature: 'ed25519:verified',
      impact: 'Internal cloud metadata extraction (169.254.169.254) and intranet probing.'
    },
    {
      id: 'FIND-004',
      title: 'Reentrancy in Smart Contract Vault Withdrawal',
      severity: 'CRITICAL',
      cwe: 'Web3-Reentrancy',
      endpoint: 'Vault.sol#withdraw()',
      gateStatus: '7/7 PASSED',
      receiptHash: 'f440ac19bb...12a',
      signature: 'ed25519:verified',
      impact: 'Complete pool balance drainage via malicious fallback contract.'
    }
  ]);

  const [chains, setChains] = useState([
    {
      id: 'CHAIN-01',
      title: '1-Click Mass Account Exfiltration via CORS Reflection & BOLA',
      severity: 'CRITICAL',
      cvss: 9.6,
      steps: [
        'Victim visits attacker-controlled landing page.',
        'Page makes cross-origin requests to /api/v1/user/profile with credentials.',
        'Reflected CORS origin exposes session authorization tokens.',
        'Attacker automates BOLA ID traversal to extract all customer records.'
      ]
    },
    {
      id: 'CHAIN-02',
      title: 'Full Cloud Environment Takeover via Webhook SSRF & Metadata IAM',
      severity: 'CRITICAL',
      cvss: 9.8,
      steps: [
        'Exploit unvalidated callback parameter on /api/v1/webhooks/test.',
        'Target internal metadata endpoint (169.254.169.254).',
        'Extract temporary AWS STS credentials for backend node role.',
        'Assume role with administrative policy to take over backend cluster.'
      ]
    }
  ]);

  const handleRunAutopilot = () => {
    setIsRunning(true);
    setTimeout(() => {
      setIsRunning(false);
    }, 1500);
  };

  return (
    <div className="space-y-6 text-slate-100">
      {/* Header / Command Bar */}
      <div className="bg-slate-900/80 backdrop-blur border border-cyan-500/30 rounded-xl p-5 shadow-2xl">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-cyan-500/10 border border-cyan-500/30 rounded-lg text-cyan-400">
              <Bug className="w-6 h-6 animate-pulse" />
            </div>
            <div>
              <h2 className="text-xl font-bold bg-gradient-to-r from-cyan-400 to-blue-500 bg-clip-text text-transparent">
                NEXA Agentic Bug Hunter
              </h2>
              <p className="text-xs text-slate-400">
                Autonomous Reconnaissance, 7-Question Gate Triage & Cryptographic Receipts
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto">
            <div className="relative flex-1 md:w-64">
              <input
                type="text"
                value={target}
                onChange={(e) => setTarget(e.target.value)}
                placeholder="target.com"
                className="w-full bg-slate-950/80 border border-slate-700 rounded-lg px-3 py-2 text-sm text-cyan-300 focus:outline-none focus:border-cyan-500"
              />
            </div>
            <button
              onClick={handleRunAutopilot}
              disabled={isRunning}
              className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 rounded-lg text-sm font-semibold transition-all shadow-lg shadow-cyan-900/30 disabled:opacity-50"
            >
              {isRunning ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Hunting...
                </>
              ) : (
                <>
                  <Zap className="w-4 h-4" />
                  Run Autopilot
                </>
              )}
            </button>
          </div>
        </div>

        {/* Telemetry Metrics */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mt-6 pt-5 border-t border-slate-800">
          <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80 text-center">
            <div className="text-xs text-slate-400">Surface Score</div>
            <div className="text-lg font-bold text-cyan-400">{stats.surfaceScore}/100</div>
          </div>
          <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80 text-center">
            <div className="text-xs text-slate-400">Subdomains</div>
            <div className="text-lg font-bold text-blue-400">{stats.subdomains}</div>
          </div>
          <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80 text-center">
            <div className="text-xs text-slate-400">Endpoints</div>
            <div className="text-lg font-bold text-indigo-400">{stats.endpoints}</div>
          </div>
          <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80 text-center">
            <div className="text-xs text-slate-400">Raw Findings</div>
            <div className="text-lg font-bold text-amber-400">{stats.scannedFindings}</div>
          </div>
          <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80 text-center">
            <div className="text-xs text-slate-400">7-Gate Passed</div>
            <div className="text-lg font-bold text-emerald-400">{stats.passedSevenGate}</div>
          </div>
          <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80 text-center">
            <div className="text-xs text-slate-400">Chains Synthesized</div>
            <div className="text-lg font-bold text-purple-400">{stats.chainsSynthesized}</div>
          </div>
          <div className="bg-slate-950/60 p-3 rounded-lg border border-slate-800/80 text-center">
            <div className="text-xs text-slate-400">Signed Receipts</div>
            <div className="text-lg font-bold text-emerald-400">100% Ed25519</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-slate-800 pb-2">
        <button
          onClick={() => setActiveTab('overview')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'overview'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Verified Findings ({findings.length})
        </button>
        <button
          onClick={() => setActiveTab('chains')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'chains'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          Exploit Chains ({chains.length})
        </button>
        <button
          onClick={() => setActiveTab('gates')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            activeTab === 'gates'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
              : 'text-slate-400 hover:text-slate-200'
          }`}
        >
          7-Question Gate Engine
        </button>
      </div>

      {/* Content Area */}
      {activeTab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {findings.map((f) => (
            <div
              key={f.id}
              className="bg-slate-900/60 border border-slate-800 hover:border-cyan-500/40 rounded-xl p-5 space-y-3 transition-all"
            >
              <div className="flex items-center justify-between">
                <span className={`px-2.5 py-0.5 rounded text-xs font-bold ${
                  f.severity === 'CRITICAL' ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                }`}>
                  {f.severity}
                </span>
                <span className="text-xs font-mono text-emerald-400 flex items-center gap-1">
                  <CheckCircle className="w-3.5 h-3.5" />
                  {f.gateStatus}
                </span>
              </div>

              <h3 className="font-semibold text-sm text-slate-100">{f.title}</h3>
              <p className="text-xs text-slate-400">{f.impact}</p>

              <div className="pt-2 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400 font-mono">
                <span>Sink: {f.endpoint}</span>
                <span className="text-cyan-400 flex items-center gap-1">
                  <Lock className="w-3 h-3" />
                  {f.receiptHash}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'chains' && (
        <div className="space-y-4">
          {chains.map((chain) => (
            <div
              key={chain.id}
              className="bg-slate-900/60 border border-purple-500/30 rounded-xl p-5 space-y-4"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-0.5 rounded text-xs font-bold bg-red-500/20 text-red-400 border border-red-500/30">
                    CVSS {chain.cvss} CRITICAL
                  </span>
                  <h3 className="font-bold text-slate-100">{chain.title}</h3>
                </div>
                <span className="text-xs text-purple-400 font-mono">{chain.id}</span>
              </div>

              <div className="bg-slate-950/80 rounded-lg p-4 border border-slate-800 space-y-2">
                <div className="text-xs font-semibold text-purple-300">Exploit Execution Chain:</div>
                <ol className="space-y-1.5 text-xs text-slate-300">
                  {chain.steps.map((step, idx) => (
                    <li key={idx} className="flex items-start gap-2">
                      <span className="font-mono text-cyan-400">{idx + 1}.</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'gates' && (
        <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-4">
          <h3 className="text-sm font-bold text-cyan-300">NEXA 7-Question Validation Criteria:</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
            <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-lg flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-slate-200">1. Scope Compliance:</strong>
                <p className="text-slate-400">Target strictly belongs to authorized program assets.</p>
              </div>
            </div>
            <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-lg flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-slate-200">2. Reproducibility:</strong>
                <p className="text-slate-400">Finding is deterministic and reproducible without flaky steps.</p>
              </div>
            </div>
            <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-lg flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-slate-200">3. Tangible Impact:</strong>
                <p className="text-slate-400">Concrete security or business consequence demonstrated.</p>
              </div>
            </div>
            <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-lg flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-slate-200">4. PoC Evidence:</strong>
                <p className="text-slate-400">Cryptographically signed payload and response traces attached.</p>
              </div>
            </div>
            <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-lg flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-slate-200">5. No False Positives:</strong>
                <p className="text-slate-400">Eliminates missing CSP, banner leaks, and theoretical issues.</p>
              </div>
            </div>
            <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-lg flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-slate-200">6. Boundary Crossing:</strong>
                <p className="text-slate-400">Bypasses tenancy, authorization, or process isolation barriers.</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
