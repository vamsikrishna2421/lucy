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

export async function selectTools(ctx: ToolContext, question: string): Promise<SelectionResult> {
  void ctx;
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
