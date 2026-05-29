import { getDatabase } from '../db';
import { listExpenses, type ExpenseRow } from '../db/expenses';
import { listLatestExtractionEvidence } from '../db/extractions';
import { listKnowledgeConnections, listKnowledgeEntities, type KnowledgeConfidence } from '../db/knowledge';
import { insertQuestionSignal } from '../db/questions';
import { listReminders, type ReminderRow } from '../db/reminders';
import { listPendingTodos, type TodoRow } from '../db/todos';
import { listRecentCaptures } from '../db/captures';
import type { ExtractionResult, PrivacyLevel } from '../types/extraction';
import { isInvalidDeadline, isInvalidPendingTask } from './artifactCleanup';
import { normalizeMemoryLookupText, recognizesMemoryMapQuestion, recognizesMonthlySpendingQuestion, recognizesTodayPlanQuestion, requestedTaskContext } from './askIntent';
import { organizeMemory } from './organizer';
import { getRemoteAccessState, getRemoteOpenAIKey } from '../ai/remoteAccess';
import { promptOpenAI } from '../ai/openai';
import { promptDevice } from '../ai/device';
import { memoryAnswerSystemPrompt } from '../ai/prompts';
import { getUserProfile, buildUserContextPrefix } from '../db/userProfile';

export interface LucyMemoryConnection {
  statement: string;
  evidenceCount: number;
  confidence: KnowledgeConfidence;
}

export interface LucyMemorySource {
  captureId: number;
  capturedAt: string;
  title: string;
  summary: string;
  actions: string[];
  privacyLevel: PrivacyLevel;
}

export interface LucySpendingCategory {
  category: string;
  total: number;
  count: number;
}

export interface LucyAnswer {
  supported: boolean;
  answerKind?: 'today' | 'memory' | 'spending' | 'llm';
  title: string;
  message: string;
  tasks: TodoRow[];
  deadlines: ReminderRow[];
  recordedSignal: string;
  taskScope?: string;
  memorySubject?: string;
  connections?: LucyMemoryConnection[];
  sources?: LucyMemorySource[];
  expenses?: ExpenseRow[];
  expenseTotal?: number;
  spendingCategories?: LucySpendingCategory[];
  llmResponse?: string;
}

function isToday(value: string): boolean {
  const target = new Date(value);
  const today = new Date();
  return target.getFullYear() === today.getFullYear()
    && target.getMonth() === today.getMonth()
    && target.getDate() === today.getDate();
}

function parseEvidence(value: string): ExtractionResult | null {
  try {
    return JSON.parse(value) as ExtractionResult;
  } catch {
    return null;
  }
}

function extractedNames(result: ExtractionResult): string[] {
  return [
    ...(result.projects ?? []),
    ...(result.areas ?? []),
    ...(result.people ?? []),
    ...(result.interests ?? []).map((interest) => interest.topic),
  ];
}

function isCurrentMonth(value: string): boolean {
  const recorded = new Date(`${value.replace(' ', 'T')}Z`);
  const now = new Date();
  return recorded.getFullYear() === now.getFullYear()
    && recorded.getMonth() === now.getMonth();
}

function recordedAmount(expense: ExpenseRow): number {
  return typeof expense.amount === 'number' && Number.isFinite(expense.amount) ? expense.amount : 0;
}

async function answerMonthlySpending(question: string): Promise<LucyAnswer> {
  const db = await getDatabase();
  const expenses = (await listExpenses(db)).filter((expense) => isCurrentMonth(expense.created_at));
  const total = expenses.reduce((sum, expense) => sum + recordedAmount(expense), 0);
  const grouped = new Map<string, LucySpendingCategory>();
  expenses.forEach((expense) => {
    const existing = grouped.get(expense.category) ?? { category: expense.category, total: 0, count: 0 };
    existing.total += recordedAmount(expense);
    existing.count += 1;
    grouped.set(expense.category, existing);
  });
  const categories = Array.from(grouped.values()).sort((left, right) => right.total - left.total);
  const summary = expenses.length
    ? `I remember ${expenses.length} payment${expenses.length === 1 ? '' : 's'} this month, totaling ${total.toFixed(2)} in recorded amounts.`
    : 'I do not remember any recorded payments for this month yet.';
  await insertQuestionSignal(db, question, 'monthly_spending_summary', summary, 'Maintain a monthly spending insight view.');
  await organizeMemory(db, 'question');
  return {
    supported: true,
    answerKind: 'spending',
    title: 'Payments this month',
    message: summary,
    tasks: [],
    deadlines: [],
    expenses,
    expenseTotal: total,
    spendingCategories: categories,
    recordedSignal: 'This question helps LUCY organize recurring spending insights locally.',
  };
}

async function answerFromMemoryMap(question: string): Promise<LucyAnswer> {
  const db = await getDatabase();
  const [entities, connections, evidence] = await Promise.all([
    listKnowledgeEntities(db),
    listKnowledgeConnections(db),
    listLatestExtractionEvidence(db),
  ]);
  const normalizedQuestion = normalizeMemoryLookupText(question);
  const matchedEntities = entities.filter((entity) => {
    const normalizedName = normalizeMemoryLookupText(entity.name);
    return normalizedName.length > 0 && normalizedQuestion.includes(normalizedName);
  });
  const subject = matchedEntities[0]?.name;
  if (!subject) {
    const message = 'I do not have an organized memory topic matching that question yet. Add context or capture a related thought, and I can connect it later.';
    await insertQuestionSignal(db, question, 'memory_map_lookup', message, 'Improve recall for missing memory subjects.');
    await organizeMemory(db, 'question');
    return {
      supported: true,
      answerKind: 'memory',
      title: 'No connected memory yet',
      message,
      tasks: [],
      deadlines: [],
      connections: [],
      sources: [],
      recordedSignal: 'This memory question was remembered locally to improve future organization.',
    };
  }
  const matchedNames = new Set(matchedEntities.map((entity) => normalizeMemoryLookupText(entity.name)));
  const relatedConnections = connections.filter((connection) => (
    matchedNames.has(normalizeMemoryLookupText(connection.source_name))
    || matchedNames.has(normalizeMemoryLookupText(connection.target_name))
  ));
  const sources: LucyMemorySource[] = evidence.flatMap((row) => {
    const extraction = parseEvidence(row.structured_json);
    if (!extraction || !extractedNames(extraction).some((name) => matchedNames.has(normalizeMemoryLookupText(name)))) {
      return [];
    }
    return [{
      captureId: row.capture_id,
      capturedAt: row.capture_created_at,
      title: extraction.title,
      summary: extraction.summary,
      actions: (extraction.tasks ?? []).map((task) => task.task),
      privacyLevel: row.privacy_level,
    }];
  }).slice(-5).reverse();
  const memoryConnections: LucyMemoryConnection[] = relatedConnections.map((connection) => ({
    statement: `${connection.source_name} ${connection.relation} ${connection.target_name}`,
    evidenceCount: connection.evidence_count,
    confidence: connection.confidence,
  }));
  const summary = `I remember ${sources.length} relevant thought${sources.length === 1 ? '' : 's'} and ${memoryConnections.length} connection${memoryConnections.length === 1 ? '' : 's'} for ${subject}.`;
  await insertQuestionSignal(db, question, 'memory_map_lookup', summary, 'Prioritize entity-based memory retrieval with supporting thoughts.');
  await organizeMemory(db, 'question');
  return {
    supported: true,
    answerKind: 'memory',
    title: `${subject} in memory`,
    message: summary,
    tasks: [],
    deadlines: [],
    memorySubject: subject,
    connections: memoryConnections,
    sources,
    recordedSignal: 'Answered locally from connected memory.',
  };
}

async function answerWithLLM(question: string): Promise<LucyAnswer> {
  const db = await getDatabase();
  const [captures, profile] = await Promise.all([
    listRecentCaptures(db, 20),
    getUserProfile(db),
  ]);

  // Build context from non-private captures only (private stays on device).
  const context = captures
    .filter((c) => c.privacy_level !== 'private' && c.raw_transcript?.trim())
    .slice(0, 15)
    .map((c) => {
      const date = new Date(c.created_at.includes('T') ? c.created_at : `${c.created_at.replace(' ', 'T')}Z`).toLocaleDateString();
      const title = c.extracted_title ? `[${c.extracted_title}]` : '';
      return `${date} ${title}\n${c.raw_transcript?.slice(0, 400) ?? ''}`;
    })
    .join('\n---\n');

  if (!context.trim()) {
    return {
      supported: true,
      answerKind: 'llm',
      title: '',
      message: '',
      tasks: [],
      deadlines: [],
      recordedSignal: '',
      llmResponse: "I don't have any captured notes to answer from yet. Try capturing some thoughts first — voice notes, meeting summaries, anything — and then ask me again.",
    };
  }

  const userPrefix = buildUserContextPrefix(profile);
  const systemPrompt = `${userPrefix}${memoryAnswerSystemPrompt}`;
  const input = `CAPTURED MEMORIES:\n---\n${context}\n---\n\nQuestion: ${question}`;

  let llmResponse: string;
  try {
    const remote = await getRemoteAccessState();
    const apiKey = remote.enabled && remote.hasKey ? await getRemoteOpenAIKey() : null;
    if (apiKey) {
      llmResponse = await promptOpenAI(systemPrompt, input, apiKey);
    } else {
      llmResponse = await promptDevice(`${systemPrompt}\n${input}\n/no_think`);
    }
  } catch {
    llmResponse = 'I had trouble answering this. Try enabling remote intelligence in Settings.';
  }

  await insertQuestionSignal(db, question, 'llm_answer', llmResponse.slice(0, 200), 'LLM answered from memory context.');

  return {
    supported: true,
    answerKind: 'llm',
    title: '',
    message: '',
    tasks: [],
    deadlines: [],
    recordedSignal: '',
    llmResponse: llmResponse.trim(),
  };
}

export async function askLucy(question: string): Promise<LucyAnswer> {
  const db = await getDatabase();
  const trimmed = question.trim();
  if (recognizesMonthlySpendingQuestion(trimmed)) {
    return answerMonthlySpending(trimmed);
  }
  if (recognizesMemoryMapQuestion(trimmed) && !recognizesTodayPlanQuestion(trimmed)) {
    return answerFromMemoryMap(trimmed);
  }
  if (!recognizesTodayPlanQuestion(trimmed)) {
    // No structured pattern matched — use LLM to answer from memory context.
    return answerWithLLM(trimmed);
  }

  const [allTasks, reminders] = await Promise.all([listPendingTodos(db), listReminders(db)]);
  const scope = requestedTaskContext(trimmed);
  const candidateTasks = allTasks.filter((task) => !isInvalidPendingTask(task));
  const tasks = scope
    ? candidateTasks.filter((task) => (
      task.context.toLocaleLowerCase().includes(scope.toLocaleLowerCase())
      || task.task.toLocaleLowerCase().includes(scope.toLocaleLowerCase())
    ))
    : candidateTasks;
  const requestsDeadlines = /\b(deadline|deadlines|due|reminder|reminders)\b/i.test(trimmed);
  const deadlines = requestsDeadlines ? reminders.filter((reminder) => (
    Boolean(reminder.remind_at)
    && isToday(reminder.remind_at as string)
    && !isInvalidDeadline(reminder)
  )) : [];
  const scopedLabel = scope ? ` related to ${scope}` : '';
  const summary = `${tasks.length} pending task${tasks.length === 1 ? '' : 's'}${scopedLabel} and ${deadlines.length} deadline${deadlines.length === 1 ? '' : 's'} for today.`;
  await insertQuestionSignal(
    db,
    trimmed,
    'today_pending_tasks_and_deadlines',
    summary,
    'Prioritize a Today workspace for pending tasks and same-day deadlines.',
  );
  await organizeMemory(db, 'question');
  return {
    supported: true,
    answerKind: 'today',
    title: scope ? `${scope} at a glance` : 'Today at a glance',
    message: summary,
    tasks,
    deadlines,
    recordedSignal: 'This question was remembered locally as a useful Today view pattern.',
    taskScope: scope ?? undefined,
  };
}
