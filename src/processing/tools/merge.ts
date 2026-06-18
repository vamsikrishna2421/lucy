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
    const system = 'You are LUCY. Answer the user using ONLY the tool outputs below — never invent numbers or facts. Be warm, direct, plain text, under 150 words. Address the user as "you".';
    const user = `User asked: ${question}\n\nTool outputs:\n${combined}`;
    const text = await promptAI(system, user, openAIKey);
    return { text: (text || combined).trim(), toolNames, sources };
  } catch {
    return { text: combined || 'I had trouble with that — try again in a moment.', toolNames, sources };
  }
}
