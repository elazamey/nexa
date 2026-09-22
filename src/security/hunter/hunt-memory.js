import fs from 'node:fs';
import path from 'node:path';

/**
 * HuntMemory - Cross-Session Intelligence & Knowledge Base
 * Persists discovered attack surfaces, tested endpoints, findings, and patterns.
 */
export class HuntMemory {
  // D1.9: the suite bootstrap sets NEXA_HUNT_MEMORY (per-process tmp); the
  // production/deploy default stays dashboard/data/hunt-memory.json unchanged.
  constructor(storagePath = process.env.NEXA_HUNT_MEMORY || 'dashboard/data/hunt-memory.json') {
    this.storagePath = path.resolve(storagePath);
    this.memory = this._load();
  }

  _load() {
    try {
      if (fs.existsSync(this.storagePath)) {
        const raw = fs.readFileSync(this.storagePath, 'utf8');
        return JSON.parse(raw);
      }
    } catch {
      // Fallback
    }
    return {
      version: '1.0.0',
      sessions: [],
      knownVulnerabilities: {},
      targetSurfaceCache: {}
    };
  }

  save() {
    try {
      const dir = path.dirname(this.storagePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.storagePath, JSON.stringify(this.memory, null, 2), 'utf8');
    } catch (err) {
      console.error('Error saving hunt memory:', err.message);
    }
  }

  recordSession(sessionData) {
    this.memory.sessions.push({
      id: `session_${Date.now()}`,
      timestamp: new Date().toISOString(),
      ...sessionData
    });
    this.save();
  }

  rememberTarget(target, surface) {
    this.memory.targetSurfaceCache[target] = {
      cachedAt: new Date().toISOString(),
      surface
    };
    this.save();
  }

  getCachedTarget(target) {
    return this.memory.targetSurfaceCache[target] || null;
  }

  garbageCollect(maxSessions = 50) {
    if (this.memory.sessions.length > maxSessions) {
      this.memory.sessions = this.memory.sessions.slice(-maxSessions);
      this.save();
    }
  }
}
