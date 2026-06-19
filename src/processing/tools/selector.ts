/** Selector — an LLM picks which tool(s) answer a question (0..n), like MCP tool selection.
 *  parseSelection + buildSelectorPrompt are pure + unit-tested (no registry/RN import); selectTools
 *  lazily loads the registry only when actually routing. */
import type { LucyTool, SelectionResult, ToolContext } from './types';
import { describeForSelector } from './describe';

export function buildSelectorPrompt(question: string, tools: LucyTool[]): { system: string; user: string } {
  const system = `You route a user's message to the right LUCY tool(s). Available tools:\n${describeForSelector(tools)}\n\n`
    + `Return STRICT JSON only: {"tools":[{"name":"<tool>","args":{"question":"<the user's message>"}}],"reason":"<short>"}.\n`
    + `Pick the FEWEST tools that fully answer it (usually 1; 0 only if no tool fits — then memory is the safe default). You may pick 2 if the answer truly needs both. Always pass the user's message as args.question.`;
  return { system, user: question };
}

/** Pure: parse the selector's JSON into a validated selection (drops unknown tools; safe fallbacks). */
export function parseSelection(raw: string, question: string, knownNames: string[]): SelectionResult {
  const known = new Set(knownNames);
  const fallback: SelectionResult = { tools: [{ name: 'memory', args: { question } }], reason: 'fallback: memory' };
  try {
    const start = raw.indexOf('{'); const end = raw.lastIndexOf('}');
    if (start === -1 || end === -1) return fallback;
    const obj = JSON.parse(raw.slice(start, end + 1)) as { tools?: Array<{ name?: string; args?: Record<string, unknown> }>; reason?: string };
    const picked = (obj.tools ?? [])
      .filter((t) => t && typeof t.name === 'string' && known.has(t.name))
      .map((t) => ({ name: t.name as string, args: { question, ...(t.args ?? {}) } }));
    const seen = new Set<string>();
    const toolsOut = picked.filter((t) => (seen.has(t.name) ? false : (seen.add(t.name), true)));
    if (toolsOut.length === 0) return fallback;
    return { tools: toolsOut, reason: (obj.reason ?? '').slice(0, 120) };
  } catch {
    return { ...fallback, reason: 'parse-failed: memory' };
  }
}

// Deterministic fast-route: when a question CLEARLY maps to exactly ONE domain, skip the LLM selector
// call entirely (halves latency/cost for the common case). Returns null when 0 or 2+ domains match —
// then the LLM selector decides (and can compose multiple tools, e.g. health + spending). Pure.
const DOMAIN_PATTERNS: Array<{ tool: string; re: RegExp }> = [
  { tool: 'spending', re: /\b(spend|spent|spending|paid|payment|payments|expense|expenses|how much.*(cost|spend)|budget)\b/i },
  { tool: 'money_watch', re: /\b(subscriptions?|recurring|renew|renews|renewal|bills? (due|coming)|due soon|over ?budget|overspend(ing)?|unusual charge|anomal)\b/i },
  { tool: 'money_goals', re: /\b(savings? goal|saving goal|money goals?|on track to save|how much.*saved|saved (so far|toward|towards)|reach my goal|nest egg|save (?:up )?for)\b/i },
  { tool: 'tasks', re: /\b(tasks?|to-?dos?|to do|pending|action items?|what.*(do i need|should i do))\b/i },
  { tool: 'health', re: /\b(calorie|calories|kcal|weight|diet|nutrition|protein|carbs?|macro|steps?|sleep|workout|exercise|medication|medicine|meds?|dose|dosage|pill)\b/i },
  { tool: 'reminders', re: /\b(reminders?|remind me of|what.*remind)\b/i },
  { tool: 'people', re: /\b(who is|who'?s|tell me about|who have i|relationship with)\b/i },
  { tool: 'keep_in_touch', re: /\b(reach out|out of touch|fallen out|neglect|keep in touch|gone quiet|who should i (call|text|message|reach)|haven'?t\s+(?:\w+\s+)?(talked|spoken|spoke|messaged|reached|seen|called|contacted))\b/i },
  { tool: 'commitments', re: /\b(promis(?:e|ed|es|ing)|commitment|committed to|what do i owe|who owes me|owes? (?:me|him|her|them)|on the hook|chasing (?:up )?\w+|what am i waiting (?:on|for)|waiting to hear back|did i (?:say|promise) i)\b/i },
  { tool: 'knowledge', re: /\b(brain map|knowledge graph|how does .+ relate|what connects|keeps coming up|recurring (theme|topic))\b/i },
];

export function fastRoute(question: string): string | null {
  const matched = DOMAIN_PATTERNS.filter((d) => d.re.test(question)).map((d) => d.tool);
  return matched.length === 1 ? matched[0] : null; // 0 or 2+ → let the LLM selector decide / compose
}

export async function selectTools(ctx: ToolContext, question: string): Promise<SelectionResult> {
  void ctx;
  const fast = fastRoute(question);
  if (fast) return { tools: [{ name: fast, args: { question } }], reason: `fast-route: ${fast}` };
  const { TOOLS } = await import('./registry');
  try {
    const { resolveRemoteAvailability } = await import('../../ai/provider');
    const { available, openAIKey } = await resolveRemoteAvailability();
    if (!available) return { tools: [{ name: 'memory', args: { question } }], reason: 'no-remote: memory' };
    const { promptAI } = await import('../../ai/openai');
    const { system, user } = buildSelectorPrompt(question, TOOLS);
    const raw = await promptAI(system, user, openAIKey);
    return parseSelection(raw, question, TOOLS.map((t) => t.name));
  } catch {
    return { tools: [{ name: 'memory', args: { question } }], reason: 'error: memory' };
  }
}
