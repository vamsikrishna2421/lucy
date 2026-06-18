import { getDatabase } from '../db';
import { listExpenses, type ExpenseRow } from '../db/expenses';
import { expenseInWindow, recordedAmount } from './expenseWindow';
import { listLatestExtractionEvidence } from '../db/extractions';
import { listKnowledgeConnections, listKnowledgeEntities, type KnowledgeConfidence } from '../db/knowledge';
import { insertQuestionSignal } from '../db/questions';
import { listReminders, type ReminderRow } from '../db/reminders';
import { listPendingTodos, type TodoRow } from '../db/todos';
import { listRecentCaptures } from '../db/captures';
import type { ExtractionResult, PrivacyLevel } from '../types/extraction';
import { isInvalidDeadline, isInvalidPendingTask } from './artifactCleanup';
import { normalizeMemoryLookupText, recognizesMemoryMapQuestion, recognizesMonthlySpendingQuestion, recognizesTodayPlanQuestion, requestedTaskContext, spendingWindow, type SpendingWindow, recognizesSchedulingQuestion, extractSchedulableTask, isComplexOrEmotionalQuery, parseExplicitDateTime } from './askIntent';
import { organizeMemory } from './organizer';
import { promptAI } from '../ai/openai';
import { resolveRemoteAvailability } from '../ai/provider';
import { promptDevice } from '../ai/device';
import { shieldText, restoreText, PLACEHOLDER_NOTE } from './sensitiveShield';
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

export interface ScheduleSuggestionDTO {
  title: string;
  start: number;
  end: number;
  rationale: string;
  resourceLabel: string;
  durationMin: number;
}

export interface LucyAnswer {
  supported: boolean;
  answerKind?: 'today' | 'memory' | 'spending' | 'llm' | 'schedule';
  scheduleSuggestions?: ScheduleSuggestionDTO[];
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
  /** When LUCY proposes concrete task reorganizations the user can approve + apply. */
  proposedActions?: import('./lucyActions').LucyAction[];
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

/** Is an expense's UTC created_at within the asked-about window? (computed against local "now"). */
// expenseInWindow + recordedAmount moved to ./expenseWindow (shared with the spending tool).

async function answerMonthlySpending(question: string): Promise<LucyAnswer> {
  const db = await getDatabase();
  const win = spendingWindow(question);
  const now = new Date();
  const expenses = (await listExpenses(db)).filter((expense) => expenseInWindow(expense.created_at, win, now));
  const total = expenses.reduce((sum, expense) => sum + recordedAmount(expense), 0);
  const grouped = new Map<string, LucySpendingCategory>();
  expenses.forEach((expense) => {
    const existing = grouped.get(expense.category) ?? { category: expense.category, total: 0, count: 0 };
    existing.total += recordedAmount(expense);
    existing.count += 1;
    grouped.set(expense.category, existing);
  });
  const categories = Array.from(grouped.values()).sort((left, right) => right.total - left.total);
  const scopeWord = win.label; // honest scope: "in total" / "this month" / "the last 7 days" / "last month" / "today" / "this year"
  const isAll = win.kind === 'all';
  const summary = expenses.length
    ? `I remember ${expenses.length} payment${expenses.length === 1 ? '' : 's'} ${scopeWord}, totaling ${total.toFixed(2)} in recorded amounts.`
    : `I do not remember any recorded payments ${scopeWord} yet.`;
  await insertQuestionSignal(db, question, isAll ? 'total_spending_summary' : 'monthly_spending_summary', summary, 'Maintain a spending insight view.');
  await organizeMemory(db, 'question');
  return {
    supported: true,
    answerKind: 'spending',
    title: isAll ? 'Total recorded payments' : `Recorded payments · ${scopeWord}`,
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
  // Pick the MOST SPECIFIC match, not the first. Generic single-word areas ("work", "life")
  // otherwise hijack questions like "who is Monisha" or "my Snowflake work" — pulling the wrong
  // sources (and previously leaking unrelated private captures). Demote generics, then prefer the
  // longest entity name.
  const GENERIC_AREAS = new Set(['work', 'life', 'personal', 'stuff', 'things', 'general', 'misc', 'product', 'focus']);
  const rankedEntities = matchedEntities.slice().sort((a, b) => {
    const na = normalizeMemoryLookupText(a.name);
    const nb = normalizeMemoryLookupText(b.name);
    const ga = GENERIC_AREAS.has(na) ? 1 : 0;
    const gb = GENERIC_AREAS.has(nb) ? 1 : 0;
    if (ga !== gb) return ga - gb; // non-generic first
    return nb.length - na.length;  // then most specific (longest)
  });
  const subject = rankedEntities[0]?.name;
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
  // Scope evidence to the CHOSEN subject only, so a co-matched generic area ("work") can't drag in
  // unrelated captures (including private ones) as sources.
  const matchedNames = new Set([normalizeMemoryLookupText(subject)]);
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
  const countSummary = `I remember ${sources.length} relevant thought${sources.length === 1 ? '' : 's'} and ${memoryConnections.length} connection${memoryConnections.length === 1 ? '' : 's'} for ${subject}.`;

  // Synthesize a real answer from the gathered evidence instead of just counting. Falls back
  // to the count if the LLM is unavailable. Secrets in the evidence are tokenized first.
  let message = countSummary;
  const evidenceText = [
    ...sources.map((s) => `- ${s.title}${s.summary ? `: ${s.summary}` : ''}`),
    ...(memoryConnections.length ? ['Connections:', ...memoryConnections.map((c) => `- ${c.statement}`)] : []),
  ].join('\n');
  if (evidenceText.trim()) {
    try {
      const sys = `You are LUCY, the user's second brain. In 2-4 natural sentences, tell the user what you actually know about "${subject}" from the memory below. Be specific with concrete facts. Do NOT count items or mention IDs — just answer naturally. If it's sparse, say so briefly.`;
      const { available, openAIKey } = await resolveRemoteAvailability();
      if (available) {
        const contacts = (await db.getAllAsync<{ name: string }>('SELECT name FROM people')).map((r) => r.name);
        const { detectNamesOnDevice } = await import('./deviceNer');
        const llmNames = await detectNamesOnDevice(evidenceText);
        const srcIds = sources.map((s) => s.captureId).filter(Boolean);
        const knownSecrets: string[] = [];
        if (srcIds.length) {
          const pv = await db.getAllAsync<{ protected_values: string | null }>(
            `SELECT protected_values FROM captures WHERE id IN (${srcIds.map(() => '?').join(',')})`, ...srcIds,
          );
          pv.forEach((r) => { if (r.protected_values) { try { (JSON.parse(r.protected_values) as Array<{ value: string }>).forEach((p) => { if (p?.value) knownSecrets.push(p.value); }); } catch { /* ignore */ } } });
        }
        const { redacted, map } = shieldText(evidenceText, [...contacts, ...llmNames, ...knownSecrets]);
        message = restoreText(await promptAI(sys + (map.length ? PLACEHOLDER_NOTE : ''), redacted, openAIKey), map);
      } else {
        message = await promptDevice(`${sys}\n${evidenceText}\n/no_think`);
      }
    } catch { /* keep the count fallback */ }
  }

  await insertQuestionSignal(db, question, 'memory_map_lookup', message, 'Prioritize entity-based memory retrieval with supporting thoughts.');
  await organizeMemory(db, 'question');
  return {
    supported: true,
    answerKind: 'memory',
    title: `${subject} in memory`,
    message,
    tasks: [],
    deadlines: [],
    memorySubject: subject,
    connections: memoryConnections,
    sources,
    recordedSignal: 'Answered from connected memory.',
  };
}

function detectsCaptureIntent(text: string): boolean {
  // A question is NEVER a capture command — "do you remember that meeting?" must be answered, not
  // saved as a new note. Exclude interrogatives (leading question word or a trailing '?').
  const t = text.trim();
  if (/\?\s*$/.test(t) || /^\s*(do|does|did|are|is|was|were|can|could|would|will|what|who|whom|when|where|why|how|which)\b/i.test(t)) {
    return false;
  }
  return /\b(add|save|remember|capture|note|log|record)\b.{0,30}\b(this|that|progress|update|today|memory)\b/i.test(text)
    || /\b(yes,?\s*add|please\s*(add|save|remember))\b/i.test(text);
}

export interface AskTurn { role: 'user' | 'lucy'; content: string }

function formatHistory(history: AskTurn[]): string {
  if (!history || history.length === 0) return '';
  const lines = history.slice(-8).map((t) => `${t.role === 'user' ? 'User' : 'LUCY'}: ${t.content}`);
  return `CONVERSATION SO FAR (use this to understand follow-ups like "yes", "do that", "the first one"):\n${lines.join('\n')}\n\n`;
}

async function answerWithLLM(question: string, history: AskTurn[] = [], screenContext?: string): Promise<LucyAnswer> {
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
    // Include auto-private captures (e.g. password notes) — the Privacy Shield below tokenizes
    // their secrets before any cloud call, so names/topics in them are recallable WITHOUT the
    // secret leaking. Only EXCLUDE captures the user explicitly marked private.
    relevantCaptures = similar
      .filter((s) => !s.capture.user_marked_private && s.capture.raw_transcript?.trim())
      .map((s) => s.capture);
  } catch { /* fall through */ }

  if (relevantCaptures.length < 3) {
    const recent = await listRecentCaptures(db, 20);
    const seen = new Set(relevantCaptures.map((c) => c.id));
    for (const c of recent) {
      if (!seen.has(c.id) && !c.user_marked_private && c.raw_transcript?.trim()) {
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

  // For health/nutrition/weight questions, attach the user's own body profile + today's data so LUCY
  // answers from it instead of claiming it has no data (the user explicitly asked + set up a profile).
  let healthPrefix = '';
  try {
    const { isHealthQuestion, buildHealthContextPrefix } = await import('./healthSummary');
    if (isHealthQuestion(question)) healthPrefix = await buildHealthContextPrefix(db);
  } catch { /* health context optional */ }

  // No captures AND no health context to answer from → ask for input. (Health questions answer from the
  // profile, so they're allowed through even with an empty note history.)
  if (!context.trim() && !healthPrefix) {
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
  const systemPrompt = `${userPrefix}${healthPrefix}${memoryAnswerSystemPrompt}`;
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
    screenContext ? `CURRENT APP SCREEN: ${screenContext}` : null,
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
      // Privacy Shield: passwords + names in the retrieved memory context are tokenized
      // on-device before the cloud call, and restored in the answer afterwards. So LUCY
      // can answer "what is my wifi password" with the real value WITHOUT it ever leaving
      // the device — the model only ever sees/says [SECRET_1].
      const contacts = (await db.getAllAsync<{ name: string }>('SELECT name FROM people')).map((r) => r.name);
      const { detectNamesOnDevice } = await import('./deviceNer');
      const llmNames = await detectNamesOnDevice(input);
      // Trust each capture's ALREADY-detected secrets (stored protected_values): re-detection
      // can miss a password (e.g. "password X" with no is/:/=), so feed the known values in
      // explicitly to GUARANTEE they're tokenized before the cloud call. Critical now that
      // auto-private (password) captures are included in the Ask context.
      const knownSecrets: string[] = [];
      for (const c of contextCaptures) {
        if (!c.protected_values) continue;
        try { (JSON.parse(c.protected_values) as Array<{ value: string }>).forEach((p) => { if (p?.value) knownSecrets.push(p.value); }); } catch { /* ignore */ }
      }
      const { redacted, map } = shieldText(input, [...contacts, ...llmNames, ...knownSecrets]);
      const shieldedSystem = systemPrompt + (map.length ? PLACEHOLDER_NOTE : '');
      // One quiet retry: the FIRST remote call after launch can fail on a cold socket/DNS warmup —
      // a silent retry beats showing the user an error on their very first question.
      let raw: string;
      try { raw = await promptAI(shieldedSystem, redacted, openAIKey); }
      catch { await new Promise((r) => setTimeout(r, 600)); raw = await promptAI(shieldedSystem, redacted, openAIKey); }
      llmResponse = restoreText(raw, map);
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
    // Never show a scary failure. Tailor the gentle fallback: if remote intelligence simply isn't
    // set up, guide them there; otherwise it was a transient hiccup — invite a retry, don't alarm.
    let remoteOn = false;
    try { remoteOn = (await resolveRemoteAvailability()).available; } catch { /* assume off */ }
    llmResponse = remoteOn
      ? 'I couldn’t quite reach my cloud brain just then — give me one more try in a moment and I’ll pick this right up.'
      : 'I can answer this best with remote intelligence turned on (Settings → Remote intelligence). Add a key and I’ll dig into your memory for you.';
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

async function answerScheduling(question: string): Promise<LucyAnswer> {
  const db = await getDatabase();
  const task = extractSchedulableTask(question);
  const { suggestForText, commitBlock, commitSeries } = await import('../scheduling');
  const { describeResources } = await import('../scheduling/resources');
  const { detectRecurrence } = await import('../scheduling/classify');
  const { computeStart } = await import('../voice/timeResolve');
  const r = await suggestForText(db, task, { maxResults: 3 });
  const fmtWhen = (ms: number): string =>
    new Date(ms).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  // EXPLICIT time given ("schedule gym at 6:30am tomorrow") → commit it directly (conflict-checked),
  // consistent with the voice command path. No explicit time → fall through to suggest + confirm.
  const explicit = parseExplicitDateTime(question);
  const startMs = explicit ? computeStart(explicit.day, explicit.time, Date.now()) : null;
  if (startMs) {
    const endMs = startMs + r.meta.durationMin * 60_000;
    const recurrence = detectRecurrence(question);
    const common = { title: r.meta.title, startMs, endMs, resources: r.meta.resources, energy: r.meta.energy, location: r.meta.resources.location ?? null, todoId: null };
    if (recurrence) {
      const { count } = await commitSeries(db, common, recurrence);
      const message = count > 0
        ? `Added "${r.meta.title}" to your calendar — ${recurrence}, starting ${fmtWhen(startMs)} (${count} occurrence${count === 1 ? '' : 's'}).`
        : `"${r.meta.title}" is already on your calendar for those times — nothing to add.`;
      await insertQuestionSignal(db, question, 'schedule_committed', message, 'Committed a recurring block at the user-specified time.');
      return { supported: true, answerKind: 'schedule', scheduleSuggestions: [], title: `Scheduled ${r.meta.title}`, message, tasks: [], deadlines: [], recordedSignal: message };
    }
    const res = await commitBlock(db, common);
    if (res.ok) {
      const message = `Added "${r.meta.title}" to your calendar at ${fmtWhen(startMs)} (${r.meta.durationMin} min).`;
      await insertQuestionSignal(db, question, 'schedule_committed', message, 'Committed a block at the user-specified time.');
      return { supported: true, answerKind: 'schedule', scheduleSuggestions: [], title: `Scheduled ${r.meta.title}`, message, tasks: [], deadlines: [], recordedSignal: message };
    }
    // The requested time clashes — explain the conflict and offer the conflict-free alternatives.
    const clash = res.conflict?.b?.title ? ` It clashes with "${res.conflict.b.title}".` : (res.conflict?.reason ? ` ${res.conflict.reason}` : '');
    const alts = r.suggestions.slice(0, 3).map((s) => fmtWhen(s.start)).join('  ·  ');
    const message = `I couldn't put "${r.meta.title}" at ${fmtWhen(startMs)}.${clash}`
      + (alts ? `\nOpen instead: ${alts}` : '\nNo nearby free slot — want to shorten it or free up that time?');
    await insertQuestionSignal(db, question, 'schedule_suggestion', message, 'Requested time conflicted; offered alternatives.');
    return {
      supported: true, answerKind: 'schedule',
      scheduleSuggestions: r.suggestions.map((s) => ({ title: r.meta.title, start: s.start, end: s.end, rationale: s.rationale, resourceLabel: describeResources(r.meta.resources), durationMin: r.meta.durationMin })),
      title: `That time is taken`, message, tasks: [], deadlines: [], recordedSignal: message,
    };
  }

  const suggestions: ScheduleSuggestionDTO[] = r.suggestions.map((s) => ({
    title: r.meta.title, start: s.start, end: s.end, rationale: s.rationale,
    resourceLabel: describeResources(r.meta.resources), durationMin: r.meta.durationMin,
  }));

  let message: string;
  if (suggestions.length === 0) {
    message = `I couldn't find a free, conflict-free slot for "${r.meta.title}" in the next week within your available hours. Want to extend your working hours or shorten the task?`;
  } else {
    const top = suggestions[0];
    const alts = suggestions.slice(1).map((s) => s.rationale).join('  ·  ');
    message = `Best time for "${r.meta.title}" (${r.meta.durationMin} min, ${top.resourceLabel}): ${top.rationale}`
      + (alts ? `\nAlso open: ${alts}` : '')
      + `\nTell me which works (or say the exact time) and I'll add it.`;
  }

  await insertQuestionSignal(db, question, 'schedule_suggestion', message, 'Help the user find conflict-free time for new work.');
  return {
    supported: true,
    answerKind: 'schedule',
    scheduleSuggestions: suggestions,
    title: suggestions.length ? `Suggested time for ${r.meta.title}` : 'No free slot found',
    message,
    tasks: [],
    deadlines: [],
    recordedSignal: 'Found conflict-free time based on your calendar and routines.',
  };
}

export async function askLucy(
  question: string,
  captureCallback?: (text: string) => Promise<void>,
  history: AskTurn[] = [],
  screenContext?: string,
): Promise<LucyAnswer> {
  const db = await getDatabase();
  const trimmed = question.trim();

  // SAFETY FIRST: emergency/crisis symptoms override everything — never run normal answering on these.
  try {
    const { detectRedFlag } = await import('./drLucy');
    const flag = detectRedFlag(trimmed);
    if (flag) {
      return { supported: true, answerKind: 'llm', title: '', message: flag.message, tasks: [], deadlines: [], recordedSignal: '', llmResponse: flag.message };
    }
  } catch { /* safety check is best-effort but should never throw */ }

  // Semantic tool router (dark-launched behind `semantic_router_enabled`, default OFF). Safety
  // red-flag stays ABOVE this. When the flag is on, route via the tool registry; on any miss/failure
  // fall through to the existing path so behavior is never worse than today.
  try {
    const { getSetting } = await import('../db/settings');
    if ((await getSetting(db, 'semantic_router_enabled')) === 'on') {
      const { runSemanticRouter } = await import('./tools');
      const routed = await runSemanticRouter(db, trimmed, history, screenContext);
      if (routed) return routed;
    }
  } catch { /* fall through to the legacy path */ }

  // Mid-conversation follow-ups (e.g. "yes", "do that", "the first one", "option 2")
  // must be answered WITH the prior turns as context — never treated as a brand-new
  // capture or matched against the standalone structured detectors.
  const isShortFollowUp = history.length > 0 && trimmed.split(/\s+/).length <= 6;
  if (isShortFollowUp) {
    return answerWithLLM(trimmed, history, screenContext);
  }

  // Interactive reorganization: LUCY proposes concrete task-list changes to approve.
  try {
    const { isReorganizeRequest, planTaskReorganization } = await import('./lucyActions');
    if (isReorganizeRequest(trimmed)) {
      const plan = await planTaskReorganization(trimmed, history);
      return {
        supported: true,
        answerKind: 'llm',
        title: '',
        message: '',
        tasks: [],
        deadlines: [],
        recordedSignal: '',
        llmResponse: plan.message,
        proposedActions: plan.actions.length > 0 ? plan.actions : undefined,
      };
    }
  } catch { /* fall through to normal answer */ }

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
  // Long / multi-topic / emotional messages → straight to the LLM (LUCY's strongest mode). Prevents a
  // keyword like "today" in a stressed brain-dump from being hijacked into a canned stats answer.
  if (isComplexOrEmotionalQuery(trimmed)) {
    return answerWithLLM(trimmed, history, screenContext);
  }
  if (recognizesSchedulingQuestion(trimmed)) {
    return answerScheduling(trimmed);
  }
  if (recognizesMonthlySpendingQuestion(trimmed)) {
    return answerMonthlySpending(trimmed);
  }
  if (recognizesMemoryMapQuestion(trimmed) && !recognizesTodayPlanQuestion(trimmed)) {
    return answerFromMemoryMap(trimmed);
  }
  if (!recognizesTodayPlanQuestion(trimmed)) {
    // No structured pattern matched — use LLM to answer from memory context.
    return answerWithLLM(trimmed, history, screenContext);
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
