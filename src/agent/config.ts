// Agent Configuration

import type { RiskLevel } from './tools/types';

export type AgentConfig = {
  llm: {
    baseUrl: string;
    model: string;
    apiKey: string;
  };
  autoConfirmWrites: boolean;
  maxIterations: number;
  confirmationLevels: Record<RiskLevel, boolean>;
};

function getEnvString(name: string, required: boolean = true): string | undefined {
  const value = process.env[name];
  if (!value && required) {
    console.error(`[Config] Missing required environment variable: ${name}`);
    return undefined;
  }
  return value;
}

function getEnvBoolean(name: string, defaultValue: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) {
    return defaultValue;
  }
  return value.toLowerCase() === 'true';
}

function getEnvNumber(name: string, defaultValue: number): number {
  const value = process.env[name];
  if (value === undefined) {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? defaultValue : parsed;
}

export function loadConfig(): AgentConfig {
  const baseUrl = getEnvString('ANZU_LLM_BASE_URL', true);
  const model = getEnvString('ANZU_LLM_MODEL', true);
  const apiKey = getEnvString('ANZU_LLM_API_KEY', true);
  const autoConfirm = getEnvBoolean('AUTO_CONFIRM_WRITES', false);
  const maxIterations = getEnvNumber('ANZU_MAX_ITERATIONS', 5);

  if (!baseUrl || !model || !apiKey) {
    console.error('\n[LLM] LLM is not configured.');
    console.error('[LLM] Please set these environment variables:');
    console.error('  - ANZU_LLM_BASE_URL (e.g., https://api.openai.com/v1)');
    console.error('  - ANZU_LLM_MODEL (e.g., gpt-4o-mini)');
    console.error('  - ANZU_LLM_API_KEY (your API key)\n');
  }

  return {
    llm: {
      baseUrl: baseUrl || '',
      model: model || '',
      apiKey: apiKey || '',
    },
    autoConfirmWrites: autoConfirm,
    maxIterations: maxIterations,
    confirmationLevels: {
      read: false,
      write: !autoConfirm,
      sensitive: true,
    },
  };
}
