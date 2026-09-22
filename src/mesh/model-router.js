import { LocalRuntimeBroker } from './local-runtime-broker.js';

/**
 * ModelRouter - Model-Agnostic Intelligent Query Dispatcher
 * Dispatches agent requests to the optimal model (Ollama, llama.cpp, LiteLLM, Cloud API)
 * with strict zero-cost / local-first preference.
 */
export class ModelRouter {
  constructor(options = {}) {
    this.broker = new LocalRuntimeBroker(options);
    this.fallbackAllowed = options.allowCloudFallback ?? false;
  }

  /**
   * Routes a request based on task requirements and hardware resource constraints
   */
  async route(request) {
    const { prompt, taskType = 'CODING', memoryLimitMb = 8192 } = request;

    // 1. Select the best local model
    const selectedModel = this.broker.selectModelForTask(taskType, memoryLimitMb);

    // 2. Execute zero-cost inference
    const response = await this.broker.runInference(selectedModel.id, prompt);

    return {
      routedTo: selectedModel.id,
      runtimeType: selectedModel.runtime,
      taskType,
      isLocal: true,
      cost: '$0.00 (Zero-Cost Local)',
      response
    };
  }
}
