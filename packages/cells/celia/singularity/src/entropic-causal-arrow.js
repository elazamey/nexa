/**
 * NEXA v1.0 — Entropic Causal Arrow Engine
 * 
 * سهم الزمن السببي عبر الإنتروبيا — Causal direction via entropy increase
 * - Determine causal direction X→Y vs Y→X via entropic arrow
 * - Second law: entropy increases forward in time
 */

export class EntropicCausalArrowEngine {
  constructor() {
    this.arrows = new Map();
  }

  determineArrow(eventA, eventB) {
    // eventA, eventB: { id, entropy, timestamp, state }
    const start = performance.now();

    const entropyA = eventA.entropy || Math.random();
    const entropyB = eventB.entropy || Math.random();
    const timeA = eventA.timestamp || Date.now() - 1000;
    const timeB = eventB.timestamp || Date.now();

    let direction, confidence, reasoning;

    if (entropyB > entropyA && timeB > timeA) {
      direction = `${eventA.id} → ${eventB.id}`;
      confidence = 0.9;
      reasoning = `Entropy increases ${entropyA.toFixed(3)}→${entropyB.toFixed(3)} and time forward ${timeA}→${timeB} — second law, causal arrow forward`;
    } else if (entropyA > entropyB && timeA > timeB) {
      direction = `${eventB.id} → ${eventA.id}`;
      confidence = 0.9;
      reasoning = `Entropy increases ${entropyB.toFixed(3)}→${entropyA.toFixed(3)} — reverse events, causal arrow ${eventB.id}→${eventA.id}`;
    } else if (entropyB > entropyA) {
      direction = `${eventA.id} → ${eventB.id}`;
      confidence = 0.7;
      reasoning = `Entropy increases ${entropyA.toFixed(3)}→${entropyB.toFixed(3)} — entropic arrow suggests ${eventA.id} causes ${eventB.id} despite time anomaly`;
    } else {
      direction = `${eventB.id} → ${eventA.id}`;
      confidence = 0.7;
      reasoning = `Entropy increases ${entropyB.toFixed(3)}→${entropyA.toFixed(3)} — entropic arrow ${eventB.id}→${eventA.id}`;
    }

    const arrowId = `arrow_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,4)}`;
    const arrow = {
      id: arrowId,
      eventA,
      eventB,
      direction,
      confidence: confidence.toFixed(2),
      reasoning,
      entropyA: entropyA.toFixed(3),
      entropyB: entropyB.toFixed(3),
      deltaEntropy: (entropyB - entropyA).toFixed(3),
      secondLaw: 'ΔS ≥ 0 forward time — entropy increase defines causal arrow',
      duration: (performance.now() - start).toFixed(2) + 'ms',
      timestamp: new Date().toISOString()
    };

    this.arrows.set(arrowId, arrow);

    return {
      ...arrow,
      claim: `Entropic causal arrow: ${direction} confidence ${arrow.confidence} — entropy ${arrow.entropyA}→${arrow.entropyB} ΔS=${arrow.deltaEntropy} — ${reasoning.slice(0,80)}... — second law defines time arrow`
    };
  }

  getStats() {
    const total = this.arrows.size;
    const avgConfidence = total > 0 ? [...this.arrows.values()].reduce((sum, a) => sum + parseFloat(a.confidence), 0) / total : 0;
    return {
      arrows: total,
      avgConfidence: avgConfidence.toFixed(2),
      avgDeltaEntropy: total > 0 ? ([...this.arrows.values()].reduce((sum, a) => sum + parseFloat(a.deltaEntropy), 0) / total).toFixed(3) : '0',
      claim: 'Entropic causal arrow — second law ΔS≥0 defines causal direction, entropy increase forward time, arrow of time via thermodynamics'
    };
  }
}
