// Task Tools - Full set of wrappers for tasks module commands

import * as z from 'zod';
import type { Tool } from '../types';
import type { Priority } from '../../../core/types';
import { tasks, saveTasks, goals } from '../../../core/data';
import { nextIdFor } from '../../../core/storage';

function toToolResult(
  ok: boolean,
  summary: string,
  detail?: string,
  data?: unknown,
): { ok: boolean; summary: string; detail?: string; data?: unknown } {
  return { ok, summary, detail, data };
}

function getTaskById(id: number) {
  return tasks.find((t) => t.id === id);
}

// ── Read ──────────────────────────────────────────────────────────────────

export const taskListTool: Tool = {
  name: 'tasks.list',
  description: 'List all tasks with their status, priority, due dates, and subtasks',
  risk: 'read',
  parameters: [],
  execute: async () => {
    if (tasks.length === 0) {
      return toToolResult(true, 'No tasks found', 'There are no tasks in your list');
    }
    const lines = tasks.map((t) => {
      const status   = t.done ? '[x]' : '[ ]';
      const priority = t.priority !== 'normal' ? ` (${t.priority})` : '';
      const due      = t.due ? ` due:${t.due}${t.dueTime ? ' ' + t.dueTime : ''}` : '';
      const subs     = t.subtasks.length > 0
        ? ` (${t.subtasks.filter((s) => s.done).length}/${t.subtasks.length} subs)`
        : '';
      const goal = goals.find((g) => g.id === t.goalId);
      const goalTag = goal ? ` [${goal.title}]` : '';
      return `${t.id}. ${status} ${t.title}${priority}${due}${subs}${goalTag}`;
    });
    return toToolResult(true, `Found ${tasks.length} task(s)`, lines.join('\n'), tasks);
  },
};

// ── Write ─────────────────────────────────────────────────────────────────

export const taskAddTool: Tool = {
  name: 'tasks.add',
  description: 'Add a new task',
  risk: 'write',
  parameters: [
    { name: 'title', type: 'string', description: 'The task title', required: true },
  ],
  execute: async (params) => {
    const parsed = z.object({ title: z.string().min(1) }).safeParse(params);
    if (!parsed.success) {
      return toToolResult(false, 'Invalid parameters', parsed.error.message);
    }
    const task = {
      id: nextIdFor(tasks),
      userId: 'local',
      title: parsed.data.title,
      done: false,
      goalId: null,
      priority: 'normal' as Priority,
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

export const taskDoneTool: Tool = {
  name: 'tasks.done',
  description: 'Mark a task as done',
  risk: 'write',
  parameters: [
    { name: 'taskId', type: 'number', description: 'The task ID', required: true },
  ],
  execute: async (params) => {
    const parsed = z.object({ taskId: z.number() }).safeParse(params);
    if (!parsed.success) {
      return toToolResult(false, 'Invalid parameters', parsed.error.message);
    }
    const task = getTaskById(parsed.data.taskId);
    if (!task) return toToolResult(false, 'Task not found', `No task with ID ${parsed.data.taskId}`);
    if (task.done) return toToolResult(false, 'Already done', `Task #${task.id} is already marked as done`);
    task.done = true;
    if (!saveTasks()) {
      task.done = false;
      return toToolResult(false, 'Failed to save', 'Could not write to tasks.json');
    }
    return toToolResult(true, `Task #${task.id} marked as done`, `Title: ${task.title}`, task);
  },
};

export const taskReopenTool: Tool = {
  name: 'tasks.reopen',
  description: 'Reopen a task that was marked as done',
  risk: 'write',
  parameters: [
    { name: 'taskId', type: 'number', description: 'The task ID', required: true },
  ],
  execute: async (params) => {
    const parsed = z.object({ taskId: z.number() }).safeParse(params);
    if (!parsed.success) {
      return toToolResult(false, 'Invalid parameters', parsed.error.message);
    }
    const task = getTaskById(parsed.data.taskId);
    if (!task) return toToolResult(false, 'Task not found', `No task with ID ${parsed.data.taskId}`);
    if (!task.done) return toToolResult(false, 'Not done yet', `Task #${task.id} is not marked as done`);
    task.done = false;
    if (!saveTasks()) {
      task.done = true;
      return toToolResult(false, 'Failed to save', 'Could not write to tasks.json');
    }
    return toToolResult(true, `Task #${task.id} reopened`, `Title: ${task.title}`, task);
  },
};

export const taskRenameTool: Tool = {
  name: 'tasks.rename',
  description: 'Change the title of a task',
  risk: 'write',
  parameters: [
    { name: 'taskId', type: 'number', description: 'The task ID', required: true },
    { name: 'title',  type: 'string', description: 'The new title', required: true },
  ],
  execute: async (params) => {
    const parsed = z.object({ taskId: z.number(), title: z.string().min(1) }).safeParse(params);
    if (!parsed.success) {
      return toToolResult(false, 'Invalid parameters', parsed.error.message);
    }
    const task = getTaskById(parsed.data.taskId);
    if (!task) return toToolResult(false, 'Task not found', `No task with ID ${parsed.data.taskId}`);
    const oldTitle = task.title;
    task.title = parsed.data.title;
    if (!saveTasks()) {
      task.title = oldTitle;
      return toToolResult(false, 'Failed to save', 'Could not write to tasks.json');
    }
    return toToolResult(true, `Task #${task.id} renamed`, `${oldTitle} → ${task.title}`, task);
  },
};

export const taskPriorityTool: Tool = {
  name: 'tasks.priority',
  description: 'Set the priority of a task: urgent, medium, or normal',
  risk: 'write',
  parameters: [
    { name: 'taskId',   type: 'number', description: 'The task ID', required: true },
    { name: 'priority', type: 'string', description: 'urgent | medium | normal', required: true },
  ],
  execute: async (params) => {
    const parsed = z.object({
      taskId:   z.number(),
      priority: z.enum(['urgent', 'medium', 'normal']),
    }).safeParse(params);
    if (!parsed.success) {
      return toToolResult(false, 'Invalid parameters', 'priority must be: urgent | medium | normal');
    }
    const task = getTaskById(parsed.data.taskId);
    if (!task) return toToolResult(false, 'Task not found', `No task with ID ${parsed.data.taskId}`);
    const old = task.priority;
    task.priority = parsed.data.priority;
    if (!saveTasks()) {
      task.priority = old;
      return toToolResult(false, 'Failed to save', 'Could not write to tasks.json');
    }
    return toToolResult(true, `Task #${task.id} priority set to ${task.priority}`, `Title: ${task.title}`, task);
  },
};

export const taskDueTool: Tool = {
  name: 'tasks.due',
  description: 'Set or clear the due date of a task. date: today | tomorrow | YYYY-MM-DD | none',
  risk: 'write',
  parameters: [
    { name: 'taskId', type: 'number', description: 'The task ID', required: true },
    { name: 'date',   type: 'string', description: 'today | tomorrow | YYYY-MM-DD | none', required: true },
    { name: 'time',   type: 'string', description: 'Optional time HH:MM', required: false },
  ],
  execute: async (params) => {
    const parsed = z.object({
      taskId: z.number(),
      date:   z.string().min(1),
      time:   z.string().optional(),
    }).safeParse(params);
    if (!parsed.success) {
      return toToolResult(false, 'Invalid parameters', parsed.error.message);
    }
    const task = getTaskById(parsed.data.taskId);
    if (!task) return toToolResult(false, 'Task not found', `No task with ID ${parsed.data.taskId}`);

    const oldDue  = task.due;
    const oldTime = task.dueTime;

    const key = parsed.data.date.toLowerCase();
    if (['none', 'clear'].includes(key)) {
      task.due     = null;
      task.dueTime = null;
    } else {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      if (key === 'today') {
        task.due = ymd(now);
      } else if (key === 'tomorrow') {
        task.due = ymd(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
      } else {
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
        if (!m) {
          return toToolResult(false, 'Invalid date', 'Use: today | tomorrow | YYYY-MM-DD | none');
        }
        task.due = key;
      }
      if (parsed.data.time) {
        const t = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(parsed.data.time);
        if (!t) return toToolResult(false, 'Invalid time', 'Use HH:MM, for example 18:00');
        task.dueTime = `${parsed.data.time.padStart(5, '0')}`;
      } else {
        task.dueTime = null;
      }
    }

    if (!saveTasks()) {
      task.due     = oldDue;
      task.dueTime = oldTime;
      return toToolResult(false, 'Failed to save', 'Could not write to tasks.json');
    }
    const text = task.due === null ? 'no due date' : `due ${task.due}${task.dueTime ? ' ' + task.dueTime : ''}`;
    return toToolResult(true, `Task #${task.id}: ${text}`, `Title: ${task.title}`, task);
  },
};

export const taskLinkTool: Tool = {
  name: 'tasks.link',
  description: 'Link a task to a goal (or unlink by passing goalId 0)',
  risk: 'write',
  parameters: [
    { name: 'taskId', type: 'number', description: 'The task ID', required: true },
    { name: 'goalId', type: 'number', description: 'The goal ID (0 to unlink)', required: true },
  ],
  execute: async (params) => {
    const parsed = z.object({ taskId: z.number(), goalId: z.number() }).safeParse(params);
    if (!parsed.success) {
      return toToolResult(false, 'Invalid parameters', parsed.error.message);
    }
    const task = getTaskById(parsed.data.taskId);
    if (!task) return toToolResult(false, 'Task not found', `No task with ID ${parsed.data.taskId}`);

    const oldGoalId = task.goalId;

    if (parsed.data.goalId === 0) {
      task.goalId = null;
      if (!saveTasks()) {
        task.goalId = oldGoalId;
        return toToolResult(false, 'Failed to save', 'Could not write to tasks.json');
      }
      return toToolResult(true, `Task #${task.id} unlinked from goal`, `Title: ${task.title}`, task);
    }

    const goal = goals.find((g) => g.id === parsed.data.goalId);
    if (!goal) return toToolResult(false, 'Goal not found', `No goal with ID ${parsed.data.goalId}`);

    task.goalId = goal.id;
    if (!saveTasks()) {
      task.goalId = oldGoalId;
      return toToolResult(false, 'Failed to save', 'Could not write to tasks.json');
    }
    return toToolResult(true, `Task #${task.id} linked to goal #${goal.id}`, `Task: ${task.title}\nGoal: ${goal.title}`, task);
  },
};

// ── Sensitive (always confirms, ignoring AUTO_CONFIRM_WRITES) ─────────────

export const taskDeleteTool: Tool = {
  name: 'tasks.delete',
  description: 'Delete a task permanently — always requires user confirmation',
  risk: 'sensitive',
  parameters: [
    { name: 'taskId', type: 'number', description: 'The task ID', required: true },
  ],
  execute: async (params) => {
    const parsed = z.object({ taskId: z.number() }).safeParse(params);
    if (!parsed.success) {
      return toToolResult(false, 'Invalid parameters', parsed.error.message);
    }
    const taskIndex = tasks.findIndex((t) => t.id === parsed.data.taskId);
    if (taskIndex === -1) {
      return toToolResult(false, 'Task not found', `No task with ID ${parsed.data.taskId}`);
    }
    const task = tasks[taskIndex];

    // For sensitive tools, execute immediately (confirmation happens in agent loop)
    const removed = tasks.splice(taskIndex, 1);
    if (!saveTasks()) {
      tasks.splice(taskIndex, 0, ...removed);
      return toToolResult(false, 'Failed to delete', 'Could not write to tasks.json');
    }
    return toToolResult(true, `Task #${task.id} deleted`, `Title: ${task.title}`);
  },
};

export const taskTools = [
  taskListTool, taskAddTool, taskDoneTool, taskReopenTool,
  taskRenameTool, taskPriorityTool, taskDueTool, taskLinkTool,
  taskDeleteTool,
];
