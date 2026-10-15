// Tool Registry - Core Registry Logic

import type { Tool, RegistryResult } from './types';

const tools = new Map<string, Tool>();

export function registerTool(tool: Tool): void {
  if (tools.has(tool.name)) {
    throw new Error(`Tool "${tool.name}" is already registered`);
  }
  tools.set(tool.name, tool);
}

export function getTool(name: string): RegistryResult {
  const tool = tools.get(name);
  if (!tool) {
    return { ok: false, error: `Tool "${name}" not found` };
  }
  return { ok: true, tool };
}

export function listTools(): string[] {
  return Array.from(tools.keys());
}

export function getToolsByRisk(risk: 'read' | 'write' | 'sensitive'): Tool[] {
  return Array.from(tools.values()).filter((t) => t.risk === risk);
}
