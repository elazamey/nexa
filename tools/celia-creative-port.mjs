// tools/celia-creative-port.mjs
// NEXA v12 — Creative Generation Port (AdForge AI)
//
// This file lives in tools/ to keep core packages isolated (posture check CLOSED).
//
// Contract (spec/celia-agent/v12-creative.md):
//  - resource:   tool:creative.generate — the ONLY surface this port implements
//  - capability: required. Accepts either a raw minted token (direct API path) or
//                a verified grant from the endpoint (envelope path: it carries
//                id, resource, actions, constraints, remaining_uses, exp)
//                budget = caveats.max_uses (or the grant's remaining_uses),
//                         tracked per capability id — defense in depth on top of
//                         the protocol UsageLedger that enforces it on envelopes
//                scope  = constraints.channels (default: the standard channel enum)
//  - channels:   meta | instagram | tiktok | google (standard enum, decision §4)
//  - secrets:    vault:// handles in args are rejected (llm-secret-egress, the same
//                rule the grok planner applies to steps)
//  - provider:   deterministic mock — seeded, same inputs → same bytes, no network.
//                Real providers attach later through the same factory with a fetch
//                port and vault:// key handles (celia-grok-port.mjs pattern).
//  - NO PUBLISH: this port has no route to any channel API. Publishing stays behind
//                the AUTO_DEPLOY gate (CLOSED — there is no API that opens one).

import crypto from 'node:crypto';

export const CREATIVE_RESOURCE = 'tool:creative.generate';
export const CREATIVE_CHANNELS = Object.freeze(['meta', 'instagram', 'tiktok', 'google']);

const CHANNEL_STYLES = Object.freeze({
  meta: { aspect: '1.91:1 feed', headlineCap: 40 },
  instagram: { aspect: '4:5 feed / 9:16 story', headlineCap: 35 },
  tiktok: { aspect: '9:16 video', headlineCap: 25 },
  google: { aspect: '16:9 display', headlineCap: 30 },
});

const TONE_IDX = { warm: 0, bold: 1, playful: 2, premium: 3 };

function toneIndex(tone) {
  const t = String(tone || 'warm').toLowerCase();
  for (const [key, idx] of Object.entries(TONE_IDX)) {
    if (t.includes(key)) return idx;
  }
  if (t.includes('دافئ')) return TONE_IDX.warm;
  if (t.includes('جريء') || t.includes('قوي')) return TONE_IDX.bold;
  if (t.includes('مرح') || t.includes('خفيف')) return TONE_IDX.playful;
  if (t.includes('فاخر') || t.includes('أنيق')) return TONE_IDX.premium;
  return TONE_IDX.warm;
}

function hashContent(value) {
  return `sha256:${crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 16)}`;
}

function seedFrom(value) {
  let h = 2166136261 >>> 0;
  const s = String(value);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic mock copy packs — pure slot-filling, no control flow.
// User-supplied strings are DATA here: they are interpolated, never executed.
const TONE_PACKS = Object.freeze([
  { // warm
    headlines: [
      (i) => `${i.brand}: ${i.product} اللي بيحكيلك عن بيتك`,
      (i) => `من ${i.brand} — ${i.product} بحب`,
      (i) => `${i.product} من ${i.brand}.. دفء في كل ملعقة`,
      (i) => `${i.audience} تستاهل ${i.product} من ${i.brand}`,
    ],
    bodies: [
      (i) => `لو ${i.audience} بتدور على ${i.product} بذكاء، ${i.brand} جابلك ${i.offer}. جودة من غير كلام زيادة.`,
      (i) => `${i.offer} — الفرصة دي للـ ${i.audience} اللي بياخدوا وقت في اختياراتهم. من ${i.brand} بكل ثقة.`,
    ],
  },
  { // bold
    headlines: [
      (i) => `${i.product} من ${i.brand} — من غير مساومة`,
      (i) => `${i.brand} اتحدت: ${i.product} أو مفيش`,
      (i) => `كفاية ${i.product} عادي.. خد من ${i.brand}`,
      (i) => `${i.offer} — والباقي كلام`,
    ],
    bodies: [
      (i) => `الـ ${i.audience} بيفهموا الجودة من أول لقطة. ${i.brand} ${i.product} بيفرق — و${i.offer} بيقنع.`,
      (i) => `مفيش وقت للتجارب الناقصة. ${i.product} من ${i.brand}، بـ${i.offer}. جرب وقارن.`,
    ],
  },
  { // playful
    headlines: [
      (i) => `${i.product} من ${i.brand}.. جرّبه وقولنا رأيك`,
      (i) => `تحدي: ${i.product} من ${i.brand} هيبقى في كل بيت من الـ ${i.audience}`,
      (i) => `${i.offer} مع ${i.brand}.. عرض من غير تفكير`,
      (i) => `${i.brand} خلاص خبي ${i.product} عندك`,
    ],
    bodies: [
      (i) => `خطة ${i.brand} لليوم: ${i.product} + ${i.offer} + يوم أحلى. مناسب تماماً للـ ${i.audience}.`,
      (i) => `جبنالكم ${i.product} بـ${i.offer} عشان الـ ${i.audience} يستاهلوا.`,
    ],
  },
  { // premium
    headlines: [
      (i) => `${i.brand} — ${i.product} بمستوى مختلف`,
      (i) => `تجربة ${i.product} من ${i.brand}.. رفاهية يومية`,
      (i) => `${i.audience} الذواقة يعرفوا ${i.brand}`,
      (i) => `${i.product} من ${i.brand}: التفاصيل هي كل حاجة`,
    ],
    bodies: [
      (i) => `لـ ${i.audience} اللي بيعرفوا الفرق: ${i.product} من ${i.brand}، مع ${i.offer} لفترة محدودة.`,
      (i) => `${i.brand} مايقدمش أكتر من اللازم. ${i.product} بحد ذاته — و${i.offer}.`,
    ],
  },
]);

const CTAS = ['اطلب دلوقتي', 'جرّبه النهارده', 'احجز حصتك', 'اسألنا.. واحنا نرتب الباقي'];

function clampHeadline(text, cap) {
  return text.length <= cap ? text : `${text.slice(0, cap - 1)}…`;
}

function schemaError(message) {
  return Object.assign(new Error(message), { code: 'NEXA_E_SCHEMA' });
}

export function createCreativePort({ vault, provider = 'mock', now = () => new Date() } = {}) {
  if (provider !== 'mock' && !vault) {
    throw new Error(`creative provider "${provider}" requires a vault — real providers take keys as vault:// handles only`);
  }
  const usage = new Map(); // capabilityId → { used, budget, exp }

  /* Budget + freshness. Accepts a raw minted token (direct API) or an endpoint
     grant (envelope path) — the grant's remaining_uses is the protocol ledger's
     view, so locking the budget at first observation keeps the two layers in
     step (the protocol always refuses first on the envelope path). */
  const requireCapability = (capability) => {
    if (!capability || typeof capability !== 'object' || typeof capability.resource !== 'string') {
      throw Object.assign(new Error(`no capability presented for ${CREATIVE_RESOURCE}`), { code: 'NEXA_E_CAP_MISSING' });
    }
    if (capability.resource !== CREATIVE_RESOURCE) {
      throw Object.assign(new Error(`capability names ${capability.resource}, expected ${CREATIVE_RESOURCE}`), { code: 'NEXA_E_CAP_SCOPE' });
    }
    if (!Array.isArray(capability.actions) || !capability.actions.includes('call')) {
      throw Object.assign(new Error('capability does not allow action "call"'), { code: 'NEXA_E_CAP_SCOPE' });
    }
    const id = typeof capability.id === 'string' && capability.id ? capability.id : 'anonymous';
    const exp = capability.caveats?.exp ?? capability.exp ?? null;
    if (exp && now() >= new Date(exp)) {
      throw Object.assign(new Error(`capability ${id} expired`), { code: 'NEXA_E_CAP_EXPIRED' });
    }
    const budget = Number.isSafeInteger(capability.caveats?.max_uses)
      ? capability.caveats.max_uses
      : Number.isSafeInteger(capability.remaining_uses)
        ? capability.remaining_uses
        : 1;
    const entry = usage.get(id) ?? { used: 0, budget, exp };
    if (entry.used + 1 > entry.budget) {
      throw Object.assign(new Error(`creative budget exhausted for ${id} (${entry.used}/${entry.budget})`), { code: 'NEXA_E_BUDGET_EXCEEDED' });
    }
    entry.used += 1;
    usage.set(id, entry);
    return entry;
  };

  const scopeChannelsFor = (capability) => {
    const channels = capability?.constraints?.channels;
    return Array.isArray(channels) && channels.length > 0 ? channels : [...CREATIVE_CHANNELS];
  };

  // llm-secret-egress, defense in depth: the planner already strips vault:// from
  // steps; the port must not trust the direct API path either.
  const assertNoSecrets = (args) => {
    if (JSON.stringify(args).includes('vault://')) {
      throw Object.assign(new Error('vault:// handle in creative args — secret egress refused'), { code: 'NEXA_E_SECRET_EGRESS' });
    }
  };

  const mockGenerate = ({ brand, product, audience, offer, channel, tone, variants }) => {
    const canonical = JSON.stringify({ brand, product, audience, offer, channel, tone, variants });
    const rng = mulberry32(seedFrom(canonical));
    const pack = TONE_PACKS[toneIndex(tone)];
    const style = CHANNEL_STYLES[channel];
    const out = [];
    for (let v = 0; v < variants; v++) {
      const base = {
        index: v + 1,
        headline: clampHeadline(pack.headlines[Math.floor(rng() * pack.headlines.length)]({ brand, product, audience, offer }), style.headlineCap),
        body: pack.bodies[Math.floor(rng() * pack.bodies.length)]({ brand, product, audience, offer }),
        cta: CTAS[Math.floor(rng() * CTAS.length)],
        imagePrompt: `${channel} creative: ${product} by ${brand}, ${tone || 'warm'} tone, ${style.aspect}, product-centric composition, clean negative space`,
        aspect: style.aspect,
      };
      out.push({ ...base, digest: hashContent(JSON.stringify(base)) });
    }
    return out;
  };

  // NOTE: synchronous on purpose — protocol endpoint handlers run in the sync core
  // (a Promise return is not canonicalizable). Async real providers attach through
  // the dashboard API path, which may await; the envelope path stays deterministic.
  const generate = (input, { capability, evidenceRef } = {}) => {
    const entry = requireCapability(capability);
    assertNoSecrets(input ?? {});
    const args = input && typeof input === 'object' ? input : {};
    const { brand, product, audience = '', offer = '', channel, tone = '' } = args;
    if (typeof brand !== 'string' || !brand.trim()) throw schemaError('brand (non-empty string) required');
    if (typeof product !== 'string' || !product.trim()) throw schemaError('product (non-empty string) required');
    if (typeof channel !== 'string' || !CREATIVE_CHANNELS.includes(channel)) {
      throw schemaError(`unknown channel "${channel}" — allowed: ${CREATIVE_CHANNELS.join(', ')}`);
    }
    if (!scopeChannelsFor(capability).includes(channel)) {
      throw Object.assign(new Error(`channel "${channel}" is outside this capability's scope`), { code: 'NEXA_E_CAP_SCOPE' });
    }
    const raw = args.variants;
    const variants = raw === undefined ? 1 : raw;
    if (!Number.isSafeInteger(variants) || variants < 1 || variants > 4) {
      throw schemaError('variants must be an integer in 1..4 (max_calls budget decision)');
    }
    const variantsList = mockGenerate({ brand: brand.trim(), product: product.trim(), audience, offer, channel, tone, variants });
    const creativeId = `cr_${seedFrom(JSON.stringify({ ...args, variants })).toString(16).padStart(8, '0')}`;
    return {
      ok: true,
      creativeId,
      provider,
      model: 'adforge-mock-1',
      resource: CREATIVE_RESOURCE,
      channel,
      variants: variantsList,
      artifactDigests: variantsList.map((v) => v.digest),
      budget: { used: entry.used, max: entry.budget },
      evidenceRef: evidenceRef ?? null,
      generatedAt: now().toISOString(),
    };
  };

  return {
    resource: CREATIVE_RESOURCE,
    channels: [...CREATIVE_CHANNELS],
    provider,
    generate,
    stats() {
      return {
        provider,
        resource: CREATIVE_RESOURCE,
        channels: [...CREATIVE_CHANNELS],
        usage: [...usage.entries()].map(([id, u]) => ({ id, used: u.used, budget: u.budget, exp: u.exp })),
      };
    },
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('Creative port demo (mock provider)');
  const port = createCreativePort();
  const capability = {
    id: 'demo-cap',
    resource: CREATIVE_RESOURCE,
    actions: ['call'],
    caveats: { max_uses: 4 },
    constraints: { channels: [...CREATIVE_CHANNELS] },
  };
  const result = await port.generate(
    { brand: 'أبو رُفيدة', product: 'عسل سدر', audience: 'أمهات', offer: 'خصم 20% لأول طلب', channel: 'instagram', tone: 'دافئ', variants: 2 },
    { capability, evidenceRef: 'evidence:creative-demo' },
  );
  console.log(JSON.stringify(result, null, 2));
}
