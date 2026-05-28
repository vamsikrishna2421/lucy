import type { ExtractionResult } from '../types/extraction';

const MONTHS: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

function hour24(hour: number, meridiem: string): number {
  const adjusted = hour % 12;
  return meridiem.toLowerCase() === 'pm' ? adjusted + 12 : adjusted;
}

export function parseEnglishReminderTime(input: string, now = new Date()): string | null {
  const absolute = input.match(
    /\b(?:on\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:,?\s+(\d{4}))?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i,
  );
  if (absolute) {
    const year = Number(absolute[3] ?? now.getFullYear());
    const month = MONTHS[absolute[1].toLowerCase()];
    const day = Number(absolute[2]);
    const hour = Number(absolute[4]);
    const minute = Number(absolute[5] ?? 0);
    if (day < 1 || day > 31 || hour < 1 || hour > 12 || minute < 0 || minute > 59) {
      return null;
    }
    const date = new Date(
      year,
      month,
      day,
      hour24(hour, absolute[6]),
      minute,
      0,
      0,
    );
    if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
      return null;
    }
    return date.toISOString();
  }

  const tomorrow = input.match(/\btomorrow\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (tomorrow) {
    const hour = Number(tomorrow[1]);
    const minute = Number(tomorrow[2] ?? 0);
    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) {
      return null;
    }
    const date = new Date(now);
    date.setDate(date.getDate() + 1);
    date.setHours(hour24(hour, tomorrow[3]), minute, 0, 0);
    return date.toISOString();
  }
  return null;
}

export function repairReminderTimes(
  extraction: ExtractionResult,
  originalInput: string,
): ExtractionResult {
  const deterministicTime = parseEnglishReminderTime(originalInput);
  if (!deterministicTime) {
    return extraction;
  }
  if (!extraction.reminders.length && /\bremind(?:er)?\b/i.test(originalInput)) {
    return {
      ...extraction,
      reminders: [{ text: originalInput, time: deterministicTime, urgency: 'medium' }],
    };
  }
  return {
    ...extraction,
    reminders: extraction.reminders.map((reminder) => ({
      ...reminder,
      time: deterministicTime,
    })),
  };
}
