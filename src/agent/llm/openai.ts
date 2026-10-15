// OpenAI-Compatible LLM Provider

import type { LLMProvider, LLMRequest, LLMResponse } from './provider';

// Configuration from environment
const BASE_URL = process.env.ANZU_LLM_BASE_URL;
const MODEL = process.env.ANZU_LLM_MODEL;
const API_KEY = process.env.ANZU_LLM_API_KEY;

// Validate configuration at load time
function validateConfig(): string | null {
  if (!BASE_URL) {
    return 'ANZU_LLM_BASE_URL is not set';
  }
  if (!MODEL) {
    return 'ANZU_LLM_MODEL is not set';
  }
  if (!API_KEY) {
    return 'ANZU_LLM_API_KEY is not set';
  }
  return null;
}

export class OpenAICompatibleProvider implements LLMProvider {
  private name: string;

  constructor(name: string = 'OpenAI-compatible') {
    this.name = name;
    const error = validateConfig();
    if (error) {
      console.error(`[LLM] Configuration error: ${error}`);
      console.error('[LLM] Please set ANZU_LLM_BASE_URL, ANZU_LLM_MODEL, and ANZU_LLM_API_KEY in environment variables');
    }
  }

  getName(): string {
    return this.name;
  }

  async chat(request: LLMRequest): Promise<LLMResponse> {
    const configError = validateConfig();
    if (configError) {
      throw new Error(`LLM not configured: ${configError}`);
    }

    try {
      const response = await fetch(`${BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${API_KEY}`,
        },
        body: JSON.stringify({
          model: MODEL,
          messages: request.messages,
          tools: request.tools,
          tool_choice: request.tool_choice,
          temperature: request.temperature ?? 0.7,
          max_tokens: request.max_tokens,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const data: LLMResponse = await response.json();
      return data;
    } catch (e) {
      throw new Error(`LLM request failed: ${String(e)}`);
    }
  }
}

// Export a singleton instance
export const llmProvider = new OpenAICompatibleProvider();
