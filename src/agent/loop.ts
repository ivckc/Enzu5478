// Agent Loop - Orchestrates the AI agent workflow

import { getTool, listTools, registerTool } from './tools/registry';
import type { Tool } from './tools/types';
import type { ToolExecuteResult } from './tools/tool';
import { taskListTool, taskAddTool, taskDoneTool, taskDeleteTool } from './tools/adapters/tasks';
import { reminderAddTool } from './tools/adapters/reminders';
import { goalListTool } from './tools/adapters/goals';
import { habitListTool, habitCheckTool } from './tools/adapters/habits';
import { SYSTEM_PROMPT, SYSTEM_PROMPT_AR } from './persona';
import { loadConfig } from './config';
import { requestConfirmation } from './confirmation';
import { appendLog } from '../core/log';
import { OpenAICompatibleProvider } from './llm/openai';

// Type for tool call from LLM
type ToolCall = {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
};

// Type for tool message to LLM
type ToolMessage = {
  role: 'tool';
  tool_call_id: string;
  content: string;
};

/**
 * Check if we need to ask for user confirmation before executing a tool
 */
function needsUserConfirmation(tool: Tool, config: any): boolean {
  if (tool.risk === 'read') {
    return false;
  }
  if (tool.risk === 'sensitive') {
    // Sensitive tools ALWAYS require confirmation
    return true;
  }
  // Write tools: check config
  return !config.autoConfirmWrites;
}

/**
 * Parse tool arguments from JSON string
 */
function parseToolArgs(args: string): Record<string, unknown> {
  try {
    return JSON.parse(args);
  } catch {
    return {};
  }
}

/**
 * Convert tool execution result to message for LLM
 */
function formatToolResult(toolResult: ToolExecuteResult): string {
  if (!toolResult.ok) {
    if (toolResult.error === 'CONFIRMATION_REQUIRED') {
      return `This action requires user confirmation. Please ask the user: "${toolResult.summary}"`;
    }
    return `Error: ${toolResult.error || 'Unknown error'}`;
  }
  return `${toolResult.summary}${toolResult.detail ? '\n\nDetail:\n' + toolResult.detail : ''}`;
}

/**
 * Register all tools
 */
function registerAllTools(): void {
  const tools = [
    taskListTool, taskAddTool, taskDoneTool, taskDeleteTool,
    reminderAddTool,
    goalListTool,
    habitListTool, habitCheckTool,
  ];
  for (const tool of tools) {
    try {
      registerTool(tool);
    } catch (e) {
      // Tool already registered or registry not loaded
    }
  }
}

/**
 * Execute a tool
 */
async function executeTool(tool: Tool, params: Record<string, unknown>): Promise<ToolExecuteResult> {
  return tool.execute(params);
}

/**
 * Detect if input is Arabic
 */
function detectLanguage(text: string): 'ar' | 'en' {
  const arabicRegex = /[؀-ۿ]/;
  return arabicRegex.test(text) ? 'ar' : 'en';
}

/**
 * Get LLM provider instance
 */
function getLLMProvider(): OpenAICompatibleProvider {
  return new OpenAICompatibleProvider('anzu-llm');
}

/**
 * The main agent loop
 * Processes user input, calls LLM, executes tools, and returns results
 */
export async function runAgentLoop(input: string): Promise<string> {
  const config = loadConfig();

  // Check if LLM is configured
  if (!config.llm.baseUrl || !config.llm.model || !config.llm.apiKey) {
    return 'Error: LLM is not configured. Please set ANZU_LLM_BASE_URL, ANZU_LLM_MODEL, and ANZU_LLM_API_KEY.';
  }

  // Register all tools
  registerAllTools();

  // Build tools list for LLM
  const registeredTools = listTools();
  const tools = registeredTools
    .map((toolName) => {
      const toolResult = getTool(toolName);
      if (!toolResult.ok || !toolResult.tool) {
        return null;
      }
      const tool = toolResult.tool;
      return {
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: {
            type: 'object' as const,
            properties: tool.parameters.reduce((acc: any, param: any) => {
              acc[param.name] = {
                type: param.type === 'string' ? 'string' : param.type === 'number' ? 'number' : 'boolean',
                description: param.description,
              };
              return acc;
            }, {}),
            required: tool.parameters.filter((p: any) => p.required !== false).map((p: any) => p.name),
          },
        },
      };
    })
    .filter((t): t is any => t !== null);

  // Build initial messages
  const messages: any[] = [
    { role: 'system' as const, content: detectLanguage(input) === 'ar' ? SYSTEM_PROMPT_AR : SYSTEM_PROMPT },
    { role: 'user' as const, content: input },
  ];

  let iteration = 0;
  const maxIterations = config.maxIterations;

  while (iteration < maxIterations) {
    iteration++;

    try {
      // Call LLM
      const provider = getLLMProvider();
      const response = await provider.chat({
        messages,
        tools: iteration === 1 ? tools : undefined,
        tool_choice: iteration === 1 ? 'auto' : 'none',
      });

      const choice = response.choices?.[0];
      if (!choice) {
        return 'Error: No response from LLM';
      }

      // Check if LLM wants to use a tool
      const toolCall = choice.message?.tool_calls?.[0];
      if (toolCall) {
        const toolName = toolCall.function?.name;
        const params = parseToolArgs(toolCall.function?.arguments || '{}');

        // Get the tool
        const toolResult = getTool(toolName || '');
        if (!toolResult.ok || !toolResult.tool) {
          messages.push({
            role: 'assistant' as const,
            content: null,
            tool_calls: [{ id: toolCall.id, type: 'function' as const, function: { name: toolName, arguments: toolCall.function?.arguments } }],
          });
          messages.push({
            role: 'tool' as const,
            tool_call_id: toolCall.id,
            content: `Error: Tool "${toolName}" not found`,
          });
          continue;
        }

        const tool = toolResult.tool;

        // Check if we need confirmation
        const needsConfirm = needsUserConfirmation(tool, config);

        if (needsConfirm) {
          // Request user confirmation
          const confirmation = await requestConfirmation({
            toolName: tool.name,
            summary: `Execute ${tool.name} with parameters: ${JSON.stringify(params)}`,
            detail: tool.description,
          });

          if (!confirmation.approved) {
            messages.push({
              role: 'assistant' as const,
              content: null,
              tool_calls: [{ id: toolCall.id, type: 'function' as const, function: { name: toolName, arguments: toolCall.function?.arguments } }],
            });
            messages.push({
              role: 'tool' as const,
              tool_call_id: toolCall.id,
              content: `User cancelled the ${tool.name} action.`,
            });
            continue;
          }
        }

        // Execute the tool
        const execResult = await executeTool(tool, params);

        // Log the action
        appendLog({
          time: new Date().toISOString(),
          actor: 'anzu',
          action: `agent.${tool.name}`,
          detail: JSON.stringify(params),
          ok: execResult.ok,
        });

        messages.push({
          role: 'assistant' as const,
          content: null,
          tool_calls: [{ id: toolCall.id, type: 'function' as const, function: { name: toolName, arguments: toolCall.function?.arguments } }],
        });
        messages.push({
          role: 'tool' as const,
          tool_call_id: toolCall.id,
          content: formatToolResult(execResult),
        });
        continue;
      }

      // LLM provided a direct response
      return choice.message?.content || 'No response from LLM';

    } catch (e: any) {
      return `Error: ${e.message || String(e)}`;
    }
  }

  return `Maximum iterations (${maxIterations}) reached`;
}

// Export for testing
export const __testExports = {
  needsUserConfirmation,
  parseToolArgs,
  formatToolResult,
  detectLanguage,
  registerAllTools,
  executeTool,
};
