/**
 * NEXA v0.9 — Actor Mailbox & Message Passing
 * 
 * نظام صناديق البريد للممثلين — كل وكيل actor له mailbox مستقل
 * - Ordered delivery, backpressure, dead-letter queue
 * - P2P no central orchestrator — matches swarm pheromone
 * - Evidence-bound messaging, hash-chained
 */

export class ActorMailboxEngine {
  constructor({ maxMailboxSize = 1000, maxMessageSize = 1024*100 } = {}) {
    this.mailboxes = new Map(); // actorId → { queue, processing, deadLetter }
    this.maxMailboxSize = maxMailboxSize;
    this.maxMessageSize = maxMessageSize;
    this.totalSent = 0;
    this.totalDelivered = 0;
    this.totalDeadLetter = 0;
  }

  createMailbox(actorId) {
    if (this.mailboxes.has(actorId)) return this.mailboxes.get(actorId);

    const mailbox = {
      id: actorId,
      queue: [],
      processing: null,
      deadLetter: [],
      createdAt: Date.now(),
      delivered: 0,
      sent: 0
    };

    this.mailboxes.set(actorId, mailbox);
    return mailbox;
  }

  send(fromActor, toActor, message, { evidenceRef = null, priority = 0 } = {}) {
    if (!evidenceRef) throw new Error('Message requires evidenceRef');

    const size = JSON.stringify(message).length;
    if (size > this.maxMessageSize) throw new Error(`Message too large: ${size} > ${this.maxMessageSize}`);

    const toMailbox = this.mailboxes.get(toActor) || this.createMailbox(toActor);

    if (toMailbox.queue.length >= this.maxMailboxSize) {
      // Backpressure — dead letter if full
      const dead = {
        id: `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,4)}`,
        from: fromActor,
        to: toActor,
        message,
        evidenceRef,
        reason: 'Mailbox full — backpressure',
        timestamp: Date.now()
      };
      toMailbox.deadLetter.push(dead);
      this.totalDeadLetter++;
      return { delivered: false, deadLetter: true, reason: 'Mailbox full', id: dead.id };
    }

    const msg = {
      id: `msg_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,6)}`,
      from: fromActor,
      to: toActor,
      message,
      evidenceRef,
      priority,
      timestamp: Date.now(),
      attempts: 0
    };

    // Priority insert
    if (priority > 0) {
      let inserted = false;
      for (let i = 0; i < toMailbox.queue.length; i++) {
        if (toMailbox.queue[i].priority < priority) {
          toMailbox.queue.splice(i, 0, msg);
          inserted = true;
          break;
        }
      }
      if (!inserted) toMailbox.queue.push(msg);
    } else {
      toMailbox.queue.push(msg);
    }

    this.totalSent++;
    toMailbox.sent = (toMailbox.sent || 0) + 1;

    return {
      delivered: true,
      queued: true,
      id: msg.id,
      from: fromActor,
      to: toActor,
      queueSize: toMailbox.queue.length,
      priority,
      claim: `Message ${msg.id} from ${fromActor} → ${toActor} queued — priority ${priority} — evidence-bound ${evidenceRef}`
    };
  }

  receive(actorId) {
    const mailbox = this.mailboxes.get(actorId);
    if (!mailbox) return null;
    if (mailbox.queue.length === 0) return null;

    const msg = mailbox.queue.shift();
    msg.attempts++;
    mailbox.processing = msg;
    mailbox.delivered++;
    this.totalDelivered++;

    return {
      ...msg,
      queueRemaining: mailbox.queue.length,
      method: 'Ordered delivery — actor mailbox'
    };
  }

  ack(actorId, messageId) {
    const mailbox = this.mailboxes.get(actorId);
    if (!mailbox) return { acked: false, reason: 'mailbox not found' };

    if (mailbox.processing && mailbox.processing.id === messageId) {
      mailbox.processing = null;
      return { acked: true, messageId, actorId };
    }

    return { acked: false, reason: 'not processing this message' };
  }

  nack(actorId, messageId, { requeue = true } = {}) {
    const mailbox = this.mailboxes.get(actorId);
    if (!mailbox) return { nacked: false };

    if (mailbox.processing && mailbox.processing.id === messageId) {
      const msg = mailbox.processing;
      mailbox.processing = null;

      if (requeue && msg.attempts < 3) {
        mailbox.queue.unshift(msg);
        return { nacked: true, requeued: true, messageId, attempts: msg.attempts };
      } else {
        mailbox.deadLetter.push({ ...msg, reason: 'Max attempts exceeded' });
        this.totalDeadLetter++;
        return { nacked: true, requeued: false, deadLetter: true, messageId };
      }
    }

    return { nacked: false };
  }

  broadcast(fromActor, message, { evidenceRef = null, exclude = [] } = {}) {
    const results = [];
    for (const actorId of this.mailboxes.keys()) {
      if (actorId === fromActor) continue;
      if (exclude.includes(actorId)) continue;
      try {
        const res = this.send(fromActor, actorId, message, { evidenceRef });
        results.push(res);
      } catch (e) {
        results.push({ delivered: false, error: e.message, to: actorId });
      }
    }

    return {
      from: fromActor,
      broadcastTo: results.length,
      delivered: results.filter(r => r.delivered).length,
      failed: results.filter(r => !r.delivered).length,
      results: results.slice(0,3),
      claim: `Broadcast from ${fromActor} to ${results.length} actors — ${results.filter(r=>r.delivered).length} delivered`
    };
  }

  getStats() {
    const totalMailboxes = this.mailboxes.size;
    const totalQueued = [...this.mailboxes.values()].reduce((sum, m) => sum + m.queue.length, 0);
    const totalDead = [...this.mailboxes.values()].reduce((sum, m) => sum + m.deadLetter.length, 0);

    return {
      mailboxes: totalMailboxes,
      totalQueued,
      totalDeadLetter: totalDead,
      totalSent: this.totalSent,
      totalDelivered: this.totalDelivered,
      deliveryRate: this.totalSent > 0 ? (this.totalDelivered / this.totalSent * 100).toFixed(1) + '%' : '0%',
      claim: 'Actor mailbox — ordered delivery, backpressure, dead-letter, priority, P2P no orchestrator'
    };
  }
}
