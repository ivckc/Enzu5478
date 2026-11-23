// Workshop: picks a fast or heavy model per request,
// and falls back to the other one if a model hits its limit or fails.

export type Role = 'fast' | 'heavy';

type WorkshopRequest = {
  messages: any[];
  tools?: any[];
  tool_choice?: any;
  temperature?: number;
  max_tokens?: number;
};

// Words that suggest the request needs the stronger model
const HEAVY_HINTS = [
  'خطة', 'خطه', 'حلل', 'تحليل', 'اكتب', 'سيناريو', 'سكربت', 'تقرير',
  'قارن', 'اقترح', 'لخص', 'اشرح', 'فكرة', 'افكار', 'أفكار',
  'plan', 'analy', 'write', 'script', 'report', 'compare',
  'suggest', 'summar', 'explain', 'idea',
];

export function pickRole(input: string): Role {
  const text = input.toLowerCase();
  if (input.length > 200) return 'heavy';
  if (HEAVY_HINTS.some((h) => text.includes(h))) return 'heavy';
  return 'fast';
}

function getModel(role: Role): string | undefined {
  const heavy = process.env.ANZU_LLM_MODEL;
  const fast = process.env.ANZU_FAST_MODEL || heavy;
  return role === 'fast' ? fast : heavy;
}

class HttpError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

async function callModel(model: string, req: WorkshopRequest): Promise<any> {
  const baseUrl = process.env.ANZU_LLM_BASE_URL;
  const apiKey = process.env.ANZU_LLM_API_KEY;
  if (!baseUrl || !apiKey) {
    throw new Error('LLM not configured: check ANZU_LLM_BASE_URL and ANZU_LLM_API_KEY in .env');
  }

  const hasTools = Array.isArray(req.tools) && req.tools.length > 0;

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: req.messages,
      tools: hasTools ? req.tools : undefined,
      tool_choice: hasTools ? req.tool_choice : undefined,
      temperature: req.temperature ?? 0.7,
      max_tokens: req.max_tokens,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new HttpError(`HTTP ${response.status}: ${errorText}`, response.status);
  }

  const data: any = await response.json();
  data.__model = model;
  return data;
}

function shouldFallback(e: unknown): boolean {
  if (e instanceof HttpError) {
    const s = e.status ?? 0;
    if (s === 401 || s === 403) return false; // bad key: switching model won't help
    if (s === 429 || s === 408 || s === 413 || s >= 500) return true;
    if (s === 400 && /tool/i.test(e.message)) return true; // model failed at tool calling
    return false;
  }
  return true; // network error or timeout
}

export async function workshopChat(role: Role, req: WorkshopRequest): Promise<any> {
  const order: Role[] = role === 'fast' ? ['fast', 'heavy'] : ['heavy', 'fast'];

  // Remove duplicates in case both roles use the same model
  const models: string[] = [];
  for (const r of order) {
    const m = getModel(r);
    if (m && !models.includes(m)) models.push(m);
  }
  if (models.length === 0) {
    throw new Error('LLM not configured: ANZU_LLM_MODEL is not set in .env');
  }

  let lastError: unknown;
  for (const model of models) {
    try {
      return await callModel(model, req);
    } catch (e) {
      lastError = e;
      if (!shouldFallback(e)) throw e;
      console.warn(`[workshop] ${model} failed, trying next model...`);
    }
  }
  throw lastError;
}