/**
 * Mood-over-time series for the Health section. Turns raw mood_entries (tone + time) into a daily
 * valence line the user can read at a glance — "I was low last week, happier now" — plus a shift
 * detector that pinpoints WHEN the mood turned, so the user can jump to that day's timeline and find
 * the event that changed it. Pure mapping (tested) + a thin DB reader.
 */
import type { SQLiteDatabase } from 'expo-sqlite';

const DAY = 86_400_000;

/** Tone → valence on a −2..+2 scale (how good the mood reads). Unknown tones are neutral (0). */
const TONE_VALENCE: Record<string, number> = {
  excited: 2, happy: 1.6, positive: 1.5, grateful: 1.5, hopeful: 1.2, content: 1, calm: 0.6, relaxed: 0.8,
  neutral: 0, tired: -0.4, bored: -0.4,
  low: -1.2, sad: -1.6, down: -1.4, anxious: -1.4, stressed: -1.5, frustrated: -1.5, overwhelmed: -1.7,
  angry: -1.8, negative: -1.8, depressed: -2,
};

export function toneValence(tone: string | null | undefined): number {
  const v = TONE_VALENCE[(tone || '').toLowerCase().trim()];
  return v == null ? 0 : v;
}

export interface MoodPoint {
  date: string;     // YYYY-MM-DD (local)
  dayMs: number;    // local midnight epoch ms (for tapping → that day's timeline)
  score: number | null; // avg valence for the day, or null if no entries
  count: number;
  dominantTone: string | null;
}

interface MoodRow { tone: string; created_at: string }

function localDayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function localMidnight(ms: number): number {
  const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime();
}
function parseTs(s: string): number {
  const iso = s.includes('T') ? s : s.replace(' ', 'T');
  return new Date(iso.endsWith('Z') ? iso : `${iso}Z`).getTime();
}

/** Build a continuous per-day series over the last `days` (empty days carry score=null for graph gaps). */
export function buildSeries(rows: MoodRow[], days: number, now = Date.now()): MoodPoint[] {
  const byDay = new Map<string, { sum: number; count: number; tones: Record<string, number> }>();
  for (const r of rows) {
    const t = parseTs(r.created_at);
    if (!Number.isFinite(t)) continue;
    const key = localDayKey(t);
    const b = byDay.get(key) ?? { sum: 0, count: 0, tones: {} };
    b.sum += toneValence(r.tone); b.count += 1;
    const tone = (r.tone || 'neutral').toLowerCase(); b.tones[tone] = (b.tones[tone] ?? 0) + 1;
    byDay.set(key, b);
  }
  const out: MoodPoint[] = [];
  const start = localMidnight(now) - (days - 1) * DAY;
  for (let i = 0; i < days; i++) {
    const dayMs = start + i * DAY;
    const key = localDayKey(dayMs);
    const b = byDay.get(key);
    out.push({
      date: key, dayMs,
      score: b ? Math.round((b.sum / b.count) * 100) / 100 : null,
      count: b?.count ?? 0,
      dominantTone: b ? Object.entries(b.tones).sort((a, c) => c[1] - a[1])[0][0] : null,
    });
  }
  return out;
}

export interface MoodShift {
  direction: 'up' | 'down' | 'flat';
  sinceDate: string | null; // the day the turn began
  delta: number;            // recent avg − prior avg
  message: string;          // human, e.g. "Your mood has lifted over the last few days…"
}

/** Compare the recent window vs the prior window to call out a meaningful upturn/downturn + when. */
export function detectShift(series: MoodPoint[]): MoodShift {
  const pts = series.filter((p) => p.score != null) as Array<MoodPoint & { score: number }>;
  if (pts.length < 4) return { direction: 'flat', sinceDate: null, delta: 0, message: '' };

  const recentN = Math.min(4, Math.floor(pts.length / 2));
  const recent = pts.slice(-recentN);
  const prior = pts.slice(0, -recentN);
  const avg = (a: typeof pts) => a.reduce((s, p) => s + p.score, 0) / a.length;
  const delta = Math.round((avg(recent) - avg(prior)) * 100) / 100;

  if (Math.abs(delta) < 0.5) return { direction: 'flat', sinceDate: null, delta, message: '' };

  // Find where the turn began: first recent-window day that moved decisively toward the new level.
  const priorAvg = avg(prior);
  const turn = recent.find((p) => (delta > 0 ? p.score > priorAvg + 0.3 : p.score < priorAvg - 0.3)) ?? recent[0];
  const when = new Date(turn.dayMs).toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
  const message = delta > 0
    ? `Your mood has lifted since around ${when}. Open that day to see what turned things around.`
    : `Your mood has dipped since around ${when}. Worth a look at what changed.`;
  return { direction: delta > 0 ? 'up' : 'down', sinceDate: turn.date, delta, message };
}

export interface DayHighlight { id: number; title: string; snippet: string; time: string }

/** A day's captured notes (title + snippet), for tapping a mood point to find what moved it. */
export async function getDayHighlights(db: SQLiteDatabase, dayMs: number, limit = 6): Promise<DayHighlight[]> {
  const start = localMidnight(dayMs);
  const end = start + DAY;
  try {
    const rows = await db.getAllAsync<{ id: number; extracted_title: string | null; raw_transcript: string | null; created_at: string }>(
      `SELECT id, extracted_title, raw_transcript, created_at FROM captures
       WHERE archived_at IS NULL AND created_at >= datetime(?, 'unixepoch') AND created_at < datetime(?, 'unixepoch')
       ORDER BY created_at ASC LIMIT ?`,
      Math.floor(start / 1000), Math.floor(end / 1000), limit,
    );
    return rows.map((r) => ({
      id: r.id,
      title: (r.extracted_title || (r.raw_transcript || '').slice(0, 40) || 'Note').trim(),
      snippet: (r.raw_transcript || '').slice(0, 120).replace(/\s+/g, ' ').trim(),
      time: new Date(parseTs(r.created_at)).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }),
    }));
  } catch { return []; }
}

export interface MoodGraph { series: MoodPoint[]; shift: MoodShift; hasData: boolean }

export async function getMoodGraph(db: SQLiteDatabase, days = 30, now = Date.now()): Promise<MoodGraph> {
  let rows: MoodRow[] = [];
  try {
    rows = await db.getAllAsync<MoodRow>(
      "SELECT tone, created_at FROM mood_entries WHERE created_at > datetime('now', ?) ORDER BY created_at ASC",
      `-${days} days`,
    );
  } catch { return { series: [], shift: { direction: 'flat', sinceDate: null, delta: 0, message: '' }, hasData: false }; }
  const series = buildSeries(rows, days, now);
  return { series, shift: detectShift(series), hasData: rows.length > 0 };
}
