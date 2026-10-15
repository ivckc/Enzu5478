// Habit Tools - Wrappers for habits module commands

import * as z from 'zod';
import type { Tool } from '../types';
import { habits, save } from '../../../modules/habits';

// Helper to convert Result to ToolResult
function toToolResult(
  ok: boolean,
  summary: string,
  detail?: string,
  data?: unknown,
): { ok: boolean; summary: string; detail?: string; data?: unknown } {
  return { ok, summary, detail, data };
}

// Helper to get today's date in YYYY-MM-DD format
function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Shift helper for habit calculations
function shift(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00`);
  d.setDate(d.getDate() + n);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Helper to calculate habit stats
function stats(h: typeof habits[0]): { streak: number } {
  const set = new Set(h.days);
  const t = today();
  const cur = set.has(t) ? t : shift(t, -1);
  let streak = 0;
  let current = cur;
  while (set.has(current)) {
    streak++;
    current = shift(current, -1);
  }
  return { streak };
}

// Habit List Tool - Read
export const habitListTool: Tool = {
  name: 'habits.list',
  description: 'List all habits with their current streak',
  risk: 'read',
  parameters: [],
  execute: async (): Promise<{ ok: boolean; summary: string; detail?: string; data?: unknown }> => {
    if (habits.length === 0) {
      return toToolResult(true, 'No habits found', 'There are no habits yet');
    }

    const t = today();
    const lines = habits.map((h) => {
      const s = stats(h);
      const doneToday = h.days.includes(t) ? '[x]' : '[ ]';
      return `${h.id}. ${doneToday} ${h.title}  (streak ${s.streak})`;
    });

    return toToolResult(true, `Found ${habits.length} habit(s)`, lines.join('\n'), habits);
  },
};

// Habit Check Tool - Write
export const habitCheckTool: Tool = {
  name: 'habits.check',
  description: 'Mark a habit as done for a specific day',
  risk: 'write',
  parameters: [
    { name: 'habitId', type: 'number', description: 'The habit ID', required: true },
    { name: 'day', type: 'string', description: 'The day to mark (today, yesterday, or YYYY-MM-DD)', required: false },
  ],
  execute: async (params): Promise<{ ok: boolean; summary: string; detail?: string; data?: unknown }> => {
    const schema = z.object({
      habitId: z.number(),
      day: z.string().optional(),
    });
    const parsed = schema.safeParse(params);

    if (!parsed.success) {
      return toToolResult(false, 'Invalid parameters', `Missing or invalid parameters: ${parsed.error.message}`);
    }

    const habit = habits.find((h) => h.id === parsed.data.habitId);
    if (!habit) {
      return toToolResult(false, 'Habit not found', `No habit with ID ${parsed.data.habitId}`);
    }

    const day = parsed.data.day || today();

    if (habit.days.includes(day)) {
      return toToolResult(false, 'Already checked', `Habit ${habit.id} is already marked for ${day}`);
    }

    const oldDays = [...habit.days];
    habit.days = [...habit.days, day].sort();

    if (!save()) {
      habit.days = oldDays;
      return toToolResult(false, 'Failed to save', 'Could not write to habits.json');
    }

    const s = stats(habit);

    return toToolResult(
      true,
      `Habit ${habit.id} checked`,
      `Day: ${day}\nStreak: ${s.streak} day(s)`,
      habit,
    );
  },
};

// Export tools for registration
export const habitTools = [habitListTool, habitCheckTool];
