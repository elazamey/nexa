/**
 * ProtocolBridge - Multi-Protocol Integration Layer (MCP, A2A, OpenAPI)
 * Connects AI agents to tools, servers, and peer agents while enforcing NEXA authority.
 */
export class ProtocolBridge {
  constructor() {
    this.mcpTools = new Map();
    this.a2aAgents = new Map();
    this.openApiEndpoints = new Map();
  }

  /**
   * Registers an MCP Tool with typed input schema
   */
  registerMcpTool(toolName, schema, handler) {
    this.mcpTools.set(toolName, {
      name: toolName,
      type: 'MCP',
      schema,
      handler,
      registeredAt: new Date().toISOString()
    });
  }

  /**
   * Registers a peer agent for Agent-to-Agent (A2A) collaboration
   */
  registerA2AAgent(agentId, capabilities = []) {
    this.a2aAgents.set(agentId, {
      agentId,
      capabilities,
      registeredAt: new Date().toISOString()
    });
  }

  /**
   * Imports OpenAPI specs and converts endpoints to callable agent tools
   */
  importOpenApiSpec(specName, endpoints = []) {
    for (const ep of endpoints) {
      const toolId = `${specName}_${ep.method}_${ep.path.replace(/[^a-zA-Z0-9]/g, '_')}`;
      this.openApiEndpoints.set(toolId, {
        specName,
        method: ep.method,
        path: ep.path,
        description: ep.description || `Call ${ep.method} on ${ep.path}`
      });
    }
  }

  /**
   * Lists all discovered tools across all 3 protocols
   */
  listAllTools() {
    const tools = [];

    for (const [name, t] of this.mcpTools.entries()) {
      tools.push({ id: name, protocol: 'MCP', schema: t.schema });
    }

    for (const [id, a] of this.a2aAgents.entries()) {
      tools.push({ id: `a2a_${id}`, protocol: 'A2A', capabilities: a.capabilities });
    }

    for (const [id, ep] of this.openApiEndpoints.entries()) {
      tools.push({ id, protocol: 'OpenAPI', endpoint: `${ep.method} ${ep.path}` });
    }

    return tools;
  }
}
