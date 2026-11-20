/** Design tokens from @panorist/core, resolved for the current color scheme. */

import { useColorScheme } from 'react-native';

import { palette, radius, space, type Palette } from '@panorist/core/design';

/** Custom fonts can't be weighted with fontWeight on Android: one family per weight. */
export const font = {
  serif: 'Newsreader_400Regular',
  serifMedium: 'Newsreader_500Medium',
  serifSemibold: 'Newsreader_600SemiBold',
  serifItalic: 'Newsreader_400Regular_Italic',
  sans: 'Inter_400Regular',
  sansMedium: 'Inter_500Medium',
  sansSemibold: 'Inter_600SemiBold',
} as const;

export interface Theme {
  dark: boolean;
  color: Palette;
}

export function useTheme(): Theme {
  const dark = useColorScheme() === 'dark';
  return { dark, color: dark ? palette.dark : palette.light };
}

export { radius, space };
