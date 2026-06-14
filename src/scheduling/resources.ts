/**
 * The conflict core. Two blocks may run in parallel ⇔ their exclusive-resource sets are
 * disjoint. This is pure, deterministic set logic — the foolproof heart of the scheduler.
 */
import type { ResourceAxis, TaskResources } from './types';

/** Conservative default for an unclassified/low-confidence task: hold attention AND body. */
export const DEFAULT_EXCLUSIVE: TaskResources = { axes: ['focus', 'self'], location: null };

/** Passive/background work (laundry, a download) — holds nothing, overlaps anything. */
export const PASSIVE: TaskResources = { axes: [], location: null };

/** Normalize: being at a location implies your body is there (self); dedupe axes. */
export function normalizeResources(r: TaskResources): TaskResources {
  const axes = new Set<ResourceAxis>(r.axes);
  const location = r.location?.trim() || null;
  if (location) axes.add('self');
  return { axes: Array.from(axes), location };
}

/**
 * Can blocks A and B occupy the same time? False if they share any binary axis, or both
 * require a location and the locations differ. Otherwise true.
 */
export function canCoexist(a: TaskResources, b: TaskResources): boolean {
  const na = normalizeResources(a);
  const nb = normalizeResources(b);
  for (const ax of na.axes) if (nb.axes.includes(ax)) return false;
  if (na.location && nb.location && na.location !== nb.location) return false;
  return true;
}

/** Human label of the resources a block holds, for "completely evident" UI. */
export function describeResources(r: TaskResources): string {
  const n = normalizeResources(r);
  if (n.axes.length === 0 && !n.location) return 'background';
  const parts: string[] = [];
  if (n.axes.includes('focus')) parts.push('focus');
  if (n.axes.includes('voice')) parts.push('voice');
  if (n.axes.includes('hands')) parts.push('hands');
  if (n.location) parts.push(`@${n.location}`);
  else if (n.axes.includes('self')) parts.push('in-person');
  return parts.join(' · ') || 'background';
}
