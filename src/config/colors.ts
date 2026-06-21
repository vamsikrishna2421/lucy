/**
 * LUCY brand palette — clean, modern, calm LIGHT theme with an indigo intelligence accent.
 * (Redesign 2026-06-20, inspired by the scuts reference: light surfaces, white soft-shadow cards,
 *  indigo primary with violet/pink/teal/amber accents.)
 *
 * Design principles:
 *   - Light surface depth (background → surface(white) → raised), separated by soft shadow + hairline border.
 *   - Indigo accent system for active/important states (replaces the old amber glow).
 *   - Near-black text hierarchy on light surfaces.
 *   - Borders that define depth with a soft hairline, never harsh contrast.
 * Token KEYS are unchanged from the old dark palette, so every consumer re-skins automatically.
 */
export const LUCY_COLORS = {
  // ─── Core indigo (primary intelligence accent) ───────────────────────────
  primary:      '#5C50DC',   // main CTA, highlights (indigo)
  primaryGlow:  '#7468E6',   // hover/active — a touch lighter
  primaryDeep:  '#4A3FC2',   // pressed state — darker
  primarySoft:  '#ECEAFB',   // subtle indigo-tinted backgrounds / chips
  primaryMist:  '#F4F3FD',   // very subtle tint, almost white
  primaryLine:  '#D9D5F6',   // indigo outline on active surfaces

  // ─── Surface depth (light) ───────────────────────────────────────────────
  background:       '#F1F2F8',   // screen background — light lavender-gray
  surface:          '#FFFFFF',   // card backgrounds — white
  surfaceRaised:    '#F6F7FC',   // elevated cards, input backgrounds
  surfaceElevated:  '#FFFFFF',   // tooltips, dropdowns (white + shadow)
  surfaceSheet:     '#FFFFFF',   // bottom sheet backgrounds
  surfaceGlass:     '#F6F7FC',   // translucent-feeling panels

  // ─── Text — near-black hierarchy ─────────────────────────────────────────
  textDark:   '#15161B',   // primary text
  textMuted:  '#6A6E7D',   // secondary text
  textSubtle: '#9AA0B0',   // tertiary text
  textFaint:  '#B8BCC8',   // disabled / placeholder

  // ─── Borders ─────────────────────────────────────────────────────────────
  border:     '#E6E8F1',   // standard card border / hairline
  borderSoft: '#EDEFF5',   // subtle dividers
  divider:    '#EEF0F6',   // list separators

  // ─── Semantic ────────────────────────────────────────────────────────────
  success:  '#2EB56B',
  warning:  '#EE9A1C',
  error:    '#E54D4D',
  info:     '#5B8CFF',
  violet:   '#8C5CEB',
  cyan:     '#1FBDAB',
  teal:     '#1FBDAB',
  gold:     '#FAB23A',
  rose:     '#ED66AE',

  white: '#FFFFFF',

  // ─── Pillar colors (multi-accent on light) ──────────────────────────────────
  listen:     '#1FBDAB',   // teal
  understand: '#8C5CEB',   // violet
  connect:    '#5C50DC',   // indigo
  yield:      '#FAB23A',   // amber
} as const;

/** TEMP (user 2026-06-20): disconnect the Lucy animated face/orb app-wide to evaluate the look without it.
 *  Flip back to true to restore the character. Gated in AnimatedFace / LucyPeek / LucyEmptyState / LucyHero. */
export const LUCY_FACE_ENABLED = false;

/** Shadow presets for depth — soft neutral elevation on the light theme (no more amber glow). */
export const LUCY_SHADOWS = {
  /** Subtle elevation — secondary cards */
  sm: {
    shadowColor: '#1A1B2E',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
    elevation: 1,
  },
  /** Standard card elevation */
  md: {
    shadowColor: '#1A1B2E',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 2,
  },
  /** Modal / sheet elevation */
  lg: {
    shadowColor: '#1A1B2E',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.1,
    shadowRadius: 24,
    elevation: 6,
  },
  /** Active / focus — a soft indigo lift on primary interactive elements */
  glow: {
    shadowColor: '#5C50DC',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.22,
    shadowRadius: 14,
    elevation: 5,
  },
} as const;

// ─── Depth & light layer (P5 Visual Craft — additive) ───────────────────────────────────────────
// A signature warm AMBER glow for "Lucy moments" (orb halo, hero wash) + an elevation/translucency
// system distinct from flat Material. These are NEW tokens; no existing key changes, so every current
// consumer is untouched. Use `withAlpha`/`amberGlow`/`amberWash`/`LUCY_ELEVATION` from the craft layer.

/** Lucy's protected brand amber (matches the orb). Exempt from "accent = meaning only". */
export const LUCY_AMBER = '#FAB23A' as const;
/** A lighter amber for the outer halo / highlight edge. */
export const LUCY_AMBER_SOFT = '#FFD78A' as const;
/** A deeper amber for the warm evening end of a wash gradient. */
export const LUCY_AMBER_DEEP = '#F2864A' as const;

/** Compose an rgba/#RRGGBBAA string from a base hex + 0..1 alpha (RN-safe 8-digit hex). */
export function withAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hex}${a}`;
}

/**
 * The amber GLOW ramp for an orb halo — three concentric translucencies (inner → mid → outer). Stack as
 * radial-feeling layers behind the orb (RN has no radial gradient without a dep, so we layer circles).
 */
export const amberGlow = (intensity = 1) => ({
  inner: withAlpha(LUCY_AMBER, 0.5 * intensity),
  mid: withAlpha(LUCY_AMBER_SOFT, 0.32 * intensity),
  outer: withAlpha(LUCY_AMBER_SOFT, 0.12 * intensity),
});

/**
 * A time-of-day ambient WASH for the hero — soft amber tints from top → bottom. Layer these as stacked
 * translucent bands (no gradient dep needed). Phase shifts the warmth (morning bright → night dim).
 */
export const amberWash = (phase: 'morning' | 'day' | 'evening' | 'night' = 'day') => {
  const base: Record<typeof phase, { top: string; mid: string; bottom: string }> = {
    morning: { top: withAlpha('#FFB064', 0.16), mid: withAlpha(LUCY_AMBER_SOFT, 0.08), bottom: withAlpha(LUCY_COLORS.surface, 0) },
    day:     { top: withAlpha(LUCY_AMBER, 0.14),  mid: withAlpha(LUCY_AMBER_SOFT, 0.07), bottom: withAlpha(LUCY_COLORS.surface, 0) },
    evening: { top: withAlpha(LUCY_AMBER_DEEP, 0.16), mid: withAlpha('#FFB07A', 0.08), bottom: withAlpha(LUCY_COLORS.surface, 0) },
    night:   { top: withAlpha('#C98A4E', 0.12), mid: withAlpha('#E9BE86', 0.06), bottom: withAlpha(LUCY_COLORS.surface, 0) },
  };
  return base[phase];
};

/**
 * Elevation / translucency tokens — a layered glass system distinct from flat Material fills. Overlay
 * scrims for sheets/modals, a frosted panel tint, and a hairline edge highlight that sells depth on the
 * light theme. Pair with the existing LUCY_SHADOWS for the cast shadow.
 */
export const LUCY_ELEVATION = {
  /** Dim scrim behind a modal/sheet (tap-to-dismiss backdrop). */
  scrim: withAlpha('#15161B', 0.32),
  /** A lighter scrim for transient popovers / peek. */
  scrimSoft: withAlpha('#15161B', 0.18),
  /** Frosted translucent panel fill (overlays floating above content). */
  glass: withAlpha('#FFFFFF', 0.72),
  /** A warmer frosted fill for Lucy-moment overlays (amber-tinted glass). */
  glassWarm: withAlpha('#FFF8EC', 0.78),
  /** Top edge highlight (a 1px inner light line that lifts a surface off the bg). */
  edgeHighlight: withAlpha('#FFFFFF', 0.6),
  /** Bottom/contact shade for a subtle pressed/recessed feel. */
  contactShade: withAlpha('#1A1B2E', 0.06),
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
