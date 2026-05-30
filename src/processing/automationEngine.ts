/**
 * LUCY Automation Engine — Phase 1
 *
 * Intent detection + action execution via URL schemes and native APIs.
 * Architecture: LUCY proposes → user confirms in one tap → executes.
 *
 * Phase 1 actions (zero special permissions beyond what's already granted):
 *   TIMER      — set a timer
 *   CALL       — initiate phone call
 *   NAVIGATE   — open maps with destination
 *   PLAY       — play music/podcast/playlist
 *   REMIND     — create reminder (uses expo-calendar/Reminders)
 *   MESSAGE    — pre-fill SMS/iMessage
 *   EMAIL      — pre-fill email
 *   SHORTCUT   — trigger a named iOS Shortcut
 *   OPEN_APP   — deep-link open any app
 */

import { Linking, Platform } from 'react-native';
import * as Calendar from 'expo-calendar';

export type ActionType =
  | 'timer'
  | 'call'
  | 'navigate'
  | 'play'
  | 'remind'
  | 'event'
  | 'message'
  | 'email'
  | 'shortcut'
  | 'open_app'
  | 'unknown';

export interface ExtractedAction {
  type: ActionType;
  confidence: number;   // 0-1
  params: Record<string, string>;
  displayText: string;  // human-readable "Call Mom"
  confirmText: string;  // "Tap to call Mom"
}

// ─── Intent pattern matching ─────────────────────────────────────────────────

const TIMER_PATTERNS = [
  /set (?:a )?timer (?:for )?(\d+)\s*(min(?:utes?)?|sec(?:onds?)?|hr?s?|hours?)/i,
  /(\d+)\s*(min(?:utes?)?|sec(?:onds?)?|hr?s?|hours?) timer/i,
  /remind me in (\d+)\s*(min(?:utes?)?|sec(?:onds?)?|hours?)/i,
];

const CALL_PATTERNS = [
  /call (\w[\w\s]+?)(?:\s+now|\s+please|$)/i,
  /(?:phone|ring|dial) (\w[\w\s]+?)(?:\s+now|\s+please|$)/i,
  /i need to call (\w[\w\s]+)/i,
];

const NAVIGATE_PATTERNS = [
  /navigate to (.+)/i,
  /take me to (.+)/i,
  /directions? to (.+)/i,
  /how do i get to (.+)/i,
  /open maps? (?:for |to )?(.+)/i,
];

const PLAY_PATTERNS = [
  /play (?:my )?(.+?)(?:\s+playlist|\s+album|\s+on spotify|\s+on apple music|$)/i,
  /start (?:playing )?(.+?)(?:\s+playlist|\s+music|$)/i,
  /put on (.+?)(?:\s+playlist|$)/i,
];

const REMIND_PATTERNS = [
  /add (.+?) to (?:my )?(grocery|shopping|todo|to-do|task|reminder)/i,
  /remind(?:er)? (?:me )?(?:to )?(.+)/i,
  /(?:grocery|shopping) (?:list|reminder)[:\s]+(.+)/i,
  /add (.+?) to (?:the )?list/i,
  /note (?:to )?(?:self[:\s]+)?(.+)/i,
];

const MESSAGE_PATTERNS = [
  /(?:text|message|sms|send a message to) (\w[\w\s]+?)[:\s]+(.+)/i,
  /tell (\w[\w\s]+?) (?:that )?(.+)/i,
];

const GEOFENCE_PATTERNS = [
  /remind me when i (?:get|arrive|reach|am at) (.+?)(?:\s+to (.+)|$)/i,
  /when i get (?:home|to (.+?))(?:,?\s*remind me (?:to )?(.+))?/i,
  /location reminder[:\s]+(.+)/i,
  /remind me at (.+?) (?:when|to) (.+)/i,
];

const EVENT_PATTERNS = [
  /schedule (?:a )?(?:meeting|call|appointment|lunch|dinner|event)? ?(?:with (\w[\w\s]+?))? ?(tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)?(?:\s+at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?))?/i,
  /add (?:a )?(?:meeting|call|appointment|event) (?:with (\w[\w\s]+?))? ?(tomorrow|today)?(?:\s+at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?))?/i,
  /book (?:a )?(?:meeting|call|appointment) (?:with (\w[\w\s]+?))? ?(tomorrow|today)?(?:\s+at\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?))?/i,
];

const SHORTCUT_PATTERNS = [
  /run (?:my )?(?:shortcut|routine) (.+)/i,
  /start (?:my )?(.+?) (?:routine|shortcut)/i,
  /trigger (.+?) (?:routine|shortcut|automation)/i,
];

// ─── Duration parsing ────────────────────────────────────────────────────────

function parseDurationToSeconds(amount: string, unit: string): number {
  const n = parseInt(amount, 10);
  if (/min/i.test(unit)) return n * 60;
  if (/sec/i.test(unit)) return n;
  if (/hr|hour/i.test(unit)) return n * 3600;
  return n * 60; // default minutes
}

// ─── Contact lookup ─────────────────────────────────────────────────────────

async function findContactPhone(name: string): Promise<string | null> {
  try {
    // Dynamic import with require to bypass missing type declarations
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Contacts = require('expo-contacts') as { requestPermissionsAsync(): Promise<{ status: string }>; getContactsAsync(opts: Record<string,unknown>): Promise<{ data: Array<{ phoneNumbers?: Array<{ number?: string }> }> }>; Fields: Record<string, string> };
    const { status } = await Contacts.requestPermissionsAsync();
    if (status !== 'granted') return null;
    const { data } = await Contacts.getContactsAsync({
      fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name],
      name,
    });
    const contact = data[0];
    return (contact?.phoneNumbers?.[0] as any)?.number ?? null;
  } catch {
    return null;
  }
}

// ─── Reminder creation ───────────────────────────────────────────────────────

async function createReminder(title: string, listName?: string): Promise<boolean> {
  try {
    const { status } = await Calendar.requestRemindersPermissionsAsync();
    if (status !== 'granted') return false;

    // Get reminder lists (entity type REMINDER on iOS)
    const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.REMINDER);
    let targetList = listName
      ? calendars.find((c) => c.title.toLowerCase().includes(listName.toLowerCase()))
      : calendars[0];
    if (!targetList) targetList = calendars[0];
    if (!targetList) return false;

    await Calendar.createReminderAsync(targetList.id, { title, completed: false });
    return true;
  } catch {
    return false;
  }
}

// ─── Main detection function ─────────────────────────────────────────────────

export function detectAutomationIntent(text: string): ExtractedAction | null {
  const t = text.trim();

  // TIMER
  for (const pattern of TIMER_PATTERNS) {
    const m = t.match(pattern);
    if (m) {
      const seconds = parseDurationToSeconds(m[1], m[2]);
      const label = seconds >= 3600 ? `${seconds / 3600}h` : seconds >= 60 ? `${seconds / 60}m` : `${seconds}s`;
      return {
        type: 'timer',
        confidence: 0.95,
        params: { seconds: String(seconds), label },
        displayText: `Set ${label} timer`,
        confirmText: `Start ${label} timer`,
      };
    }
  }

  // CALL
  for (const pattern of CALL_PATTERNS) {
    const m = t.match(pattern);
    if (m) {
      const name = m[1].trim();
      return {
        type: 'call',
        confidence: 0.9,
        params: { name },
        displayText: `Call ${name}`,
        confirmText: `Call ${name}`,
      };
    }
  }

  // NAVIGATE
  for (const pattern of NAVIGATE_PATTERNS) {
    const m = t.match(pattern);
    if (m) {
      const dest = m[1].trim();
      return {
        type: 'navigate',
        confidence: 0.9,
        params: { destination: dest },
        displayText: `Navigate to ${dest}`,
        confirmText: `Open Maps → ${dest}`,
      };
    }
  }

  // PLAY
  for (const pattern of PLAY_PATTERNS) {
    const m = t.match(pattern);
    if (m) {
      const what = m[1].trim();
      return {
        type: 'play',
        confidence: 0.85,
        params: { query: what },
        displayText: `Play "${what}"`,
        confirmText: `Open Spotify → ${what}`,
      };
    }
  }

  // GEOFENCE REMINDER
  for (const pattern of GEOFENCE_PATTERNS) {
    const m = t.match(pattern);
    if (m) {
      const location = (m[1] ?? 'that location').trim();
      const task = (m[2] ?? '').trim() || 'Check in';
      return {
        type: 'remind' as ActionType,
        confidence: 0.87,
        params: { item: task, listHint: '', geofence: 'true', locationLabel: location },
        displayText: `Remind me when I get to ${location}: ${task}`,
        confirmText: `Set location reminder for ${location}`,
      };
    }
  }

  // EVENT / MEETING
  for (const pattern of EVENT_PATTERNS) {
    const m = t.match(pattern);
    if (m) {
      const person = m[1]?.trim();
      const day = m[2]?.trim();
      const time = m[3]?.trim();
      const titleParts = ['Meeting'];
      if (person) titleParts.push(`with ${person}`);
      const title = titleParts.join(' ');
      const display = `Schedule: ${title}${day ? ` ${day}` : ''}${time ? ` at ${time}` : ''}`;
      return {
        type: 'event',
        confidence: 0.88,
        params: { title, person: person ?? '', day: day ?? '', time: time ?? '' },
        displayText: display,
        confirmText: `Create calendar event: ${title}`,
      };
    }
  }

  // REMIND / ADD TO LIST
  for (const pattern of REMIND_PATTERNS) {
    const m = t.match(pattern);
    if (m) {
      const item = m[1].trim();
      const listHint = m[2]?.trim();
      return {
        type: 'remind',
        confidence: 0.88,
        params: { item, listHint: listHint ?? '' },
        displayText: `Add "${item}" to ${listHint ?? 'Reminders'}`,
        confirmText: `Add to ${listHint ?? 'Reminders'}: ${item}`,
      };
    }
  }

  // MESSAGE
  for (const pattern of MESSAGE_PATTERNS) {
    const m = t.match(pattern);
    if (m) {
      const name = m[1].trim();
      const body = m[2].trim();
      return {
        type: 'message',
        confidence: 0.85,
        params: { name, body },
        displayText: `Message ${name}: "${body}"`,
        confirmText: `Open Messages → ${name}`,
      };
    }
  }

  // SHORTCUT
  for (const pattern of SHORTCUT_PATTERNS) {
    const m = t.match(pattern);
    if (m) {
      const name = m[1].trim();
      return {
        type: 'shortcut',
        confidence: 0.9,
        params: { name },
        displayText: `Run Shortcut: "${name}"`,
        confirmText: `Start "${name}" routine`,
      };
    }
  }

  return null;
}

// ─── Action execution ─────────────────────────────────────────────────────────

export async function executeAction(action: ExtractedAction): Promise<{ success: boolean; message: string }> {
  try {
    switch (action.type) {

      case 'timer': {
        const seconds = parseInt(action.params.seconds ?? '60', 10);
        if (Platform.OS === 'android') {
          await Linking.openURL(`intent:#Intent;action=android.intent.action.SET_TIMER;S.android.intent.extra.alarm.LENGTH=${seconds};S.android.intent.extra.alarm.SKIP_UI=true;end`);
        } else {
          // iOS: use Shortcuts or clock app deep link
          const mins = Math.ceil(seconds / 60);
          await Linking.openURL(`shortcuts://run-shortcut?name=Set%20Timer&input=${mins}`);
        }
        return { success: true, message: `${action.params.label} timer started` };
      }

      case 'call': {
        const phone = await findContactPhone(action.params.name ?? '');
        if (phone) {
          await Linking.openURL(`tel:${phone.replace(/\s/g, '')}`);
          return { success: true, message: `Calling ${action.params.name}` };
        }
        // No phone found — open dialer with name search
        await Linking.openURL(`tel:`);
        return { success: false, message: `Couldn't find ${action.params.name} in contacts` };
      }

      case 'navigate': {
        const dest = encodeURIComponent(action.params.destination ?? '');
        const url = Platform.OS === 'ios'
          ? `maps://?q=${dest}`
          : `geo:0,0?q=${dest}`;
        await Linking.openURL(url);
        return { success: true, message: `Opening Maps to ${action.params.destination}` };
      }

      case 'play': {
        const q = encodeURIComponent(action.params.query ?? '');
        // Try Spotify first, fall back to Apple Music
        const spotifyUrl = `spotify:search:${action.params.query}`;
        const appleMusicUrl = `music://search?term=${q}`;
        const canSpotify = await Linking.canOpenURL(spotifyUrl);
        await Linking.openURL(canSpotify ? spotifyUrl : appleMusicUrl);
        return { success: true, message: `Playing ${action.params.query}` };
      }

      case 'remind': {
        // Check if it's a geofence reminder
        if (action.params.geofence === 'true') {
          const { createGeofenceReminder } = await import('./geofenceReminders');
          const result = await createGeofenceReminder(
            action.params.item ?? 'Check in',
            action.params.locationLabel ?? 'that location',
          );
          return result;
        }
        // Regular reminder
        const created = await createReminder(action.params.item ?? '', action.params.listHint);
        if (created) {
          return { success: true, message: `Added "${action.params.item}" to ${action.params.listHint || 'Reminders'}` };
        }
        await Linking.openURL('x-apple-reminderkit://');
        return { success: false, message: 'Could not create reminder — calendar permission needed' };
      }

      case 'event': {
        try {
          const { status } = await Calendar.requestCalendarPermissionsAsync();
          if (status !== 'granted') {
            await Linking.openURL(Platform.OS === 'ios' ? 'calshow://' : 'content://com.android.calendar/time/');
            return { success: false, message: 'Calendar permission needed — opened calendar to add manually' };
          }
          const calendars = await Calendar.getCalendarsAsync(Calendar.EntityTypes.EVENT);
          const defaultCal = calendars.find((c) => c.allowsModifications) ?? calendars[0];
          if (!defaultCal) return { success: false, message: 'No editable calendar found' };

          const now = new Date();
          let startDate = new Date(now);
          // Parse day
          if (/tomorrow/i.test(action.params.day ?? '')) startDate.setDate(now.getDate() + 1);
          // Parse time
          const timeMatch = (action.params.time ?? '').match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
          if (timeMatch) {
            let h = parseInt(timeMatch[1], 10);
            const m = parseInt(timeMatch[2] ?? '0', 10);
            const meridiem = timeMatch[3]?.toLowerCase();
            if (meridiem === 'pm' && h < 12) h += 12;
            if (meridiem === 'am' && h === 12) h = 0;
            startDate.setHours(h, m, 0, 0);
          } else {
            startDate.setHours(10, 0, 0, 0); // default 10am
          }
          const endDate = new Date(startDate.getTime() + 60 * 60 * 1000); // 1 hour

          await Calendar.createEventAsync(defaultCal.id, {
            title: action.params.title ?? 'Meeting',
            startDate,
            endDate,
            notes: action.params.person ? `With ${action.params.person}` : '',
          });
          return { success: true, message: `Created: ${action.params.title}` };
        } catch (err) {
          return { success: false, message: 'Could not create calendar event' };
        }
      }

      case 'message': {
        const phone = await findContactPhone(action.params.name ?? '');
        const to = phone?.replace(/\s/g, '') ?? '';
        const body = encodeURIComponent(action.params.body ?? '');
        await Linking.openURL(`sms:${to}${Platform.OS === 'ios' ? '&' : '?'}body=${body}`);
        return { success: true, message: `Composing message to ${action.params.name}` };
      }

      case 'shortcut': {
        const name = encodeURIComponent(action.params.name ?? '');
        await Linking.openURL(`shortcuts://run-shortcut?name=${name}`);
        return { success: true, message: `Running "${action.params.name}"` };
      }

      default:
        return { success: false, message: 'Action not supported yet' };
    }
  } catch (e) {
    return { success: false, message: `Could not execute: ${e instanceof Error ? e.message : 'unknown error'}` };
  }
}
