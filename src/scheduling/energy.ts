/**
 * Energy curve (Phase 3 personalization). Learns when the user is sharp vs low from their
 * mood_entries (tone + energy by hour). Used to place deep work in genuine peak windows.
 * Falls back to null when there isn't enough data (caller keeps the inferred default).
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import type { DailyWindow } from './types';

function hourOf(ts: string): number {
  const iso = ts.includes('T') ? ts : ts.replace(' ', 'T');
  const d = new Date(iso + (iso.endsWith('Z') ? '' : 'Z'));
  return Number.isNaN(d.getTime()) ? -1 : d.getHours();
}

export interface EnergyCurve {
  peak: DailyWindow | null;   // best ~3h high-energy window for deep work
  trough: DailyWindow | null; // worst ~3h low-energy window (the "afternoon crash") to protect from deep work
}

/** Per-hour energy score (−99 = no data) built from mood_entries. Pure-ish; shared by peak + trough. */
function hourlyEnergy(rows: Array<{ created_at: string; energy: string | null; tone: string | null }>): { avg: number[]; cnt: number[] } {
  const sum = new Array(24).fill(0);
  const cnt = new Array(24).fill(0);
  for (const r of rows) {
    const h = hourOf(r.created_at);
    if (h < 0) continue;
    let s = 0;
    const e = (r.energy || '').toLowerCase();
    if (e === 'high') s += 2; else if (e === 'medium') s += 1; else if (e === 'low') s -= 1;
    const t = (r.tone || '').toLowerCase();
    if (t === 'positive' || t === 'excited') s += 1; else if (t === 'low' || t === 'negative' || t === 'stressed' || t === 'frustrated') s -= 1;
    sum[h] += s; cnt[h] += 1;
  }
  return { avg: sum.map((v, i) => (cnt[i] > 0 ? v / cnt[i] : -99)), cnt };
}

/** Learn both the peak (best) and trough (worst) ~3h windows from the user's mood/energy history. */
export async function computeEnergyCurve(db: SQLiteDatabase): Promise<EnergyCurve> {
  let rows: Array<{ created_at: string; energy: string | null; tone: string | null }> = [];
  try {
    rows = await db.getAllAsync('SELECT created_at, energy, tone FROM mood_entries WHERE created_at IS NOT NULL');
  } catch { return { peak: null, trough: null }; }
  if (rows.length < 15) return { peak: null, trough: null };

  const { avg, cnt } = hourlyEnergy(rows);

  // Slide a 3-hour window over the day; track both the highest and lowest-scoring window with data.
  let bestStart = -1, bestScore = -1e9;
  let worstStart = -1, worstScore = 1e9;
  for (let h = 6; h <= 19; h++) {
    const hrs = [h, h + 1, h + 2].filter((x) => cnt[x] > 0);
    if (hrs.length < 2) continue;
    const score = hrs.reduce((a, x) => a + avg[x], 0) / hrs.length;
    if (score > bestScore) { bestScore = score; bestStart = h; }
    if (score < worstScore) { worstScore = score; worstStart = h; }
  }

  const peak = bestStart >= 0 && bestScore > 0
    ? { label: 'Peak focus', startMin: bestStart * 60, endMin: (bestStart + 3) * 60 }
    : null;
  // Treat a window as a genuine dip if it's distinct from the peak AND either non-positive (real low)
  // or clearly below the user's own peak (relative crash) — absolute thresholds were too strict on real
  // data where the worst stretch is still mildly positive but well under the morning peak.
  const trough = worstStart >= 0 && worstStart !== bestStart && (worstScore < 0 || bestScore - worstScore >= 1.0)
    ? { label: 'Low-energy dip', startMin: worstStart * 60, endMin: (worstStart + 3) * 60 }
    : null;
  return { peak, trough };
}

/** Best contiguous ~3h high-energy window (within 6:00–22:00), or null if data is sparse. */
export async function computePeakWindow(db: SQLiteDatabase): Promise<DailyWindow | null> {
  return (await computeEnergyCurve(db)).peak;
}
