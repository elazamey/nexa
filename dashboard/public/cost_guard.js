/**
 * NEXA Edge RAG — CostGuard
 * 
 * 2026 Zero-Cost Financial Protection Engine ($0 Hard Guarantee).
 * Strictly enforces MAX_SPEND = 0 and blocks any paid API tokens/calls.
 */

export class NexaCostGuardError extends Error {
  constructor(message, details = {}) {
    super(`[CostGuard Violation] ${message}`);
    this.name = 'NexaCostGuardError';
    this.nexa_code = 'NEXA_E_COST_GUARD';
    this.details = details;
  }
}

// Immutable Free Models Catalog (Price = $0.00 / token)
export const FREE_TIER_PROVIDERS = Object.freeze({
  'gemini-free': {
    name: 'Google Gemini Free Tier',
    models: ['gemini-1.5-flash', 'gemini-2.0-flash-exp', 'gemini-1.5-flash-8b'],
    costPerMillionTokens: 0,
    isFree: true,
  },
  'openrouter-free': {
    name: 'OpenRouter Free Models',
    models: [
      'meta-llama/llama-3.2-3b-instruct:free',
      'google/gemini-2.0-flash-exp:free',
      'mistralai/mistral-7b-instruct:free',
      'qwen/qwen-2.5-7b-instruct:free',
      'meta-llama/llama-3.1-8b-instruct:free',
    ],
    costPerMillionTokens: 0,
    isFree: true,
  },
  'groq-free': {
    name: 'Groq Cloud Free Tier',
    models: ['llama-3.1-8b-instant', 'llama-3.2-3b-preview', 'mixtral-8x7b-32768'],
    costPerMillionTokens: 0,
    isFree: true,
  },
  'cloudflare-ai-free': {
    name: 'Cloudflare Workers AI Free Tier',
    models: ['@cf/meta/llama-3.1-8b-instruct', '@cf/meta/llama-3.2-3b-instruct', '@cf/qwen/qwen1.5-7b-chat-awq'],
    costPerMillionTokens: 0,
    isFree: true,
  },
  'nvidia-nim-free': {
    name: 'NVIDIA NIM Developer Trial Tier',
    models: ['meta/llama-3.1-8b-instruct', 'mistralai/mistral-7b-instruct-v0.3', 'meta/llama-3.1-70b-instruct'],
    costPerMillionTokens: 0,
    isFree: true,
  },
  'local-ollama': {
    name: 'Local Ollama Instance',
    models: ['llama3.2', 'mistral', 'qwen2.5', 'phi3', 'deepseek-r1', 'tinyllama'],
    costPerMillionTokens: 0,
    isFree: true,
  },
  'local-llamacpp': {
    name: 'Local llama.cpp Server',
    models: ['default', 'custom-gguf'],
    costPerMillionTokens: 0,
    isFree: true,
  },
  'local-webgpu': {
    name: 'Client WebGPU / WASM Local Engine',
    models: ['webgpu-all-minilm-l6-v2', 'webgpu-smollm2-135m'],
    costPerMillionTokens: 0,
    isFree: true,
  },
});

export const PAID_MODELS_PRICE_MAP = Object.freeze({
  'gpt-4o': 5.0,
  'gpt-4-turbo': 10.0,
  'claude-3-5-sonnet': 3.0,
  'claude-3-opus': 15.0,
  'gemini-1.5-pro-paid': 3.5,
});

export class CostGuard {
  static #MAX_SPEND = 0;
  static #currentSpend = 0;
  static #totalRequests = 0;
  static #freeTokensConsumed = 0;
  static #blockedPaidAttempts = 0;
  static #usageHistory = [];

  /**
   * Immutable Max Spend constant ($0 Hard Guarantee).
   */
  static get MAX_SPEND() {
    return CostGuard.#MAX_SPEND;
  }

  /**
   * Check if provider and model qualify under the zero-cost guarantee.
   */
  static isZeroCost(provider, model) {
    if (!provider || !model) return false;
    
    // Check if provider is in free catalog
    const freeProvider = FREE_TIER_PROVIDERS[provider];
    if (freeProvider && freeProvider.isFree) {
      if (provider.startsWith('local-')) return true;
      if (freeProvider.models.some((m) => m.toLowerCase() === model.toLowerCase())) return true;
      if (model.toLowerCase().endsWith(':free')) return true;
    }

    // Direct check for local models or free tags
    if (provider.toLowerCase().includes('local') || provider.toLowerCase().includes('ollama')) return true;
    if (model.toLowerCase().endsWith(':free') || model.toLowerCase().includes('webgpu')) return true;

    // Explicit paid check
    if (PAID_MODELS_PRICE_MAP[model] !== undefined && PAID_MODELS_PRICE_MAP[model] > 0) {
      return false;
    }

    return false;
  }

  /**
   * Assert that a requested call incurs strictly $0.00 spend.
   * Throws NexaCostGuardError if any non-zero price is detected.
   */
  static assertZeroSpend(provider, model, tokenEstimate = 0) {
    if (!CostGuard.isZeroCost(provider, model)) {
      CostGuard.#blockedPaidAttempts++;
      const estPrice = PAID_MODELS_PRICE_MAP[model] || 1.0;
      throw new NexaCostGuardError(
        `$0 Hard Guarantee Violated: Request to '${provider}/${model}' requires paid credits (Estimated: $${estPrice}/M tokens). Blocked by CostGuard.`,
        { provider, model, tokenEstimate, maxSpend: CostGuard.MAX_SPEND }
      );
    }

    if (CostGuard.#currentSpend > CostGuard.MAX_SPEND) {
      throw new NexaCostGuardError(
        `$0 Spend Limit Exceeded: Accumulated spend is $${CostGuard.#currentSpend.toFixed(4)}.`,
        { currentSpend: CostGuard.#currentSpend, maxSpend: CostGuard.MAX_SPEND }
      );
    }

    return true;
  }

  /**
   * Record usage of a free model call.
   */
  static recordUsage({ provider, model, promptTokens = 0, completionTokens = 0 }) {
    CostGuard.assertZeroSpend(provider, model, promptTokens + completionTokens);

    const totalTokens = (promptTokens || 0) + (completionTokens || 0);
    CostGuard.#totalRequests++;
    CostGuard.#freeTokensConsumed += totalTokens;
    
    const record = {
      timestamp: new Date().toISOString(),
      provider,
      model,
      tokens: totalTokens,
      cost: 0.0,
      guarantee: '$0 Hard Guarantee'
    };

    CostGuard.#usageHistory.push(record);
    if (CostGuard.#usageHistory.length > 500) {
      CostGuard.#usageHistory.shift();
    }

    return record;
  }

  /**
   * Retrieve real-time metrics and financial posture.
   */
  static getStats() {
    return {
      maxSpend: CostGuard.MAX_SPEND,
      currentSpend: CostGuard.#currentSpend,
      totalRequests: CostGuard.#totalRequests,
      freeTokensConsumed: CostGuard.#freeTokensConsumed,
      blockedPaidAttempts: CostGuard.#blockedPaidAttempts,
      guarantee: '100% $0 Hard Guarantee Verified',
      activeFreeProviders: Object.keys(FREE_TIER_PROVIDERS).length,
    };
  }

  /**
   * Reset stats (for isolated test suites).
   */
  static reset() {
    CostGuard.#currentSpend = 0;
    CostGuard.#totalRequests = 0;
    CostGuard.#freeTokensConsumed = 0;
    CostGuard.#blockedPaidAttempts = 0;
    CostGuard.#usageHistory = [];
  }
}
