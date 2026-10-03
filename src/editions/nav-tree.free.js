/**
 * Free-edition navigation tree — GENERATED FILE, DO NOT EDIT.
 *
 * Filtered copy of `src/core/nav-tree.js` for the free edition.
 * Regenerate with: node scripts/generate-free-map.cjs
 * Check freshness:  node scripts/generate-free-map.cjs --check
 *
 * 10 of 14 areas · 39 of 109 nav entries (premium ids AND labels removed)
 * Plan: Trading-Command-Suite-Documentation/commercial/FREE-EDITION-PLAN.md (§3, §11.1)
 */

export const NAV_TREE = {
  dashboard: {
    label: "Dashboard",
    views: [
      {
        id: "dashboard",
        label: "Dashboard",
        icon: "🏠",
      },
    ],
  },
  trading212: {
    label: "Accounts",
    views: [
      {
        id: "t212-portfolio",
        label: "Portfolio",
        icon: "🏦",
      },
    ],
  },
  watchlists: {
    label: "Watchlists",
    views: [
      {
        id: "active-symbols",
        label: "Active Symbols",
        icon: "★",
      },
      {
        id: "user-watchlists",
        label: "Watchlists",
        icon: "⊞",
      },
    ],
  },
  research: {
    label: "Research",
    views: [
      {
        id: "symbols-browser",
        label: "Symbols Browser",
        icon: "🔍",
      },
      {
        id: "screener",
        label: "Screener",
        icon: "🧲",
      },
      {
        id: "research-notes",
        label: "Notes",
        icon: "📝",
      },
      {
        id: "earnings-calendar",
        label: "Earnings Calendar",
        icon: "📅",
      },
      {
        id: "news-intel",
        label: "News Intel",
        icon: "📰",
      },
      {
        id: "market-correlations",
        label: "Market Correlations",
        icon: "🔗",
      },
      {
        id: "recently-analysed-symbols",
        label: "Recently Analysed",
        icon: "🕘",
      },
    ],
  },
  protocols: {
    label: "Protocols",
    views: [
      {
        kind: "section-header",
        id: "tools-header",
        label: "Tools",
        icon: "",
      },
      {
        id: "protocol-queue",
        label: "Protocol Queue",
        icon: "🏗",
      },
    ],
  },
  trading: {
    label: "Trading",
    views: [
      {
        id: "positions-monitor",
        label: "Positions Monitor",
        icon: "◈",
      },
      {
        id: "mt5-trading",
        label: "MT5 Trading",
        icon: "📈",
      },
      {
        id: "trading-plans",
        label: "Trading Plans",
        icon: "📋",
      },
      {
        id: "trade-journal",
        label: "Trade Journal",
        icon: "▤",
      },
      {
        kind: "section-header",
        id: "legacy-strategies",
        label: "— Legacy Strategy Pages —",
        icon: "",
      },
      {
        id: "market-context",
        label: "Market Context",
        icon: "🌐",
      },
      {
        id: "performance-lab",
        label: "Trading Performance",
        icon: "📊",
      },
      {
        id: "calculators",
        label: "Calculators",
        icon: "⊞",
      },
      {
        id: "trading-settings",
        label: "Settings",
        icon: "⚙",
      },
    ],
  },
  education: {
    label: "Education",
    views: [
      {
        id: "glossary",
        label: "Glossary",
        icon: "📖",
      },
      {
        id: "settings-education",
        label: "Education Settings",
        icon: "⚙",
      },
    ],
  },
  status: {
    label: "Status",
    views: [
      {
        id: "setup",
        label: "Setup & Diagnostics",
        icon: "◉",
      },
      {
        id: "scheduled-jobs",
        label: "Scheduled Jobs",
        icon: "🗓",
      },
    ],
  },
  planner: {
    label: "Planner",
    views: [
      {
        id: "personal-finances",
        label: "Personal Finances",
        icon: "💰",
      },
      {
        id: "trading-styles",
        label: "Trading Styles",
        icon: "🎨",
      },
      {
        id: "objectives",
        label: "Objectives",
        icon: "🎯",
      },
    ],
  },
  settings: {
    label: "Settings",
    views: [
      {
        kind: "section-header",
        id: "settings-layers",
        label: "Layers",
        icon: "",
      },
      {
        id: "trading-settings",
        label: "Trading",
        icon: "💹",
      },
      {
        id: "risk-controls",
        label: "Risk Controls",
        icon: "◈",
      },
      {
        kind: "section-header",
        id: "settings-app",
        label: "Application",
        icon: "",
      },
      {
        id: "settings",
        label: "General",
        icon: "⚙",
      },
      {
        id: "appearance",
        label: "Appearance",
        icon: "🎨",
      },
      {
        kind: "section-header",
        id: "settings-reference",
        label: "Reference",
        icon: "",
      },
      {
        id: "user-preferences",
        label: "User Preferences",
        icon: "⚙",
      },
      {
        id: "theme-packs",
        label: "Theme Packs",
        icon: "🎨",
      },
      {
        id: "settings-education",
        label: "Education",
        icon: "◉",
      },
    ],
  },
};


export const PRIMARY_PAGES = Object.entries(NAV_TREE).map(([id, area]) => ({
  id,
  label: area.label,
}));

/**
 * Quick Menu shortcuts — high-priority jump targets shown in the header dropdown.
 * Each entry must reference a view id that exists somewhere in NAV_TREE.
 */
export const QUICK_MENU = PRIMARY_PAGES;

/**
 * Derive the legacy flat NAV_STRUCTURE shape for backward compat with App.jsx.
 * Returns { [areaKey]: [{ id, label }] }
 */
export function getNavStructure() {
  const structure = {};
  for (const [key, area] of Object.entries(NAV_TREE)) {
    structure[key] = area.views;
  }
  return structure;
}

/**
 * Resolve which area owns a given view id.
 */
export function resolveArea(viewId) {
  for (const [key, area] of Object.entries(NAV_TREE)) {
    if (area.views.some((v) => v.id === viewId)) {
      return key;
    }
  }
  return null;
}
