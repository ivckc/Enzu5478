// Agent Loop - Orchestrates the AI agent workflow
// Changes vs. the old version:
//  1) tools are offered on EVERY iteration (the old one offered them only on the first)
//  2) ALL tool calls in a reply are executed (the old one ran only the first)
//  3) the model knows today's date/time (needed for "tomorrow", "Friday"...)
//  4) optional conversation history (so voice chat has memory)
//  5) it is told clearly to ACT through tools, not just describe
//  6) optional voice mode: short spoken-style answers
//  7) router: only the tool groups related to the request are sent (saves tokens)
//  8) workshop: picks a fast/heavy model per request and falls back if one hits its limit

import { getTool, listTools, registerTool } from './tools/registry';
import type { Tool } from './tools/types';
import {
  taskListTool, taskAddTool, taskDoneTool, taskReopenTool,
  taskRenameTool, taskPriorityTool, taskDueTool, taskLinkTool,
  taskDeleteTool,
} from './tools/adapters/tasks';
import { reminderListTool, reminderAddTool, reminderCancelTool } from './tools/adapters/reminders';
import { goalListTool, goalAddTool, goalRenameTool, goalDeleteTool } from './tools/adapters/goals';
import {
  habitListTool, habitAddTool, habitCheckTool, habitUncheckTool,
  habitRenameTool, habitDeleteTool,
} from './tools/adapters/habits';
import { SYSTEM_PROMPT, SYSTEM_PROMPT_AR } from './persona';
import { loadConfig } from './config';
import { requestConfirmation } from './confirmation';
import type { ConfirmFn } from './confirmation';
import { appendLog } from '../core/log';
import { pickGroups } from './router';
import type { ToolGroup } from './router';
import { workshopChat, pickRole } from './llm/workshop';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ToolCall = {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
};

export type AgentMessage = Record<string, unknown>;

export type AgentOptions = {
  /** Past turns (plain user/assistant text). The loop appends the new turn to it. */
  history?: AgentMessage[];
  /** true = the answer will be read aloud, so keep it short and plain. */
  voice?: boolean;
};

const MAX_HISTORY = 12; // keep an EVEN number (pairs of user/assistant)

// ---------------------------------------------------------------------------
// Prompt helpers
// ---------------------------------------------------------------------------

function nowInfo(): string {
  const tz = 'Asia/Baghdad';
  const d = new Date();
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d); // YYYY-MM-DD
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(d);
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'long' }).format(d);
  return (
    `Current date: ${date} (${weekday}), time: ${time} (Asia/Baghdad). ` +
    `Use it to turn words like "today", "tomorrow", "next Friday" into YYYY-MM-DD dates.`
  );
}

const CONTROL_RULES = `
You control the ANZU app through the tools you are given.
- When the user asks you to DO something (add, change, finish, list, check, remind...), call the matching tool. Do not only describe what you would do.
- You may call several tools in one turn when the request needs it.
- Never say something was done unless a tool result confirms it. If a tool fails, say so honestly.
- For deletions the app asks the user to confirm by itself; just call the tool.
- If the request is unclear, ask ONE short question.`;

const VOICE_RULES = `
The user is talking to you by voice and your answer will be read aloud: reply in short, natural spoken sentences. No markdown, no bullet lists, no tables, no emojis.`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function needsUserConfirmation(tool: Tool, autoConfirm: boolean): boolean {
  if (tool.risk === 'read') return false;
  if (tool.risk === 'sensitive') return true; // always confirm deletions
  return !autoConfirm;
}

function parseToolArgs(args: string): Record<string, unknown> {
  try {
    return JSON.parse(args);
  } catch {
    return {};
  }
}

function formatToolResult(result: { ok: boolean; summary: string; detail?: string; error?: string }): string {
  if (!result.ok) {
    if (result.error === 'CONFIRMATION_REQUIRED') {
      return `This action needs confirmation: "${result.summary}"`;
    }
    return `Error: ${result.error ?? 'Unknown error'}`;
  }
  return result.detail ? `${result.summary}\n\n${result.detail}` : result.summary;
}

function detectLanguage(text: string): 'ar' | 'en' {
  return /[؀-ۿ]/.test(text) ? 'ar' : 'en';
}

function remember(history: AgentMessage[] | undefined, user: string, assistant: string): void {
  if (!history) return;
  history.push({ role: 'user', content: user }, { role: 'assistant', content: assistant });
  while (history.length > MAX_HISTORY) history.shift();
}

// ---------------------------------------------------------------------------
// Tool registration (idempotent)
// ---------------------------------------------------------------------------

let toolsRegistered = false;

function ensureToolsRegistered(): void {
  if (toolsRegistered) return;
  const tools = [
    // tasks
    taskListTool, taskAddTool, taskDoneTool, taskReopenTool,
    taskRenameTool, taskPriorityTool, taskDueTool, taskLinkTool,
    taskDeleteTool,
    // goals
    goalListTool, goalAddTool, goalRenameTool, goalDeleteTool,
    // habits
    habitListTool, habitAddTool, habitCheckTool, habitUncheckTool,
    habitRenameTool, habitDeleteTool,
    // reminders
    reminderListTool, reminderAddTool, reminderCancelTool,
  ];
  for (const tool of tools) {
    try { registerTool(tool); } catch { /* already registered */ }
  }
  toolsRegistered = true;
}

// Which tool names belong to which group (used by the router)
const TOOL_GROUPS: Record<ToolGroup, string[]> = {
  tasks: [
    taskListTool, taskAddTool, taskDoneTool, taskReopenTool,
    taskRenameTool, taskPriorityTool, taskDueTool, taskLinkTool, taskDeleteTool,
  ].map((t) => t.name),
  goals: [goalListTool, goalAddTool, goalRenameTool, goalDeleteTool].map((t) => t.name),
  habits: [
    habitListTool, habitAddTool, habitCheckTool, habitUncheckTool,
    habitRenameTool, habitDeleteTool,
  ].map((t) => t.name),
  reminders: [reminderListTool, reminderAddTool, reminderCancelTool].map((t) => t.name),
};

function buildToolsSchema(only?: string[]) {
  ensureToolsRegistered();
  return listTools()
    .filter((name) => !only || only.includes(name))
    .map((name) => {
      const r = getTool(name);
      if (!r.ok || !r.tool) return null;
      const t = r.tool;
      return {
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: {
            type: 'object' as const,
            properties: t.parameters.reduce<Record<string, { type: string; description: string }>>(
              (acc, p) => {
                acc[p.name] = { type: p.type, description: p.description };
                return acc;
              },
              {},
            ),
            required: t.parameters.filter((p) => p.required !== false).map((p) => p.name),
          },
        },
      };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);
}

// ---------------------------------------------------------------------------
// Run ONE tool call (confirmation -> execute -> log). Returns the text for the model.
// ---------------------------------------------------------------------------

async function runOneTool(
  tc: ToolCall,
  autoConfirm: boolean,
  confirmFn: ConfirmFn,
): Promise<string> {
  const toolName = tc.function?.name ?? '';
  const params = parseToolArgs(tc.function?.arguments ?? '{}');

  const lookup = getTool(toolName);
  if (!lookup.ok || !lookup.tool) return `الأداة "${toolName}" غير موجودة.`;
  const tool = lookup.tool;

  if (needsUserConfirmation(tool, autoConfirm)) {
    const confirmation = await requestConfirmation(
      {
        toolName: tool.name,
        summary: `تنفيذ ${tool.name} بالمعطيات: ${JSON.stringify(params)}`,
        detail: tool.description,
      },
      confirmFn,
    );
    if (!confirmation.approved) return `ألغى المستخدم تنفيذ ${tool.name}.`;
  }

  let execResult: { ok: boolean; summary: string; detail?: string; error?: string };
  try {
    execResult = await tool.execute(params);
  } catch (e: unknown) {
    execResult = { ok: false, summary: tool.name, error: e instanceof Error ? e.message : String(e) };
  }

  appendLog({
    time: new Date().toISOString(),
    actor: 'anzu',
    action: `agent.${tool.name}`,
    detail: JSON.stringify(params),
    ok: execResult.ok,
  });

  return formatToolResult(execResult);
}

// ---------------------------------------------------------------------------
// Main agent loop
// ---------------------------------------------------------------------------

/**
 * @param input     - what the user said or typed
 * @param confirmFn - shows a question and returns true/false
 * @param opts      - optional: { history, voice }
 */
export async function runAgentLoop(
  input: string,
  confirmFn: ConfirmFn,
  opts: AgentOptions = {},
): Promise<string> {
  const config = loadConfig();

  if (!config.llm.baseUrl || !config.llm.model || !config.llm.apiKey) {
    const missing: string[] = [];
    if (!config.llm.baseUrl) missing.push('ANZU_LLM_BASE_URL');
    if (!config.llm.model)   missing.push('ANZU_LLM_MODEL');
    if (!config.llm.apiKey)  missing.push('ANZU_LLM_API_KEY');
    return (
      '⚠️  الذكاء الاصطناعي غير مفعّل.\n' +
      'المتغيرات الناقصة في ملف .env:\n' +
      missing.map((v) => `  - ${v}`).join('\n') +
      '\n\nانسخ .env.example إلى .env وأضف قيمك.'
    );
  }

  ensureToolsRegistered();

  // Router: send only the tool groups related to this request (no LLM call, zero tokens)
  const groups = pickGroups(input);
  const allowed = groups === 'all' ? undefined : groups.flatMap((g) => TOOL_GROUPS[g]);
  const toolsSchema = buildToolsSchema(allowed);

  const lang = detectLanguage(input);
  const role = pickRole(input); // 'fast' or 'heavy' model

  const system =
    (lang === 'ar' ? SYSTEM_PROMPT_AR : SYSTEM_PROMPT) +
    '\n\n' + nowInfo() +
    '\n' + CONTROL_RULES +
    (opts.voice ? '\n' + VOICE_RULES : '');

  const messages: AgentMessage[] = [
    { role: 'system', content: system },
    ...(opts.history ?? []),
    { role: 'user', content: input },
  ];

  const maxIterations = Math.max(config.maxIterations ?? 5, 3);

  for (let i = 0; i < maxIterations; i++) {
    const lastTurn = i === maxIterations - 1; // force a plain answer on the last round

    let response: any;
    try {
      response = await workshopChat(role, {
        messages,
        tools: toolsSchema,
        tool_choice: lastTurn ? 'none' : 'auto',
      });
    } catch (e: unknown) {
      return `خطأ في الاتصال بالنموذج: ${e instanceof Error ? e.message : String(e)}`;
    }

    const usage = response?.usage;
    if (usage) {
      console.log(
        `[tokens] ${response.__model} round ${i + 1}: prompt=${usage.prompt_tokens} completion=${usage.completion_tokens} tools=${toolsSchema.length}`,
      );
    }

    const choice = response.choices?.[0];
    if (!choice) return 'لم يرجع النموذج أي رد.';

    const msg = choice.message as any;
    const toolCalls: ToolCall[] = Array.isArray(msg?.tool_calls) ? msg.tool_calls : [];

    // No tool calls -> this is the final answer
    if (toolCalls.length === 0) {
      const text = String(msg?.content ?? '').trim() || 'لم يرجع النموذج أي رد.';
      remember(opts.history, input, text);
      return text;
    }

    // One assistant message that lists ALL the tool calls...
    messages.push({
      role: 'assistant',
      content: msg?.content ?? null,
      tool_calls: toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.function?.name ?? '', arguments: tc.function?.arguments ?? '{}' },
      })),
    });

    // ...then one tool result for each call, in order
    for (const tc of toolCalls) {
      const content = await runOneTool(tc, config.autoConfirmWrites, confirmFn);
      messages.push({ role: 'tool', tool_call_id: tc.id, content });
    }
  }

  const limitMsg = `وصلت للحد الأقصى من المحاولات (${maxIterations}).`;
  remember(opts.history, input, limitMsg);
  return limitMsg;
}

// ---------------------------------------------------------------------------
// Test exports
// ---------------------------------------------------------------------------
export const __testExports = {
  needsUserConfirmation,
  parseToolArgs,
  formatToolResult,
  detectLanguage,
  ensureToolsRegistered,
};