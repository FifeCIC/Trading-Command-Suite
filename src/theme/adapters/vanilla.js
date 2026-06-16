export function toCssVariables(tokens) {
  const p = tokens.palette || {};

  return {
    // Core
    '--bg': p.bg,
    '--ink': p.ink,
    '--ink-soft': p.inkSoft ?? p.textDim,
    '--panel': p.panel,
    '--line': p.line,
    '--accent': p.accent,
    '--danger': p.danger,
    '--shadow-card': tokens.shadow?.card ?? 'none',
    '--font-body': tokens.typography?.body ?? 'Inter, system-ui, sans-serif',
    '--font-mono': tokens.typography?.mono ?? 'ui-monospace, monospace',
    '--radius-sm': `${tokens.radius?.sm ?? 10}px`,
    '--radius-md': `${tokens.radius?.md ?? 14}px`,

    // Doomchart extended surface layers
    '--bg-elev': p.bgElev ?? p.panel,
    '--bg-elev-2': p.bgElev2 ?? p.panel,
    '--border': p.border ?? p.line,
    '--border-strong': p.borderStrong ?? p.line,

    // Doomchart text scale
    '--text-dim': p.textDim ?? p.inkSoft,
    '--text-faint': p.textFaint ?? p.inkSoft,

    // Doomchart risk spectrum
    '--risk-normal': p.riskNormal ?? '#2ecc91',
    '--risk-watch': p.riskWatch ?? '#c5a3ff',
    '--risk-elevated': p.riskElevated ?? '#ffd166',
    '--risk-high': p.riskHigh ?? '#ff8c42',
    '--risk-critical': p.riskCritical ?? '#ff5470',

    // Doomchart accent soft
    '--accent-soft': p.accentSoft ?? 'rgba(91, 141, 239, 0.12)',
  };
}

export const themeAdapter = {
  id: 'vanilla',
  transform: toCssVariables
};
