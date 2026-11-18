/**
 * Design tokens. Neutral system surfaces with the brand colour used for
 * content (buttons, highlights), never for navigation bars, which the OS draws.
 * Light and dark palettes keep text contrast at 4.5:1 or better.
 */
import { useColorScheme } from 'react-native';

const brand = { light: '#4F46E5', dark: '#818CF8' };

const light = {
  background: '#F2F2F7',
  surface: '#FFFFFF',
  surfaceMuted: '#F4F4F5',
  border: '#E4E4E7',
  text: '#18181B',
  textSecondary: '#52525B',
  textTertiary: '#71717A',
  primary: brand.light,
  onPrimary: '#FFFFFF',
  primarySoft: '#EEF2FF',
  success: '#047857',
  successSoft: '#ECFDF5',
  warning: '#B45309',
  warningSoft: '#FFFBEB',
  danger: '#B91C1C',
  dangerSoft: '#FEF2F2',
  info: '#1D4ED8',
  infoSoft: '#EFF6FF',
};

const dark: typeof light = {
  background: '#000000',
  surface: '#1C1C1E',
  surfaceMuted: '#2C2C2E',
  border: '#3A3A3C',
  text: '#F4F4F5',
  textSecondary: '#D4D4D8',
  textTertiary: '#A1A1AA',
  primary: brand.dark,
  onPrimary: '#0B0B1A',
  primarySoft: '#1E1B4B',
  success: '#34D399',
  successSoft: '#022C22',
  warning: '#FBBF24',
  warningSoft: '#2A1F05',
  danger: '#F87171',
  dangerSoft: '#2A0F0F',
  info: '#60A5FA',
  infoSoft: '#0B1A33',
};

export type Colors = typeof light;
export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

/** iOS text styles (Body 17, Large Title 34); scale with the system font size setting. */
export const type = {
  largeTitle: { fontSize: 34, fontWeight: '700' as const, lineHeight: 41 },
  title: { fontSize: 22, fontWeight: '700' as const, lineHeight: 28 },
  headline: { fontSize: 17, fontWeight: '600' as const, lineHeight: 22 },
  body: { fontSize: 17, fontWeight: '400' as const, lineHeight: 22 },
  callout: { fontSize: 16, fontWeight: '400' as const, lineHeight: 21 },
  subhead: { fontSize: 15, fontWeight: '400' as const, lineHeight: 20 },
  footnote: { fontSize: 13, fontWeight: '400' as const, lineHeight: 18 },
  caption: { fontSize: 12, fontWeight: '500' as const, lineHeight: 16 },
};

/** Minimum touch target: 44 pt (Apple), 48 dp (Material). */
export const TOUCH = 48;

export function useTheme() {
  const scheme = useColorScheme();
  const colors = scheme === 'dark' ? dark : light;
  return { colors, dark: scheme === 'dark' };
}

export function toneColors(colors: Colors, tone: Tone) {
  switch (tone) {
    case 'primary':
      return { fg: colors.primary, bg: colors.primarySoft };
    case 'success':
      return { fg: colors.success, bg: colors.successSoft };
    case 'warning':
      return { fg: colors.warning, bg: colors.warningSoft };
    case 'danger':
      return { fg: colors.danger, bg: colors.dangerSoft };
    case 'info':
      return { fg: colors.info, bg: colors.infoSoft };
    default:
      return { fg: colors.textSecondary, bg: colors.surfaceMuted };
  }
}
