/**
 * Trip co-pilot — surfacing + planning. Turns a detected trip (trip.ts) into a propose-and-confirm offer
 * and, on confirm, a "Trip to X" project seeded with the pre-trip checklist + a check-in/leave-for-airport
 * reminder. Mirrors the move autopilot (movePlan.ts). Never auto-creates.
 *
 * Unlike a move (one-off → dismiss forever), trips recur, so "Not a trip" just clears the CURRENT offer;
 * a later travel capture can offer again. A matching "Trip to X" project already existing suppresses re-offers.
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import type { CaptureRow } from '../db/captures';
import type { ExtractionResult } from '../types/extraction';
import { createProject, listProjects } from '../db/projects';
import { detectTrip, tripPlan, TRIP_CHECKLIST, type TripSignal } from './trip';
import { getSetting, setSetting } from '../db/settings';

const SIGNAL_KEY = 'trip_signal';

export interface StoredTripSignal {
  destination: string | null;
  dates: TripSignal['dates'];
  sample: string;
  captureId: number | null;
  detectedAt: string;
}

function projectNameFor(dest: string | null): string {
  return dest ? `Trip to ${dest}` : 'Upcoming trip';
}

async function hasTripProject(db: SQLiteDatabase, dest: string | null): Promise<boolean> {
  const want = projectNameFor(dest).toLowerCase();
  return (await listProjects(db)).some((p) => p.name.trim().toLowerCase() === want);
}

function dedupeDates(dates: TripSignal['dates']): TripSignal['dates'] {
  const seen = new Set<string>();
  const out: TripSignal['dates'] = [];
  for (const d of dates) { const k = `${d.label}|${d.dueISO}`; if (d.dueISO && !seen.has(k)) { seen.add(k); out.push(d); } }
  return out;
}

/** Called during extraction: remember a STRONG trip signal so the Projects tab can offer a trip plan. */
export async function maybeFlagTripSignal(db: SQLiteDatabase, extraction: ExtractionResult, capture: CaptureRow): Promise<void> {
  const signal = detectTrip(capture.raw_transcript ?? '', Date.parse(capture.created_at ?? '') || Date.now());
  if (!signal) return;
  // Strong = a named destination OR a date OR explicit travel words (flight/itinerary/etc.).
  const strong = !!signal.destination
    || signal.dates.length > 0
    || /\b(flight|flying|boarding pass|itinerary|layover|vacation|holiday|red[- ]?eye)\b/i.test(capture.raw_transcript ?? '');
  if (!strong) return;
  if (await hasTripProject(db, signal.destination)) return;

  let prior: StoredTripSignal | null = null;
  try { const raw = await getSetting(db, SIGNAL_KEY); if (raw) prior = JSON.parse(raw) as StoredTripSignal; } catch { /* ignore */ }
  // Keep merging while the destination matches (or we didn't have one yet); a new destination replaces.
  const sameTrip = !prior || !signal.destination || !prior.destination || prior.destination.toLowerCase() === signal.destination.toLowerCase();
  const stored: StoredTripSignal = {
    destination: signal.destination ?? (sameTrip ? prior?.destination ?? null : null),
    dates: dedupeDates([...(sameTrip ? prior?.dates ?? [] : []), ...signal.dates]),
    sample: (capture.raw_transcript ?? '').replace(/\s+/g, ' ').trim().slice(0, 120) || (sameTrip ? prior?.sample ?? '' : ''),
    captureId: capture.id ?? (sameTrip ? prior?.captureId ?? null : null),
    detectedAt: new Date().toISOString(),
  };
  void extraction;
  await setSetting(db, SIGNAL_KEY, JSON.stringify(stored));
}

export async function getTripSignal(db: SQLiteDatabase): Promise<StoredTripSignal | null> {
  try {
    const raw = await getSetting(db, SIGNAL_KEY);
    if (!raw) return null;
    const sig = JSON.parse(raw) as StoredTripSignal;
    if (await hasTripProject(db, sig.destination)) return null; // already set up
    return sig;
  } catch { return null; }
}

/** "Not a trip" — clear the current offer (trips recur, so don't silence future ones). */
export async function dismissTripSignal(db: SQLiteDatabase): Promise<void> {
  await setSetting(db, SIGNAL_KEY, '');
}

export interface TripPlanResult { projectId: number; projectName: string; steps: number; departISO: string | null; reminderAt: string | null; peopleToSee: number; bookings: number }

export async function createTripPlan(db: SQLiteDatabase, signal: StoredTripSignal): Promise<TripPlanResult> {
  const captureId = signal.captureId ?? 0;
  const projectName = projectNameFor(signal.destination);
  const existing = (await listProjects(db)).find((p) => p.name.trim().toLowerCase() === projectName.toLowerCase());

  // Enrich from what LUCY already knows: people the user mentioned alongside the destination, and saved
  // vault bookings that name it. Best-effort — the plan still stands if any of this fails.
  let enrich = { peopleToSee: [] as string[], bookings: [] as string[] };
  try {
    const { enrichTrip } = await import('./tripEnrichment');
    const { listRecentCaptures } = await import('../db/captures');
    const { getAllPersonContexts } = await import('./relationshipEngine');
    const { listVaultItems } = await import('./documentVault');
    const [caps, people, vault] = await Promise.all([
      listRecentCaptures(db, 150), getAllPersonContexts(db), listVaultItems(db),
    ]);
    enrich = enrichTrip({
      destination: signal.destination,
      captures: caps.map((c) => c.raw_transcript ?? '').filter(Boolean),
      people: people.map((p) => p.name),
      vault: vault.map((v) => ({ title: v.title, description: v.description, keywords: v.keywords, bucket: v.bucket })),
    });
  } catch { /* enrichment is best-effort */ }

  const baseDesc = 'Your trip — the pre-trip checklist, dates, and a check-in nudge.';
  const description = enrich.bookings.length
    ? `${baseDesc}\n\nSaved bookings on file: ${enrich.bookings.join(', ')}.`
    : baseDesc;
  const projectId = existing?.id ?? await createProject(db, projectName, description);

  const departISO = signal.dates.find((d) => d.label === 'Departure')?.dueISO
    ?? signal.dates.find((d) => !!d.dueISO)?.dueISO
    ?? null;
  const dated = departISO ? tripPlan(departISO) : [];
  const dueFor = (task: string): string | null => dated.find((p) => p.task === task)?.dueISO ?? null;

  const { insertTodo } = await import('../db/todos');
  for (const step of TRIP_CHECKLIST) {
    const due = dueFor(step.task);
    const isKey = step.offsetDays === 0 || /check in/i.test(step.task);
    const context = due
      ? `${projectName} · by ${new Date(due).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
      : projectName;
    await insertTodo(db, captureId, { task: step.task, category: 'errand', urgency: isKey ? 'high' : 'medium', context }, 'normal');
  }

  // Make the generic "who to meet" step concrete: the people you've mentioned alongside this place.
  if (enrich.peopleToSee.length) {
    const names = enrich.peopleToSee.join(', ');
    const where = signal.destination ? ` to ${signal.destination}` : '';
    await insertTodo(
      db, captureId,
      { task: `Reach out to ${names} about your trip${where}`, category: 'errand', urgency: 'medium', context: `${projectName} · people to see` },
      'normal',
    );
  }

  // A check-in / leave-for-airport reminder on departure day.
  let reminderAt: string | null = null;
  if (departISO) {
    reminderAt = departISO;
    try {
      const { insertReminder, markReminderScheduled } = await import('../db/reminders');
      const where = signal.destination ? ` to ${signal.destination}` : '';
      const reminder = { text: `Check in online and head out for your trip${where}`, time: reminderAt, urgency: 'high' as const };
      const id = await insertReminder(db, captureId, reminder, 'normal');
      const { scheduleCapturedReminder } = await import('./notifications');
      const notifId = await scheduleCapturedReminder(id, reminder, 'normal', '');
      if (notifId) await markReminderScheduled(db, id, notifId);
    } catch { /* the plan still stands if scheduling fails */ }
  }

  await setSetting(db, SIGNAL_KEY, '');
  return { projectId, projectName, steps: TRIP_CHECKLIST.length, departISO, reminderAt, peopleToSee: enrich.peopleToSee.length, bookings: enrich.bookings.length };
}
