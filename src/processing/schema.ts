import type { ExtractionResult } from '../types/extraction';

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' ? (value as UnknownRecord) : {};
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function requiredText(value: unknown, fallback: string): string {
  const result = text(value).trim();
  return result || fallback;
}

function texts(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function enumValue<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return typeof value === 'string' && options.includes(value as T) ? (value as T) : fallback;
}

function language(value: unknown): ExtractionResult['detected_language'] {
  const normalized = text(value).toLowerCase();
  const options: ExtractionResult['detected_language'][] = [
    'english',
    'hindi',
    'telugu',
    'tanglish',
    'mixed',
    'other',
  ];
  const exact = options.find((item) => item === normalized);
  if (exact) {
    return exact;
  }
  const mentioned = options.find((item) => normalized.includes(item));
  return mentioned ?? 'other';
}

function reminderTime(value: unknown): string | null {
  const raw = value === null ? '' : text(value);
  const time = Date.parse(raw);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

export function normalizeExtraction(value: unknown): ExtractionResult {
  const source = record(value);
  return {
    title: requiredText(source.title, 'Untitled capture'),
    summary: text(source.summary),
    note_type: enumValue(
      source.note_type,
      ['thought', 'task', 'idea', 'decision', 'meeting', 'journal', 'resource', 'reminder', 'project_update'],
      'thought',
    ),
    detected_language: language(source.detected_language),
    privacy_level: enumValue(source.privacy_level, ['private', 'local', 'normal'], 'normal'),
    privacy_reason: text(source.privacy_reason),
    projects: texts(source.projects),
    areas: texts(source.areas),
    people: texts(source.people),
    tasks: Array.isArray(source.tasks)
      ? source.tasks.map((item) => {
          const task = record(item);
          return {
            task: text(task.task),
            category: enumValue(
              task.category,
              ['youtube', 'place', 'idea', 'learning', 'errand', 'call', 'expense', 'other'],
              'other',
            ),
            urgency: enumValue(task.urgency, ['high', 'medium', 'low'], 'low'),
            context: text(task.context),
          };
        }).filter((item) => item.task.trim().length > 0)
      : [],
    expenses: Array.isArray(source.expenses)
      ? source.expenses.map((item) => {
          const expense = record(item);
          return {
            amount: text(expense.amount),
            description: text(expense.description),
            category: enumValue(expense.category, ['food', 'transport', 'shopping', 'entertainment', 'other'], 'other'),
          };
        }).filter((item) => item.amount.trim().length > 0 || item.description.trim().length > 0)
      : [],
    ideas: Array.isArray(source.ideas)
      ? source.ideas.map((item) => {
          const idea = record(item);
          return {
            title: text(idea.title),
            description: text(idea.description),
            type: enumValue(idea.type, ['startup', 'creative', 'personal', 'other'], 'other'),
          };
        }).filter((item) => item.title.trim().length > 0 || item.description.trim().length > 0)
      : [],
    places: Array.isArray(source.places)
      ? source.places.map((item) => {
          const place = record(item);
          return {
            name: text(place.name),
            reason: text(place.reason),
            urgency: enumValue(place.urgency, ['soon', 'someday'], 'someday'),
          };
        }).filter((item) => item.name.trim().length > 0)
      : [],
    interests: Array.isArray(source.interests)
      ? source.interests.map((item) => {
          const interest = record(item);
          return {
            topic: text(interest.topic),
            strength: enumValue(interest.strength, ['strong', 'moderate'], 'moderate'),
            evidence: text(interest.evidence),
          };
        }).filter((item) => item.topic.trim().length > 0)
      : [],
    decisions: texts(source.decisions),
    reminders: Array.isArray(source.reminders)
      ? source.reminders.map((item) => {
          const reminder = record(item);
          return {
            text: text(reminder.text),
            time: reminderTime(reminder.time),
            urgency: enumValue(reminder.urgency, ['high', 'medium', 'low'], 'low'),
          };
        }).filter((item) => item.text.trim().length > 0)
      : [],
    tags: texts(source.tags),
    suggested_folders: texts(source.suggested_folders),
    low_audio_warning: source.low_audio_warning === true,
    clarifications: Array.isArray(source.clarifications)
      ? source.clarifications.map((item) => {
          const clarification = record(item);
          return {
            snippet: text(clarification.snippet),
            question: text(clarification.question),
          };
        })
      : [],
    memory_gaps: Array.isArray(source.memory_gaps)
      ? source.memory_gaps.map((item) => {
          const gap = record(item);
          const confidence = enumValue(
            gap.confidence,
            ['high', 'medium', 'low', 'none'] as const,
            'none' as const,
          );
          const rawAnswer = text(gap.answer);
          const rawNotification = text(gap.notification);
          return {
            question: text(gap.question),
            context: text(gap.context),
            answer: rawAnswer.trim() || null,
            confidence,
            notification: rawNotification.trim() || null,
          };
        }).filter((item) => item.question.trim().length > 0 && item.confidence !== 'none')
      : [],
    open_loops: Array.isArray(source.open_loops)
      ? source.open_loops
          .map((item) => {
            const loop = record(item);
            return { description: text(loop.description) };
          })
          .filter((item) => item.description.trim().length > 0)
      : [],
    follow_ups: Array.isArray(source.follow_ups)
      ? source.follow_ups
          .map((item) => {
            const fu = record(item);
            return { assignee: text(fu.assignee), action: text(fu.action) };
          })
          .filter((item) => item.action.trim().length > 0)
      : [],
    mood: (() => {
      const validTones = ['positive','negative','neutral','stressed','excited','frustrated','calm'] as const;
      const validEnergy = ['high','medium','low'] as const;
      const m = record((source as Record<string, unknown>).mood);
      const rawTone = text(m?.tone ?? 'neutral');
      const rawEnergy = text(m?.energy ?? 'medium');
      const tone = validTones.includes(rawTone as typeof validTones[number]) ? rawTone as typeof validTones[number] : 'neutral';
      const energy = validEnergy.includes(rawEnergy as typeof validEnergy[number]) ? rawEnergy as typeof validEnergy[number] : 'medium';
      return { tone, energy };
    })(),
    importance: (() => {
      const raw = text((source as Record<string, unknown>).importance ?? 'normal').toLowerCase().trim();
      return (raw === 'low' || raw === 'high') ? raw : 'normal';
    })(),
    detected_action: (() => {
      const validActionTypes = ['timer','call','navigate','play','remind','event','message','shortcut','open_app'] as const;
      const raw = (source as Record<string, unknown>).detected_action;
      if (!raw || typeof raw !== 'object') return null;
      const a = raw as Record<string, unknown>;
      const type = text(a.type);
      if (!validActionTypes.includes(type as typeof validActionTypes[number])) return null;
      const displayText = text(a.displayText).trim();
      const confirmText = text(a.confirmText).trim();
      if (!displayText || !confirmText) return null;
      const params: Record<string, string> = {};
      if (a.params && typeof a.params === 'object') {
        for (const [k, v] of Object.entries(a.params as Record<string, unknown>)) {
          if (typeof v === 'string') params[k] = v;
          else if (typeof v === 'number') params[k] = String(v);
        }
      }
      return { type: type as typeof validActionTypes[number], params, displayText, confirmText };
    })(),
  };
}
