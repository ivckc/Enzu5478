// LLM Provider Interface

export type LLMMessageRole = 'system' | 'user' | 'assistant' | 'tool';

export type LLMMessage = {
  role: LLMMessageRole;
  content: string;
  tool_call_id?: string;
};

export type ToolParameterSchema = {
  type: string;
  description?: string;
  enum?: string[];
};

export type ToolParameters = {
  type: 'object';
  properties: Record<string, ToolParameterSchema>;
  required?: string[];
};

export type LLMFunctionTool = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: ToolParameters;
  };
};

export type LLMToolChoice = 'auto' | 'none' | { type: 'function'; function: { name: string } };

export type LLMRequest = {
  messages: LLMMessage[];
  tools?: LLMFunctionTool[];
  tool_choice?: LLMToolChoice;
  temperature?: number;
  max_tokens?: number;
};

export type LLMResponseChoice = {
  index: number;
  message: {
    role: 'assistant';
    content?: string;
    tool_calls?: {
      id: string;
      type: 'function';
      function: {
        name: string;
        arguments: string;
      };
    }[];
  };
  finish_reason: 'stop' | 'tool_calls' | 'length' | 'content_filter';
};

export type LLMResponse = {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: LLMResponseChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
};

export interface LLMProvider {
  chat(request: LLMRequest): Promise<LLMResponse>;
  getName(): string;
}
