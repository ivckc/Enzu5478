// Tool Registry Types

export type RiskLevel = 'read' | 'write' | 'sensitive';

export type ToolParameter = {
  name: string;
  type: 'string' | 'number' | 'boolean';
  description: string;
  required?: boolean;
};

export type Tool = {
  name: string;
  description: string;
  parameters: ToolParameter[];
  risk: RiskLevel;
  execute(params: Record<string, unknown>): Promise<ToolResult>;
};

export type ToolResult = {
  ok: boolean;
  summary: string;
  detail?: string;
  data?: unknown;
  error?: string;
};

export type ToolCall = {
  toolName: string;
  params: Record<string, unknown>;
};

export type RegistryResult = {
  ok: boolean;
  tool?: Tool;
  error?: string;
};

export type ConfirmationRequest = {
  toolName: string;
  summary: string;
  detail?: string;
};

export type ConfirmationResponse = {
  approved: boolean;
};
