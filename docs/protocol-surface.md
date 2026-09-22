# NEXA Protocol Surface & S-Series Security Invariants Specification

**Standard Identifier:** `NEXA-SPEC-SECURITY-INVARIANTS-v1.0`  
**Applicability:** Core Protocol Packages (`packages/*`), Synthesis Engine (`packages/cells/celia/synthesis/*`), and Boundary Adapters.

---

## 1. Overview and Core Axiom

The foundational axiom of the NEXA architecture is:
$$\textbf{AI Proposes, the Deterministic System Decides}$$

To ensure zero ambient power, zero privilege escalation, and zero covert channels, all protocol layers must strictly adhere to the **S-Series Security Invariants** detailed below.

---

## 2. The S-Series Security Invariants (S1 – S9c)

| Invariant | Title | Definition & Formal Requirement |
|---|---|---|
| **S1** | **Unicode NFC Key Normalization** | Map keys that collide after Unicode NFC normalization are strictly rejected at parse time, never silently merged. |
| **S1b** | **Nesting Integrity** | Nested objects and arrays cannot act as escape hatches for illegal, uncanonicalized, or unparseable values. |
| **S2** | **Origin-Pinned Authority** | A trusted peer cannot mint itself authority that the operator never explicitly granted. No self-promoted capability roots. |
| **S2b** | **Issuer Constraint Verification** | Capability verification standalone functions must support strict whitelisting of trusted capability issuer Key IDs (`capabilityIssuers`). |
| **S2c** | **Endpoint Origin Isolation** | Endpoints accept capability roots exclusively from pinned, trusted operators (`capabilityIssuers`). |
| **S3** | **Revocation Provenance** | A third party cannot revoke capabilities issued by another principal. Revocation sets require proof of issuer authority. |
| **S3b** | **Cascading Chain Revocation** | Revoking a root capability automatically invalidates all children attenuated from that root across the entire delegation lattice. |
| **S4** | **Oversized Body Pre-Verification Denial** | Payload bodies exceeding `MAX_BODY_BYTES` (64 KB) are rejected immediately prior to running Ed25519 signature checks to prevent DoS. |
| **S5** | **Replay State Protection** | Only cryptographically valid, correctly addressed, unexpired envelopes consume nonce/replay state. Malformed packets fail without side-effects. |
| **S6** | **Tamper & Truncation Detectability** | Local log truncation or mutation is immediately detectable by anyone holding a signed portable receipt. |
| **S6b** | **Foreign Record Splice Rejection** | Foreign records cannot be spliced into the evidence hash chain; co-signed continuations are explicitly audited. |
| **S7** | **Zero Private Key Serialization** | No serialized wire surface, capability document, envelope, or evidence record may contain private key material (`nexa:key:priv:*` or raw seeds). |
| **S8** | **Gateway Boundary Defense** | MCP bridges and external tool connectors cannot be talked into authority or into invoking gated tools without signed capabilities. |
| **S9** | **Zero Ambient I/O & Execution Purity** | Protocol packages (`packages/ast`, `packages/crypto`, `packages/identity`, `packages/capability`, `packages/policy`, `packages/protocol`, `packages/cells/celia/synthesis`) must be pure deterministic logic. They must **never** import `node:fs`, `node:child_process`, `node:net`, `node:http`, `node:dgram`, nor invoke `eval()`, `Function()`, or `process.binding`. |
| **S9b** | **Prototype Pollution & Getter Immunity** | Hostile policy or capability documents cannot smuggle behavior via `__proto__`, getters, or class instances. All rules and tokens must be plain data. |
| **S9c** | **Strict Schema Strictness** | Unknown top-level or nested fields in envelopes, capabilities, or receipts are refused at the schema validation boundary. |

---

## 3. Compliance and Automated Verification

The S-Series invariants are continuously verified by:
1. `tests/security.test.js`: Full automated suite testing S1 through S9c.
2. `tests/grand-synthesis.test.js`: Verification of S9 isolation across the synthesis module.
3. Static scanner sweeps before every commit and release ceremony.
