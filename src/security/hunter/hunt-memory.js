import fs from 'node:fs';
import path from 'node:path';

/**
 * HuntMemory - Cross-Session Intelligence & Knowledge Base
 * Persists discovered attack surfaces, tested endpoints, findings, and patterns.
 *
 * D1.6 (A11 / DI-14): لا ابتلاع. القارئ والحاكم يُبلَّغان بحالة، لا بصمت:
 *   - `loadStatus` يفرّق أول تشغيل (`fresh`) عن مخزن غير قابل للقراءة (`NEXA-HM-READ-FAILED`)
 *     وعن JSON فاسد (`NEXA-HM-CORRUPT`) وعن بنية صحيحة الصرف لكنها ليست ذاكرة (`NEXA-HM-MALFORMED`).
 *   - `save()` يرفض الكتابة فوق مخزن لم يُقرأ (`NEXA-HM-REFUSED-OVERWRITE`) — وهو بالضبط مسار
 *     الضياع القديم: ذاكرة فارغة كُتبت فوق ملف فاسد فمحت الجلسات السابقة بلا إشارة.
 *     الاستعادة قرار صريح: `save({ force: true })`.
 *   - الكتابة ذرّية (ملف مؤقت ثم rename)، وفشل النظام يُرجع `NEXA-HM-WRITE-FAILED` مع errno/syscall.
 * الذاكرة ليست بوابة ولا دليل أمان: الفشل هنا يُبلَّغ للمنسِّق ولا يمنع ولا يمنح إيصالات.
 */
export class HuntMemory {
  // D1.9: the suite bootstrap sets NEXA_HUNT_MEMORY (per-process tmp); the
  // production/deploy default stays dashboard/data/hunt-memory.json unchanged.
  constructor(storagePath = process.env.NEXA_HUNT_MEMORY || 'dashboard/data/hunt-memory.json') {
    this.storagePath = path.resolve(storagePath);
    this.loadStatus = { ok: true, phase: 'load', path: this.storagePath };
    this.saveStatus = null;
    this.memory = this._load();
  }

  static _blankMemory() {
    return {
      version: '1.0.0',
      sessions: [],
      knownVulnerabilities: {},
      targetSurfaceCache: {}
    };
  }

  /** علامة فشل واحدة: تُبقي الذاكرة الحية usable، وتمنع الدهس في `save`. */
  _failLoad(code, reason, extra = {}) {
    this.loadStatus = { ok: false, phase: 'load', code, reason, path: this.storagePath, ...extra };
    return HuntMemory._blankMemory();
  }

  _load() {
    if (!fs.existsSync(this.storagePath)) {
      this.loadStatus = { ok: true, phase: 'load', path: this.storagePath, fresh: true };
      return HuntMemory._blankMemory();
    }

    let raw;
    try {
      raw = fs.readFileSync(this.storagePath, 'utf8');
    } catch (err) {
      return this._failLoad('NEXA-HM-READ-FAILED', `cannot read the memory store: ${err.message}`, {
        errno: err.code,
        syscall: err.syscall
      });
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      return this._failLoad('NEXA-HM-CORRUPT', `memory store is not valid JSON (${err.message})`);
    }

    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed) ||
      !Array.isArray(parsed.sessions) ||
      typeof parsed.knownVulnerabilities !== 'object' ||
      parsed.knownVulnerabilities === null ||
      typeof parsed.targetSurfaceCache !== 'object' ||
      parsed.targetSurfaceCache === null
    ) {
      return this._failLoad(
        'NEXA-HM-MALFORMED',
        'memory store parsed but is not a HuntMemory document — expected {version, sessions[], knownVulnerabilities{}, targetSurfaceCache{}}'
      );
    }

    this.loadStatus = {
      ok: true,
      phase: 'load',
      path: this.storagePath,
      bytes: Buffer.byteLength(raw),
      sessions: parsed.sessions.length
    };
    return { ...HuntMemory._blankMemory(), ...parsed };
  }

  /**
   * @param {{force?: boolean}} [options] force = استعادة مُقرَّرَة فوق مخزن لم يُقرأ
   * @returns {{ok: boolean, phase: 'save', code?: string, reason?: string, path: string}}
   */
  save(options = {}) {
    const force = options.force === true;
    if (!this.loadStatus.ok && !force) {
      const status = {
        ok: false,
        phase: 'save',
        code: 'NEXA-HM-REFUSED-OVERWRITE',
        path: this.storagePath,
        reason:
          `refusing to overwrite an unreadable memory store (${this.loadStatus.code}) with in-memory state — ` +
          'recover explicitly with save({ force: true }) once the file has been inspected or restored'
      };
      this.saveStatus = status;
      return status;
    }

    const dir = path.dirname(this.storagePath);
    const tempPath = `${this.storagePath}.${process.pid}.tmp`;
    let body;
    try {
      body = `${JSON.stringify(this.memory, null, 2)}\n`;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(tempPath, body, 'utf8');
      fs.renameSync(tempPath, this.storagePath);
    } catch (err) {
      const status = {
        ok: false,
        phase: 'save',
        code: 'NEXA-HM-WRITE-FAILED',
        path: this.storagePath,
        errno: err.code,
        syscall: err.syscall,
        reason: `cannot persist hunt memory: ${err.message}`
      };
      if (fs.existsSync(tempPath)) {
        try {
          fs.rmSync(tempPath, { force: true });
        } catch (cleanupErr) {
          // لا ابتلاع: الأثر المتروك جزء من الحالة المُبلَّغة
          status.leftoverTemp = tempPath;
          status.cleanupError = cleanupErr.message;
        }
      }
      this.saveStatus = status;
      return status;
    }

    const status = {
      ok: true,
      phase: 'save',
      path: this.storagePath,
      bytes: Buffer.byteLength(body),
      recovered: force === true && this.loadStatus.ok === false
    };
    this.saveStatus = status;
    if (status.recovered) {
      this.loadStatus = { ...this.loadStatus, recovered: true };
    }
    return status;
  }

  recordSession(sessionData) {
    const session = {
      id: `session_${Date.now()}`,
      timestamp: new Date().toISOString(),
      ...sessionData
    };
    this.memory.sessions.push(session);
    const status = this.save();
    return { sessionId: session.id, persisted: status.ok, status };
  }

  rememberTarget(target, surface) {
    this.memory.targetSurfaceCache[target] = {
      cachedAt: new Date().toISOString(),
      surface
    };
    const status = this.save();
    return { target, persisted: status.ok, status };
  }

  getCachedTarget(target) {
    return this.memory.targetSurfaceCache?.[target] ?? null;
  }

  garbageCollect(maxSessions = 50) {
    if (Array.isArray(this.memory.sessions) && this.memory.sessions.length > maxSessions) {
      this.memory.sessions = this.memory.sessions.slice(-maxSessions);
      return this.save();
    }
    return null; // صريح: لا عمل، لا undefined غامض
  }
}
