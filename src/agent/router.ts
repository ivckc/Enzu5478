// Rule-based router: decides which tool groups a request needs.
// It makes NO LLM call, so it costs zero tokens.

export type ToolGroup = 'tasks' | 'goals' | 'habits' | 'reminders';

const RULES: Record<ToolGroup, RegExp> = {
  tasks: /مهم[ةه]|مهام|مهمت|task|todo/i,
  goals: /هدف|أهداف|اهداف|goal/i,
  habits: /عاد[ةه]|عادات|عادتي|habit|streak/i,
  reminders: /ذكرني|ذكّرني|تذكير|نبهني|نبّهني|منبه|remind/i,
};

export function pickGroups(input: string): ToolGroup[] | 'all' {
  const found = (Object.keys(RULES) as ToolGroup[]).filter((g) => RULES[g].test(input));
  return found.length > 0 ? found : 'all';
}
