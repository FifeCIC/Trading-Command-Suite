export function toCssVariables(tokens) {
  return {
    '--bg': tokens.palette.bg,
    '--ink': tokens.palette.ink,
    '--ink-soft': tokens.palette.inkSoft,
    '--panel': tokens.palette.panel,
    '--line': tokens.palette.line,
    '--accent': tokens.palette.accent,
    '--danger': tokens.palette.danger,
    '--shadow-card': tokens.shadow.card,
    '--font-body': tokens.typography.body
  };
}

export const themeAdapter = {
  id: 'vanilla',
  transform: toCssVariables
};
