import type { ModelProviderConfig } from '@codedelta/types';
import { borrowCodexCredentials, CodexAuthError, readCodexAuthStatus, readCodexDefaultModel } from './codex-auth';
import { fetchWithRetry } from './codex-http';
import { CODEX_BACKEND_BASE_URL, extractResponsesText } from './codex-responses';
import { readResponsesSseStream } from './codex-stream';

export { borrowCodexCredentials, CodexAuthError, readCodexAuthStatus, readCodexDefaultModel };
export { CODEX_BACKEND_BASE_URL, extractResponsesText };

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatCompleteInput {
  system: string;
  messages: ChatMessage[];
  temperature?: number;
}

export interface ChatProvider {
  readonly id: string;
  readonly label: string;
  isConfigured(): boolean;
  complete(input: ChatCompleteInput): Promise<string>;
}

/** No-AI provider — returns a deterministic message explaining AI is disabled. */
export class NoAiProvider implements ChatProvider {
  readonly id = 'none';
  readonly label = 'No AI';

  isConfigured(): boolean {
    return true;
  }

  async complete(_input: ChatCompleteInput): Promise<string> {
    return 'No-AI mode: deterministic candidate and evidence output only.';
  }
}

class OpenAiLikeProvider implements ChatProvider {
  readonly id: 'openai' | 'openai-compatible';
  readonly label: string;
  private readonly config: ModelProviderConfig;

  constructor(id: 'openai' | 'openai-compatible', config: ModelProviderConfig) {
    this.id = id;
    this.label = id === 'openai' ? 'OpenAI' : 'OpenAI-compatible';
    this.config = config;
  }

  isConfigured(): boolean {
    return Boolean(this.config.apiKey && (this.config.baseUrl || this.id === 'openai'));
  }

  async complete(input: ChatCompleteInput): Promise<string> {
    if (!this.isConfigured()) {
      throw new Error(`${this.label} provider is not configured`);
    }
    const baseUrl =
      this.id === 'openai'
        ? (this.config.baseUrl ?? 'https://api.openai.com/v1')
        : (this.config.baseUrl as string);
    const model = this.config.model ?? 'gpt-4o-mini';
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey as string}`,
      },
      body: JSON.stringify({
        model,
        temperature: input.temperature ?? 0.1,
        messages: [
          { role: 'system', content: input.system },
          ...input.messages.map((m) => ({ role: m.role, content: m.content })),
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(`${this.label} provider failed: HTTP ${res.status}`);
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) {
      throw new Error(`${this.label} provider returned empty response`);
    }
    return content;
  }
}

/** Phase 3 TODO: OpenAI API provider. */
export class OpenAiProvider implements ChatProvider {
  readonly id = 'openai';
  readonly label = 'OpenAI';
  private readonly inner: OpenAiLikeProvider;
  constructor(config: ModelProviderConfig) {
    this.inner = new OpenAiLikeProvider('openai', config);
  }
  isConfigured(): boolean {
    return this.inner.isConfigured();
  }
  async complete(input: ChatCompleteInput): Promise<string> {
    return this.inner.complete(input);
  }
}

/** Phase 3 TODO: Anthropic provider. */
export class AnthropicProvider implements ChatProvider {
  readonly id = 'anthropic';
  readonly label = 'Anthropic';
  constructor(_config: ModelProviderConfig) {}
  isConfigured(): boolean {
    return false;
  }
  async complete(_input: ChatCompleteInput): Promise<string> {
    throw new Error('Anthropic provider: not implemented (Phase 3)');
  }
}

/** Phase 3 TODO: Ollama provider. */
export class OllamaProvider implements ChatProvider {
  readonly id = 'ollama';
  readonly label = 'Ollama';
  constructor(_config: ModelProviderConfig) {}
  isConfigured(): boolean {
    return false;
  }
  async complete(_input: ChatCompleteInput): Promise<string> {
    throw new Error('Ollama provider: not implemented (Phase 3)');
  }
}

/** Phase 3 TODO: OpenAI-compatible endpoint provider. */
export class OpenAiCompatibleProvider implements ChatProvider {
  readonly id = 'openai-compatible';
  readonly label = 'OpenAI-compatible';
  private readonly inner: OpenAiLikeProvider;
  constructor(config: ModelProviderConfig) {
    this.inner = new OpenAiLikeProvider('openai-compatible', config);
  }
  isConfigured(): boolean {
    return this.inner.isConfigured();
  }
  async complete(input: ChatCompleteInput): Promise<string> {
    return this.inner.complete(input);
  }
}

/** Reuse local Codex CLI ChatGPT OAuth credentials (~/.codex/auth.json). */
export class CodexOAuthProvider implements ChatProvider {
  readonly id = 'codex-oauth';
  readonly label = 'Codex OAuth';
  private readonly config: ModelProviderConfig;

  constructor(config: ModelProviderConfig) {
    this.config = config;
  }

  isConfigured(): boolean {
    return readCodexAuthStatus().configured;
  }

  async complete(input: ChatCompleteInput): Promise<string> {
    const { accessToken, accountId } = await borrowCodexCredentials();
    const model = this.config.model ?? readCodexDefaultModel() ?? 'gpt-4o-mini';
    const inputMessages = input.messages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    let res: Response;
    try {
      res = await fetchWithRetry(
        `${CODEX_BACKEND_BASE_URL}/responses`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
            ...(accountId ? { 'ChatGPT-Account-ID': accountId } : {}),
          },
          // Codex ChatGPT backend rejects `temperature` (differs from OpenAI API).
          body: JSON.stringify({
            model,
            input: inputMessages,
            instructions: input.system,
            store: false,
            stream: true,
          }),
        },
        { timeoutMs: 120_000, retries: 2 },
      );
    } catch (err) {
      throw new Error(
        err instanceof Error
          ? `Codex OAuth provider failed: ${err.message}`
          : 'Codex OAuth provider failed: network error',
      );
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(
        `Codex OAuth provider failed: HTTP ${res.status}${detail ? ` — ${detail.slice(0, 200)}` : ''}`,
      );
    }

    if (!res.body) {
      throw new Error('Codex OAuth provider returned empty body');
    }

    let content: string;
    try {
      content = await readResponsesSseStream(res.body);
    } catch (err) {
      throw new Error(
        err instanceof Error
          ? `Codex OAuth provider failed while reading stream: ${err.message}`
          : 'Codex OAuth provider failed while reading stream',
      );
    }
    if (!content) {
      throw new Error('Codex OAuth provider returned empty response');
    }
    return content;
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
