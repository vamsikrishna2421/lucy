/** Pure helpers (no tool impls / no RN deps) so the selector parsing + descriptions stay unit-testable. */
import type { LucyTool } from './types';

/** The name+description block fed to the LLM selector (like an MCP tool list). */
export function describeForSelector(tools: LucyTool[]): string {
  return tools.map((t) => `- ${t.name}: ${t.description}`).join('\n');
}
