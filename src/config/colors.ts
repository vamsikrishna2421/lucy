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
