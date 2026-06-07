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
import { promptAI } from '../ai/openai';
import { resolveRemoteAvailability } from '../ai/provider';
import { promptDevice } from '../ai/device';
import { memoryAnswerSystemPrompt } from '../ai/prompts';
import { getUserProfile, buildUserContextPrefix } from '../db/userProfile';
import { getDeviceContext, enrichWithUsagePatterns } from '../ai/deviceContext';
import { getUpcomingEvents, formatCalendarContext } from './calendarConnector';

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

export interface CitedSource {
  captureId: number;
  title: string;
  snippet: string;
  capturedAt: string;
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
  citedSources?: CitedSource[];
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

function detectsCaptureIntent(text: string): boolean {
  return /\b(add|save|remember|capture|note|log|record)\b.{0,30}\b(this|that|progress|update|today|memory)\b/i.test(text)
    || /\b(yes,?\s*add|please\s*(add|save|remember))\b/i.test(text);
}

export interface AskTurn { role: 'user' | 'lucy'; content: string }

function formatHistory(history: AskTurn[]): string {
  if (!history || history.length === 0) return '';
  const lines = history.slice(-8).map((t) => `${t.role === 'user' ? 'User' : 'LUCY'}: ${t.content}`);
  return `CONVERSATION SO FAR (use this to understand follow-ups like "yes", "do that", "the first one"):\n${lines.join('\n')}\n\n`;
}

async function answerWithLLM(question: string, history: AskTurn[] = []): Promise<LucyAnswer> {
  const db = await getDatabase();
  const [profile, deviceCtx, calEvents] = await Promise.all([
    getUserProfile(db),
    getDeviceContext(),
    getUpcomingEvents(7).catch(() => []),
  ]);

  // Use semantic search for relevant captures, fall back to recent if no embeddings
  let relevantCaptures: import('../db/captures').CaptureRow[] = [];
  try {
    const { findSimilarCaptures } = await import('./vectorSearch');
    const similar = await findSimilarCaptures(db, question, 8, 0.1);
    relevantCaptures = similar
      .filter((s) => s.capture.privacy_level !== 'private' && s.capture.raw_transcript?.trim())
      .map((s) => s.capture);
  } catch { /* fall through */ }

  if (relevantCaptures.length < 3) {
    const recent = await listRecentCaptures(db, 20);
    const seen = new Set(relevantCaptures.map((c) => c.id));
    for (const c of recent) {
      if (!seen.has(c.id) && c.privacy_level !== 'private' && c.raw_transcript?.trim()) {
        relevantCaptures.push(c);
      }
    }
  }

  const contextCaptures = relevantCaptures.slice(0, 12);

  const context = contextCaptures
    .map((c) => {
      const date = new Date(c.created_at.includes('T') ? c.created_at : `${c.created_at.replace(' ', 'T')}Z`).toLocaleDateString();
      const title = c.extracted_title ? `[${c.extracted_title}]` : '';
      return `[ID:${c.id}] ${date} ${title}\n${c.raw_transcript?.slice(0, 400) ?? ''}`;
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
  const deviceInfo = await enrichWithUsagePatterns(deviceCtx);
  const calendarInfo = formatCalendarContext(calEvents);

  // Enrich with top Brain Galaxy topics so LUCY understands life structure
  let galaxyContext: string | null = null;
  try {
    const { listTopics } = await import('../db/brainTopics');
    const topics = await listTopics(db);
    const areas = topics.filter((t) => t.depth === 0 && !t.is_misc && t.item_count > 0);
    if (areas.length > 0) {
      galaxyContext = `USER'S LIFE AREAS (Brain Galaxy):\n${areas.map((a) => `- ${a.emoji ?? ''} ${a.name} (${a.item_count} items)`).join('\n')}`;
    }
  } catch { /* non-critical */ }

  // Inject today's health snapshot for wellbeing questions
  let healthContext: string | null = null;
  try {
    const { getTodayHealthSnapshot } = await import('../db/healthSnapshots');
    const health = await getTodayHealthSnapshot(db);
    if (health && (health.steps > 0 || health.sleep_hours)) {
      const parts = [];
      if (health.steps > 0) parts.push(`${health.steps.toLocaleString()} steps today`);
      if (health.sleep_hours) parts.push(`${health.sleep_hours}h sleep last night`);
      if (health.resting_hr) parts.push(`resting HR ${health.resting_hr} bpm`);
      if (parts.length > 0) healthContext = `TODAY'S HEALTH:\n${parts.join(', ')}`;
    }
  } catch { /* non-critical */ }

  const input = [
    formatHistory(history) || null,
    `DEVICE CONTEXT (live data — always accurate):\n${deviceInfo}`,
    calendarInfo ? calendarInfo : null,
    galaxyContext,
    healthContext,
    `CAPTURED MEMORIES:\n---\n${context}\n---`,
    `Current message: ${question}`,
  ].filter(Boolean).join('\n\n');

  let llmResponse: string;
  const t0 = Date.now();
  try {
    const { available, openAIKey } = await resolveRemoteAvailability();
    if (available) {
      llmResponse = await promptAI(systemPrompt, input, openAIKey);
    } else {
      llmResponse = await promptDevice(`${systemPrompt}\n${input}\n/no_think`);
    }
    const { getPreferredModel } = await import('../ai/modelPreference');
    const { config } = await import('../config');
    const { insertDevLog } = await import('../db/devLog');
    void insertDevLog(db, {
      category: 'ask', model: getPreferredModel(config.openAIModel),
      input_preview: question.slice(0, 300),
      output_preview: llmResponse.slice(0, 300),
      duration_ms: Date.now() - t0, error: null,
    }).catch(() => {});
  } catch (e) {
    llmResponse = 'I had trouble answering this. Try enabling remote intelligence in Settings.';
    const { getPreferredModel } = await import('../ai/modelPreference');
    const { config } = await import('../config');
    const { insertDevLog } = await import('../db/devLog');
    void insertDevLog(db, {
      category: 'ask', model: getPreferredModel(config.openAIModel),
      input_preview: question.slice(0, 300), output_preview: '',
      duration_ms: Date.now() - t0,
      error: e instanceof Error ? e.message : String(e),
    }).catch(() => {});
  }

  await insertQuestionSignal(db, question, 'llm_answer', llmResponse.slice(0, 200), 'LLM answered from memory context.');

  // Build cited sources from captures that were used as context
  const citedSources: CitedSource[] = contextCaptures.slice(0, 5).map((c) => ({
    captureId: c.id,
    title: c.extracted_title ?? 'Memory',
    snippet: (c.raw_transcript ?? '').slice(0, 80) + ((c.raw_transcript?.length ?? 0) > 80 ? '...' : ''),
    capturedAt: c.created_at,
  }));

  return {
    supported: true,
    answerKind: 'llm',
    title: '',
    message: '',
    tasks: [],
    deadlines: [],
    recordedSignal: '',
    llmResponse: llmResponse.trim(),
    citedSources,
  };
}

export async function askLucy(
  question: string,
  captureCallback?: (text: string) => Promise<void>,
  history: AskTurn[] = [],
): Promise<LucyAnswer> {
  const db = await getDatabase();
  const trimmed = question.trim();

  // Mid-conversation follow-ups (e.g. "yes", "do that", "the first one", "option 2")
  // must be answered WITH the prior turns as context — never treated as a brand-new
  // capture or matched against the standalone structured detectors.
  const isShortFollowUp = history.length > 0 && trimmed.split(/\s+/).length <= 6;
  if (isShortFollowUp) {
    return answerWithLLM(trimmed, history);
  }

  // If the user is adding new information to memory, capture it and confirm.
  if (detectsCaptureIntent(trimmed) && captureCallback) {
    try {
      await captureCallback(trimmed);
    } catch { /* non-critical */ }
    const { getUserProfile: gp, buildUserContextPrefix: bcp } = await import('../db/userProfile');
    const profile = await gp(db);
    const name = profile.name || 'you';
    return {
      supported: true,
      answerKind: 'llm',
      title: '',
      message: '',
      tasks: [],
      deadlines: [],
      recordedSignal: '',
      llmResponse: `Got it, ${name}. I've saved that to your memory and will organize it shortly.`,
    };
  }
  if (recognizesMonthlySpendingQuestion(trimmed)) {
    return answerMonthlySpending(trimmed);
  }
  if (recognizesMemoryMapQuestion(trimmed) && !recognizesTodayPlanQuestion(trimmed)) {
    return answerFromMemoryMap(trimmed);
  }
  if (!recognizesTodayPlanQuestion(trimmed)) {
    // No structured pattern matched — use LLM to answer from memory context.
    return answerWithLLM(trimmed, history);
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
