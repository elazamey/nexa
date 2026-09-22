import React, { useEffect, useState } from 'react';

/**
 * Raw display of the evidence checker's output. This panel does not check
 * anything.
 *
 * The rule it obeys: the tool checks, the viewer displays. It fetches the JSON
 * written by `node tools/verify-evidence.mjs` and renders the rows as they
 * arrive. It never walks docs/evidence/, never hashes a file, never combines
 * packages into a score, and never shows a tick. A display layer that issued a
 * verdict it had no means to reach is exactly the defect recorded in
 * docs/incidents/2026-09-fake-proof-endpoint.md.
 *
 * Statuses are shown with the tool's own words — `match`, `mismatch`,
 * `missing`, `unlisted` — because those are facts. "Evidence is good" is a
 * judgement, and it is not this panel's to make.
 */

const STATUS_STYLE = {
  match: { color: '#6ee7a8', label: 'SHA match' },
  mismatch: { color: '#ff6b6b', label: 'SHA mismatch' },
  missing: { color: '#ffb86b', label: 'missing' },
  unlisted: { color: '#9aa4b2', label: 'unlisted (no digest)' },
  'malformed-record': { color: '#ffb86b', label: 'malformed record' },
};

function age(iso) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '—';
  const days = Math.floor(ms / 86400000);
  if (days > 0) return `${days}d`;
  const hours = Math.floor(ms / 3600000);
  return hours > 0 ? `${hours}h` : `${Math.max(0, Math.floor(ms / 60000))}m`;
}

export default function EvidenceCheckPanel() {
  const [state, setState] = useState({ phase: 'loading' });

  useEffect(() => {
    let live = true;
    fetch('/evidence-check.json')
      .then(async res => {
        if (res.status === 404) return { phase: 'not-run' };
        if (!res.ok) return { phase: 'error', error: `HTTP ${res.status}` };
        return { phase: 'ready', report: await res.json() };
      })
      // A swallowed error would make a dead endpoint look like clean evidence.
      .catch(error => ({ phase: 'error', error: `network error: ${error.message}` }))
      .then(next => { if (live) setState(next); });
    return () => { live = false; };
  }, []);

  const header = (
    <div style={{ fontSize: 13, color: '#9aa4b2', marginBottom: 12, fontFamily: 'monospace' }}>
      Evidence verification — run <code style={{ color: '#e6e6e6' }}>npm run verify-evidence</code> to regenerate.
    </div>
  );

  if (state.phase === 'loading') {
    return <section style={wrap}>{header}<div style={muted}>loading…</div></section>;
  }
  if (state.phase === 'not-run') {
    // Not an empty table: "never run" and "nothing wrong" must not look alike.
    return <section style={wrap}>{header}<div style={muted}>Verification has not been run yet. No report exists to display.</div></section>;
  }
  if (state.phase === 'error') {
    return <section style={wrap}>{header}<div style={{ ...muted, color: '#ff6b6b' }}>Could not load report: {state.error}</div></section>;
  }

  const { report } = state;
  const rows = report.packages.flatMap(pkg =>
    pkg.sums !== 'present'
      ? [{ pkg: pkg.package, name: '—', status: 'no-sha256sums', note: pkg.note, provenance: pkg.provenance }]
      : pkg.files.map(file => ({ pkg: pkg.package, name: file.name, status: file.status, provenance: pkg.provenance, manifest: pkg.manifest })),
  );

  return (
    <section style={wrap}>
      {header}
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'monospace', fontSize: 12 }}>
        <thead>
          <tr style={{ color: '#9aa4b2', textAlign: 'left' }}>
            <th style={th}>path</th><th style={th}>status</th><th style={th}>commit</th><th style={th}>age</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const style = STATUS_STYLE[row.status] ?? { color: '#9aa4b2', label: row.status };
            const provenance = row.provenance?.recorded
              ? `${row.provenance.commit} (${row.provenance.state})`
              : 'no commit recorded';
            return (
              <tr
                key={`${row.pkg}/${row.name}/${index}`}
                onClick={() => window.open(`/evidence-raw/${row.pkg}/SHA256SUMS`, '_blank')}
                style={{ borderTop: '1px solid #222', cursor: 'pointer' }}
                title="open the raw SHA256SUMS for this package"
              >
                <td style={td}>{row.pkg}/{row.name}</td>
                <td style={{ ...td, color: style.color }}>{style.label}{row.note ? ` — ${row.note}` : ''}</td>
                <td style={{ ...td, color: '#9aa4b2' }}>{provenance}</td>
                <td style={{ ...td, color: '#9aa4b2' }}>{age(row.manifest?.generated)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ ...muted, marginTop: 12 }}>
        {report.summary.match} match · {report.summary.mismatch} mismatch · {report.summary.missing} missing ·{' '}
        {report.summary.unlisted} unlisted · {report.summary.packagesWithoutSums} package(s) without SHA256SUMS
        <div style={{ marginTop: 6 }}>Checked {age(report.checkedAt)} ago. {report.limits}</div>
      </div>
    </section>
  );
}

const wrap = { background: '#0d0d0f', border: '1px solid #222', borderRadius: 8, padding: 16, color: '#e6e6e6' };
const th = { padding: '6px 8px', fontWeight: 400 };
const td = { padding: '6px 8px' };
const muted = { color: '#9aa4b2', fontSize: 12, fontFamily: 'monospace' };
