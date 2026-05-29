/**
 * LUCY brand palette: warm dark journal feel with vibrant orange intelligence.
 * Shifted from cold blue-grey to warm brown-black — feels personal, not technical.
 */
export const LUCY_COLORS = {
  // Core orange — brighter and more confident
  primary: '#FF8C42',
  primaryGlow: '#FFA05C',
  primarySoft: '#3D1D08',

  // Backgrounds — warm dark instead of cold blue-grey
  background: '#0F0E0B',
  surface: '#1A1510',
  surfaceRaised: '#241E16',

  // Text — warm cream and tan tones
  textDark: '#F5EFE6',
  textMuted: '#C4A882',
  textSubtle: '#8A7560',

  // Borders — warm brown instead of cold grey
  border: '#2D2218',
  divider: '#261E14',

  white: '#FFFFFF',

  // Pillar accent colors — warm the cooler tones slightly
  listen: '#FDBA74',
  understand: '#FFA05C',
  connect: '#FF8C42',
  yield: '#FDDCB0',

  success: '#4ADE80',
  warning: '#F59E0B',
  error: '#FB7185',
} as const;

export type ColorKey = keyof typeof LUCY_COLORS;

export const getPillarColor = (pillar: 'listen' | 'understand' | 'connect' | 'yield'): string => {
  return LUCY_COLORS[pillar];
};

export const LUCY_PILLARS = [
  { label: 'Listen', color: LUCY_COLORS.listen },
  { label: 'Understand', color: LUCY_COLORS.understand },
  { label: 'Connect', color: LUCY_COLORS.connect },
  { label: 'Yield', color: LUCY_COLORS.yield },
] as const;
