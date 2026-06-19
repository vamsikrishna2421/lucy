/**
 * Savings-goal autopilot — surfacing + creation. Turns a detected goal (goalDetect.ts) into a
 * propose-and-confirm offer and, on confirm, a real money goal (db/moneyGoals.ts). Mirrors the move/trip
 * planners. Never auto-creates. Goals recur, so "Not now" only clears the CURRENT offer.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import type { CaptureRow } from '../db/captures';
import type { ExtractionResult } from '../types/extraction';
import { createMoneyGoal, listMoneyGoals } from '../db/moneyGoals';
import { detectSavingsGoal, type DetectedGoal } from './goalDetect';
import { getSetting, setSetting } from '../db/settings';

const SIGNAL_KEY = 'goal_signal';

export interface StoredGoalSignal extends DetectedGoal { sample: string; captureId: number | null; detectedAt: string }

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

async function hasGoalLike(db: SQLiteDatabase, label: string): Promise<boolean> {
  const want = norm(label);
  return (await listMoneyGoals(db)).some((g) => g.status === 'active' && norm(g.label) === want);
}

/** Called during extraction: remember a detected savings goal so the Goals tab can offer to create it. */
export async function maybeFlagGoalSignal(db: SQLiteDatabase, extraction: ExtractionResult, capture: CaptureRow): Promise<void> {
  const g = detectSavingsGoal(capture.raw_transcript ?? '', Date.parse(capture.created_at ?? '') || Date.now());
  if (!g) return;
  if (await hasGoalLike(db, g.label)) return; // already tracking this one
  const stored: StoredGoalSignal = {
    ...g,
    sample: (capture.raw_transcript ?? '').replace(/\s+/g, ' ').trim().slice(0, 120),
    captureId: capture.id ?? null,
    detectedAt: new Date().toISOString(),
  };
  void extraction;
  await setSetting(db, SIGNAL_KEY, JSON.stringify(stored));
}

export async function getGoalSignal(db: SQLiteDatabase): Promise<StoredGoalSignal | null> {
  try {
    const raw = await getSetting(db, SIGNAL_KEY);
    if (!raw) return null;
    const sig = JSON.parse(raw) as StoredGoalSignal;
    if (await hasGoalLike(db, sig.label)) return null; // user already created it
    return sig;
  } catch { return null; }
}

/** "Not now" — clear the current offer (goals recur, so don't silence future ones). */
export async function dismissGoalSignal(db: SQLiteDatabase): Promise<void> {
  await setSetting(db, SIGNAL_KEY, '');
}

export async function createGoalFromSignal(db: SQLiteDatabase, sig: StoredGoalSignal): Promise<number> {
  const id = await createMoneyGoal(db, {
    label: sig.label,
    target: sig.target,
    currency: sig.currency,
    deadline: sig.deadlineISO,
  });
  await setSetting(db, SIGNAL_KEY, '');
  return id;
}
