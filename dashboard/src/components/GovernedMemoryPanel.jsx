import React, { useState, useEffect } from 'react';
import { Brain, Shield, Zap, AlertTriangle, BookOpen, RefreshCw, Trash2, Activity, Clock, Layers, FileJson } from 'lucide-react';

const stateColors = {
  PROPOSED: 'bg-slate-700 text-slate-300 border-slate-600',
  OBSERVED: 'bg-blue-900/30 text-blue-300 border-blue-700/50',
  VALIDATED: 'bg-cyan-900/30 text-cyan-300 border-cyan-700/50',
  ACTIVE: 'bg-emerald-900/30 text-emerald-300 border-emerald-700/50',
  WEAKENED: 'bg-amber-900/30 text-amber-300 border-amber-700/50',
  SUPERSEDED: 'bg-purple-900/30 text-purple-300 border-purple-700/50',
  RETIRED: 'bg-red-900/20 text-red-400 border-red-800/30 opacity-60'
};

const typeIcons = {
  procedural: BookOpen,
  failure: AlertTriangle,
  belief: Brain,
  episodic: Clock,
  semantic: Layers,
  working: Zap
};

const typeColors = {
  procedural: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
  failure: 'text-red-400 bg-red-500/10 border-red-500/20',
  belief: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  episodic: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  semantic: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
  working: 'text-amber-400 bg-amber-500/10 border-amber-500/20'
};

export default function GovernedMemoryPanel() {
  const [memories, setMemories] = useState([]);
  const [stats, setStats] = useState({ total: 0, states: {}, types: {}, avgUtility: 0 });
  const [ledger, setLedger] = useState([]);
  const [query, setQuery] = useState('read file with evidence');
  const [recallResult, setRecallResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState({ type: '', state: '' });

  const fetchMemories = async () => {
    try {
      const params = new URLSearchParams();
      if (filter.type) params.set('type', filter.type);
      if (filter.state) params.set('state', filter.state);
      params.set('limit', '50');
      const res = await fetch(`/api/v1/governed/memory?${params}`);
      const data = await res.json();
      setMemories(data.memories || []);
    } catch (e) {
      console.error('Failed to fetch governed memories', e);
    }
  };

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/v1/governed/stats');
      const data = await res.json();
      setStats(data.stats || {});
    } catch (e) {
      console.error('Failed to fetch stats', e);
    }
  };

  const fetchLedger = async () => {
    try {
      const res = await fetch('/api/v1/governed/ledger?limit=10');
      const data = await res.json();
      setLedger(data.entries || []);
    } catch (e) {
      console.error('Failed to fetch ledger', e);
    }
  };

  useEffect(() => {
    fetchMemories();
    fetchStats();
    fetchLedger();
    const interval = setInterval(() => {
      fetchMemories();
      fetchStats();
    }, 5000);
    return () => clearInterval(interval);
  }, [filter]);

  const handleRecall = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const res = await fetch('/api/v1/governed/recall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskIntent: query, currentSystemState: { tool: 'fs.read', gate: 'REAL_EXECUTION' }, options: { limit: 12 } })
      });
      const data = await res.json();
      setRecallResult(data);
    } catch (e) {
      console.error('Recall failed', e);
    } finally {
      setLoading(false);
    }
  };

  const handleSweep = async (kind = 'forgetting') => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/governed/sweep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, threshold: kind === 'weakening' ? 0.4 : 0.1, options: { keepFailures: true } })
      });
      const data = await res.json();
      console.log('Sweep result', data);
      fetchMemories();
      fetchStats();
      fetchLedger();
    } catch (e) {
      console.error('Sweep failed', e);
    } finally {
      setLoading(false);
    }
  };

  const totalMemories = stats.total || memories.length;
  const retrievable = stats.retrievable || memories.filter(m => ['ACTIVE', 'VALIDATED', 'WEAKENED'].includes(m.state)).length;

  return (
    <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-2xl overflow-hidden flex flex-col h-[620px] hover:border-slate-700/80 transition-colors">
      <div className="px-4 py-3 border-b border-slate-800/80 flex justify-between items-center bg-slate-900/60">
        <h3 className="text-[11px] font-semibold text-slate-300 uppercase tracking-widest flex items-center gap-2">
          <Brain className="w-3.5 h-3.5 text-cyan-400" /> Governed Memory State Machine
          <span className="px-2 py-0.5 bg-cyan-500/10 border border-cyan-500/20 rounded-full text-[9px] text-cyan-300 font-mono">{totalMemories} nodes</span>
          <span className="px-1.5 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded-full text-[9px] text-emerald-300">{retrievable} active</span>
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono text-slate-600">PROPOSED→ACTIVE→RETIRED</span>
          <div className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse"></div>
        </div>
      </div>

      {/* Telemetry */}
      <div className="grid grid-cols-4 gap-2 p-3 border-b border-slate-800/50 bg-black/20">
        <div className="p-2 rounded-lg bg-slate-800/30 border border-slate-700/30">
          <div className="text-[9px] text-slate-500 uppercase">States</div>
          <div className="text-[11px] font-mono text-slate-300 mt-1">
            {Object.entries(stats.states || {}).map(([k,v]) => `${k.slice(0,3)}:${v}`).join(' ')}
          </div>
        </div>
        <div className="p-2 rounded-lg bg-slate-800/30 border border-slate-700/30">
          <div className="text-[9px] text-slate-500 uppercase">Types</div>
          <div className="text-[11px] font-mono text-slate-300 mt-1">
            {Object.entries(stats.types || {}).map(([k,v]) => `${k.slice(0,4)}:${v}`).join(' ')}
          </div>
        </div>
        <div className="p-2 rounded-lg bg-slate-800/30 border border-slate-700/30">
          <div className="text-[9px] text-slate-500 uppercase">Avg Utility</div>
          <div className="text-[11px] font-mono text-cyan-300 mt-1">{(stats.avgUtility || 0).toFixed(3)}</div>
        </div>
        <div className="p-2 rounded-lg bg-slate-800/30 border border-slate-700/30">
          <div className="text-[9px] text-slate-500 uppercase">Ledger</div>
          <div className="text-[11px] font-mono text-emerald-300 mt-1">{stats.ledger?.total || 0} entries ✓</div>
        </div>
      </div>

      {/* Recall */}
      <div className="p-3 border-b border-slate-800/50 bg-black/10">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Activity className="absolute left-2.5 top-2 w-3.5 h-3.5 text-slate-500" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleRecall()}
              placeholder="Task intent → state-aware recall (preventions + strategies)"
              className="w-full pl-8 pr-3 py-1.5 bg-slate-800/50 border border-slate-700/50 rounded-lg text-[11px] font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50 focus:bg-slate-800/80 transition-colors"
            />
          </div>
          <button
            onClick={handleRecall}
            disabled={loading}
            className="px-3 py-1.5 bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-700 text-black disabled:text-slate-400 rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition-colors"
          >
            {loading ? <Clock className="w-3 h-3 animate-spin" /> : <Shield className="w-3 h-3" />}
            Recall
          </button>
          <button
            onClick={() => handleSweep('forgetting')}
            className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-400 rounded-lg text-[10px] font-mono flex items-center gap-1 transition-colors"
          >
            <Trash2 className="w-3 h-3" /> Sweep
          </button>
          <button
            onClick={() => handleSweep('weakening')}
            className="px-2.5 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 text-amber-300 rounded-lg text-[10px] font-mono flex items-center gap-1 transition-colors"
          >
            <Zap className="w-3 h-3" /> Weaken
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3 bg-black/5">
        {recallResult ? (
          <div className="space-y-3">
            <div className="flex justify-between items-center">
              <div className="text-[10px] font-mono text-slate-400">
                Recall for "{recallResult.taskIntent?.slice(0,40)}..." — {recallResult.total} total
              </div>
              <button onClick={() => setRecallResult(null)} className="text-[10px] text-slate-500 hover:text-slate-300">Clear</button>
            </div>

            {recallResult.preventions?.length > 0 && (
              <div>
                <div className="text-[10px] font-bold text-red-300 uppercase flex items-center gap-1 mb-2">
                  <AlertTriangle className="w-3 h-3" /> Preventions ({recallResult.preventions.length}) — Failure Memory
                </div>
                <div className="space-y-2">
                  {recallResult.preventions.map((p, i) => (
                    <div key={i} className="p-2.5 rounded-xl bg-red-500/5 border border-red-500/20">
                      <div className="flex justify-between">
                        <span className="text-[11px] font-bold text-red-300">{p.failurePattern}</span>
                        <span className="text-[9px] px-1.5 py-0.5 bg-red-500/20 rounded-full text-red-300">confidence {p.confidence}</span>
                      </div>
                      <div className="text-[10px] text-slate-400 mt-1">Cause: {p.cause}</div>
                      <div className="text-[10px] text-emerald-300 mt-1">Fix: {p.preventiveFix}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {recallResult.strategies?.length > 0 && (
              <div>
                <div className="text-[10px] font-bold text-cyan-300 uppercase flex items-center gap-1 mb-2">
                  <BookOpen className="w-3 h-3" /> Strategies ({recallResult.strategies.length}) — Procedural Memory
                </div>
                <div className="space-y-2">
                  {recallResult.strategies.map((s, i) => (
                    <div key={i} className="p-2.5 rounded-xl bg-cyan-500/5 border border-cyan-500/20">
                      <div className="flex justify-between">
                        <span className="text-[11px] font-bold text-cyan-300">{s.taskIntent}</span>
                        <span className="text-[9px] font-mono text-slate-500">utility {s.utility?.toFixed(2)} • success {s.successCount}</span>
                      </div>
                      <div className="text-[10px] font-mono text-slate-500 mt-1">{JSON.stringify(s.strategyDAG || {}).slice(0,100)}...</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {recallResult.preventions?.length === 0 && recallResult.strategies?.length === 0 && (
              <div className="text-[11px] text-slate-600 py-4 text-center">No relevant knowledge — planner will use default</div>
            )}
          </div>
        ) : (
          <div>
            <div className="flex justify-between items-center mb-2">
              <div className="text-[10px] font-mono text-slate-500">Memory Nodes — State Machine (utility sorted)</div>
              <div className="flex gap-1">
                <select value={filter.type} onChange={e => setFilter(f => ({ ...f, type: e.target.value }))} className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-[10px] text-slate-400">
                  <option value="">All types</option>
                  <option value="procedural">procedural</option>
                  <option value="failure">failure</option>
                  <option value="belief">belief</option>
                </select>
                <select value={filter.state} onChange={e => setFilter(f => ({ ...f, state: e.target.value }))} className="px-2 py-1 bg-slate-800 border border-slate-700 rounded text-[10px] text-slate-400">
                  <option value="">All states</option>
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="VALIDATED">VALIDATED</option>
                  <option value="WEAKENED">WEAKENED</option>
                  <option value="RETIRED">RETIRED</option>
                  <option value="SUPERSEDED">SUPERSEDED</option>
                </select>
              </div>
            </div>

            <div className="space-y-2">
              {memories.slice(0, 20).map((m, i) => {
                const Icon = typeIcons[m.type] || Brain;
                return (
                  <div key={i} className="p-2.5 rounded-xl bg-slate-800/20 border border-slate-700/30 hover:border-slate-600/50 transition-colors group">
                    <div className="flex justify-between items-start gap-2">
                      <div className="flex items-center gap-2">
                        <div className={`p-1 rounded-lg border ${typeColors[m.type] || 'bg-slate-700 text-slate-400'}`}>
                          <Icon className="w-3 h-3" />
                        </div>
                        <div>
                          <div className="text-[11px] font-mono text-slate-200 truncate max-w-[200px]">
                            {m.content?.taskIntent || m.content?.failurePattern || m.content?.belief || m.id}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-mono ${stateColors[m.state] || 'bg-slate-700 text-slate-400'}`}>{m.state}</span>
                            <span className="text-[9px] font-mono text-slate-500">u:{(m.utility || 0).toFixed(2)} c:{(m.confidence || 0).toFixed(2)} v:{m.version}</span>
                          </div>
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="text-[9px] font-mono text-slate-600">{m.id.slice(0,12)}</div>
                        <div className="text-[9px] font-mono text-slate-500 mt-1">s:{m.successCount} f:{m.failureCount}</div>
                      </div>
                    </div>
                    {m.content?.preventiveFix && (
                      <div className="mt-2 text-[10px] text-emerald-400/80 bg-emerald-500/5 border border-emerald-500/10 rounded-lg p-1.5">
                        Fix: {m.content.preventiveFix.slice(0,80)}...
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {memories.length === 0 && (
              <div className="text-[11px] text-slate-600 py-8 text-center">
                <Brain className="w-6 h-6 mx-auto mb-2 opacity-30" />
                <div>No governed memories yet</div>
              </div>
            )}

            <div className="mt-4 pt-3 border-t border-slate-800/50">
              <div className="text-[10px] font-mono text-slate-500 mb-2 flex items-center gap-2">
                <FileJson className="w-3 h-3" /> Ledger — Audit Trail (hash-chained)
              </div>
              <div className="space-y-1">
                {ledger.slice(-5).reverse().map((e, i) => (
                  <div key={i} className="flex justify-between text-[9px] font-mono p-1.5 rounded bg-black/20 border border-slate-800/30">
                    <span className="text-slate-400">#{e.index} {e.action}</span>
                    <span className="text-slate-500 truncate max-w-[120px]">{e.memoryId.slice(0,16)}</span>
                    <span className="text-slate-600">{e.actor.slice(0,12)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t border-slate-800/60 bg-slate-900/40 flex justify-between items-center text-[10px] font-mono text-slate-500">
        <span>State Machine • Procedural • Failure • Belief • Forgetting • Ledger</span>
        <span className="flex items-center gap-1"><span className="w-1 h-1 bg-cyan-500 rounded-full animate-pulse"></span>Governed • evidence-bound • auditable</span>
      </div>
    </div>
  );
}
