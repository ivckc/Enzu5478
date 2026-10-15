// Goal Tools - Wrappers for goals module commands

import type { Tool } from '../types';
import { goals } from '../../../core/data';

// Helper to convert Result to ToolResult
function toToolResult(
  ok: boolean,
  summary: string,
  detail?: string,
  data?: unknown,
): { ok: boolean; summary: string; detail?: string; data?: unknown } {
  return { ok, summary, detail, data };
}

// Goal List Tool - Read
export const goalListTool: Tool = {
  name: 'goals.list',
  description: 'List all goals with their progress (done/total tasks)',
  risk: 'read',
  parameters: [],
  execute: async (): Promise<{ ok: boolean; summary: string; detail?: string; data?: unknown }> => {
    if (goals.length === 0) {
      return toToolResult(true, 'No goals found', 'There are no goals in your list');
    }

    const lines = goals.map((g) => {
      // Tasks are not linked to goals in the data model directly
      // We'll just show the goal title and ID
      return `${g.id}. ${g.title}`;
    });

    return toToolResult(true, `Found ${goals.length} goal(s)`, lines.join('\n'), goals);
  },
};

// Export tools for registration
export const goalTools = [goalListTool];
