/** Merge — run the selected tools (parallel) and fuse their outputs into one answer.
 *  Single tool → short-circuit to its prose (1 LLM call total). Multiple → synthesize. */
import type { SelectionResult, ToolContext, ToolResult } from './types';

export interface MergedAnswer {
  text: string;
  toolNames: string[];
  sources: Array<{ captureId: number; title: string; snippet?: string }>;
}

/** Pure: stitch tool prose fragments into one block (used directly for single-tool, or as synth input). */
export function assembleProse(results: Array<{ name: string; result: ToolResult }>): string {
  return results.map((r) => r.result.prose).filter(Boolean).join('\n\n');
}

export async function runSelected(ctx: ToolContext, selection: SelectionResult): Promise<Array<{ name: string; result: ToolResult }>> {
  const { getTool } = await import('./registry');
  const runs = await Promise.all(selection.tools.map(async (sel) => {
    const tool = getTool(sel.name);
    if (!tool) return null;
    try { return { name: sel.name, result: await tool.run(ctx, sel.args) }; }
    catch { return null; }
  }));
  return runs.filter((r): r is { name: string; result: ToolResult } => r !== null);
}

export async function mergeResults(question: string, results: Array<{ name: string; result: ToolResult }>): Promise<MergedAnswer> {
  const sources = results.flatMap((r) => r.result.sources ?? []);
  const toolNames = results.map((r) => r.name);
  const combined = assembleProse(results);

  // Some tools already produce a final user-facing line (e.g. spending). When there's a single
  // structured tool, return its prose directly — no extra LLM call.
  if (results.length === 1 && results[0].name === 'spending') {
    return { text: combined, toolNames, sources };
  }

  // Otherwise synthesize one grounded answer from the tool outputs.
  try {
    const { resolveRemoteAvailability } = await import('../../ai/provider');
    const { available, openAIKey } = await resolveRemoteAvailability();
    if (!available) return { text: combined || 'I could not find anything for that.', toolNames, sources };
    const { promptAI } = await import('../../ai/openai');
    // Label each fragment by its tool so the model knows which numbers are AUTHORITATIVE: the dedicated
    // structured tools (e.g. [spending] totals) are ground truth for their domain. Numbers mentioned in
    // recalled notes ([memory]) are context/budget — never report them as the actual spent/eaten figure.
    const labeled = results.map((r) => `[${r.name}] ${r.result.prose}`).filter((p) => p.replace(/^\[\w+\]\s*$/, '')).join('\n\n');
    const system = 'You are LUCY. Answer the user using ONLY the tool outputs below — never invent numbers or facts. '
      + 'Each block is tagged with the tool that produced it. For any figure, TRUST the dedicated structured tool for its domain: '
      + 'use [spending] for amounts actually spent, [health] for calories/steps, [tasks]/[reminders] for counts. '
      + 'Numbers found inside [memory] notes are context only (e.g. a stated budget) — never present them as the actual spent/eaten amount, and if they differ from a structured tool, label them as a budget/plan, not actuals. '
      + 'Be warm, direct, plain text, under 160 words. Address the user as "you".';
    const user = `User asked: ${question}\n\nTool outputs:\n${labeled}`;
    const text = await promptAI(system, user, openAIKey);
    return { text: (text || combined).trim(), toolNames, sources };
  } catch {
    return { text: combined || 'I had trouble with that — try again in a moment.', toolNames, sources };
  }
}
