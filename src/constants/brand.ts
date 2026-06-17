export const Brand = {
  bg: '#121110',
  bgElevated: '#1a1917',
  surface: '#222120',
  surfaceHover: '#2a2927',
  border: '#33312e',
  borderStrong: '#45433e',
  text: '#ece9e2',
  textSecondary: '#9c9890',
  textTertiary: '#6e6a63',
  accent: '#e06345',
  accentHover: '#c8553a',
  accentMuted: 'rgba(224, 99, 69, 0.14)',
  gold: '#d4a72c',
  silver: '#9aa3a8',
  bronze: '#c4785a',
  good: '#5a9a82',
  warn: '#d4a72c',
  bad: '#e06345',
  radius: 8,
  radiusLg: 12,
  radiusPill: 999,
} as const;

export const Overlay = {  scrim: 'rgba(18, 17, 16, 0.55)',
  card: 'rgba(26, 25, 23, 0.82)',
  cardStrong: 'rgba(18, 17, 16, 0.92)',
  hairline: 'rgba(236, 233, 226, 0.10)',
  accentGlow: 'rgba(224, 99, 69, 0.22)',
} as const;

export type BrandToken = keyof typeof Brand;
