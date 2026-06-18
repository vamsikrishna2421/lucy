# Plan — Semantic Tool Layer ("LUCY as the MCP on top")

## Why
Today Ask/insight routing is brittle regex (`askIntent.ts` + a long `if/else` in `ask.ts`). It
mis-routes (the agent-Vamsi gaps: rants → "22 tasks", "plan my day" → wrong path), can't compose
domains (a question that needs spending AND calendar), and is hard to test per-domain. We replace the
keyword fast-paths with a **tool registry + an LLM router** that picks the right tool(s) on demand and
**merges** their structured outputs into one answer. Each tool is small, perfect at one job, and
independently testable — LUCY is the orchestrator on top.

This is an internal refactor — NOT Anthropic MCP over the wire. "MCP" here = the user's mental model:
LUCY selects focused tools the way an MCP client selects server tools.

## Core shape
```ts
interface LucyTool<Args, Result> {
  name: string;                 // 'spending' | 'schedule' | 'health' | 'memory' | 'tasks' | 'people' | 'reminders'
  description: string;          // when-to-use, written for the LLM selector (like an MCP tool desc)
  schema: ArgSpec;              // expected args the selector fills
  run(db, args, ctx): Promise<ToolResult>;   // returns STRUCTURED data + a short prose fragment
}
interface ToolResult { kind: string; data: unknown; prose: string; sources?: CitedSource[]; }
```
- **Registry** (`src/processing/tools/registry.ts`): array of tools + a `describeForSelector()` that emits the name+description list.
- **Selector** (`src/processing/tools/selector.ts`): one LLM call → `{tools:[{name,args}], reason}` (0..n tools). Deterministic guards FIRST for safety (red-flag/health emergency → force health tool; explicit `isComplexOrEmotionalQuery` already exists). Falls back to the plain LLM answer when no tool fits.
- **Merge** (`src/processing/tools/merge.ts`): run selected tools (parallel), then ONE synthesis LLM call that fuses their `prose`+`data` into the final answer with cited sources. Single tool → can skip synthesis and return its prose directly (cheap path).

## First tools (wrap EXISTING engines — no logic rewrite, just adapters)
1. **spending** → `answerMonthlySpending` + `spendingWindow` (already solid).
2. **schedule** → `suggestForText`/`commitBlock`/`autoPlanDay` (reuse the new explicit-commit path).
3. **health** → `getHealthSummary` + `buildHealthContextPrefix` + `drLucy` (keep red-flag override on top).
4. **memory** → vector recall + captures context (the current LLM-from-memory path).
5. **tasks** → today/pending todos (`recognizesTodayPlanQuestion` logic).
6. **people** → person lookup (current matchedEntities path, ranked, generic-demoted).
7. **reminders** → list/create reminders.
8. **knowledge** → KG entities/connections.

## Phases (each shippable + reversible, OTA)
- **P0 — scaffold, dark-launched:** registry + selector + merge + the `LucyTool` interface and 2 tools
  (spending, memory). Behind a setting `semantic_router_enabled` (default OFF). `askLucy` tries the
  router when on, else the current path. Unit tests for the selector (fixtures: 20 real questions →
  expected tool set). No user-visible change yet.
- **P1 — port the rest + dogfood:** add schedule/health/tasks/people/reminders/knowledge tools. Run
  BOTH paths in shadow on a sample, diff answers, fix selector. Keep deterministic safety guards
  (red-flag, complex/emotional) ABOVE the selector.
- **P2 — flip default ON** after the agent-Vamsi hard-test passes on the router; delete the dead regex
  fast-paths once stable. Add per-tool dev-log so misroutes are observable.
- **P3 — proactive insights via the same tools:** the insight engine calls tools on a schedule and
  merges (replaces ad-hoc insight logic), so insights and answers share one brain.

## Guardrails (non-negotiable, from past lessons)
- Safety FIRST: chest-pain/red-flag and crisis detection run BEFORE the selector and can force/override.
- Never fabricate: tools return only real data; the synthesis prompt forbids inventing numbers.
- Cost: cap at ~2 LLM calls (select + synthesize); single-tool short-circuits to 1. Cache the selector
  for identical recent questions.
- Reversible: everything behind `semantic_router_enabled`; the current path stays until P2 proves out.
- Privacy shield stays wrapped around every remote call (tokenize → restore), unchanged.

## Files
New: `src/processing/tools/{registry,selector,merge,types}.ts` + `tools/impl/*.ts` (one per tool) +
`tests/toolRouter.ts`. Edit: `src/processing/ask.ts` (try router when enabled), Settings (dev toggle),
later `insightEngine.ts`.

## Verification
- `tests/toolRouter.ts`: 20+ fixture questions → expected tool selection (incl. the agent-Vamsi cases).
- `npx tsc --noEmit` + existing `tests/hardening.ts` stay green.
- Shadow-diff old vs new on the LAN test harness before flipping the default.
- Re-run the agent-Vamsi 33-interaction hard test on the router; must match or beat the current pass rate.

## Risk
Largest engineering change to the answer path. Mitigated by: dark-launch behind a flag, wrapping
(not rewriting) existing engines, shadow-diffing, and keeping deterministic safety above the LLM
selector. Do NOT delete the regex paths until P2 is proven on device.
