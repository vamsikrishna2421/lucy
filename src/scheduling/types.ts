/**
 * Intelligent Calendar — shared types. See docs/CALENDAR_STRATEGY.md.
 * The scheduler reasons over the timeline in epoch-ms; availability windows are stored as
 * minutes-from-local-midnight so they recur each day independent of date/timezone.
 */

/** Binary exclusive resource axes — two blocks sharing any one cannot run in parallel. */
export type ResourceAxis = 'focus' | 'self' | 'voice' | 'hands';
export const RESOURCE_AXES: ResourceAxis[] = ['focus', 'self', 'voice', 'hands'];

/** Exclusive resources a block consumes. `location` conflicts only when two differ. */
export interface TaskResources {
  axes: ResourceAxis[];
  location?: string | null;
}

export type EnergyLevel = 'deep' | 'shallow' | 'passive';
export type TimeWindow = 'morning' | 'afternoon' | 'evening' | 'workhours' | null;

/** Scheduling metadata for a task (classified once, then refined by learning). */
export interface SchedTaskMeta {
  title: string;
  durationMin: number;
  resources: TaskResources;
  energy: EnergyLevel;
  location?: string | null;
  timeWindow?: TimeWindow;
  deadline?: string | null; // ISO
  earliestMin?: number | null; // earliest start time-of-day (mins from midnight) — "after 6:30pm"
  latestMin?: number | null;   // latest start time-of-day — "before 9am"
  splittable?: boolean;
  confidence?: number;      // 0-1 classification confidence (low ⇒ treated conservatively)
}

export type BlockSource = 'calendar' | 'scheduled' | 'protected' | 'sleep';

/** A concrete occupied span on the timeline. */
export interface Block {
  id?: number;
  title: string;
  start: number; // epoch ms
  end: number;   // epoch ms
  resources: TaskResources;
  source: BlockSource;
  locked?: boolean;
  todoId?: number | null;
  calendarEventId?: string | null;
}

/** A recurring daily window (minutes from local midnight). */
export interface DailyWindow {
  label: string;
  startMin: number;
  endMin: number;
  days?: number[]; // 0=Sun..6=Sat; undefined = every day
}

export interface AvailabilityProfile {
  workStartMin: number;
  workEndMin: number;
  sleepStartMin: number; // e.g. 23:30 -> 1410
  sleepEndMin: number;   // e.g. 07:30 -> 450
  bufferMin: number;     // transition gap kept around exclusive blocks
  maxFocusMinPerDay: number;
  protectedWindows: DailyWindow[];
  peakWindows: DailyWindow[]; // high-energy (deep work fits best here)
  inferred: boolean;
  confirmedAt: string | null;
}

export interface SlotSuggestion {
  start: number;
  end: number;
  score: number;
  reasons: string[];
}
