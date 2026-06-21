/**
 * User color overrides — persistence for the in-app palette customizer.
 *
 * These are NON-SENSITIVE preferences (just hex strings), so they live in a small, SEPARATE,
 * UNENCRYPTED SQLite database — NOT the encrypted lucy.db. That matters because it lets us read them
 * *synchronously at module-load time* (the encrypted DB needs an async SecureStore key, so it can't be
 * read before React/StyleSheets evaluate). colors.ts calls `readColorOverridesSync()` at the very top of
 * its module body, so every `LUCY_COLORS.x` read — including the ones baked into StyleSheet.create — picks
 * up the user's chosen colors. Changes therefore apply on a (clean) app reload, which the customizer does.
 *
 * Keys are LUCY_COLORS token names (e.g. 'primary'); values are validated hex strings.
 */
import * as SQLite from 'expo-sqlite';

const PREFS_DB = 'lucy_prefs.db';
const OVERRIDES_KEY = 'color_overrides';

export type ColorOverrides = Record<string, string>;

let prefsDb: SQLite.SQLiteDatabase | null | undefined;

/** Open (once) the plain prefs DB + ensure the table. Returns null if sync sqlite is unavailable. */
function getPrefsDb(): SQLite.SQLiteDatabase | null {
  if (prefsDb !== undefined) return prefsDb;
  try {
    const db = SQLite.openDatabaseSync(PREFS_DB);
    db.execSync('CREATE TABLE IF NOT EXISTS prefs (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);');
    prefsDb = db;
  } catch {
    prefsDb = null;
  }
  return prefsDb;
}

/** A LUCY hex: #RGB, #RRGGBB, or #RRGGBBAA. */
export function isHexColor(v: unknown): v is string {
  return typeof v === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(v);
}

/**
 * Read saved overrides SYNCHRONOUSLY. Safe to call at module-load (used by colors.ts). Never throws —
 * returns {} on any error so the app always falls back to the default palette.
 */
export function readColorOverridesSync(): ColorOverrides {
  try {
    const db = getPrefsDb();
    if (!db) return {};
    const row = db.getFirstSync<{ value: string }>('SELECT value FROM prefs WHERE key = ?;', OVERRIDES_KEY);
    if (!row?.value) return {};
    const parsed: unknown = JSON.parse(row.value);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: ColorOverrides = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (isHexColor(v)) out[k] = (v as string).toUpperCase();
    }
    return out;
  } catch {
    return {};
  }
}

/** Persist the full override map (only keys the user has changed). Throws if storage is unavailable. */
export function saveColorOverridesSync(overrides: ColorOverrides): void {
  const db = getPrefsDb();
  if (!db) throw new Error('Color preferences storage is unavailable on this device.');
  const clean: ColorOverrides = {};
  for (const [k, v] of Object.entries(overrides)) {
    if (isHexColor(v)) clean[k] = v.toUpperCase();
  }
  db.runSync('INSERT OR REPLACE INTO prefs (key, value) VALUES (?, ?);', OVERRIDES_KEY, JSON.stringify(clean));
}

/** Remove all overrides (revert to the built-in palette). */
export function clearColorOverridesSync(): void {
  try {
    const db = getPrefsDb();
    db?.runSync('DELETE FROM prefs WHERE key = ?;', OVERRIDES_KEY);
  } catch {
    /* no-op — best effort */
  }
}
