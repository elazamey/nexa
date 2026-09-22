# 🌐 NEXA 2026 Free-First AI Agent Operating System Architecture

> **A Model-Agnostic, Zero-Cost, Multi-Protocol, Self-Improving AI Governance OS.**
> Built on Ollama/llama.cpp Local Inference, MCP/A2A Protocols, Graphiti-style Temporal Memory, Playwright Computer Use, and NEXA Ed25519 Cryptographic Verification.

---

## 🏛️ Architectural Topology

```text
                       NEXA 2026 AI OS
        ┌──────────────────────────────────────────────┐
        │       Protocol + Identity + Policy           │
        │       Capability + Evidence + Ledger         │
        └──────────────────────┬───────────────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          ↓                    ↓                    ↓
     Model Mesh           Multi-Protocol       4-Tier Memory
   (Ollama/llama.cpp)       (MCP / A2A)     (Temporal Graphiti)
   (Qwen/DeepSeek/Phi)       (OpenAPI)       (Episodic/Semantic)
          │                    │                    │
          └────────────────────┼────────────────────┘
                               ↓
                      Computer Interface
                  ┌────────────┼────────────┐
                  ↓            ↓            ↓
               Browser      Terminal    Filesystem
             (Playwright)  (Subprocess)  (Atomic Diff)
                  │            │            │
                  └────────────┼────────────┘
                               ↓
                        NEXA Policy Gate
                               ↓
                       Authorization Gate
                               ↓
                      Isolated Micro-Sandbox
                               ↓
                           Executor
                               ↓
                       Invariant Verifier
                               ↓
                      Cryptographic Evidence
                               ↓
                      Immutable Ed25519 Ledger
```

---

## 🧩 The 8 Core Architectural Layers

### 1. Zero-Cost Local Model Mesh (`src/mesh/local-runtime-broker.js` & `src/mesh/model-router.js`)
- **Free-First Priority**: Prefers local execution via **Ollama** (`http://localhost:11434`) and **llama.cpp** (`http://localhost:8080`) over external paid APIs.
- **Task-Adaptive Routing**: Automatically dispatches queries to quantized models based on task type (`CODING`, `REASONING`, `VISION`, `GENERAL_CHAT`).
- **Resource Aware**: Selects models tailored to available system VRAM and quantization levels (`Q4_K_M`, `Q4_0`).

### 2. Multi-Protocol Tool Integration (`src/mesh/protocols.js`)
- **MCP (Model Context Protocol)**: Bridges standard MCP tool servers for filesystem, git, and fetch.
- **A2A (Agent-to-Agent)**: Supports direct peer agent collaboration and delegation.
- **OpenAPI / MCPO**: Converts RESTful schemas into typed agent tools without custom connector code.
- **Principle**: *Connectivity without Authority* — tools provide functionality, but NEXA holds the execution key.

### 3. 4-Tier Memory & Temporal Knowledge Graph (`src/mesh/memory-mesh.js`)
- **Working Memory**: Fast short-term scratchpad.
- **Episodic Memory**: Full execution traces with SHA-256 state digests.
- **Semantic Memory**: Knowledge nodes and embedded concepts.
- **Procedural Memory**: Verified, reusable action recipes and tool sequences.
- **Temporal Knowledge Graph**: Causal relations (`source -> relation -> target`) with timestamps and provenance attribution.

### 4. Computer Use & Sandbox Action Bus (`src/mesh/computer-interface.js`)
- **Terminal Interface**: Strictly allowlisted command execution with timeout and path-traversal safeguards.
- **Browser Interface**: Playwright and `browser-use` compatible visual DOM actions (`GOTO`, `CLICK`, `FILL`, `SCREENSHOT`).
- **Atomic Filesystem**: Diff calculation and committed SHA-256 digests.

### 5. Zero-Trust Policy & Authorization Gate (`src/mesh/governance-kernel.js`)
- **Default-Deny Policy**: All executions refused unless backed by an unexpired capability token.
- **Lattice Attenuation**: Authority can only be narrowed, never widened.
- **Cryptographic Receipts**: Every decision is signed with Ed25519 and chained to the previous block hash.

### 6. Safe Continuous Self-Improvement (`src/mesh/self-improvement.js`)
- **6-Stage Promotion Invariant**:
  ```text
  Observe -> Failure Discovery -> Patch Generation -> Sandbox Execution -> AST Security Scan -> Policy Verification -> Signed Promotion
  ```
- **Fail-Closed**: Direct production modification without sandbox pass is structurally blocked.

---

## ⚡ CLI Commands (`tools/nexa-mesh.mjs`)

```bash
# 1. View active zero-cost local runtimes and models
node tools/nexa-mesh.mjs runtimes

# 2. Test model-agnostic local routing
node tools/nexa-mesh.mjs route "Write a fast Merkle Tree in JavaScript"

# 3. Inspect Temporal Knowledge Graph & 4-Tier Memory
node tools/nexa-mesh.mjs memory

# 4. Simulate safe Computer Use action planning
node tools/nexa-mesh.mjs computer

# 5. Run the safe Self-Improvement patch promotion pipeline
node tools/nexa-mesh.mjs improve

# 6. Verify cryptographic integrity of the immutable evidence ledger
node tools/nexa-mesh.mjs verify-ledger

# 7. Execute the complete full-mesh demonstration
node tools/nexa-mesh.mjs full-demo
```
