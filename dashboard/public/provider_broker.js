/**
 * NEXA Edge RAG — ProviderBroker
 * 
 * Free-Tier Prioritized Cascading Model Router with Seamless Local Fallback.
 * Ensures 100% $0 operation and high availability across Cloud Free Tiers & Local Ollama.
 */

import { CostGuard, FREE_TIER_PROVIDERS } from './cost_guard.js';

export class ProviderBroker {
  constructor(options = {}) {
    this.cloudProviders = options.cloudProviders || [
      {
        id: 'openrouter-free',
        name: 'OpenRouter Free Tier',
        model: 'meta-llama/llama-3.2-3b-instruct:free',
        endpoint: 'https://openrouter.ai/api/v1/chat/completions',
        authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
        formatBody: (messages, model) => ({ model, messages, temperature: 0.2 }),
        extractContent: (json) => json.choices?.[0]?.message?.content || '',
      },
      {
        id: 'groq-free',
        name: 'Groq Cloud Free Tier',
        model: 'llama-3.1-8b-instant',
        endpoint: 'https://api.groq.com/openai/v1/chat/completions',
        authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
        formatBody: (messages, model) => ({ model, messages, temperature: 0.2 }),
        extractContent: (json) => json.choices?.[0]?.message?.content || '',
      },
      {
        id: 'nvidia-nim-free',
        name: 'NVIDIA NIM Free Trial',
        model: 'meta/llama-3.1-8b-instruct',
        endpoint: 'https://integrate.api.nvidia.com/v1/chat/completions',
        authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
        formatBody: (messages, model) => ({ model, messages, temperature: 0.2, max_tokens: 1024 }),
        extractContent: (json) => json.choices?.[0]?.message?.content || '',
      },
    ];

    this.localProviders = options.localProviders || [
      {
        id: 'local-ollama',
        name: 'Local Ollama Instance',
        model: 'llama3.2',
        endpoint: options.ollamaUrl || 'http://127.0.0.1:11434/api/chat',
        authHeader: () => ({}),
        formatBody: (messages, model) => ({
          model: model || 'llama3.2',
          messages: messages,
          stream: false,
        }),
        extractContent: (json) => json.message?.content || json.response || '',
      },
      {
        id: 'local-llamacpp',
        name: 'Local llama.cpp Server',
        model: 'default',
        endpoint: options.llamacppUrl || 'http://127.0.0.1:8080/v1/chat/completions',
        authHeader: () => ({}),
        formatBody: (messages, model) => ({ model, messages }),
        extractContent: (json) => json.choices?.[0]?.message?.content || '',
      },
    ];

    this.timeoutMs = options.timeoutMs || 8000;
  }

  /**
   * Execute chat completion with cascading free-tier fallback.
   */
  async executeCascade({ messages, keys = {}, preferredProvider = null, mockFetch = null }) {
    const fetchImpl = mockFetch || globalThis.fetch;
    const candidates = [];

    // Prioritize preferred provider if specified
    if (preferredProvider) {
      const found = [...this.cloudProviders, ...this.localProviders].find((p) => p.id === preferredProvider);
      if (found) candidates.push(found);
    }

    // Add remaining cloud providers with available keys or public access
    for (const cp of this.cloudProviders) {
      if (!candidates.some((c) => c.id === cp.id)) {
        candidates.push(cp);
      }
    }

    // Add local providers as robust zero-cost fallbacks
    for (const lp of this.localProviders) {
      if (!candidates.some((c) => c.id === lp.id)) {
        candidates.push(lp);
      }
    }

    const errors = [];

    for (const candidate of candidates) {
      // Step 1: Enforce $0 CostGuard Guarantee before dispatch
      try {
        CostGuard.assertZeroSpend(candidate.id, candidate.model, 500);
      } catch (cgErr) {
        errors.push({ provider: candidate.id, error: cgErr.message });
        continue;
      }

      // Step 2: Check API key requirement for cloud providers
      const apiKey = keys[candidate.id] || keys[candidate.id.replace('-free', '').toUpperCase() + '_API_KEY'];
      if (!candidate.id.startsWith('local-') && !apiKey) {
        // Skip if required cloud API key is missing
        continue;
      }

      // Step 3: Attempt API Call with timeout
      try {
        const headers = {
          'Content-Type': 'application/json',
          ...candidate.authHeader(apiKey),
        };

        const body = JSON.stringify(candidate.formatBody(messages, candidate.model));

        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), this.timeoutMs);

        const response = await fetchImpl(candidate.endpoint, {
          method: 'POST',
          headers,
          body,
          signal: controller.signal,
        });

        clearTimeout(timer);

        if (!response.ok) {
          const status = response.status;
          const errText = await response.text().catch(() => '');
          errors.push({
            provider: candidate.id,
            status,
            error: `HTTP ${status}: ${errText.slice(0, 150)}`,
          });
          // Rate limit (429), Payment Required (402), or Server Error (5xx) triggers cascade
          continue;
        }

        const data = await response.json();
        const content = candidate.extractContent(data);

        if (!content || typeof content !== 'string') {
          errors.push({ provider: candidate.id, error: 'Empty or invalid response format' });
          continue;
        }

        // Step 4: Record usage in CostGuard ($0 guaranteed)
        CostGuard.recordUsage({
          provider: candidate.id,
          model: candidate.model,
          promptTokens: Math.ceil(JSON.stringify(messages).length / 4),
          completionTokens: Math.ceil(content.length / 4),
        });

        return {
          success: true,
          content,
          providerUsed: candidate.id,
          providerName: candidate.name,
          modelUsed: candidate.model,
          isFallback: candidate.id !== candidates[0].id,
          cost: 0.0,
          costGuardStatus: 'ZERO_COST_VERIFIED',
          raw: data,
        };
      } catch (err) {
        errors.push({
          provider: candidate.id,
          error: err.name === 'AbortError' ? 'Request Timed Out' : err.message,
        });
      }
    }

    // If all providers failed, synthesize safe local offline fallback response
    return {
      success: false,
      content: '⚠️ Free Tier Quota Exceeded & Local Engine Unreachable. Please verify local Ollama is active on http://127.0.0.1:11434.',
      providerUsed: 'offline-fallback',
      cost: 0.0,
      costGuardStatus: 'ZERO_COST_VERIFIED',
      errors,
    };
  }
}
