/**
 * LUCY brand palette — premium dark, warm journal feel with vibrant amber intelligence.
 *
 * Design principles:
 *   - 4-level surface depth (background → surface → surfaceRaised → surfaceElevated)
 *   - Amber glow system for active/important states
 *   - Warm cream text, never cold grey
 *   - Borders that define depth without harsh contrast
 *
 * THEMES: only the ACCENT family (primary*) is swappable per the user's chosen "skin" (Settings →
 * Appearance). Surfaces/text stay the same. The choice is read SYNCHRONOUSLY at boot so every
 * StyleSheet picks up the right accent; changing it persists + restarts the app.
 */
import { ACCENT_THEMES, type AccentPalette, THEME_SETTING_KEY, isThemeKey } from './themes';

const BASE_COLORS = {
  // ─── Core accent (overridden by the active theme) ─────────────────────────
  primary:      '#FF8C42',   // main CTA, highlights
  primaryGlow:  '#FFA05C',   // hover/active state, a touch lighter
  primaryDeep:  '#E8722A',   // pressed state, 10% darker
  primarySoft:  '#3D1D08',   // subtle tinted backgrounds
  primaryMist:  '#2A1205',   // very subtle tint, almost invisible
  primaryLine:  '#6F3515',   // warm outlines on active surfaces

  // ─── Surface depth (4 levels, each ~8% lighter) ──────────────────────────
  background:       '#0C0B09',   // deepest — screen background
  surface:          '#161310',   // card backgrounds
  surfaceRaised:    '#1F1A14',   // elevated cards, input backgrounds
  surfaceElevated:  '#2A2219',   // tooltips, dropdowns, highest layer
  surfaceSheet:     '#131108',   // bottom sheet backgrounds (slightly cooler)
  surfaceGlass:     '#211A13',   // translucent-feeling panels

  // ─── Text — warm cream hierarchy ─────────────────────────────────────────
  textDark:   '#F5EFE6',   // primary text — warm white
  textMuted:  '#C4A882',   // secondary text — warm tan
  textSubtle: '#8A7560',   // tertiary text — warm brown
  textFaint:  '#5C4A38',   // disabled / placeholder

  // ─── Borders ─────────────────────────────────────────────────────────────
  border:     '#2D2218',   // standard card border
  borderSoft: '#221B12',   // subtle dividers
  divider:    '#1E1710',   // list separators

  // ─── Semantic ────────────────────────────────────────────────────────────
  success:  '#4ADE80',
  warning:  '#F59E0B',
  error:    '#FB7185',
  info:     '#60A5FA',
  violet:   '#A78BFA',
  cyan:     '#4DA3FF',
  teal:     '#34D399',
  gold:     '#F5C451',
  rose:     '#FB7185',

  white: '#FFFFFF',

  // ─── Pillar colors ────────────────────────────────────────────────────────
  listen:     '#FDBA74',
  understand: '#FFA05C',
  connect:    '#FF8C42',
  yield:      '#FDDCB0',
} as const;

/** Read the chosen theme's accent SYNCHRONOUSLY at module init. Fully guarded — any failure (DB not
 *  ready on first launch, native module absent in a test/node context) falls back to the default amber. */
function activeAccent(): AccentPalette {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const SQLite = require('expo-sqlite') as typeof import('expo-sqlite');
    const db = SQLite.openDatabaseSync('lucy.db');
    const row = db.getFirstSync<{ value: string }>('SELECT value FROM settings WHERE key = ?', THEME_SETTING_KEY);
    if (row && isThemeKey(row.value)) return ACCENT_THEMES[row.value];
  } catch { /* default below */ }
  return ACCENT_THEMES.lucy;
}

type Palette = { -readonly [K in keyof typeof BASE_COLORS]: string };
export const LUCY_COLORS: Palette = { ...BASE_COLORS, ...activeAccent() };
const ACTIVE_PRIMARY = LUCY_COLORS.primary;

/** Shadow presets for depth — use on elevated cards, modals, active states. */
export const LUCY_SHADOWS = {
  /** Subtle elevation — secondary cards */
  sm: {
    shadowColor: ACTIVE_PRIMARY,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  /** Standard card elevation */
  md: {
    shadowColor: ACTIVE_PRIMARY,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.10,
    shadowRadius: 8,
    elevation: 4,
  },
  /** Modal / sheet elevation */
  lg: {
    shadowColor: ACTIVE_PRIMARY,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 16,
    elevation: 8,
  },
  /** Active / focus glow — primary interactive elements */
  glow: {
    shadowColor: ACTIVE_PRIMARY,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 12,
    elevation: 6,
  },
} as const;

export type ColorKey = keyof typeof LUCY_COLORS;
export type ShadowKey = keyof typeof LUCY_SHADOWS;

export const getPillarColor = (pillar: 'listen' | 'understand' | 'connect' | 'yield'): string => {
  return LUCY_COLORS[pillar];
};

export const LUCY_PILLARS = [
  { label: 'Listen', color: LUCY_COLORS.listen },
  { label: 'Understand', color: LUCY_COLORS.understand },
  { label: 'Connect', color: LUCY_COLORS.connect },
  { label: 'Yield', color: LUCY_COLORS.yield },
] as const;
