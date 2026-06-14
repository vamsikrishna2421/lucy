/**
 * LUCY Calendar Connector
 *
 * Reads the device calendar (with user permission) and:
 * 1. Injects upcoming events into every Ask query context
 * 2. Sends pre-meeting briefs 30 minutes before a meeting,
 *    synthesizing everything LUCY knows about the attendees
 * 3. After meetings, prompts user to capture notes
 */

import * as Calendar from 'expo-calendar';
import { Platform } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import { getSetting, setSetting } from '../db/settings';
import { promptAI } from '../ai/openai';
import { resolveRemoteAvailability } from '../ai/provider';
import { getAllPersonContexts } from './relationshipEngine';
import { getUserProfile, buildUserContextPrefix } from '../db/userProfile';
import { sendGuardianNotification } from './notifications';
import { listRecentCaptures } from '../db/captures';

export interface CalendarEvent {
  id: string;
  title: string;
  startDate: Date;
  endDate: Date;
  location?: string;
  notes?: string;
  attendees?: string[];
  calendarName?: string;
}

// ─── Permission ───────────────────────────────────────────────────────────────

export async function requestCalendarPermission(): Promise<boolean> {
  try {
    const { status } = await Calendar.requestCalendarPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

export async function hasCalendarPermission(): Promise<boolean> {
  try {
    const { status } = await Calendar.getCalendarPermissionsAsync();
    return status === 'granted';
  } catch {
    return false;
  }
}

// ─── Fetch events ─────────────────────────────────────────────────────────────

export async function getUpcomingEvents(daysAhead = 7): Promise<CalendarEvent[]> {
  if (!(await hasCalendarPermission())) return [];

  try {
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const calendarIds = calendars.map((c) => c.id);
    if (calendarIds.length === 0) return [];

    const now   = new Date();
    const end   = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
    const start = new Date(now.getTime() - 60 * 60 * 1000); // include events starting up to 1h ago

    const rawEvents = await Calendar.getEventsAsync(calendarIds, start, end);

    return rawEvents
      .filter((e) => e.title && !e.allDay) // skip all-day events for brief
      .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
      .slice(0, 20)
      .map((e) => {
        const cal = calendars.find((c) => c.id === (e as any).calendarId);
        return {
          id:          e.id,
          title:       e.title,
          startDate:   new Date(e.startDate),
          endDate:     new Date(e.endDate),
          location:    e.location ?? undefined,
          notes:       e.notes ?? undefined,
          attendees:   ((e as any).attendees ?? []).map((a: any) => a?.name ?? a?.email ?? '').filter(Boolean),
          calendarName: cal?.title,
        };
      });
  } catch {
    return [];
  }
}

// ─── Busy blocks + event creation (for the scheduler) ──────────────────────────

/** Timed calendar events in [fromMs,toMs] as engine Blocks (busy = focus+self+location). */
export async function calendarBusyBlocks(fromMs: number, toMs: number): Promise<import('../scheduling/types').Block[]> {
  if (!(await hasCalendarPermission())) return [];
  try {
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const ids = calendars.map((c) => c.id);
    if (ids.length === 0) return [];
    const raw = await Calendar.getEventsAsync(ids, new Date(fromMs), new Date(toMs));
    return raw
      .filter((e) => e.title && !e.allDay)
      .map((e) => ({
        title: e.title,
        start: new Date(e.startDate).getTime(),
        end: new Date(e.endDate).getTime(),
        resources: { axes: ['focus', 'self'] as Array<'focus' | 'self'>, location: e.location || null },
        source: 'calendar' as const,
        calendarEventId: e.id,
      }));
  } catch {
    return [];
  }
}

/** Find a writable calendar to create LUCY events in. */
async function getWritableCalendarId(): Promise<string | null> {
  try {
    if (Platform.OS === 'ios') {
      const def = await Calendar.getDefaultCalendarAsync();
      if (def?.id) return def.id;
    }
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
    const writable = calendars.find((c) => c.allowsModifications);
    return writable?.id ?? calendars[0]?.id ?? null;
  } catch {
    return null;
  }
}

/** Create a calendar event for a LUCY-scheduled block. Returns the event id, or null. */
export async function createLucyEvent(
  title: string, startMs: number, endMs: number, location?: string | null, notes?: string | null,
): Promise<string | null> {
  if (!(await hasCalendarPermission())) {
    if (!(await requestCalendarPermission())) return null;
  }
  const calId = await getWritableCalendarId();
  if (!calId) return null;
  try {
    return await Calendar.createEventAsync(calId, {
      title,
      startDate: new Date(startMs),
      endDate: new Date(endMs),
      location: location || undefined,
      notes: notes || 'Scheduled by LUCY',
      timeZone: undefined,
    });
  } catch {
    return null;
  }
}

export async function deleteLucyEvent(eventId: string): Promise<void> {
  try { await Calendar.deleteEventAsync(eventId); } catch { /* best effort */ }
}

// ─── Format for Ask context ───────────────────────────────────────────────────

export function formatCalendarContext(events: CalendarEvent[]): string {
  if (events.length === 0) return '';

  const now = new Date();
  const todayStr = now.toDateString();
  const tomorrowStr = new Date(now.getTime() + 86400000).toDateString();

  const lines = events.map((e) => {
    const start = e.startDate;
    const dayLabel = start.toDateString() === todayStr
      ? 'Today'
      : start.toDateString() === tomorrowStr
        ? 'Tomorrow'
        : start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

    const timeStr = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const minsUntil = Math.round((start.getTime() - now.getTime()) / 60000);
    const urgency = minsUntil > 0 && minsUntil <= 30 ? ` ← IN ${minsUntil} MINUTES` : '';

    const attendeePart = e.attendees && e.attendees.length > 0
      ? ` with ${e.attendees.slice(0, 3).join(', ')}`
      : '';
    const locationPart = e.location ? ` @ ${e.location}` : '';

    return `${dayLabel} ${timeStr}${urgency}: ${e.title}${attendeePart}${locationPart}`;
  });

  return `CALENDAR (upcoming ${lines.length} event${lines.length !== 1 ? 's' : ''}):\n${lines.join('\n')}`;
}

// ─── Pre-meeting brief ────────────────────────────────────────────────────────

const PRE_MEETING_SENT_KEY = 'pre_meeting_last_sent';

export async function checkAndSendPreMeetingBrief(db: SQLiteDatabase): Promise<void> {
  if (!(await hasCalendarPermission())) return;

  const events = await getUpcomingEvents(0.5); // next 12 hours only
  const now = Date.now();

  for (const event of events) {
    const minsUntil = (event.startDate.getTime() - now) / 60000;
    if (minsUntil < 25 || minsUntil > 35) continue; // only 25-35 mins before

    // Check if we already sent a brief for this event
    const sentKey = `${PRE_MEETING_SENT_KEY}_${event.id}`;
    const alreadySent = await getSetting(db, sentKey);
    if (alreadySent) continue;

    await generateAndSendPreMeetingBrief(db, event);
    await setSetting(db, sentKey, new Date().toISOString());
    break; // only one brief per background cycle
  }
}

async function generateAndSendPreMeetingBrief(db: SQLiteDatabase, event: CalendarEvent): Promise<void> {
  const timeStr = event.startDate.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const minsUntil = Math.round((event.startDate.getTime() - Date.now()) / 60000);

  // Base notification even without LLM
  const baseMessage = `"${event.title}" in ${minsUntil} minutes at ${timeStr}`;

  // Try to enrich with memory about attendees
  if (event.attendees && event.attendees.length > 0) {
    try {
      const [remote, people, captures, profile] = await Promise.all([
        resolveRemoteAvailability(),
        getAllPersonContexts(db),
        listRecentCaptures(db, 30),
        getUserProfile(db),
      ]);

      // Find relevant people from attendees
      const relevantPeople = people.filter((p) =>
        event.attendees!.some((a) => a.toLowerCase().includes(p.name.toLowerCase()) || p.name.toLowerCase().includes(a.toLowerCase())),
      );

      // Find relevant captures mentioning attendees or event title
      const relevantCaptures = captures
        .filter((c) => {
          const text = (c.raw_transcript ?? '').toLowerCase();
          return event.attendees!.some((a) => text.includes(a.toLowerCase())) ||
                 text.includes(event.title.toLowerCase());
        })
        .slice(0, 5);

      if ((relevantPeople.length > 0 || relevantCaptures.length > 0) && remote.available) {
        const userPrefix = buildUserContextPrefix(profile);
        const context = [
          `Upcoming: "${event.title}" in ${minsUntil} minutes`,
          relevantPeople.length > 0
            ? `People you know: ${relevantPeople.map((p) => `${p.name} (${p.typicalContext?.slice(0, 80) ?? 'no context'})`).join('; ')}`
            : '',
          relevantCaptures.length > 0
            ? `Related captures:\n${relevantCaptures.map((c) => c.raw_transcript?.slice(0, 120)).join('\n')}`
            : '',
        ].filter(Boolean).join('\n\n');

        const brief = await promptAI(
          `${userPrefix}You are LUCY. Generate a 2-sentence pre-meeting brief for the user. Be specific and useful. Mention key context from their memories. Plain text only.`,
          context,
          remote.openAIKey,
        );

        if (brief.trim()) {
          await sendGuardianNotification(brief.trim(), { kind: 'pre-meeting', eventTitle: event.title });
          return;
        }
      }
    } catch { /* fall through to base notification */ }
  }

  await sendGuardianNotification(baseMessage, { kind: 'pre-meeting', eventTitle: event.title });
}

// ─── Post-meeting capture prompt ──────────────────────────────────────────────

export async function checkAndSendPostMeetingPrompt(db: SQLiteDatabase): Promise<void> {
  if (!(await hasCalendarPermission())) return;

  const now = Date.now();
  const events = await getUpcomingEvents(0);
  const recentlyEnded = events.filter((e) => {
    const ended = (now - e.endDate.getTime()) / 60000;
    return ended >= 0 && ended <= 15; // ended in last 15 mins
  });

  for (const event of recentlyEnded) {
    const sentKey = `post_meeting_prompt_${event.id}`;
    const alreadySent = await getSetting(db, sentKey);
    if (alreadySent) continue;

    await sendGuardianNotification(
      `"${event.title}" just ended — capture your notes before they fade`,
      { kind: 'post-meeting', eventTitle: event.title },
    );
    await setSetting(db, sentKey, new Date().toISOString());
    break;
  }
}
