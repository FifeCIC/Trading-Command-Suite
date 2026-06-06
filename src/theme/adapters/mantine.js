export function toMantineTheme(tokens) {
  return {
    primaryColor: 'brand',
    defaultRadius: 'md',
    fontFamily: tokens.typography.body,
    colors: {
      brand: [
        '#ecfeff',
        '#cffafe',
        '#a5f3fc',
        '#67e8f9',
        '#22d3ee',
        '#06b6d4',
        '#0891b2',
        '#0e7490',
        '#155e75',
        '#164e63'
      ]
    },
    other: {
      mode: tokens.mode,
      panel: tokens.palette.panel,
      border: tokens.palette.line
    }
  };
}

export const themeAdapter = {
  id: 'mantine',
  transform: toMantineTheme
};
