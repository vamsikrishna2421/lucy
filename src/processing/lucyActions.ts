/**
 * Interactive LUCY — turns a natural-language reorganization request into concrete,
 * user-approved actions on the task list, then executes them.
 *
 * Flow: planTaskReorganization() asks the LLM for a structured action plan referencing
 * real task IDs → the Ask screen shows a confirmation card → executeActions() applies it.
 */
import { jsonrepair } from 'jsonrepair';
import { getDatabase } from '../db';
import { listPendingTodos, recategorizeTodos, renameTodoList, splitTodo, deleteTodos, archiveTodos } from '../db/todos';

export type LucyAction =
  | { type: 'move'; taskIds: number[]; list: string }
  | { type: 'split'; taskId: number; newTasks: string[] }
  | { type: 'delete'; taskIds: number[] }
  | { type: 'archive'; taskIds: number[] }
  | { type: 'rename_list'; from: string; to: string };

export interface ActionPlan {
  message: string;       // LUCY's conversational explanation
  actions: LucyAction[]; // concrete operations to confirm + execute
}

const PLANNER_PROMPT = `You are LUCY, a personal second-brain assistant that can REORGANIZE the user's task list.
You are given the user's current pending tasks (each with an [ID] and its current list) and a request.
Return STRICT JSON only — no markdown — in this exact shape:
{"message":"<short friendly explanation of what you'll do>","actions":[ ...actions ]}

Each action is one of:
{"type":"move","taskIds":[1,2],"list":"AI & Tech"}        // assign tasks to a list (creates the list if new)
{"type":"split","taskId":5,"newTasks":["Buy milk","Buy eggs"]}  // replace one combined task with several
{"type":"delete","taskIds":[7,8]}                          // remove duplicate/unwanted tasks
{"type":"archive","taskIds":[9]}                           // archive stale tasks (recoverable)
{"type":"rename_list","from":"General","to":"Inbox"}       // rename an existing list

Rules:
- Only reference task IDs that appear in the provided list. Never invent IDs.
- Group related tasks into clearly-named lists (e.g. "AI & Tech", "Work", "Groceries", "Personal Errands").
- Prefer "move" to organize; use "split" only when one task clearly bundles multiple actions.
- Keep list names short and human (Title Case).
- If nothing actionable, return {"message":"...","actions":[]}.
- message must be under 80 words, warm and specific.`;

function buildTaskContext(todos: { id: number; task: string; list_name?: string | null; category?: string }[]): string {
  return todos
    .map((t) => `[ID:${t.id}] ${t.task} (list: ${(t.list_name ?? '').trim() || 'unsorted'})`)
    .join('\n');
}

export async function planTaskReorganization(question: string, history: { role: string; content: string }[] = []): Promise<ActionPlan> {
  const db = await getDatabase();
  const todos = await listPendingTodos(db);
  if (todos.length === 0) {
    return { message: "You don't have any pending tasks to reorganize yet.", actions: [] };
  }

  const historyText = history.length
    ? `CONVERSATION SO FAR:\n${history.slice(-6).map((h) => `${h.role === 'user' ? 'User' : 'LUCY'}: ${h.content}`).join('\n')}\n\n`
    : '';
  const input = `${historyText}CURRENT PENDING TASKS:\n${buildTaskContext(todos)}\n\nUSER REQUEST: ${question}`;

  const { resolveRemoteAvailability } = await import('../ai/provider');
  const { promptAI } = await import('../ai/openai');
  const { promptDevice } = await import('../ai/device');
  const { available, openAIKey } = await resolveRemoteAvailability();

  let raw: string;
  try {
    raw = available
      ? await promptAI(PLANNER_PROMPT, input, openAIKey)
      : await promptDevice(`${PLANNER_PROMPT}\n${input}\n/no_think`);
  } catch {
    return { message: 'I had trouble planning that reorganization. Try again, or enable Remote Intelligence in Settings.', actions: [] };
  }

  return parseActionPlan(raw, new Set(todos.map((t) => t.id)));
}

function parseActionPlan(raw: string, validIds: Set<number>): ActionPlan {
  try {
    const jsonStart = raw.indexOf('{');
    const jsonEnd = raw.lastIndexOf('}');
    const slice = jsonStart >= 0 ? raw.slice(jsonStart, jsonEnd + 1) : raw;
    const parsed = JSON.parse(jsonrepair(slice)) as ActionPlan;
    const actions = (parsed.actions ?? []).filter((a) => validateAction(a, validIds));
    return { message: parsed.message?.trim() || 'Here\'s how I can reorganize these.', actions };
  } catch {
    return { message: raw.trim().slice(0, 400) || 'I could not produce a clean plan.', actions: [] };
  }
}

function validateAction(a: LucyAction, validIds: Set<number>): boolean {
  switch (a?.type) {
    case 'move': return Array.isArray(a.taskIds) && a.taskIds.every((id) => validIds.has(id)) && !!a.list?.trim();
    case 'split': return validIds.has(a.taskId) && Array.isArray(a.newTasks) && a.newTasks.length >= 2;
    case 'delete': return Array.isArray(a.taskIds) && a.taskIds.every((id) => validIds.has(id)) && a.taskIds.length > 0;
    case 'archive': return Array.isArray(a.taskIds) && a.taskIds.every((id) => validIds.has(id)) && a.taskIds.length > 0;
    case 'rename_list': return !!a.from?.trim() && !!a.to?.trim();
    default: return false;
  }
}

/** Human-readable one-line summary of each action for the confirmation card. */
export function summarizeAction(a: LucyAction): string {
  switch (a.type) {
    case 'move': return `Move ${a.taskIds.length} task${a.taskIds.length === 1 ? '' : 's'} → "${a.list}"`;
    case 'split': return `Split 1 task into ${a.newTasks.length}`;
    case 'delete': return `Delete ${a.taskIds.length} task${a.taskIds.length === 1 ? '' : 's'}`;
    case 'archive': return `Archive ${a.taskIds.length} task${a.taskIds.length === 1 ? '' : 's'}`;
    case 'rename_list': return `Rename list "${a.from}" → "${a.to}"`;
  }
}

// Lightweight pub/sub so the Tasks board can refresh after LUCY applies changes,
// without prop-drilling a callback through the Ask message tree.
let onActionsApplied: (() => void) | null = null;
export function setActionsAppliedListener(fn: (() => void) | null): void { onActionsApplied = fn; }

export async function executeActions(actions: LucyAction[]): Promise<{ applied: number; summary: string }> {
  const db = await getDatabase();
  let applied = 0;
  for (const a of actions) {
    try {
      switch (a.type) {
        case 'move': await recategorizeTodos(db, a.taskIds, a.list.trim()); applied++; break;
        case 'split': await splitTodo(db, a.taskId, a.newTasks); applied++; break;
        case 'delete': await deleteTodos(db, a.taskIds); applied++; break;
        case 'archive': await archiveTodos(db, a.taskIds, 'LUCY reorganization'); applied++; break;
        case 'rename_list': await renameTodoList(db, a.from.trim(), a.to.trim()); applied++; break;
      }
    } catch { /* skip the failing action, continue with the rest */ }
  }
  if (applied > 0) { try { onActionsApplied?.(); } catch { /* non-critical */ } }
  return { applied, summary: `Applied ${applied} of ${actions.length} change${actions.length === 1 ? '' : 's'}.` };
}

const REORG_INTENT = /\b(reorgani[sz]e|organi[sz]e|re-?organi[sz]e|categori[sz]e|split.*(list|task)|clean ?up|tidy|sort .*(task|list|todo)|move .*(task|to)|create .*(list|categor)|group .*(task|by)|separate.*(list|task)|merge.*(list|task)|rename.*list)\b/i;

/** Detects whether a question is asking LUCY to reorganize/modify the task list. */
export function isReorganizeRequest(text: string): boolean {
  return REORG_INTENT.test(text);
}
