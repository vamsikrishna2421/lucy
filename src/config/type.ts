/**
 * LUCY type system — Pillar P5 "Visual Craft" (v3 redesign).
 *
 * A dual-VOICE type system on a single deliberate scale:
 *   - DISPLAY voice — Lucy's character: greetings, narrative, hero numbers. Larger, heavier, tighter
 *     tracking, warm. Lucy's spoken/written voice ALWAYS renders here so she reads as a companion, not a
 *     form field.
 *   - UI voice — the clean workhorse for data, labels, body and metadata. Neutral, legible, calm.
 *
 * Fonts are SYSTEM for now (weight/size/letter-spacing contrast does the heavy lifting). A bundled
 * characterful display face is deferred to Q4 (it needs a native build + asset). When that lands, only
 * `DISPLAY_FAMILY` below changes — every `typeStyle('display.*')` consumer upgrades for free.
 *
 * Pure presentation, additive. RN `TextStyle` objects — spread them onto a Text style:
 *   <Text style={typeStyle('display.hero')}>Good morning, Vamsi</Text>
 *   <Text style={typeStyle('ui.body')}>3 captures waiting</Text>
 *   <Text style={[typeStyle('ui.meta'), { color: LUCY_COLORS.textSubtle }]}>2h ago</Text>
 *
 * Note: colors are intentionally NOT baked in (a few defaults aside) so callers keep tone control. Pair
 * display roles with `textDark`; meta with `textMuted`/`textSubtle`.
 */
import { Platform, type TextStyle } from 'react-native';
import { LUCY_COLORS } from './colors';

// ── The scale (P5: 34 / 28 / 22 / 17 / 15 / 13 / 11) ───────────────────────────────────────────────
export const TYPE_SCALE = {
  xxl: 34, // hero numbers / big greeting
  xl: 28,  // display title
  lg: 22,  // section / sheet title
  md: 17,  // body emphasis / row title
  base: 15, // body
  sm: 13,  // meta / supporting
  xs: 11,  // eyebrow / micro-label
} as const;

// RN weight strings (kept as the literal union so they satisfy TextStyle['fontWeight']).
export const WEIGHT = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  heavy: '800',
  black: '900',
} as const satisfies Record<string, TextStyle['fontWeight']>;

/**
 * Font families. System for now. The DISPLAY family is the single swap-point for the future bundled
 * characterful face (Q4). On iOS the system face already has lovely optical sizing at large weights;
 * on Android we lean on weight/tracking contrast.
 */
const SYSTEM_FAMILY = Platform.select({ ios: undefined, default: undefined }); // RN default system font
export const DISPLAY_FAMILY = SYSTEM_FAMILY; // ← swap to a bundled font key here once a build ships it
export const UI_FAMILY = SYSTEM_FAMILY;

export type TypeRole =
  // DISPLAY voice — Lucy's character / hero
  | 'display.hero'   // big greeting / hero number
  | 'display.title'  // large warm title (S-EMOTIONAL narrative lead, hero line)
  | 'display.line'   // the one warm Lucy-voiced sentence on a hero / card
  // UI voice — data + chrome
  | 'ui.title'       // section / sheet / row title
  | 'ui.subtitle'    // secondary title / strong label
  | 'ui.body'        // default body copy
  | 'ui.bodyStrong'  // emphasised body
  | 'ui.meta'        // timestamps, counts, supporting
  | 'ui.eyebrow';    // UPPERCASE kicker

const ROLES: Record<TypeRole, TextStyle> = {
  // ── DISPLAY — warm, characterful, tighter tracking, heavier ──
  'display.hero': {
    fontFamily: DISPLAY_FAMILY,
    fontSize: TYPE_SCALE.xxl,
    fontWeight: WEIGHT.heavy,
    letterSpacing: -0.6,
    lineHeight: Math.round(TYPE_SCALE.xxl * 1.08),
    color: LUCY_COLORS.textDark,
  },
  'display.title': {
    fontFamily: DISPLAY_FAMILY,
    fontSize: TYPE_SCALE.xl,
    fontWeight: WEIGHT.heavy,
    letterSpacing: -0.4,
    lineHeight: Math.round(TYPE_SCALE.xl * 1.12),
    color: LUCY_COLORS.textDark,
  },
  // The signature "Lucy says…" line — warm, readable, a touch larger than body with relaxed leading.
  'display.line': {
    fontFamily: DISPLAY_FAMILY,
    fontSize: TYPE_SCALE.md,
    fontWeight: WEIGHT.semibold,
    letterSpacing: -0.1,
    lineHeight: Math.round(TYPE_SCALE.md * 1.4),
    color: LUCY_COLORS.textDark,
  },

  // ── UI — clean, neutral, legible ──
  'ui.title': {
    fontFamily: UI_FAMILY,
    fontSize: TYPE_SCALE.lg,
    fontWeight: WEIGHT.heavy,
    letterSpacing: -0.2,
    lineHeight: Math.round(TYPE_SCALE.lg * 1.2),
    color: LUCY_COLORS.textDark,
  },
  'ui.subtitle': {
    fontFamily: UI_FAMILY,
    fontSize: TYPE_SCALE.md,
    fontWeight: WEIGHT.bold,
    letterSpacing: -0.1,
    lineHeight: Math.round(TYPE_SCALE.md * 1.3),
    color: LUCY_COLORS.textDark,
  },
  'ui.body': {
    fontFamily: UI_FAMILY,
    fontSize: TYPE_SCALE.base,
    fontWeight: WEIGHT.regular,
    lineHeight: Math.round(TYPE_SCALE.base * 1.45),
    color: LUCY_COLORS.textDark,
  },
  'ui.bodyStrong': {
    fontFamily: UI_FAMILY,
    fontSize: TYPE_SCALE.base,
    fontWeight: WEIGHT.bold,
    lineHeight: Math.round(TYPE_SCALE.base * 1.4),
    color: LUCY_COLORS.textDark,
  },
  'ui.meta': {
    fontFamily: UI_FAMILY,
    fontSize: TYPE_SCALE.sm,
    fontWeight: WEIGHT.medium,
    lineHeight: Math.round(TYPE_SCALE.sm * 1.35),
    color: LUCY_COLORS.textMuted,
  },
  'ui.eyebrow': {
    fontFamily: UI_FAMILY,
    fontSize: TYPE_SCALE.xs,
    fontWeight: WEIGHT.black,
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: LUCY_COLORS.primary,
  },
};

/**
 * Resolve a type role to its `TextStyle`. Returns a fresh object each call so a caller can safely
 * mutate/merge without poisoning the shared token.
 */
export function typeStyle(role: TypeRole): TextStyle {
  return { ...ROLES[role] };
}

/** True when a role belongs to Lucy's DISPLAY voice (useful for guards / theming). */
export function isDisplayRole(role: TypeRole): boolean {
  return role.startsWith('display.');
}
