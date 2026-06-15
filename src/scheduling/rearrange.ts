/**
 * "Swap / adjust to accommodate" — when a new task cannot fit conflict-free, propose MOVING
 * existing movable blocks out of the way to make room, rather than just failing.
 *
 * This is a thin, deterministic layer over the pure engine: it reuses {@link findSlots} both to
 * detect that no clean slot exists AND to relocate each displaced block. It commits nothing — it
 * returns a proposal the caller can confirm (locked decision #2: suggest + confirm).
 */
import type { SQLiteDatabase } from 'expo-sqlite';
import type { Block, SchedTaskMeta, TaskResources } from './types';
import { getAvailability } from './availability';
import { nonWorkingBlocks } from './freeBusy';
import { findSlots } from './scheduler';
import { canCoexist } from './resources';
import { DAY, startOfLocalDay, overlaps } from './time';
import { listScheduledBlocks, rowToBlock, type ScheduledBlockRow } from '../db/schedule';

export interface RearrangeProposal {
  place: { start: number; end: number };
  moves: Array<{ blockId: number; title: string; from: number; to: number }>;
}

/** A committed block paired with its row (so we can read `energy`/`locked`, absent from Block). */
interface CommittedBlock {
  block: Block;
  row: ScheduledBlockRow;
}

/** True if a committed block may be relocated: it's a LUCY-scheduled block, unlocked, not fixed. */
function isMovable(c: CommittedBlock): boolean {
  return c.block.source === 'scheduled' && !c.block.locked && c.row.energy !== 'fixed';
}

/**
 * Propose a rearrangement that lets `meta` be placed by displacing conflicting movable blocks.
 *
 * Returns `null` when:
 *  - a conflict-free slot already exists (the normal scheduler handles it — no rearrangement), or
 *  - no valid target placement exists at all (even ignoring resource conflicts), or
 *  - any conflicting block at the target is fixed/locked/non-movable, or
 *  - any displaced block has nowhere conflict-free to go.
 */
export async function suggestRearrangement(
  db: SQLiteDatabase,
  meta: SchedTaskMeta,
  opts?: { horizonDays?: number },
): Promise<RearrangeProposal | null> {
  const av = await getAvailability(db);
  const now = Date.now();
  const horizonDays = opts?.horizonDays ?? 7;

  // 1. Busy timeline for the horizon: hard (sleep/protected) + resource (committed blocks).
  let to = startOfLocalDay(now) + (horizonDays + 1) * DAY;
  if (meta.deadline) {
    const due = Date.parse(meta.deadline);
    if (Number.isFinite(due)) to = Math.min(to, due);
  }
  const hardBlocks = nonWorkingBlocks(av, now, to);
  const schedRows = await listScheduledBlocks(db, now, to, ['committed']);
  const committed: CommittedBlock[] = schedRows.map((row) => ({ row, block: rowToBlock(row) }));
  const resourceBlocks: Block[] = committed.map((c) => c.block);

  // 2. If a conflict-free slot already exists, there's nothing to rearrange.
  const clean = findSlots({ meta, hardBlocks, resourceBlocks, availability: av, now, horizonDays, maxResults: 1 });
  if (clean.length) return null;

  // 3. Pick a target placement: the earliest/best slot that respects the HARD windows + the
  // task's own time-of-day constraints, ignoring resource conflicts. (Empty resourceBlocks ⇒
  // findSlots returns the preferred placement we then make room for.) Deterministic: the scorer
  // ranks it, and `findSlots` already thins to the single best candidate.
  const placed = findSlots({ meta, hardBlocks, resourceBlocks: [], availability: av, now, horizonDays, maxResults: 1 });
  if (!placed.length) return null; // no lawful placement even ignoring conflicts ⇒ give up.
  const place = { start: placed[0].start, end: placed[0].end };

  // Conflicting committed blocks overlapping the target that genuinely can't coexist.
  const conflicting = committed.filter(
    (c) => overlaps(place.start, place.end, c.block.start, c.block.end) && !canCoexist(meta.resources, c.block.resources),
  );
  if (!conflicting.length) {
    // Overlaps were all coexistable — `findSlots` would have placed it cleanly; nothing to do.
    return null;
  }

  // 4. Every conflicting block must be movable, else we bail (conservative — no forced bumps).
  if (conflicting.some((c) => !isMovable(c))) return null;

  // Relocate each displaced block. Treat the new task's placement as occupied, plus every block we
  // keep in place, plus the relocations we've already decided (so moves don't collide with each
  // other). Prefer the fewest moves: process fewest-first by handling each conflicting block once.
  const placeBlock: Block = {
    title: meta.title, start: place.start, end: place.end, resources: meta.resources, source: 'scheduled',
  };
  const movingIds = new Set(conflicting.map((c) => c.row.id));
  // Blocks that stay put (everything committed except the ones we're relocating).
  const staying: Block[] = committed.filter((c) => !movingIds.has(c.row.id)).map((c) => c.block);

  const moves: RearrangeProposal['moves'] = [];
  const relocated: Block[] = []; // new positions chosen so far

  for (const c of conflicting) {
    const dur = c.block.end - c.block.start;
    const blockMeta: SchedTaskMeta = {
      title: c.block.title,
      durationMin: Math.max(1, Math.round(dur / 60_000)),
      resources: c.block.resources as TaskResources,
      energy: 'shallow', // relocation is unconstrained by energy; honor only resources + windows.
    };
    // Avoid: every staying block, the new task's placement, the new positions already chosen, and
    // this block's OWN current position (so it actually moves somewhere new).
    const obstacles: Block[] = [...staying, placeBlock, ...relocated, c.block];
    const alt = findSlots({
      meta: blockMeta, hardBlocks, resourceBlocks: obstacles, availability: av, now, horizonDays, maxResults: 1,
    });
    if (!alt.length) return null; // can't rehome this block ⇒ no safe rearrangement.
    const dest = alt[0];
    moves.push({ blockId: c.row.id, title: c.block.title, from: c.block.start, to: dest.start });
    relocated.push({ ...c.block, start: dest.start, end: dest.start + dur });
  }

  return { place, moves };
}
