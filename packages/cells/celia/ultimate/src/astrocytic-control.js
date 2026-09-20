/**
 * NEXA v0.8 — Neuromorphic Astrocytic Plasticity Control
 * 
 * محاكاة الخلايا النجمية Astrocytes التي تحكم ملايين النيورونات.
 * - طبقة نجمية غير عصبية تتحكم في البيئة الكيميائية والكهربائية
 * - تفرز ناقلات عصبية رقمية Digital Neuromodulators
 * - تغير temperature، نسبة الشك، ميزانية التفكير لحظياً لجميع الوكلاء
 * - التحكم الذاتي في المزاج المعرفي والتركيز
 */

export class AstrocyticControlEngine {
  constructor({ numAgents = 100 } = {}) {
    this.astrocytes = new Map(); // astrocyteId → { agents, neuromodulators, mood }
    this.globalState = {
      entropy: 0.2,
      temperature: 0.7,
      doubt: 0.1,
      focus: 0.8,
      thinkingBudget: 1000,
      mood: 'focused'
    };
    this.modulatorHistory = [];
  }

  /**
   * Create astrocytic layer over swarm of agents
   */
  createAstrocyticLayer(layerId, agentIds) {
    const astrocyte = {
      id: layerId,
      agents: agentIds,
      neuromodulators: {
        dopamine: 0.5, // motivation/reward
        serotonin: 0.5, // mood/stability
        norepinephrine: 0.5, // focus/arousal
        acetylcholine: 0.5, // attention/learning
        glutamate: 0.5, // excitation
        gaba: 0.5 // inhibition
      },
      mood: 'balanced',
      entropy: 0.2,
      createdAt: Date.now()
    };

    this.astrocytes.set(layerId, astrocyte);
    return astrocyte;
  }

  /**
   * Sense environment entropy and adjust astrocytic response
   */
  senseEntropy(newEntropy) {
    this.globalState.entropy = newEntropy;

    // High entropy → increase caution, reduce temperature, increase doubt
    if (newEntropy > 0.6) {
      this.globalState.mood = 'cautious';
      this.globalState.temperature = Math.max(0.2, this.globalState.temperature - 0.2);
      this.globalState.doubt = Math.min(0.8, this.globalState.doubt + 0.3);
      this.globalState.focus = Math.min(1.0, this.globalState.focus + 0.2);
      this.globalState.thinkingBudget = Math.min(5000, this.globalState.thinkingBudget + 500);
    } else if (newEntropy < 0.2) {
      this.globalState.mood = 'confident';
      this.globalState.temperature = Math.min(1.0, this.globalState.temperature + 0.1);
      this.globalState.doubt = Math.max(0.05, this.globalState.doubt - 0.1);
      this.globalState.focus = Math.max(0.5, this.globalState.focus - 0.1);
    } else {
      this.globalState.mood = 'focused';
    }

    // Release neuromodulators accordingly
    const modulators = this._releaseModulators(newEntropy);

    this.modulatorHistory.push({
      entropy: newEntropy,
      modulators,
      globalState: { ...this.globalState },
      timestamp: Date.now()
    });

    // Apply to all astrocytic layers
    for (const [id, astro] of this.astrocytes.entries()) {
      astro.neuromodulators = { ...modulators };
      astro.mood = this.globalState.mood;
      astro.entropy = newEntropy;
    }

    return {
      entropy: newEntropy,
      mood: this.globalState.mood,
      modulators,
      globalState: { ...this.globalState },
      affectedAgents: [...this.astrocytes.values()].reduce((sum, a) => sum + a.agents.length, 0),
      claim: `Astrocytic control: entropy ${newEntropy.toFixed(2)} → mood ${this.globalState.mood}, temp ${this.globalState.temperature.toFixed(2)}, doubt ${this.globalState.doubt.toFixed(2)} — auto cognitive mood control`
    };
  }

  /**
   * Get agent-specific neuromodulation (temperature, doubt, budget)
   */
  getAgentModulation(agentId) {
    let astrocyte = null;
    for (const astro of this.astrocytes.values()) {
      if (astro.agents.includes(agentId)) {
        astrocyte = astro;
        break;
      }
    }

    if (!astrocyte) return { agentId, temperature: this.globalState.temperature, doubt: this.globalState.doubt, budget: this.globalState.thinkingBudget, mood: this.globalState.mood };

    // Calculate agent-specific modulation based on astrocytic neuromodulators
    const temp = this.globalState.temperature * (0.8 + astrocyte.neuromodulators.dopamine * 0.4);
    const doubt = this.globalState.doubt * (0.5 + astrocyte.neuromodulators.serotonin * 0.5);
    const budget = this.globalState.thinkingBudget * (0.7 + astrocyte.neuromodulators.norepinephrine * 0.6);
    const focus = this.globalState.focus * (0.6 + astrocyte.neuromodulators.acetylcholine * 0.8);

    return {
      agentId,
      astrocyteId: astrocyte.id,
      temperature: temp.toFixed(3),
      doubt: doubt.toFixed(3),
      thinkingBudget: Math.floor(budget),
      focus: focus.toFixed(3),
      mood: astrocyte.mood,
      neuromodulators: astrocyte.neuromodulators,
      explanation: `Astrocytic layer ${astrocyte.id} modulates ${agentId}: dopamine→motivation, serotonin→stability, norepinephrine→focus`
    };
  }

  _releaseModulators(entropy) {
    // High entropy → high norepinephrine (focus), high serotonin (stability), low dopamine (caution)
    // Low entropy → high dopamine (exploration), low norepinephrine
    return {
      dopamine: entropy > 0.6 ? 0.3 : entropy < 0.2 ? 0.8 : 0.5,
      serotonin: entropy > 0.6 ? 0.8 : 0.5,
      norepinephrine: entropy > 0.6 ? 0.9 : entropy < 0.2 ? 0.3 : 0.5,
      acetylcholine: entropy > 0.5 ? 0.8 : 0.4,
      glutamate: 0.5 + entropy * 0.3,
      gaba: entropy > 0.6 ? 0.7 : 0.4
    };
  }

  getStats() {
    return {
      astrocyticLayers: this.astrocytes.size,
      totalAgents: [...this.astrocytes.values()].reduce((sum, a) => sum + a.agents.length, 0),
      globalMood: this.globalState.mood,
      globalEntropy: this.globalState.entropy.toFixed(3),
      globalTemperature: this.globalState.temperature.toFixed(3),
      modulatorHistory: this.modulatorHistory.length,
      claim: 'Self-regulating cognitive mood — raises caution automatically when entropy rises'
    };
  }
}
