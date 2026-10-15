// Tool Core - Base Tool Interface and Validation

import * as z from 'zod';

export type RiskLevel = 'read' | 'write' | 'sensitive';

export type ToolParameterSchema = {
  name: string;
  type: 'string' | 'number' | 'boolean';
  description: string;
  required?: boolean;
};

export type ToolExecuteResult = {
  ok: boolean;
  summary: string;
  detail?: string;
  data?: unknown;
  error?: string;
};

export type ToolExecuteParams = Record<string, unknown>;

export abstract class BaseTool {
  abstract readonly name: string;
  abstract readonly description: string;
  abstract readonly risk: RiskLevel;
  abstract parameters: ToolParameterSchema[];

  /**
   * Validate parameters against schema
   */
  protected validateParams(params: ToolExecuteParams): { ok: boolean; error?: string } {
    try {
      // Basic validation: all required params must be present
      const missing = this.parameters
        .filter((p) => p.required !== false)
        .map((p) => p.name)
        .filter((name) => params[name] === undefined);

      if (missing.length > 0) {
        return {
          ok: false,
          error: `Missing required parameters: ${missing.join(', ')}`,
        };
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: `Validation error: ${String(e)}` };
    }
  }

  /**
   * Execute the tool with validated parameters
   */
  abstract execute(params: ToolExecuteParams): Promise<ToolExecuteResult>;
}
