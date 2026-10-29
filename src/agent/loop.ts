// Agent Loop - Orchestrates the AI agent workflow

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
import { OpenAICompatibleProvider } from './llm/openai';

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

// ---------------------------------------------------------------------------
// LLM provider (singleton per call to avoid re-reading env each iteration)
// ---------------------------------------------------------------------------

function buildToolsSchema() {
  ensureToolsRegistered();
  return listTools()
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
// Main agent loop
// ---------------------------------------------------------------------------

/**
 * Run the agent loop.
 *
 * @param input     - what the user typed after "ask "
 * @param confirmFn - callback that shows a question and returns true/false.
 *                    Injected by module.ts so the main readline loop handles it.
 */
export async function runAgentLoop(input: string, confirmFn: ConfirmFn): Promise<string> {
  const config = loadConfig();

  // Check LLM configuration before doing anything
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
  const toolsSchema = buildToolsSchema();
  const provider = new OpenAICompatibleProvider('anzu-llm');
  const lang = detectLanguage(input);

  const messages: Array<Record<string, unknown>> = [
    { role: 'system', content: lang === 'ar' ? SYSTEM_PROMPT_AR : SYSTEM_PROMPT },
    { role: 'user',   content: input },
  ];

  const maxIterations = config.maxIterations;

  for (let i = 0; i < maxIterations; i++) {
    let response: Awaited<ReturnType<typeof provider.chat>>;
    try {
      response = await provider.chat({
        messages: messages as Parameters<typeof provider.chat>[0]['messages'],
        tools: i === 0 ? toolsSchema : undefined,
        tool_choice: i === 0 ? 'auto' : 'none',
      });
    } catch (e: unknown) {
      return `خطأ في الاتصال بالنموذج: ${e instanceof Error ? e.message : String(e)}`;
    }

    const choice = response.choices?.[0];
    if (!choice) return 'لم يرجع النموذج أي رد.';

    const toolCall: ToolCall | undefined = (choice.message as any)?.tool_calls?.[0];

    // ── No tool call → direct answer ──────────────────────────────────────
    if (!toolCall) {
      return (choice.message as any)?.content ?? 'لم يرجع النموذج أي رد.';
    }

    // ── Tool call ─────────────────────────────────────────────────────────
    const toolName = toolCall.function?.name ?? '';
    const params   = parseToolArgs(toolCall.function?.arguments ?? '{}');

    const toolLookup = getTool(toolName);
    const assistantMsg = {
      role: 'assistant',
      content: null,
      tool_calls: [{
        id: toolCall.id,
        type: 'function',
        function: { name: toolName, arguments: toolCall.function?.arguments ?? '{}' },
      }],
    };

    if (!toolLookup.ok || !toolLookup.tool) {
      messages.push(assistantMsg);
      messages.push({ role: 'tool', tool_call_id: toolCall.id, content: `الأداة "${toolName}" غير موجودة.` });
      continue;
    }

    const tool = toolLookup.tool;

    // ── Confirmation if needed ────────────────────────────────────────────
    if (needsUserConfirmation(tool, config.autoConfirmWrites)) {
      const confirmation = await requestConfirmation(
        {
          toolName: tool.name,
          summary: `تنفيذ ${tool.name} بالمعطيات: ${JSON.stringify(params)}`,
          detail: tool.description,
        },
        confirmFn,
      );

      if (!confirmation.approved) {
        messages.push(assistantMsg);
        messages.push({ role: 'tool', tool_call_id: toolCall.id, content: `ألغى المستخدم تنفيذ ${tool.name}.` });
        continue;
      }
    }

    // ── Execute ───────────────────────────────────────────────────────────
    const execResult = await tool.execute(params);

    appendLog({
      time: new Date().toISOString(),
      actor: 'anzu',
      action: `agent.${tool.name}`,
      detail: JSON.stringify(params),
      ok: execResult.ok,
    });

    messages.push(assistantMsg);
    messages.push({ role: 'tool', tool_call_id: toolCall.id, content: formatToolResult(execResult) });
  }

  return `وصلت للحد الأقصى من المحاولات (${maxIterations}).`;
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
