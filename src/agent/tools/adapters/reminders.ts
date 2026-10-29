// Reminder Tools - Full set of wrappers for reminders module commands

import * as z from 'zod';
import type { Tool } from '../types';
import { reminders, saveReminders, parseWhen } from '../../../modules/reminders';
import { nextIdFor } from '../../../core/storage';

function toToolResult(
  ok: boolean,
  summary: string,
  detail?: string,
  data?: unknown,
): { ok: boolean; summary: string; detail?: string; data?: unknown } {
  return { ok, summary, detail, data };
}

function formatWait(ms: number): string {
  const totalMin = Math.max(0, Math.round(ms / 60000));
  if (totalMin < 1)    return 'in less than a minute';
  if (totalMin < 1440) {
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `in ${h > 0 ? h + 'h ' : ''}${m > 0 ? m + 'm' : ''}`.trim();
  }
  return `in ${Math.floor(totalMin / 1440)} day(s)`;
}

// ── Read ──────────────────────────────────────────────────────────────────

export const reminderListTool: Tool = {
  name: 'reminders.list',
  description: 'List all pending reminders with their due time',
  risk: 'read',
  parameters: [],
  execute: async () => {
    const pending = reminders.filter((r) => r.status === 'pending');
    if (pending.length === 0) {
      return toToolResult(true, 'No pending reminders', 'All reminders have fired or been cancelled');
    }
    const now   = Date.now();
    const lines = pending
      .slice()
      .sort((a, b) => a.at.localeCompare(b.at))
      .map((r) => {
        const due  = new Date(r.at);
        const wait = due.getTime() > now ? formatWait(due.getTime() - now) : '(overdue)';
        return `${r.id}. ${r.text}  —  ${due.toLocaleString()} ${wait}`;
      });
    return toToolResult(true, `Found ${pending.length} pending reminder(s)`, lines.join('\n'), pending);
  },
};

// ── Write ─────────────────────────────────────────────────────────────────

export const reminderAddTool: Tool = {
  name: 'reminders.add',
  description: 'Add a new reminder. Format: "in 2h Call Ahmed" or "tomorrow 18:00 Doctor appointment" or "at 09:30 Meeting"',
  risk: 'write',
  parameters: [
    { name: 'when', type: 'string', description: 'Time expression + reminder text, e.g. "in 30m Buy milk" or "tomorrow 09:00 Call mom"', required: true },
  ],
  execute: async (params) => {
    const parsed = z.object({ when: z.string().min(1) }).safeParse(params);
    if (!parsed.success) {
      return toToolResult(false, 'Invalid parameters', parsed.error.message);
    }

    const parsedWhen = parseWhen(parsed.data.when, new Date());
    if ('error' in parsedWhen) {
      return toToolResult(false, 'Invalid time format', parsedWhen.error.join('\n'));
    }

    const reminder = {
      id:      nextIdFor(reminders),
      userId:  'local',
      text:    parsedWhen.text,
      at:      parsedWhen.at.toISOString(),
      status:  'pending' as const,
      firedAt: null,
    };

    reminders.push(reminder);
    if (!saveReminders()) {
      reminders.pop();
      return toToolResult(false, 'Failed to save reminder', 'Could not write to reminders.json');
    }

    const wait = formatWait(parsedWhen.at.getTime() - Date.now());
    return toToolResult(
      true,
      `Reminder #${reminder.id} set`,
      `Text: ${reminder.text}\nDue: ${parsedWhen.at.toLocaleString()} (${wait})`,
      reminder,
    );
  },
};

export const reminderCancelTool: Tool = {
  name: 'reminders.cancel',
  description: 'Cancel a pending reminder by its ID',
  risk: 'write',
  parameters: [
    { name: 'reminderId', type: 'number', description: 'The reminder ID', required: true },
  ],
  execute: async (params) => {
    const parsed = z.object({ reminderId: z.number() }).safeParse(params);
    if (!parsed.success) {
      return toToolResult(false, 'Invalid parameters', parsed.error.message);
    }

    const reminder = reminders.find((r) => r.id === parsed.data.reminderId);
    if (!reminder) {
      return toToolResult(false, 'Reminder not found', `No reminder with ID ${parsed.data.reminderId}`);
    }
    if (reminder.status !== 'pending') {
      return toToolResult(false, 'Already done', `Reminder #${reminder.id} is already ${reminder.status}`);
    }

    const old = reminder.status;
    reminder.status = 'cancelled';
    if (!saveReminders()) {
      reminder.status = old;
      return toToolResult(false, 'Failed to save', 'Could not write to reminders.json');
    }
    return toToolResult(true, `Reminder #${reminder.id} cancelled`, `Text: ${reminder.text}`, reminder);
  },
};

export const reminderTools = [reminderListTool, reminderAddTool, reminderCancelTool];
