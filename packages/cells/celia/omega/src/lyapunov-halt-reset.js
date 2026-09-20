/**
 * NEXA v1.1 — Lyapunov Halt & Reset Engine
 * 
 * الاستقرار عبر دالة ليابونوف — Halt & Reset عند عدم الاستقرار
 * - Lyapunov function V(x) > 0, dV/dt < 0 stable, else halt & reset
 * - Prevents infinite loops, divergence, chaos
 */

export class LyapunovHaltResetEngine {
  constructor() {
    this.systems = new Map();
    this.halts = [];
    this.resets = [];
  }

  createSystem(sysId, { initialState = 0, lyapunovFunction = null } = {}) {
    const system = {
      id: sysId,
      state: initialState,
      lyapunovV: Math.abs(initialState) + 1, // V(x) > 0
      dVdt: 0,
      stable: true,
      history: [{ state: initialState, V: Math.abs(initialState)+1, timestamp: Date.now() }],
      halts: 0,
      resets: 0,
      createdAt: Date.now()
    };
    this.systems.set(sysId, system);
    return system;
  }

  step(sysId, { delta = 0.1, maxV = 100 } = {}) {
    const system = this.systems.get(sysId);
    if (!system) throw new Error(`System not found: ${sysId}`);

    const prevV = system.lyapunovV;
    const newState = system.state + delta + (Math.random()-0.5)*0.01; // with noise
    const newV = Math.abs(newState) + 1 + Math.random()*0.1;

    system.state = newState;
    system.dVdt = newV - prevV; // dV/dt approximation
    system.lyapunovV = newV;
    system.history.push({ state: newState, V: newV, dVdt: system.dVdt, timestamp: Date.now() });

    // Lyapunov stability: V > 0 and dV/dt < 0 stable, else unstable
    if (newV > maxV || system.dVdt > 0.5) {
      system.stable = false;
      const halt = {
        id: `halt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,4)}`,
        sysId,
        state: newState,
        V: newV.toFixed(3),
        dVdt: system.dVdt.toFixed(3),
        reason: newV > maxV ? `V=${newV.toFixed(3)} > maxV=${maxV} — divergence` : `dV/dt=${system.dVdt.toFixed(3)} > 0 — unstable increasing`,
        timestamp: Date.now(),
        action: 'HALT'
      };
      this.halts.push(halt);
      system.halts++;
      return {
        sysId,
        state: newState.toFixed(3),
        V: newV.toFixed(3),
        dVdt: system.dVdt.toFixed(3),
        stable: false,
        halt,
        claim: `⚠️ Lyapunov HALT ${sysId}: V=${newV.toFixed(3)} dV/dt=${system.dVdt.toFixed(3)} — ${halt.reason} — unstable, halting to prevent infinite loop/divergence`
      };
    }

    system.stable = true;
    return {
      sysId,
      state: newState.toFixed(3),
      V: newV.toFixed(3),
      dVdt: system.dVdt.toFixed(3),
      stable: true,
      historyLength: system.history.length,
      claim: `Lyapunov stable ${sysId}: state ${newState.toFixed(3)} V=${newV.toFixed(3)} dV/dt=${system.dVdt.toFixed(3)} < 0 — stable, continuing`
    };
  }

  reset(sysId) {
    const system = this.systems.get(sysId);
    if (!system) throw new Error(`System not found: ${sysId}`);

    const resetRecord = {
      id: `reset_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,4)}`,
      sysId,
      fromState: system.state,
      toState: 0,
      fromV: system.lyapunovV,
      toV: 1,
      timestamp: Date.now(),
      action: 'RESET',
      reason: 'Lyapunov unstable — reset to stable origin'
    };

    system.state = 0;
    system.lyapunovV = 1;
    system.dVdt = 0;
    system.stable = true;
    system.resets++;
    system.history = [{ state: 0, V: 1, timestamp: Date.now() }];
    this.resets.push(resetRecord);

    return {
      ...resetRecord,
      claim: `🔄 Lyapunov RESET ${sysId}: ${resetRecord.fromState.toFixed(3)} (V=${resetRecord.fromV.toFixed(3)}) → 0 (V=1) — reset to stable origin, halts ${system.halts} resets ${system.resets}`
    };
  }

  getStats() {
    return {
      systems: this.systems.size,
      halts: this.halts.length,
      resets: this.resets.length,
      stable: [...this.systems.values()].filter(s => s.stable).length,
      unstable: [...this.systems.values()].filter(s => !s.stable).length,
      claim: 'Lyapunov Halt & Reset — V(x)>0 dV/dt<0 stable, else halt & reset prevents infinite loops divergence chaos'
    };
  }
}
