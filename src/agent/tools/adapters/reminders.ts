// Reminder Tools - Wrappers for reminders module commands

import * as z from 'zod';
import type { Tool } from '../types';
import { reminders, parseWhen } from '../../../modules/reminders';
import { saveReminders } from '../../../core/storage';
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

// Reminder Add Tool - Write
export const reminderAddTool: Tool = {
  name: 'reminders.add',
  description: 'Add a new reminder with text and time',
  risk: 'write',
  parameters: [
    { name: 'text', type: 'string', description: 'The reminder text', required: true },
    { name: 'at', type: 'string', description: 'When to trigger (e.g., "tomorrow 5pm", "in 2h")', required: true },
  ],
  execute: async (params): Promise<{ ok: boolean; summary: string; detail?: string; data?: unknown }> => {
    const schema = z.object({
      text: z.string().min(1),
      at: z.string().min(1),
    });
    const parsed = schema.safeParse(params);

    if (!parsed.success) {
      return toToolResult(false, 'Invalid parameters', `Missing or invalid parameters: ${parsed.error.message}`);
    }

    const current = new Date();
    const parsedWhen = parseWhen(`${parsed.data.at} ${parsed.data.text}`, current);

    if ('error' in parsedWhen) {
      return toToolResult(false, 'Invalid time format', parsedWhen.error.join('\n'));
    }

    const reminder = {
      id: nextIdFor(reminders),
      userId: 'local',
      text: parsedWhen.text,
      at: parsedWhen.at.toISOString(),
      status: 'pending',
      firedAt: null,
    };

    reminders.push(reminder);

    if (!saveReminders()) {
      reminders.pop();
      return toToolResult(false, 'Failed to save reminder', 'Could not write to reminders.json');
    }

    const dueDate = new Date(parsedWhen.at);
    const nowMs = Date.now();
    const waitMs = dueDate.getTime() - nowMs;
    const totalMin = Math.max(0, Math.round(waitMs / 60000));
    let waitText = '';
    if (totalMin < 1) {
      waitText = 'in less than a minute';
    } else if (totalMin < 1440) {
      const hours = Math.floor(totalMin / 60);
      const mins = totalMin % 60;
      waitText = `in ${hours > 0 ? hours + 'h' : ''} ${mins > 0 ? mins + 'm' : ''}`;
    } else {
      const days = Math.floor(totalMin / 1440);
      waitText = `in ${days} days`;
    }

    return toToolResult(
      true,
      `Reminder #${reminder.id} set`,
      `Due: ${dueDate.toLocaleString()} (${waitText})\nText: ${reminder.text}`,
      reminder,
    );
  },
};

// Export tools for registration
export const reminderTools = [reminderAddTool];
