// Task Tools - Wrappers for tasks module commands

import * as z from 'zod';
import type { Tool } from '../types';
import { tasks } from '../../../core/data';
import { saveTasks } from '../../../core/storage';
import { nextIdFor } from '../../../core/parse';

// Helper to convert Result to ToolResult
function toToolResult(
  ok: boolean,
  summary: string,
  detail?: string,
  data?: unknown,
): { ok: boolean; summary: string; detail?: string; data?: unknown } {
  return { ok, summary, detail, data };
}

// Helper to get task by ID
function getTaskById(id: number) {
  return tasks.find((t) => t.id === id);
}

// Task List Tool - Read
export const taskListTool: Tool = {
  name: 'tasks.list',
  description: 'List all tasks with their status, priority, due dates, and subtasks',
  risk: 'read',
  parameters: [],
  execute: async (): Promise<{ ok: boolean; summary: string; detail?: string; data?: unknown }> => {
    if (tasks.length === 0) {
      return toToolResult(true, 'No tasks found', 'There are no tasks in your list');
    }

    const lines = tasks.map((t) => {
      const status = t.done ? '[x]' : '[ ]';
      const priority = t.priority !== 'normal' ? ` (${t.priority})` : '';
      const due = t.due ? ` due:${t.due}${t.dueTime ? ' ' + t.dueTime : ''}` : '';
      const subs = t.subtasks.length > 0 ? ` (${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length} subs)` : '';
      return `${t.id}. ${status} ${t.title}${priority}${due}${subs}`;
    });

    return toToolResult(true, `Found ${tasks.length} task(s)`, lines.join('\n'), tasks);
  },
};

// Task Add Tool - Write
export const taskAddTool: Tool = {
  name: 'tasks.add',
  description: 'Add a new task',
  risk: 'write',
  parameters: [
    { name: 'title', type: 'string', description: 'The task title', required: true },
  ],
  execute: async (params): Promise<{ ok: boolean; summary: string; detail?: string; data?: unknown }> => {
    const schema = z.object({ title: z.string().min(1) });
    const parsed = schema.safeParse(params);

    if (!parsed.success) {
      return toToolResult(false, 'Invalid parameters', `Missing or invalid title: ${parsed.error.message}`);
    }

    const task = {
      id: nextIdFor(tasks),
      userId: 'local',
      title: parsed.data.title,
      done: false,
      goalId: null,
      priority: 'normal',
      due: null,
      dueTime: null,
      subtasks: [],
    };

    tasks.push(task);

    if (!saveTasks()) {
      tasks.pop();
      return toToolResult(false, 'Failed to save task', 'Could not write to tasks.json');
    }

    return toToolResult(true, `Task #${task.id} added`, `Title: ${task.title}`, task);
  },
};

// Task Done Tool - Write
export const taskDoneTool: Tool = {
  name: 'tasks.done',
  description: 'Mark a task as done',
  risk: 'write',
  parameters: [
    { name: 'taskId', type: 'number', description: 'The task ID', required: true },
  ],
  execute: async (params): Promise<{ ok: boolean; summary: string; detail?: string; data?: unknown }> => {
    const schema = z.object({ taskId: z.number() });
    const parsed = schema.safeParse(params);

    if (!parsed.success) {
      return toToolResult(false, 'Invalid parameters', `Missing or invalid taskId: ${parsed.error.message}`);
    }

    const task = getTaskById(parsed.data.taskId);
    if (!task) {
      return toToolResult(false, 'Task not found', `No task with ID ${parsed.data.taskId}`);
    }

    if (task.done) {
      return toToolResult(false, 'Task already done', `Task #${task.id} is already marked as done`);
    }

    task.done = true;

    if (!saveTasks()) {
      task.done = false;
      return toToolResult(false, 'Failed to save', 'Could not write to tasks.json');
    }

    return toToolResult(true, `Task #${task.id} marked as done`, `Title: ${task.title}`, task);
  },
};

// Task Delete Tool - Sensitive
export const taskDeleteTool: Tool = {
  name: 'tasks.delete',
  description: 'Delete a task permanently',
  risk: 'sensitive',
  parameters: [
    { name: 'taskId', type: 'number', description: 'The task ID', required: true },
  ],
  execute: async (params): Promise<{ ok: boolean; summary: string; detail?: string; data?: unknown }> => {
    const schema = z.object({ taskId: z.number() });
    const parsed = schema.safeParse(params);

    if (!parsed.success) {
      return toToolResult(false, 'Invalid parameters', `Missing or invalid taskId: ${parsed.error.message}`);
    }

    const taskIndex = tasks.findIndex((t) => t.id === parsed.data.taskId);
    if (taskIndex === -1) {
      return toToolResult(false, 'Task not found', `No task with ID ${parsed.data.taskId}`);
    }

    const task = tasks[taskIndex];

    // For sensitive tools, we return a confirmation request instead of executing
    // The caller is responsible for getting user confirmation first
    return {
      ok: false,
      summary: `Delete task #${task.id}?`,
      detail: `Title: ${task.title}`,
      data: { task, taskIndex },
      error: 'CONFIRMATION_REQUIRED',
    };
  },
};

// Export tools for registration
export const taskTools = [taskListTool, taskAddTool, taskDoneTool, taskDeleteTool];
