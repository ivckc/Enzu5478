// Tool Registry Tests - Simple inline tests

import { describe, it, expect } from 'vitest';

// Simple mock registry for testing
type Tool = {
  name: string;
  description: string;
  risk: 'read' | 'write' | 'sensitive';
};

const toolsMap = new Map<string, Tool>();

function registerTool(tool: Tool): void {
  if (toolsMap.has(tool.name)) {
    throw new Error(`Tool "${tool.name}" is already registered`);
  }
  toolsMap.set(tool.name, tool);
}

function getTool(name: string): { ok: boolean; tool?: Tool; error?: string } {
  const tool = toolsMap.get(name);
  if (!tool) {
    return { ok: false, error: `Tool "${name}" not found` };
  }
  return { ok: true, tool };
}

function listTools(): string[] {
  return Array.from(toolsMap.keys());
}

describe('Tool Registry', () => {
  it('should register a tool', () => {
    const tool: Tool = { name: 'test.tool', description: 'Test tool', risk: 'read' };
    registerTool(tool);

    const result = getTool('test.tool');
    expect(result.ok).toBe(true);
    expect(result.tool?.name).toBe('test.tool');
  });

  it('should return error for non-existent tool', () => {
    const result = getTool('nonexistent.tool');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Tool "nonexistent.tool" not found');
  });

  it('should list all registered tools', () => {
    registerTool({ name: 'list.test.1', description: 'Test', risk: 'read' });
    registerTool({ name: 'list.test.2', description: 'Test', risk: 'read' });

    const tools = listTools();
    expect(tools).toContain('list.test.1');
    expect(tools).toContain('list.test.2');
  });

  it('should prevent duplicate registration', () => {
    const tool: Tool = { name: 'duplicate.test', description: 'Test', risk: 'read' };

    registerTool(tool);
    expect(() => registerTool(tool)).toThrow('Tool "duplicate.test" is already registered');
  });

  it('should identify read risk level', () => {
    const tool: Tool = { name: 'read.test', description: 'Test', risk: 'read' };
    registerTool(tool);

    const result = getTool('read.test');
    expect(result.ok).toBe(true);
    expect(result.tool?.risk).toBe('read');
  });

  it('should identify write risk level', () => {
    const tool: Tool = { name: 'write.test', description: 'Test', risk: 'write' };
    registerTool(tool);

    const result = getTool('write.test');
    expect(result.ok).toBe(true);
    expect(result.tool?.risk).toBe('write');
  });

  it('should identify sensitive risk level', () => {
    const tool: Tool = { name: 'sensitive.test', description: 'Test', risk: 'sensitive' };
    registerTool(tool);

    const result = getTool('sensitive.test');
    expect(result.ok).toBe(true);
    expect(result.tool?.risk).toBe('sensitive');
  });
});
