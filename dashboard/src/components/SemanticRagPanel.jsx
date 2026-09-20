import React, { useState, useEffect } from 'react';
import { Brain, Search, Database, Sparkles, FileText, Zap, Clock } from 'lucide-react';

export default function SemanticRagPanel() {
  const [facts, setFacts] = useState([]);
  const [query, setQuery] = useState('How to handle execution evidence and DAG concurrency?');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [stats, setStats] = useState({ count: 0, dim: 384 });

  const fetchMemory = async () => {
    try {
      const res = await fetch('/api/v1/semantic/memory');
      const data = await res.json();
      setFacts(data.facts || []);
      setStats(s => ({ ...s, count: data.count || 0 }));
    } catch (e) {
      console.error('Failed to fetch semantic memory', e);
    }
  };

  useEffect(() => {
    fetchMemory();
    // poll every 5s for new facts
    const interval = setInterval(fetchMemory, 5000);
    return () => clearInterval(interval);
  }, []);

  const handleRecall = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const res = await fetch('/api/v1/semantic/recall', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, limit: 12, threshold: 0.2 })
      });
      const data = await res.json();
      setResults(data.facts || []);
    } catch (e) {
      console.error('Recall failed', e);
    } finally {
      setLoading(false);
    }
  };

  const handleRagDemo = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/semantic/rag-demo', { method: 'POST' });
      const data = await res.json();
      setResults(data.facts || []);
      setQuery(data.query || query);
    } catch (e) {
      console.error('RAG demo failed', e);
    } finally {
      setLoading(false);
    }
  };

  const handleStore = async (content) => {
    if (!content) return;
    try {
      await fetch('/api/v1/semantic/store', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, tier: 'working', metadata: { source: 'dashboard' } })
      });
      fetchMemory();
    } catch (e) {
      console.error('Store failed', e);
    }
  };

  return (
    <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-2xl overflow-hidden flex flex-col h-[460px] hover:border-slate-700/80 transition-colors">
      <div className="px-4 py-3 border-b border-slate-800/80 flex justify-between items-center bg-slate-900/60">
        <h3 className="text-[11px] font-semibold text-slate-300 uppercase tracking-widest flex items-center gap-2">
          <Brain className="w-3.5 h-3.5 text-purple-400" /> Semantic Memory & RAG
          <span className="px-2 py-0.5 bg-purple-500/10 border border-purple-500/20 rounded-full text-[9px] text-purple-300 font-mono">{stats.count} facts • 384d</span>
          <span className="px-1.5 py-0.5 bg-cyan-500/10 border border-cyan-500/20 rounded-full text-[9px] text-cyan-300">Top-12</span>
        </h3>
        <div className="flex items-center gap-2">
          <span className="text-[9px] font-mono text-slate-600">pgvector • cosine</span>
          <div className="w-2 h-2 rounded-full bg-purple-500 animate-pulse"></div>
        </div>
      </div>

      <div className="p-3 border-b border-slate-800/50 bg-black/20">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-2.5 top-2 w-3.5 h-3.5 text-slate-500" />
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleRecall()}
              placeholder="Task → Embedding → Top-12 Facts → Planner"
              className="w-full pl-8 pr-3 py-1.5 bg-slate-800/50 border border-slate-700/50 rounded-lg text-[11px] font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-purple-500/50 focus:bg-slate-800/80 transition-colors"
            />
          </div>
          <button
            onClick={handleRecall}
            disabled={loading}
            className="px-3 py-1.5 bg-purple-500 hover:bg-purple-400 disabled:bg-slate-700 text-white disabled:text-slate-400 rounded-lg text-[11px] font-bold flex items-center gap-1.5 transition-colors"
          >
            {loading ? <Clock className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
            Recall
          </button>
          <button
            onClick={handleRagDemo}
            disabled={loading}
            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 rounded-lg text-[11px] font-mono flex items-center gap-1.5 transition-colors"
          >
            <Sparkles className="w-3 h-3" /> Demo
          </button>
        </div>
        <div className="mt-2 flex gap-2 text-[9px] font-mono text-slate-500">
          <span className="flex items-center gap-1"><Zap className="w-3 h-3" /> Flow: Task → Embedding → Retrieve → Planner → Execute</span>
          <span className="w-1 h-1 bg-slate-700 rounded-full self-center"></span>
          <span>384d • free • deterministic</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3 bg-black/10">
        {results.length > 0 ? (
          <div>
            <div className="text-[10px] font-mono text-slate-400 mb-2 flex items-center gap-2">
              <FileText className="w-3 h-3" /> RAG Results for "{query.slice(0,40)}..." — {results.length} facts
            </div>
            <div className="space-y-2">
              {results.map((fact, i) => (
                <div key={i} className="p-2.5 rounded-xl bg-slate-800/30 border border-slate-700/30 hover:border-slate-600/50 transition-colors group">
                  <div className="flex justify-between items-start gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] font-bold text-slate-500">#{i+1}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-mono
                        ${fact.tier === 'semantic' ? 'bg-purple-500/10 border-purple-500/20 text-purple-300' :
                          fact.tier === 'working' ? 'bg-blue-500/10 border-blue-500/20 text-blue-300' :
                          fact.tier === 'episodic' ? 'bg-amber-500/10 border-amber-500/20 text-amber-300' :
                          'bg-emerald-500/10 border-emerald-500/20 text-emerald-300'}`}>
                        {fact.tier}
                      </span>
                      <span className="text-[9px] font-mono text-cyan-400">{fact.similarity?.toFixed ? fact.similarity.toFixed(3) : fact.similarity}</span>
                    </div>
                    <span className="text-[9px] font-mono text-slate-600 truncate max-w-[80px]">{fact.digest?.slice(0,16)}</span>
                  </div>
                  <div className="mt-1.5 text-[11px] text-slate-300 leading-relaxed">{fact.content}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 p-2 rounded-lg bg-purple-500/5 border border-purple-500/10">
              <div className="text-[10px] font-mono text-purple-300 font-bold">📋 Planner Context (passed to Grok):</div>
              <div className="mt-1 text-[10px] font-mono text-slate-500 whitespace-pre-wrap leading-relaxed">
                {results.slice(0,5).map(f => `- [${f.tier}] ${f.content}`).join('\n')}
              </div>
            </div>
          </div>
        ) : (
          <div>
            <div className="text-[10px] font-mono text-slate-500 mb-2 flex items-center gap-2">
              <Database className="w-3 h-3" /> Semantic Memory — {facts.length} facts stored
            </div>
            {facts.length === 0 ? (
              <div className="text-[11px] text-slate-600 py-8 text-center">
                <Brain className="w-6 h-6 mx-auto mb-2 opacity-30" />
                <div>No semantic facts yet</div>
                <div className="text-[10px] mt-1">Run RAG demo or store facts via API</div>
              </div>
            ) : (
              <div className="space-y-2">
                {facts.slice(-8).reverse().map((fact, i) => (
                  <div key={i} className="p-2.5 rounded-xl bg-black/30 border border-slate-800/50 hover:border-slate-700/50 transition-colors">
                    <div className="flex justify-between items-start gap-2">
                      <span className="text-[11px] text-slate-300 leading-relaxed flex-1">{fact.content.slice(0,90)}...</span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-mono ml-2
                        ${fact.tier === 'semantic' ? 'bg-purple-500/10 border-purple-500/20 text-purple-300' : 'bg-slate-700/50 border-slate-600/30 text-slate-400'}`}>
                        {fact.tier}
                      </span>
                    </div>
                    <div className="mt-1 flex justify-between text-[9px] font-mono text-slate-600">
                      <span>{fact.digest?.slice(0,20)}</span>
                      <span>{fact.metadata?.type || 'fact'}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="px-3 py-2 border-t border-slate-800/60 bg-slate-900/40 flex justify-between items-center text-[10px] font-mono text-slate-500">
        <span>v0.5 RAG • 384d • pgvector • cosine • Top-12</span>
        <span className="flex items-center gap-1"><span className="w-1 h-1 bg-purple-500 rounded-full animate-pulse"></span>Semantic • digest-only • evidence-bound</span>
      </div>
    </div>
  );
}
