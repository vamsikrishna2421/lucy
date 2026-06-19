/**
 * Accent themes — a lightweight "skin" that swaps ONLY the accent (the gold/amber family) to mimic a
 * familiar app's brand color. Surfaces/text stay the LUCY premium dark; just the accent changes, so it's
 * a couple of colors per theme. Selected in Settings → applied at boot (see colors.ts readThemeKey).
 */
export type ThemeKey = 'lucy' | 'whatsapp' | 'facebook' | 'snapchat' | 'instagram';

export interface AccentPalette {
  primary: string;      // main CTA / highlight
  primaryGlow: string;  // lighter active state
  primaryDeep: string;  // pressed
  primarySoft: string;  // subtle tinted background
  primaryMist: string;  // very subtle tint
  primaryLine: string;  // outline on active surfaces
}

export const ACCENT_THEMES: Record<ThemeKey, AccentPalette> = {
  // Default — the original LUCY amber.
  lucy:      { primary: '#FF8C42', primaryGlow: '#FFA05C', primaryDeep: '#E8722A', primarySoft: '#3D1D08', primaryMist: '#2A1205', primaryLine: '#6F3515' },
  // WhatsApp green.
  whatsapp:  { primary: '#25D366', primaryGlow: '#3DE07D', primaryDeep: '#1FA855', primarySoft: '#0B2D1E', primaryMist: '#0A1F16', primaryLine: '#1B5E45' },
  // Facebook blue.
  facebook:  { primary: '#1877F2', primaryGlow: '#4A95F5', primaryDeep: '#0E5FCC', primarySoft: '#0C1B33', primaryMist: '#08111F', primaryLine: '#1E3A66' },
  // Snapchat yellow.
  snapchat:  { primary: '#FFE93B', primaryGlow: '#FFF06E', primaryDeep: '#E6CF00', primarySoft: '#2E2A00', primaryMist: '#1C1A00', primaryLine: '#5C5400' },
  // Instagram magenta/pink.
  instagram: { primary: '#E1306C', primaryGlow: '#F0568A', primaryDeep: '#C2275B', primarySoft: '#330E1C', primaryMist: '#1F0812', primaryLine: '#6E2440' },
};

export const THEME_META: Record<ThemeKey, { label: string; swatch: string }> = {
  lucy:      { label: 'Lucy', swatch: '#FF8C42' },
  whatsapp:  { label: 'WhatsApp', swatch: '#25D366' },
  facebook:  { label: 'Facebook', swatch: '#1877F2' },
  snapchat:  { label: 'Snapchat', swatch: '#FFE93B' },
  instagram: { label: 'Instagram', swatch: '#E1306C' },
};

export const THEME_KEYS: ThemeKey[] = ['lucy', 'whatsapp', 'facebook', 'snapchat', 'instagram'];
export const THEME_SETTING_KEY = 'app_theme';

export function isThemeKey(v: string | null | undefined): v is ThemeKey {
  return !!v && (THEME_KEYS as string[]).includes(v);
}
