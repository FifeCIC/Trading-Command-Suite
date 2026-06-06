export function toMuiTheme(tokens) {
  return {
    palette: {
      mode: tokens.mode,
      primary: {
        main: tokens.palette.accent
      },
      error: {
        main: tokens.palette.danger
      },
      background: {
        default: tokens.palette.bg,
        paper: tokens.palette.panel
      },
      text: {
        primary: tokens.palette.ink,
        secondary: tokens.palette.inkSoft
      },
      divider: tokens.palette.line
    },
    shape: {
      borderRadius: tokens.radius.md
    },
    typography: {
      fontFamily: tokens.typography.body
    }
  };
}

export const themeAdapter = {
  id: 'mui',
  transform: toMuiTheme
};
