/**
 * LUCY brand palette: calm dark surfaces with a warm orange intelligence cue.
 */
export const LUCY_COLORS = {
  primary: '#F97316',
  primaryGlow: '#FB923C',
  primarySoft: '#402215',
  background: '#0D1015',
  surface: '#151A21',
  surfaceRaised: '#1D242D',
  textDark: '#F7F4EF',
  textMuted: '#A8A198',
  textSubtle: '#756F68',
  border: '#2A3039',
  divider: '#242A32',
  white: '#FFFFFF',
  listen: '#FDBA74',
  understand: '#FB923C',
  connect: '#F97316',
  yield: '#FED7AA',
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
