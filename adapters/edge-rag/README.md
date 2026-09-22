# ⚡ NEXA Edge RAG — Cloudflare Workers + WebGPU + NVIDIA NIM

> **Zero-Server-Cost Edge RAG Architecture.**
> Client-Side WebGPU / WASM Embeddings + Vector Search & Cloudflare Workers Proxy to NVIDIA NIM Inference API.

---

## 🏛️ Topology

```
User Document (TXT/MD)
         ↓
  Client Browser (WebGPU / WASM)
  [Xenova/all-MiniLM-L6-v2]
         ↓ (Cosine Similarity Search)
   Relevant Chunks (Top-K Context)
         ↓
  Cloudflare Worker Proxy (worker.js)
         ↓ (Bearer Token Protected)
  NVIDIA NIM API (meta/llama-3.1-70b-instruct)
         ↓ (Server-Sent Events Stream)
  Real-Time SSE Response in Browser
```

---

## 🚀 Quick Start & Deployment

### 1. Set NVIDIA NIM Secret
```bash
npx wrangler secret put NVIDIA_API_KEY
```

### 2. Run Local Development Server
```bash
npx wrangler dev
```

### 3. Deploy Globally to Cloudflare Workers
```bash
npx wrangler deploy
```
