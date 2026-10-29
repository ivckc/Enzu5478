// Goal Tools - Full set of wrappers for goals module commands

import * as z from 'zod';
import type { Tool } from '../types';
import { goals, saveGoals, saveTasks, tasks } from '../../../core/data';
import { nextIdFor } from '../../../core/storage';

function toToolResult(
  ok: boolean,
  summary: string,
  detail?: string,
  data?: unknown,
): { ok: boolean; summary: string; detail?: string; data?: unknown } {
  return { ok, summary, detail, data };
}

// ── Read ──────────────────────────────────────────────────────────────────

export const goalListTool: Tool = {
  name: 'goals.list',
  description: 'List all goals with their task progress (done / total)',
  risk: 'read',
  parameters: [],
  execute: async () => {
    if (goals.length === 0) {
      return toToolResult(true, 'No goals found', 'There are no goals yet');
    }
    const lines = goals.map((g) => {
      const linked    = tasks.filter((t) => t.goalId === g.id);
      const doneCount = linked.filter((t) => t.done).length;
      return `${g.id}. ${g.title}: ${doneCount}/${linked.length} task(s) done`;
    });
    return toToolResult(true, `Found ${goals.length} goal(s)`, lines.join('\n'), goals);
  },
};

// ── Write ─────────────────────────────────────────────────────────────────

export const goalAddTool: Tool = {
  name: 'goals.add',
  description: 'Add a new goal',
  risk: 'write',
  parameters: [
    { name: 'title', type: 'string', description: 'The goal title', required: true },
  ],
  execute: async (params) => {
    const parsed = z.object({ title: z.string().min(1) }).safeParse(params);
    if (!parsed.success) {
      return toToolResult(false, 'Invalid parameters', parsed.error.message);
    }
    const goal = { id: nextIdFor(goals), userId: 'local', title: parsed.data.title };
    goals.push(goal);
    if (!saveGoals()) {
      goals.pop();
      return toToolResult(false, 'Failed to save goal', 'Could not write to goals.json');
    }
    return toToolResult(true, `Goal #${goal.id} added`, `Title: ${goal.title}`, goal);
  },
};

export const goalRenameTool: Tool = {
  name: 'goals.rename',
  description: 'Change the title of a goal',
  risk: 'write',
  parameters: [
    { name: 'goalId', type: 'number', description: 'The goal ID', required: true },
    { name: 'title',  type: 'string', description: 'The new title', required: true },
  ],
  execute: async (params) => {
    const parsed = z.object({ goalId: z.number(), title: z.string().min(1) }).safeParse(params);
    if (!parsed.success) {
      return toToolResult(false, 'Invalid parameters', parsed.error.message);
    }
    const goal = goals.find((g) => g.id === parsed.data.goalId);
    if (!goal) return toToolResult(false, 'Goal not found', `No goal with ID ${parsed.data.goalId}`);
    const oldTitle = goal.title;
    goal.title = parsed.data.title;
    if (!saveGoals()) {
      goal.title = oldTitle;
      return toToolResult(false, 'Failed to save', 'Could not write to goals.json');
    }
    return toToolResult(true, `Goal #${goal.id} renamed`, `${oldTitle} → ${goal.title}`, goal);
  },
};

// ── Sensitive (always confirms, ignoring AUTO_CONFIRM_WRITES) ─────────────

export const goalDeleteTool: Tool = {
  name: 'goals.delete',
  description: 'Delete a goal permanently — always requires user confirmation. Linked tasks are kept but unlinked.',
  risk: 'sensitive',
  parameters: [
    { name: 'goalId', type: 'number', description: 'The goal ID', required: true },
  ],
  execute: async (params) => {
    const parsed = z.object({ goalId: z.number() }).safeParse(params);
    if (!parsed.success) {
      return toToolResult(false, 'Invalid parameters', parsed.error.message);
    }
    const goal = goals.find((g) => g.id === parsed.data.goalId);
    if (!goal) return toToolResult(false, 'Goal not found', `No goal with ID ${parsed.data.goalId}`);

    // Unlink tasks first
    const linked = tasks.filter((t) => t.goalId === goal.id);
    for (const t of linked) t.goalId = null;
    if (linked.length > 0 && !saveTasks()) {
      for (const t of linked) t.goalId = goal.id;
      return toToolResult(false, 'Failed to unlink tasks', 'Could not write to tasks.json');
    }

    const index = goals.indexOf(goal);
    goals.splice(index, 1);
    if (!saveGoals()) {
      goals.splice(index, 0, goal);
      for (const t of linked) t.goalId = goal.id;
      return toToolResult(false, 'Failed to delete goal', 'Could not write to goals.json');
    }

    return toToolResult(true, `Goal #${goal.id} deleted`, `Title: ${goal.title}\n${linked.length} linked task(s) unlinked.`);
  },
};

export const goalTools = [goalListTool, goalAddTool, goalRenameTool, goalDeleteTool];
