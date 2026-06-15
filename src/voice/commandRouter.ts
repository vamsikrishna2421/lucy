/**
 * Voice command router — the brain behind "Hey Lucy, …". Turns a natural-language command into a
 * concrete app ACTION across every feature, executes it, and returns a spoken confirmation + an
 * optional navigation hint. Used by the in-app voice button and the web Hey-Lucy bar (/api/voice).
 *
 * "Hey Lucy, schedule a 15 min walk this evening at 6:30" → creates the calendar block + says it back.
 */
import { jsonrepair } from 'jsonrepair';
import type { SQLiteDatabase } from 'expo-sqlite';
import { getDatabase } from '../db';

export type VoiceIntent = 'schedule' | 'capture' | 'task' | 'mood' | 'link' | 'project' | 'navigate' | 'ask';

export interface VoiceResult {
  ok: boolean;
  intent: VoiceIntent;
  speak: string;            // what LUCY says back (TTS)
  navigate?: string | null; // a section key the UI should open
  data?: Record<string, unknown>;
}

const VOICE_SYSTEM = `You are LUCY's voice command interpreter. Convert the user's spoken request into ONE structured action. Return STRICT JSON only — no markdown:
{"intent":"schedule|capture|task|mood|link|project|navigate|ask",
 "title":"<concise title/content>",
 "durationMin":<integer or null>,
 "time":"<HH:MM 24-hour, or null>",
 "day":"today|tomorrow|<YYYY-MM-DD>|null",
 "url":"<url or null>",
 "tone":"positive|neutral|low|negative|null",
 "section":"home|timeline|ask|tasks|calendar|documents|resources|projects|brain|people|health|money|null",
 "text":"<raw text for capture/ask>",
 "speak":"<one short friendly first-person confirmation, under 18 words>"}
Rules:
- "schedule/book/block/add … at <time>" or "find time for …" → intent "schedule" (title = the activity; durationMin default 30 if unsaid; fill time+day when given).
- "remember/note/capture/save that …" → "capture" (text = the thing to remember).
- "add a task/todo/remind me to …" → "task" (title = the task).
- "I feel …/log my mood …" → "mood" (tone).
- "save this link/add bookmark <url>" → "link" (url + title).
- "create/start a project …" → "project" (title).
- "open/go to/show me <section>" → "navigate" (section).
- Any question or anything else → "ask" (text = the full question).
- speak is natural, first-person as LUCY, confirms what you did or will do.`;

function computeStart(day: string | null, time: string | null, now: number): number | null {
  if (!time) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  if (!m) return null;
  const d = new Date(now);
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day)) {
    const p = day.split('-').map(Number); d.setFullYear(p[0], p[1] - 1, p[2]);
  } else if (day === 'tomorrow') {
    d.setDate(d.getDate() + 1);
  }
  d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  let ms = d.getTime();
  if (ms < now - 60_000 && (!day || day === 'today')) { d.setDate(d.getDate() + 1); ms = d.getTime(); }
  return ms;
}

interface ParsedCommand {
  intent: VoiceIntent; title?: string; durationMin?: number | null; time?: string | null; day?: string | null;
  url?: string | null; tone?: string | null; section?: string | null; text?: string | null; speak?: string;
}

async function interpret(text: string, context?: string): Promise<ParsedCommand> {
  const { resolveRemoteAvailability } = await import('../ai/provider');
  const { promptAI } = await import('../ai/openai');
  const { promptDevice } = await import('../ai/device');
  const { available, openAIKey } = await resolveRemoteAvailability();
  // Context-aware: the single mic button acts on whatever screen the user is on. Bias ambiguous
  // requests toward that screen's actions (e.g. a bare phrase on Calendar → schedule).
  const ctx = context ? `\nThe user is currently on the "${context}" screen. If the request is ambiguous, prefer actions for that screen.` : '';
  const sys = VOICE_SYSTEM + ctx;
  let raw: string;
  try {
    raw = available ? await promptAI(sys, text, openAIKey) : await promptDevice(`${sys}\n${text}\n/no_think`);
  } catch {
    return { intent: 'ask', text, speak: '' };
  }
  try {
    const s = raw.indexOf('{'); const e = raw.lastIndexOf('}');
    const obj = JSON.parse(jsonrepair(s >= 0 ? raw.slice(s, e + 1) : raw)) as ParsedCommand;
    if (!obj.intent) obj.intent = 'ask';
    return obj;
  } catch {
    return { intent: 'ask', text, speak: '' };
  }
}

/** Is this a "how do I / where is / how to use the app" help question? */
export function isHelpQuery(text: string): boolean {
  return /\b(how (do|can) i|how to|where (is|are|do i|can i)|how does (lucy|the app|this) work|what can (you|lucy) do|help me (use|with)|i don.?t know (how|where)|guide me|show me how)\b/i.test(text);
}

/** Answer a help question from LUCY's built-in manual. */
async function answerFromManual(question: string): Promise<string | null> {
  try {
    const { LUCY_MANUAL } = await import('./appManual');
    const { resolveRemoteAvailability } = await import('../ai/provider');
    const { promptAI } = await import('../ai/openai');
    const { promptDevice } = await import('../ai/device');
    const sys = `You are LUCY's in-app guide. Using ONLY the manual below, answer the user's question about how to use the app/website in 2-4 short sentences. Tell them exactly WHERE to tap/look. If it's not covered, say so briefly.\n\nMANUAL:\n${LUCY_MANUAL}`;
    const { available, openAIKey } = await resolveRemoteAvailability();
    return available ? await promptAI(sys, question, openAIKey) : await promptDevice(`${sys}\n\nQ: ${question}\n/no_think`);
  } catch { return null; }
}

/** Interpret a spoken command and EXECUTE it. Returns what to say + where to navigate. */
export async function runVoiceCommand(text: string, dbArg?: SQLiteDatabase, context?: string): Promise<VoiceResult> {
  const db = dbArg ?? await getDatabase();
  const cmd = await interpret(text, context);
  const now = Date.now();

  switch (cmd.intent) {
    case 'schedule': {
      const title = (cmd.title || 'Untitled').trim();
      const { classifyTask, detectRecurrence } = await import('../scheduling/classify');
      const meta = classifyTask(title, { durationMin: cmd.durationMin ?? undefined });
      // Recurrence is usually in the spoken command ("every day"), not the extracted title — read both.
      const rec = meta.recurrence || detectRecurrence(text);
      const recLabel = rec === 'weekdays' ? 'every weekday' : rec === 'weekly' ? 'weekly' : 'every day';
      const explicit = computeStart(cmd.day ?? null, cmd.time ?? null, now);
      const { commitBlock, commitSeries, suggestForText } = await import('../scheduling');
      const dur = Math.max(5, meta.durationMin) * 60_000;
      if (explicit) {
        const endMs = explicit + dur;
        if (rec) {
          const { count } = await commitSeries(db, { title, startMs: explicit, endMs, resources: meta.resources, energy: meta.energy, location: meta.location }, rec);
          const at = new Date(explicit).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
          return { ok: true, intent: 'schedule', speak: cmd.speak || `Done — "${title}" ${recLabel} at ${at} (${count} added).`, navigate: 'calendar' };
        }
        const r = await commitBlock(db, { title, startMs: explicit, endMs, resources: meta.resources, energy: meta.energy, location: meta.location }, { force: true });
        const when = new Date(explicit).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
        return { ok: true, intent: 'schedule', speak: r.conflict ? `Added "${title}" at ${when} — heads up, it overlaps something else.` : (cmd.speak || `Done — "${title}" is on your calendar at ${when}.`), navigate: 'calendar', data: { blockId: r.blockId } };
      }
      const sug = await suggestForText(db, title);
      if (!sug.suggestions.length) return { ok: false, intent: 'schedule', speak: `I couldn't find a free slot for "${title}".`, navigate: 'calendar' };
      const top = sug.suggestions[0];
      const when = new Date(top.start).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });
      if (rec) {
        const { count } = await commitSeries(db, { title, startMs: top.start, endMs: top.end, resources: sug.meta.resources, energy: sug.meta.energy, location: sug.meta.location }, rec);
        const at = new Date(top.start).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
        return { ok: true, intent: 'schedule', speak: cmd.speak || `Scheduled "${title}" ${recLabel} at ${at} (${count} added).`, navigate: 'calendar' };
      }
      const r = await commitBlock(db, { title, startMs: top.start, endMs: top.end, resources: sug.meta.resources, energy: sug.meta.energy, location: sug.meta.location });
      return { ok: r.ok, intent: 'schedule', speak: cmd.speak || `Scheduled "${title}" for ${when}.`, navigate: 'calendar', data: { blockId: r.blockId } };
    }
    case 'capture': {
      const body = (cmd.text || cmd.title || text).trim();
      const { enqueueTranscript, processQueue } = await import('../processing/extract');
      await enqueueTranscript(body, 'text'); void processQueue();
      return { ok: true, intent: 'capture', speak: cmd.speak || 'Captured — I’ll organize it.', navigate: 'timeline' };
    }
    case 'task': {
      const task = (cmd.title || cmd.text || '').trim();
      if (!task) return { ok: false, intent: 'task', speak: 'What task should I add?' };
      await db.runAsync("INSERT INTO todos (task, category, urgency, context, status) VALUES (?, 'general', 'medium', '', 'pending')", task);
      return { ok: true, intent: 'task', speak: cmd.speak || `Added "${task}" to your tasks.`, navigate: 'tasks' };
    }
    case 'mood': {
      const tone = ['positive', 'neutral', 'low', 'negative'].includes(String(cmd.tone)) ? String(cmd.tone) : 'neutral';
      await db.runAsync("INSERT INTO mood_entries (tone, energy) VALUES (?, 'medium')", tone);
      return { ok: true, intent: 'mood', speak: cmd.speak || `Logged that you’re feeling ${tone}.`, navigate: 'health' };
    }
    case 'link': {
      const url = (cmd.url || '').trim();
      if (!url) return { ok: false, intent: 'link', speak: 'What link should I save?' };
      await db.runAsync(
        "INSERT OR IGNORE INTO online_resources (url, title, platform, topic) VALUES (?, ?, 'web', 'General')",
        url, (cmd.title || url).trim(),
      );
      return { ok: true, intent: 'link', speak: cmd.speak || 'Saved that link to your resources.', navigate: 'resources' };
    }
    case 'project': {
      const name = (cmd.title || '').trim();
      if (!name) return { ok: false, intent: 'project', speak: 'What should I name the project?' };
      const { createProject } = await import('../db/projects');
      await createProject(db, name, null);
      return { ok: true, intent: 'project', speak: cmd.speak || `Created the "${name}" project.`, navigate: 'projects' };
    }
    case 'navigate': {
      const section = (cmd.section || 'home').trim();
      return { ok: true, intent: 'navigate', speak: cmd.speak || `Opening ${section}.`, navigate: section };
    }
    default: {
      // Help / how-to questions about using the app → answer from the built-in manual.
      if (isHelpQuery(text)) {
        const speak = await answerFromManual((cmd.text || text).trim());
        if (speak) return { ok: true, intent: 'ask', speak };
      }
      const { askLucy } = await import('../processing/ask');
      const ans = await askLucy((cmd.text || text).trim());
      const reply = (ans.llmResponse || ans.message || '').trim() || 'I’m not sure about that one.';
      return { ok: true, intent: 'ask', speak: reply, navigate: ans.answerKind === 'schedule' ? 'calendar' : null };
    }
  }
}
