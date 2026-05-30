/**
 * Module-level singleton tracking Eleanor's brain seeding progress.
 * Lives outside any React component so seeding continues while user
 * navigates away from Settings.
 */

export type EleanorSeedStatus = 'idle' | 'seeding' | 'ready' | 'error';

let _status: EleanorSeedStatus = 'idle';
let _progress = 0;
const _listeners = new Set<() => void>();

export function getSeedState(): { status: EleanorSeedStatus; progress: number } {
  return { status: _status, progress: _progress };
}

export function subscribeSeedState(fn: () => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

function notify() {
  for (const fn of _listeners) fn();
}

/** Start seeding Eleanor's brain in the background. Safe to call multiple times. */
export async function startEleanorSeed(): Promise<void> {
  if (_status === 'seeding' || _status === 'ready') return;

  // Guard: never open a second connection if demo brain is already the active DB
  const { getActiveUser } = await import('./userManager');
  if (getActiveUser().id === 'demo') {
    // Already in Eleanor's brain — just mark ready
    _status = 'ready';
    _progress = 100;
    notify();
    return;
  }

  _status = 'seeding';
  _progress = 0;
  notify();

  try {
    const { openNamedDatabase } = await import('./index');
    const db = await openNamedDatabase('lucy_demo.db', 'lucy_database_key_demo');

    // Check if already seeded
    const count = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) as n FROM captures');
    if ((count?.n ?? 0) > 0) {
      await db.closeAsync();
      _status = 'ready';
      _progress = 100;
      notify();
      return;
    }

    const { seedDemoDataIfNeeded } = await import('../processing/demoSeed');
    await seedDemoDataIfNeeded(db, (pct: number) => {
      _progress = pct;
      notify();
    });

    await db.closeAsync();
    _status = 'ready';
    _progress = 100;
    notify();
  } catch {
    _status = 'error';
    notify();
  }
}
