// Habit Tools - Full set of wrappers for habits module commands

import * as z from 'zod';
import type { Tool } from '../types';
import { habits, save } from '../../../modules/habits';
import { nextIdFor } from '../../../core/storage';

function toToolResult(
  ok: boolean,
  summary: string,
  detail?: string,
  data?: unknown,
): { ok: boolean; summary: string; detail?: string; data?: unknown } {
  return { ok, summary, detail, data };
}

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function shift(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + n);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function streak(h: typeof habits[0]): number {
  const set = new Set(h.days);
  const t   = today();
  let cur   = set.has(t) ? t : shift(t, -1);
  let count = 0;
  while (set.has(cur)) { count++; cur = shift(cur, -1); }
  return count;
}

// Resolve "today" / "yesterday" / YYYY-MM-DD; returns error string on failure
function resolveDay(raw: string | undefined): string | { error: string } {
  const t = today();
  if (!raw || raw === 'today')     return t;
  if (raw === 'yesterday')         return shift(t, -1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    if (raw > t) return { error: 'A habit cannot be marked for a future day' };
    return raw;
  }
  return { error: 'Use: today | yesterday | YYYY-MM-DD' };
}

// ── Read ──────────────────────────────────────────────────────────────────

export const habitListTool: Tool = {
  name: 'habits.list',
  description: 'List all habits with their current streak and today\'s status',
  risk: 'read',
  parameters: [],
  execute: async () => {
    if (habits.length === 0) {
      return toToolResult(true, 'No habits found', 'There are no habits yet');
    }
    const t     = today();
    const lines = habits.map((h) => {
      const done = h.days.includes(t) ? '[x]' : '[ ]';
      return `${h.id}. ${done} ${h.title}  (streak ${streak(h)})`;
    });
    return toToolResult(true, `Found ${habits.length} habit(s)`, lines.join('\n'), habits);
  },
};

// ── Write ─────────────────────────────────────────────────────────────────

export const habitAddTool: Tool = {
  name: 'habits.add',
  description: 'Add a new habit to track',
  risk: 'write',
  parameters: [
    { name: 'title', type: 'string', description: 'The habit title', required: true },
  ],
  execute: async (params) => {
    const parsed = z.object({ title: z.string().min(1) }).safeParse(params);
    if (!parsed.success) {
      return toToolResult(false, 'Invalid parameters', parsed.error.message);
    }
    const habit = {
      id:      nextIdFor(habits),
      userId:  'local',
      title:   parsed.data.title,
      note:    '',
      days:    [] as string[],
      created: today(),
    };
    habits.push(habit);
    if (!save()) {
      habits.pop();
      return toToolResult(false, 'Failed to save habit', 'Could not write to habits.json');
    }
    return toToolResult(true, `Habit #${habit.id} added`, `Title: ${habit.title}`, habit);
  },
};

export const habitCheckTool: Tool = {
  name: 'habits.check',
  description: 'Mark a habit as done for today or a specific day',
  risk: 'write',
  parameters: [
    { name: 'habitId', type: 'number', description: 'The habit ID', required: true },
    { name: 'day',     type: 'string', description: 'today | yesterday | YYYY-MM-DD (default: today)', required: false },
  ],
  execute: async (params) => {
    const parsed = z.object({ habitId: z.number(), day: z.string().optional() }).safeParse(params);
    if (!parsed.success) return toToolResult(false, 'Invalid parameters', parsed.error.message);

    const habit = habits.find((h) => h.id === parsed.data.habitId);
    if (!habit) return toToolResult(false, 'Habit not found', `No habit with ID ${parsed.data.habitId}`);

    const day = resolveDay(parsed.data.day);
    if (typeof day !== 'string') return toToolResult(false, 'Invalid day', day.error);
    if (habit.days.includes(day)) return toToolResult(false, 'Already checked', `Habit #${habit.id} is already marked for ${day}`);

    const old = [...habit.days];
    habit.days = [...habit.days, day].sort();
    if (!save()) {
      habit.days = old;
      return toToolResult(false, 'Failed to save', 'Could not write to habits.json');
    }
    return toToolResult(true, `Habit #${habit.id} checked for ${day}`, `Streak: ${streak(habit)} day(s)`, habit);
  },
};

export const habitUncheckTool: Tool = {
  name: 'habits.uncheck',
  description: 'Remove the check mark from a habit for today or a specific day',
  risk: 'write',
  parameters: [
    { name: 'habitId', type: 'number', description: 'The habit ID', required: true },
    { name: 'day',     type: 'string', description: 'today | yesterday | YYYY-MM-DD (default: today)', required: false },
  ],
  execute: async (params) => {
    const parsed = z.object({ habitId: z.number(), day: z.string().optional() }).safeParse(params);
    if (!parsed.success) return toToolResult(false, 'Invalid parameters', parsed.error.message);

    const habit = habits.find((h) => h.id === parsed.data.habitId);
    if (!habit) return toToolResult(false, 'Habit not found', `No habit with ID ${parsed.data.habitId}`);

    const day = resolveDay(parsed.data.day);
    if (typeof day !== 'string') return toToolResult(false, 'Invalid day', day.error);
    if (!habit.days.includes(day)) return toToolResult(false, 'Not checked', `Habit #${habit.id} was not marked for ${day}`);

    const old = [...habit.days];
    habit.days = habit.days.filter((d) => d !== day);
    if (!save()) {
      habit.days = old;
      return toToolResult(false, 'Failed to save', 'Could not write to habits.json');
    }
    return toToolResult(true, `Habit #${habit.id} unchecked for ${day}`, `Title: ${habit.title}`, habit);
  },
};

export const habitRenameTool: Tool = {
  name: 'habits.rename',
  description: 'Change the title of a habit',
  risk: 'write',
  parameters: [
    { name: 'habitId', type: 'number', description: 'The habit ID', required: true },
    { name: 'title',   type: 'string', description: 'The new title', required: true },
  ],
  execute: async (params) => {
    const parsed = z.object({ habitId: z.number(), title: z.string().min(1) }).safeParse(params);
    if (!parsed.success) return toToolResult(false, 'Invalid parameters', parsed.error.message);

    const habit = habits.find((h) => h.id === parsed.data.habitId);
    if (!habit) return toToolResult(false, 'Habit not found', `No habit with ID ${parsed.data.habitId}`);

    const old = habit.title;
    habit.title = parsed.data.title;
    if (!save()) {
      habit.title = old;
      return toToolResult(false, 'Failed to save', 'Could not write to habits.json');
    }
    return toToolResult(true, `Habit #${habit.id} renamed`, `${old} → ${habit.title}`, habit);
  },
};

// ── Sensitive (always confirms, ignoring AUTO_CONFIRM_WRITES) ─────────────

export const habitDeleteTool: Tool = {
  name: 'habits.delete',
  description: 'Delete a habit permanently — always requires user confirmation. All tracked days will be lost.',
  risk: 'sensitive',
  parameters: [
    { name: 'habitId', type: 'number', description: 'The habit ID', required: true },
  ],
  execute: async (params) => {
    const parsed = z.object({ habitId: z.number() }).safeParse(params);
    if (!parsed.success) return toToolResult(false, 'Invalid parameters', parsed.error.message);

    const index = habits.findIndex((h) => h.id === parsed.data.habitId);
    if (index === -1) return toToolResult(false, 'Habit not found', `No habit with ID ${parsed.data.habitId}`);

    const habit   = habits[index];
    const removed = habits.splice(index, 1);
    if (!save()) {
      habits.splice(index, 0, ...removed);
      return toToolResult(false, 'Failed to delete', 'Could not write to habits.json');
    }
    return toToolResult(true, `Habit #${habit.id} deleted`, `Title: ${habit.title}\n${habit.days.length} tracked day(s) removed`);
  },
};

export const habitTools = [
  habitListTool, habitAddTool, habitCheckTool, habitUncheckTool,
  habitRenameTool, habitDeleteTool,
];
