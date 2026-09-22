/**
 * NEXA Edge RAG Proxy Worker (2026 Zero-Cost Cloudflare Worker)
 * 
 * Enforces CostGuard ($0 Hard Guarantee), ProviderBroker cascading routing,
 * ReflectionEngine hallucination evaluation, and EdgeEvidenceLedger cryptographic audit trail.
 */

import { CostGuard } from './cost_guard.js';
import { ReflectionEngine } from './reflection_engine.js';
import { EdgeEvidenceLedger } from './evidence_ledger.js';

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With, X-Nexa-Provider",
  "Access-Control-Expose-Headers": "X-Nexa-Evidence-Hash, X-Nexa-CostGuard-Status, X-Nexa-Reflection-Score",
};

export default {
  async fetch(request, env = {}) {
    // 1. معالجة طلبات CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // 2. إحصائيات حارس التكلفة $0 والضمان المالي
    if (url.pathname === "/api/stats" && request.method === "GET") {
      return new Response(JSON.stringify({
        ok: true,
        costGuard: CostGuard.getStats(),
        timestamp: new Date().toISOString(),
      }), {
        status: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // 3. تقييم الانعكاس والتحقق من الهلوسة (Reflection Engine)
    if (url.pathname === "/api/reflect" && request.method === "POST") {
      try {
        const body = await request.json();
        const { query, context, answer } = body;
        const reflection = ReflectionEngine.evaluate({
          query: query || '',
          contextChunks: Array.isArray(context) ? context : [context || ''],
          answer: answer || '',
        });

        return new Response(JSON.stringify({ ok: true, reflection }), {
          status: 200,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
        });
      }
    }

    // 4. مسار طلبات التوليد عبر المحركات المجانية وحارس التكلفة
    if (url.pathname === "/api/chat" && request.method === "POST") {
      try {
        const body = await request.json();
        const { prompt, context, stream = false, provider = "nvidia-nim-free", model } = body;

        if (!prompt) {
          return new Response(JSON.stringify({ error: "Missing prompt" }), {
            status: 400,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          });
        }

        // تطبيق شرط CostGuard: التأكد الصريح من أن النموذج مجاني 100%
        const targetModel = model || (provider === "nvidia-nim-free" ? "meta/llama-3.1-8b-instruct" : "meta-llama/llama-3.2-3b-instruct:free");
        CostGuard.assertZeroSpend(provider, targetModel, 500);

        const apiKey = env?.NVIDIA_API_KEY || env?.OPENROUTER_API_KEY || env?.GROQ_API_KEY;
        if (!apiKey && !provider.startsWith("local-")) {
          return new Response(JSON.stringify({ error: "No free-tier API key configured on server" }), {
            status: 500,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          });
        }

        const systemMessage = "You are a precise AI assistant. Answer the user's question accurately using ONLY the provided context. If the answer cannot be found in the context, state that clearly.";
        const fullPrompt = context 
          ? `Context information:\n---\n${context}\n---\nQuestion: ${prompt}`
          : prompt;

        // إرسال الطلب إلى المزود المحدد
        let targetEndpoint = "https://integrate.api.nvidia.com/v1/chat/completions";
        if (provider === "openrouter-free") {
          targetEndpoint = "https://openrouter.ai/api/v1/chat/completions";
        } else if (provider === "groq-free") {
          targetEndpoint = "https://api.groq.com/openai/v1/chat/completions";
        }

        const llmResponse = await fetch(targetEndpoint, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            ...(stream ? { "Accept": "text/event-stream" } : {})
          },
          body: JSON.stringify({
            model: targetModel,
            messages: [
              { role: "system", content: systemMessage },
              { role: "user", content: fullPrompt }
            ],
            temperature: 0.2,
            top_p: 0.7,
            max_tokens: 1024,
            stream: Boolean(stream)
          })
        });

        if (!llmResponse.ok) {
          const errText = await llmResponse.text();
          return new Response(JSON.stringify({ error: `Provider API Error (${llmResponse.status}): ${errText}` }), {
            status: llmResponse.status,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
          });
        }

        // تسجيل العملية في CostGuard ($0 محفوظ ومضمون)
        CostGuard.recordUsage({
          provider,
          model: targetModel,
          promptTokens: Math.ceil(fullPrompt.length / 4),
          completionTokens: 256,
        });

        if (stream) {
          // تمرير تدفق SSE مباشرة إلى المتصفح مع ترويسات الضمان
          return new Response(llmResponse.body, {
            headers: {
              ...CORS_HEADERS,
              "Content-Type": "text/event-stream",
              "Cache-Control": "no-cache",
              "Connection": "keep-alive",
              "X-Nexa-CostGuard-Status": "ZERO_COST_VERIFIED",
            }
          });
        }

        const data = await llmResponse.json();
        const content = data.choices?.[0]?.message?.content || "";

        // إجراء تقييم الانعكاس والتحقق من الأدلة
        const reflection = ReflectionEngine.evaluate({
          query: prompt,
          contextChunks: [context || ""],
          answer: content,
        });

        const ledger = new EdgeEvidenceLedger();
        const receipt = await ledger.createReceipt({
          prompt,
          context: [context || ""],
          stdout: content,
          reflection,
          providerUsed: provider,
        });

        return new Response(JSON.stringify({
          ok: true,
          content,
          provider,
          model: targetModel,
          cost: 0.0,
          costGuardStatus: "ZERO_COST_VERIFIED",
          reflection,
          receipt,
        }), {
          status: 200,
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "application/json",
            "X-Nexa-Evidence-Hash": receipt.receiptHash,
            "X-Nexa-CostGuard-Status": "ZERO_COST_VERIFIED",
            "X-Nexa-Reflection-Score": String(reflection.reflectionScore),
          }
        });

      } catch (err) {
        return new Response(JSON.stringify({
          error: err.message,
          nexa_code: err.nexa_code || 'NEXA_E_WORKER_ERROR'
        }), {
          status: 500,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
        });
      }
    }

    return new Response("NEXA Edge RAG Proxy Active (CostGuard $0 Protected)", {
      status: 200,
      headers: CORS_HEADERS
    });
  }
};
