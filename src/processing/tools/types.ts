/**
 * Semantic Tool Layer — types. See docs/SEMANTIC_TOOL_LAYER_PLAN.md.
 *
 * LUCY answers by selecting focused TOOLS (like an MCP client picks server tools) and merging their
 * structured outputs. Each tool is small, perfect at one job, and independently testable. This is an
 * internal abstraction — not Anthropic MCP over the wire.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

export interface ToolContext {
  db: SQLiteDatabase;
  /** Prior turns for follow-ups ("yes", "do that"). */
  history?: Array<{ role: 'user' | 'lucy'; content: string }>;
  screenContext?: string;
}

export interface ToolResult {
  /** A short machine tag for the kind of result (for logging/merge hints). */
  kind: string;
  /** Structured data the tool produced (numbers, lists) — never invented. */
  data: unknown;
  /** A short prose fragment the merge step can use directly or synthesize from. */
  prose: string;
  /** Optional cited sources (capture ids/titles) for transparency. */
  sources?: Array<{ captureId: number; title: string; snippet?: string }>;
}

export interface LucyTool {
  /** Stable id, e.g. 'spending' | 'memory'. */
  name: string;
  /** When-to-use, written for the LLM selector (like an MCP tool description). */
  description: string;
  /** Run the tool. `args` are whatever the selector filled (free-form per tool). */
  run(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult>;
}

export interface SelectedTool { name: string; args: Record<string, unknown> }
export interface SelectionResult { tools: SelectedTool[]; reason: string }
