import type { ModelProviderConfig } from '@codedelta/types';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatCompletionRequest {
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface ChatCompletionResponse {
  content: string;
  provider: string;
  model?: string;
}

export interface ChatProvider {
  readonly name: string;
  complete(request: ChatCompletionRequest): Promise<ChatCompletionResponse>;
}

/** No-AI provider — returns a deterministic message explaining AI is disabled. */
export class NoAiProvider implements ChatProvider {
  readonly name = 'none';

  async complete(_request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    return {
      content:
        'AI provider is disabled (no-AI mode). CodeDelta still supports repository import, commit timeline, and Delta View structural analysis.',
      provider: 'none',
    };
  }
}

/** Phase 3 TODO: OpenAI API provider. */
export class OpenAiProvider implements ChatProvider {
  readonly name = 'openai';
  constructor(_config: ModelProviderConfig) {}
  async complete(_request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    throw new Error('OpenAI provider: not implemented (Phase 3)');
  }
}

/** Phase 3 TODO: Anthropic provider. */
export class AnthropicProvider implements ChatProvider {
  readonly name = 'anthropic';
  constructor(_config: ModelProviderConfig) {}
  async complete(_request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    throw new Error('Anthropic provider: not implemented (Phase 3)');
  }
}

/** Phase 3 TODO: Ollama provider. */
export class OllamaProvider implements ChatProvider {
  readonly name = 'ollama';
  constructor(_config: ModelProviderConfig) {}
  async complete(_request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    throw new Error('Ollama provider: not implemented (Phase 3)');
  }
}

/** Phase 3 TODO: OpenAI-compatible endpoint provider. */
export class OpenAiCompatibleProvider implements ChatProvider {
  readonly name = 'openai-compatible';
  constructor(_config: ModelProviderConfig) {}
  async complete(_request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    throw new Error('OpenAI-compatible provider: not implemented (Phase 3)');
  }
}

/** Phase 3 TODO: Codex OAuth provider placeholder. */
export class CodexOAuthProvider implements ChatProvider {
  readonly name = 'codex-oauth';
  constructor(_config: ModelProviderConfig) {}
  async complete(_request: ChatCompletionRequest): Promise<ChatCompletionResponse> {
    throw new Error('Codex OAuth provider: not implemented (Phase 3)');
  }
}

export function createProvider(config: ModelProviderConfig): ChatProvider {
  switch (config.kind) {
    case 'none':
      return new NoAiProvider();
    case 'openai':
      return new OpenAiProvider(config);
    case 'anthropic':
      return new AnthropicProvider(config);
    case 'ollama':
      return new OllamaProvider(config);
    case 'openai-compatible':
      return new OpenAiCompatibleProvider(config);
    case 'codex-oauth':
      return new CodexOAuthProvider(config);
    default:
      return new NoAiProvider();
  }
}
