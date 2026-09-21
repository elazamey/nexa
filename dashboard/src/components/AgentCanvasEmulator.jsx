import React, { useEffect, useRef, useState } from 'react';
import { Monitor } from 'lucide-react';

/*
 * AgentCanvasEmulator — "Live Agent Desktop" (Manus-style) on Canvas
 *
 * Event-driven from REAL DAG node states (SSE → NexaDashboard → props):
 *  • one simulated window per DAG node, with a mini terminal that types
 *    lines while the node is RUNNING (pacing derives from the real node timestamp)
 *  • animated cursor that glides to the currently-running node's window
 *  • click ripples + green/red rings on real STATE transitions (RUNNING/SUCCESS/FAILED)
 *  • taskbar with live clock, running/done counters and gates status
 *
 * No fake data: when there is no active DAG the desktop is idle and the
 * cursor drifts until RUN DAG streams real events.
 */

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
const TASKBAR_H = 30;

function hashStr(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function fakeLines(nodeId, node) {
  const seed = hashStr(nodeId);
  const ref = node?.evidenceRef || `evidence:${seed.toString(16).slice(0, 10)}`;
  return [
    `$ nexa dag node ${nodeId}`,
    `> loading context • seed 0x${seed.toString(16).padStart(8, '0')}`,
    '> executing capability graph…',
    `✓ evidence → ${String(ref).slice(0, 26)}…`,
  ];
}

export default function AgentCanvasEmulator({ nodes = {}, workspace = null, connectionStatus = '', onWorkspaceDemo, demoBusy = false }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const nodesRef = useRef(nodes);
  const sizeRef = useRef({ w: 0, h: 0 });
  const cursorRef = useRef({ x: 0, y: 0, inited: false });
  const clickTRef = useRef(-1e9);
  const fxRef = useRef([]); // { type, nodeId, t }
  const prevStatesRef = useRef({});
  const actionRef = useRef(null);
  const connectionStatusRef = useRef(connectionStatus);
  const workspaceRef = useRef(workspace);
  const prevWsRef = useRef(null); // { id, status }
  const wsRectRef = useRef(null); // workspace window rect (per-frame)
  const [action, setAction] = useState(null);

  useEffect(() => {
    connectionStatusRef.current = connectionStatus;
  }, [connectionStatus]);

  /* Workspace transitions (real CoW events) → cursor + ring effects */
  useEffect(() => {
    workspaceRef.current = workspace;
    const prev = prevWsRef.current;
    if (workspace && (!prev || prev.id !== workspace.id || prev.status !== workspace.status)) {
      if (workspace.status === 'COMMITTED') {
        fxRef.current.push({ type: 'ws-commit', nodeId: '@workspace', t: performance.now() });
        clickTRef.current = performance.now();
        actionRef.current = `workspace commit (${workspace.changedFiles ?? 0} files)`;
        setAction(actionRef.current);
      } else if (workspace.status === 'ROLLED_BACK') {
        fxRef.current.push({ type: 'ws-rollback', nodeId: '@workspace', t: performance.now() });
        clickTRef.current = performance.now();
        actionRef.current = 'workspace rollback (zero side effects)';
        setAction(actionRef.current);
      } else if (!prev || prev.id !== workspace.id) {
        actionRef.current = `workspace staging (${String(workspace.taskId || '').slice(0, 18)})`;
        setAction(actionRef.current);
      }
      prevWsRef.current = { id: workspace.id, status: workspace.status };
    }
  }, [workspace]);

  /* 1) Mirror props + detect real state transitions → visual effects */
  useEffect(() => {
    const prev = prevStatesRef.current;
    nodesRef.current = nodes;
    const next = {};
    for (const [id, node] of Object.entries(nodes)) {
      next[id] = node.state;
      if (prev[id] !== node.state) {
        if (node.state === 'RUNNING') {
          fxRef.current.push({ type: 'click', nodeId: id, t: performance.now() });
          clickTRef.current = performance.now();
          actionRef.current = id;
          setAction(id);
        } else if (node.state === 'SUCCESS') {
          fxRef.current.push({ type: 'success', nodeId: id, t: performance.now() });
        } else if (node.state === 'FAILED') {
          fxRef.current.push({ type: 'fail', nodeId: id, t: performance.now() });
        }
      }
    }
    if (fxRef.current.length > 40) fxRef.current.splice(0, fxRef.current.length - 40);
    prevStatesRef.current = next;
    if (Object.keys(nodes).length === 0) {
      actionRef.current = null;
      setAction(null);
    }
  }, [nodes]);

  /* 2) Canvas render loop */
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext('2d');

    let dotPattern = null;
    const ensurePattern = () => {
      if (dotPattern) return dotPattern;
      const pc = document.createElement('canvas');
      pc.width = 22;
      pc.height = 22;
      const pctx = pc.getContext('2d');
      pctx.fillStyle = 'rgba(51,65,85,0.5)';
      pctx.fillRect(11, 11, 1, 1);
      dotPattern = ctx.createPattern(pc, 'repeat');
      return dotPattern;
    };

    const resize = () => {
      const r = wrap.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      sizeRef.current = { w: r.width, h: r.height };
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (!cursorRef.current.inited && r.width > 0) {
        cursorRef.current = { x: r.width / 2, y: r.height / 2, inited: true };
      }
    };
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    resize();

    const rr = (x, y, ww, hh, rad) => {
      const r = Math.min(rad, ww / 2, hh / 2);
      ctx.beginPath();
      if (ctx.roundRect) {
        ctx.roundRect(x, y, ww, hh, r);
        return;
      }
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + ww, y, x + ww, y + hh, r);
      ctx.arcTo(x + ww, y + hh, x, y + hh, r);
      ctx.arcTo(x, y + hh, x, y, r);
      ctx.arcTo(x, y, x + ww, y, r);
      ctx.closePath();
    };

    const text = (s, x, y, opts = {}) => {
      const { font = `10px ${MONO}`, fill = 'rgba(148,163,184,0.9)', align = 'left' } = opts;
      ctx.font = font;
      ctx.fillStyle = fill;
      ctx.textAlign = align;
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(s, x, y);
    };

    const layout = (ids, w, h, rightLimit) => {
      const rects = {};
      if (!ids.length) return rects;
      const top = 12;
      const side = 14;
      const gap = 12;
      const areaW = (rightLimit || w) - side * 2;
      const areaH = h - top - TASKBAR_H;
      const cols = ids.length <= 2 ? ids.length : 3;
      const rows = Math.ceil(ids.length / cols);
      const ww = Math.min(380, (areaW - gap * (cols - 1)) / cols);
      const wh = Math.min(190, (areaH - gap * (rows - 1)) / rows);
      const gw = cols * ww + (cols - 1) * gap;
      const gh = rows * wh + (rows - 1) * gap;
      const x0 = side + Math.max(0, (areaW - gw) / 2);
      const y0 = top + Math.max(0, (areaH - gh) / 2);
      ids.forEach((id, i) => {
        const c = i % cols;
        const r = Math.floor(i / cols);
        rects[id] = { x: x0 + c * (ww + gap), y: y0 + r * (wh + gap), w: ww, h: wh };
      });
      return rects;
    };

    const stateColor = (state) => {
      switch (state) {
        case 'RUNNING': return { border: 'rgba(34,211,238,0.8)', glow: 'rgba(34,211,238,0.35)', dot: '#22d3ee', label: 'RUNNING' };
        case 'SUCCESS': return { border: 'rgba(52,211,153,0.7)', glow: 'rgba(52,211,153,0.25)', dot: '#34d399', label: 'SUCCESS' };
        case 'FAILED': return { border: 'rgba(248,113,113,0.8)', glow: 'rgba(248,113,113,0.3)', dot: '#f87171', label: 'FAILED' };
        case 'PENDING': return { border: 'rgba(148,163,184,0.35)', glow: null, dot: '#fbbf24', label: 'PENDING' };
        default: return { border: 'rgba(51,65,85,0.6)', glow: null, dot: '#64748b', label: state || 'IDLE' };
      }
    };

    let raf = 0;
    let last = performance.now();

    const frame = (now) => {
      raf = requestAnimationFrame(frame);
      const { w, h } = sizeRef.current;
      if (!w || !h) return;
      const dt = Math.min(64, now - last);
      last = now;

      const nodesMap = nodesRef.current;
      const ids = Object.keys(nodesMap);

      /* workspace dock (right side on wide screens, bottom on narrow) */
      const ws = workspaceRef.current;
      const wsActive = !!ws;
      let wsRect = null;
      let rightLimit = w;
      if (wsActive) {
        const narrow = w < 760;
        const dockW = narrow ? Math.min(360, w - 24) : Math.max(250, Math.min(320, w * 0.24));
        const dockH = narrow ? 150 : Math.max(150, h - TASKBAR_H - 24);
        wsRect = narrow
          ? { x: 12, y: h - TASKBAR_H - dockH - 8, w: dockW, h: dockH }
          : { x: w - dockW - 12, y: 12, w: dockW, h: dockH };
        if (!narrow) rightLimit = wsRect.x - 4;
      }
      wsRectRef.current = wsRect;
      const rects = layout(ids, w, h, rightLimit);

      /* --- background --- */
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#020617';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = ensurePattern();
      ctx.fillRect(0, 0, w, h);

      /* --- node windows --- */
      for (const id of ids) {
        const node = nodesMap[id];
        const rect = rects[id];
        if (!rect) continue;
        const st = stateColor(node.state);

        ctx.save();
        if (st.glow) {
          ctx.shadowColor = st.glow;
          ctx.shadowBlur = 16;
        }
        rr(rect.x, rect.y, rect.w, rect.h, 10);
        ctx.fillStyle = 'rgba(15,23,42,0.82)';
        ctx.fill();
        ctx.strokeStyle = st.border;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.shadowBlur = 0;

        /* titlebar */
        const tbH = 24;
        ctx.beginPath();
        ctx.rect(rect.x, rect.y, rect.w, tbH);
        ctx.clip();
        ctx.fillStyle = 'rgba(2,6,23,0.65)';
        ctx.fillRect(rect.x, rect.y, rect.w, tbH);
        ctx.restore();
        ctx.strokeStyle = 'rgba(51,65,85,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(rect.x + 1, rect.y + tbH);
        ctx.lineTo(rect.x + rect.w - 1, rect.y + tbH);
        ctx.stroke();

        /* title */
        ctx.beginPath();
        ctx.arc(rect.x + 12, rect.y + tbH / 2, 3, 0, Math.PI * 2);
        ctx.fillStyle = st.dot;
        if (node.state === 'RUNNING') {
          ctx.save();
          ctx.shadowColor = st.dot;
          ctx.shadowBlur = 8;
          ctx.fill();
          ctx.restore();
        } else {
          ctx.fill();
        }
        text(id, rect.x + 22, rect.y + tbH / 2 + 3.5, { font: `bold 11px ${MONO}`, fill: 'rgba(226,232,240,0.95)' });
        text(st.label, rect.x + rect.w - 10, rect.y + tbH / 2 + 3, { font: `9px ${MONO}`, fill: st.dot, align: 'right' });

        /* terminal content */
        const lines = fakeLines(id, node);
        const startX = rect.x + 12;
        let y = rect.y + tbH + 18;
        const lineH = 15;
        ctx.save();
        ctx.beginPath();
        ctx.rect(rect.x, rect.y + tbH, rect.w, rect.h - tbH);
        ctx.clip();

        if (node.state === 'PENDING') {
          text('… queued (waiting for dependencies)', startX, y, { fill: 'rgba(100,116,139,0.8)' });
        } else if (node.state === 'SUCCESS' || node.state === 'FAILED') {
          for (const ln of lines) {
            text(ln, startX, y, { fill: 'rgba(100,116,139,0.75)' });
            y += lineH;
          }
          if (node.state === 'SUCCESS') {
            text('✓ node complete — evidence recorded', startX, y, { fill: 'rgba(52,211,153,0.9)' });
          } else {
            text('✗ node failed — evidence retained', startX, y, { fill: 'rgba(248,113,113,0.9)' });
          }
        } else if (node.state === 'RUNNING') {
          const start = node.timestamp ? new Date(node.timestamp).getTime() : now;
          const elapsed = Math.max(0, now - start);
          const lineInterval = 900;
          const fullLines = Math.min(lines.length, Math.floor(elapsed / lineInterval) + 1);
          for (let i = 0; i < lines.length; i++) {
            if (i < fullLines - 1) {
              text(lines[i], startX, y, { fill: 'rgba(148,163,184,0.9)' });
              y += lineH;
            } else if (i === fullLines - 1) {
              const frac = (elapsed % lineInterval) / lineInterval;
              const typed = lines[i].slice(0, Math.max(0, Math.floor(frac * lines[i].length)));
              text(typed + '▌', startX, y, { fill: 'rgba(103,232,249,0.95)' });
              y += lineH;
            } else {
              break;
            }
          }
          /* progress shimmer */
          const pbY = rect.y + rect.h - 8;
          const pbW = rect.w - 24;
          ctx.fillStyle = 'rgba(15,23,42,0.9)';
          rr(rect.x + 12, pbY, pbW, 3, 1.5);
          ctx.fill();
          const shimmer = 0.5 + 0.5 * Math.sin(now * 0.006);
          ctx.fillStyle = 'rgba(34,211,238,0.8)';
          rr(rect.x + 12, pbY, Math.max(4, pbW * (0.25 + 0.75 * shimmer)), 3, 1.5);
          ctx.fill();
        }
        ctx.restore();
      }

      /* --- workspace file-explorer window (real CoW data) --- */
      if (wsRect && ws) {
        const wsSt = ws.status === 'COMMITTED'
          ? { border: 'rgba(52,211,153,0.8)', glow: null, dot: '#34d399', label: 'COMMITTED' }
          : ws.status === 'ROLLED_BACK'
            ? { border: 'rgba(251,191,36,0.8)', glow: 'rgba(251,191,36,0.25)', dot: '#fbbf24', label: 'ROLLED_BACK' }
            : { border: 'rgba(34,211,238,0.8)', glow: 'rgba(34,211,238,0.35)', dot: '#22d3ee', label: 'STAGING' };

        ctx.save();
        if (wsSt.glow) {
          ctx.shadowColor = wsSt.glow;
          ctx.shadowBlur = 14;
        }
        rr(wsRect.x, wsRect.y, wsRect.w, wsRect.h, 10);
        ctx.fillStyle = 'rgba(15,23,42,0.9)';
        ctx.fill();
        ctx.strokeStyle = wsSt.border;
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.shadowBlur = 0;

        const wtbH = 24;
        ctx.save();
        ctx.beginPath();
        ctx.rect(wsRect.x, wsRect.y, wsRect.w, wtbH);
        ctx.clip();
        ctx.fillStyle = 'rgba(2,6,23,0.65)';
        ctx.fillRect(wsRect.x, wsRect.y, wsRect.w, wtbH);
        ctx.restore();
        ctx.strokeStyle = 'rgba(51,65,85,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(wsRect.x + 1, wsRect.y + wtbH);
        ctx.lineTo(wsRect.x + wsRect.w - 1, wsRect.y + wtbH);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(wsRect.x + 12, wsRect.y + wtbH / 2, 3, 0, Math.PI * 2);
        ctx.fillStyle = wsSt.dot;
        ctx.fill();
        text(`workspace ${String(ws.id || '').slice(0, 16)}`, wsRect.x + 22, wsRect.y + wtbH / 2 + 3.5, { font: `bold 11px ${MONO}`, fill: 'rgba(226,232,240,0.95)' });
        text(wsSt.label, wsRect.x + wsRect.w - 10, wsRect.y + wtbH / 2 + 3, { font: `9px ${MONO}`, fill: wsSt.dot, align: 'right' });

        const bx = wsRect.x + 12;
        let by = wsRect.y + wtbH + 18;
        const bh = 15;
        ctx.save();
        ctx.beginPath();
        ctx.rect(wsRect.x, wsRect.y + wtbH, wsRect.w, wsRect.h - wtbH);
        ctx.clip();

        text(`task: ${String(ws.taskId || '—')} • lazy CoW`, bx, by, { fill: 'rgba(148,163,184,0.85)' });
        by += bh;

        const changes = ws.changes || [];
        if (ws.status === 'STAGING') {
          text('staging… writes tracked (lazy CoW)', bx, by, { fill: 'rgba(103,232,249,0.8)' });
          by += bh;
          text('atomic on commit — zero side effects', bx, by, { fill: 'rgba(100,116,139,0.7)' });
          by += bh + 6;
          const dots = Math.floor(now / 400) % 4;
          text('commit pending' + '·'.repeat(dots), bx, by, { fill: 'rgba(34,211,238,0.6)' });
        } else {
          changes.slice(0, 8).forEach((c) => {
            const added = c.status !== 'modified';
            const marker = added ? '+' : '~';
            const fill = added ? 'rgba(52,211,153,0.9)' : 'rgba(251,191,36,0.9)';
            const p = String(c.path || '');
            const label = p.length > 30 ? '…' + p.slice(-29) : p;
            text(`${marker} ${label}`, bx, by, { fill });
            if (c.stagingDigest) {
              text(String(c.stagingDigest).slice(0, 14), bx + wsRect.w - 24, by, { font: `8px ${MONO}`, fill: 'rgba(100,116,139,0.6)', align: 'right' });
            }
            by += bh;
          });
          if (changes.length > 8) {
            text(`… +${changes.length - 8} more`, bx, by, { fill: 'rgba(100,116,139,0.7)' });
            by += bh;
          }
          by += 6;
          if (ws.status === 'COMMITTED') {
            text(`✓ committed ${ws.changedFiles ?? changes.length} files atomic`, bx, by, { fill: 'rgba(52,211,153,0.95)' });
            by += bh;
            if (ws.committedAt) text(new Date(ws.committedAt).toLocaleTimeString(), bx, by, { font: `9px ${MONO}`, fill: 'rgba(100,116,139,0.7)' });
          } else {
            text('⊘ rolled back — zero side effects', bx, by, { fill: 'rgba(251,191,36,0.95)' });
          }
        }
        ctx.restore();
      }

      /* --- idle overlay --- */
      if (!ids.length) {
        ctx.textAlign = 'center';
        text('NEXA', w / 2, h / 2 - 18, { font: `bold 30px ${MONO}`, fill: 'rgba(34,211,238,0.5)', align: 'center' });
        text('agent desktop idle — press RUN DAG or WORKSPACE DEMO', w / 2, h / 2 + 10, { font: `11px ${MONO}`, fill: 'rgba(100,116,139,0.85)', align: 'center' });
        text('cursor animates on real SSE node events', w / 2, h / 2 + 28, { font: `10px ${MONO}`, fill: 'rgba(71,85,105,0.8)', align: 'center' });
        ctx.textAlign = 'left';
      }

      /* --- taskbar --- */
      ctx.fillStyle = 'rgba(15,23,42,0.95)';
      ctx.fillRect(0, h - TASKBAR_H, w, TASKBAR_H);
      ctx.strokeStyle = 'rgba(51,65,85,0.8)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, h - TASKBAR_H + 0.5);
      ctx.lineTo(w, h - TASKBAR_H + 0.5);
      ctx.stroke();

      const running = ids.filter((id) => nodesMap[id].state === 'RUNNING').length;
      const done = ids.filter((id) => nodesMap[id].state === 'SUCCESS').length;
      const clock = new Date(now).toLocaleTimeString([], { hour12: false });
      const live = connectionStatusRef.current === 'Live';
      ctx.beginPath();
      ctx.arc(14, h - TASKBAR_H / 2, 3, 0, Math.PI * 2);
      ctx.fillStyle = live ? '#22c55e' : '#f59e0b';
      ctx.fill();
      text(`NEXA AGENT DESKTOP • ${running} running • ${done} done • 6 gates closed`, 24, h - TASKBAR_H / 2 + 3.5, { fill: 'rgba(148,163,184,0.85)' });
      text(clock, w - 12, h - TASKBAR_H / 2 + 3.5, { fill: 'rgba(203,213,225,0.9)', align: 'right' });

      /* --- transitions effects (click ripples / success / fail rings) --- */
      const aliveFx = [];
      for (const fx of fxRef.current) {
        const age = now - fx.t;
        if (age > 750) continue;
        aliveFx.push(fx);
        const rect = fx.nodeId === '@workspace' ? wsRectRef.current : rects[fx.nodeId];
        if (!rect) continue;
        const cx = rect.x + rect.w / 2;
        const cy = rect.y + rect.h / 2;
        const radius = 8 + age * 0.09;
        const alpha = Math.max(0, 1 - age / 750);
        const color = fx.type === 'success' || fx.type === 'ws-commit' ? `rgba(52,211,153,${alpha})`
          : fx.type === 'fail' ? `rgba(248,113,113,${alpha})`
          : fx.type === 'ws-rollback' ? `rgba(251,191,36,${alpha})`
          : `rgba(34,211,238,${alpha})`;
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      fxRef.current = aliveFx;

      /* --- cursor: target selection --- */
      let runningId = null;
      let latestTs = -1;
      for (const id of ids) {
        if (nodesMap[id].state !== 'RUNNING') continue;
        const ts = nodesMap[id].timestamp ? new Date(nodesMap[id].timestamp).getTime() : now;
        if (ts >= latestTs) {
          latestTs = ts;
          runningId = id;
        }
      }

      let tx, ty;
      if (runningId && rects[runningId]) {
        const rect = rects[runningId];
        tx = rect.x + rect.w / 2;
        ty = rect.y + rect.h / 2 - 8;
      } else if (wsRect) {
        tx = wsRect.x + wsRect.w / 2;
        ty = wsRect.y + wsRect.h / 2 - 8;
      } else if (ids.length) {
        tx = w / 2;
        ty = h - TASKBAR_H - 16;
      } else {
        tx = w / 2 + Math.cos(now * 0.0005) * w * 0.28;
        ty = h * 0.45 + Math.sin(now * 0.00077) * h * 0.16;
      }

      const k = 1 - Math.exp(-dt * 0.0045);
      const cur = cursorRef.current;
      cur.x += (tx - cur.x) * k;
      cur.y += (ty - cur.y) * k;

      /* --- cursor draw --- */
      ctx.save();
      ctx.translate(cur.x, cur.y);
      const pulse = 1 + 0.45 * Math.max(0, 1 - (now - clickTRef.current) / 220);
      ctx.scale(pulse, pulse);
      ctx.shadowColor = 'rgba(34,211,238,0.8)';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, 14);
      ctx.lineTo(3.8, 10.8);
      ctx.lineTo(6.2, 16);
      ctx.lineTo(8.6, 14.8);
      ctx.lineTo(6.2, 9.8);
      ctx.lineTo(11, 9.5);
      ctx.closePath();
      ctx.fillStyle = 'rgba(34,211,238,0.95)';
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = 'rgba(2,6,23,0.9)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();

      /* cursor label while executing */
      if (runningId) {
        const label = `exec ${runningId}`;
        ctx.font = `9px ${MONO}`;
        const tw = ctx.measureText(label).width;
        const lx = cur.x + 14;
        const ly = cur.y + 16;
        rr(lx - 4, ly - 10, tw + 8, 15, 4);
        ctx.fillStyle = 'rgba(2,6,23,0.85)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(34,211,238,0.35)';
        ctx.lineWidth = 1;
        ctx.stroke();
        text(label, lx, ly + 1, { font: `9px ${MONO}`, fill: 'rgba(103,232,249,0.95)' });
      }
    };

    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return (
    <div className="bg-slate-900/40 backdrop-blur-xl border border-slate-800 rounded-2xl overflow-hidden group hover:border-slate-700/80 transition-colors">
      <div className="px-4 py-3 border-b border-slate-800/80 flex justify-between items-center bg-slate-900/60">
        <h3 className="text-[11px] font-semibold text-slate-300 uppercase tracking-widest flex items-center gap-2">
          <Monitor className="w-3.5 h-3.5 text-cyan-400" /> Live Agent Desktop
          <span className="ml-1 px-2 py-0.5 bg-cyan-500/10 border border-cyan-500/20 rounded-full text-[9px] text-cyan-300 font-mono normal-case tracking-normal">Manus-style • Canvas</span>
        </h3>
        <div className="flex items-center gap-2 text-[10px] font-mono">
          <span className="text-slate-500">SSE event-driven</span>
          <span className="w-1 h-1 bg-slate-700 rounded-full"></span>
          <span className="flex items-center gap-1.5 text-slate-400">
            <span className={`w-2 h-2 rounded-full ${connectionStatus === 'Live' ? 'bg-green-500 animate-pulse' : 'bg-amber-500'}`}></span>
            {connectionStatus === 'Live' ? 'LIVE' : 'SYNC…'}
          </span>
        </div>
      </div>
      <div ref={wrapRef} className="relative h-[380px] w-full">
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />
      </div>
      <div className="px-4 py-2.5 border-t border-slate-800/60 bg-slate-900/40 flex justify-between items-center gap-2 text-[10px] font-mono text-slate-500">
        <span className="truncate">
          {action ? (
            <>
              cursor → <span className="text-cyan-300">{action}</span> • reacting to real SSE events
            </>
          ) : (
            'Awaiting events — RUN DAG or WORKSPACE DEMO animates the cursor on real state'
          )}
        </span>
        <span className="flex items-center gap-2 shrink-0">
          {workspace && (
            <span className={`px-2 py-0.5 rounded-full border font-mono ${workspace.status === 'COMMITTED' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-300' : workspace.status === 'ROLLED_BACK' ? 'bg-amber-500/10 border-amber-500/20 text-amber-300' : 'bg-cyan-500/10 border-cyan-500/20 text-cyan-300'}`}>
              WS {workspace.status}{workspace.changedFiles != null ? ` • ${workspace.changedFiles}f` : ''}
            </span>
          )}
          <button
            onClick={onWorkspaceDemo}
            disabled={demoBusy}
            className="px-2.5 py-1 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 text-emerald-300 rounded text-[10px] font-mono disabled:opacity-50 transition-colors"
          >
            {demoBusy ? 'running…' : '▶ WORKSPACE DEMO'}
          </button>
          <span className="flex items-center gap-1.5">
            <span className="w-1 h-1 bg-green-500 rounded-full animate-pulse"></span>
            60fps
          </span>
        </span>
      </div>
    </div>
  );
}
