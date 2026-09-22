/**
 * NEXA Edge RAG Proxy Worker
 * Cloudflare Worker Proxy for NVIDIA NIM Inference API
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export default {
  async fetch(request, env = {}) {
    // 1. معالجة طلبات CORS Preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);

    // 2. مسار طلبات التوليد عبر NIM API
    if (url.pathname === "/api/chat" && request.method === "POST") {
      try {
        const body = await request.json();
        const { prompt, context } = body;

        if (!prompt) {
          return new Response(JSON.stringify({ error: "Missing prompt" }), {
            status: 400,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          });
        }

        const apiKey = env?.NVIDIA_API_KEY;
        if (!apiKey) {
          return new Response(JSON.stringify({ error: "NVIDIA_API_KEY not set on server" }), {
            status: 500,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
          });
        }

        // بناء الموجه المدمج مع السياق المجلوب من محرك RAG المحلي
        const systemMessage = "You are a precise AI assistant. Answer the user's question accurately using ONLY the provided context. If the answer cannot be found in the context, state that clearly.";
        const fullPrompt = context 
          ? `Context information:\n---\n${context}\n---\nQuestion: ${prompt}`
          : prompt;

        // إرسال الطلب إلى NVIDIA NIM API
        const nvidiaResponse = await fetch("https://integrate.api.nvidia.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json",
            "Accept": "text/event-stream"
          },
          body: JSON.stringify({
            model: env.NVIDIA_MODEL || "meta/llama-3.1-70b-instruct",
            messages: [
              { role: "system", content: systemMessage },
              { role: "user", content: fullPrompt }
            ],
            temperature: 0.2,
            top_p: 0.7,
            max_tokens: 1024,
            stream: true
          })
        });

        if (!nvidiaResponse.ok) {
          const errText = await nvidiaResponse.text();
          return new Response(JSON.stringify({ error: `NVIDIA NIM API Error: ${errText}` }), {
            status: nvidiaResponse.status,
            headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
          });
        }

        // تمرير تدفق SSE مباشرة إلى المتصفح
        return new Response(nvidiaResponse.body, {
          headers: {
            ...CORS_HEADERS,
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive"
          }
        });

      } catch (err) {
        return new Response(JSON.stringify({ error: err.message }), {
          status: 500,
          headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
        });
      }
    }

    return new Response("NEXA Edge RAG Proxy Active", { status: 200, headers: CORS_HEADERS });
  }
};
