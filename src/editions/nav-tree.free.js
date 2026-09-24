/**
 * Free-edition navigation tree — GENERATED FILE, DO NOT EDIT.
 *
 * Filtered copy of `src/core/nav-tree.js` for the free edition.
 * Regenerate with: node scripts/generate-free-map.cjs
 * Check freshness:  node scripts/generate-free-map.cjs --check
 *
 * 10 of 15 areas · 46 of 135 nav entries (premium ids AND labels removed)
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
      {
        id: "t212-isa",
        label: "Stocks ISA",
        icon: "🏛️",
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
      {
        id: "add-symbol",
        label: "Add Symbol",
        icon: "➕",
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
        id: "events-calendar",
        label: "Events Calendar",
        icon: "🗓️",
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
  trading: {
    label: "Trading",
    views: [
      {
        id: "positions-monitor",
        label: "Positions Monitor",
        icon: "◈",
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
        id: "accounts-dashboard",
        label: "Accounts",
        icon: "💰",
      },
      {
        id: "trading-settings",
        label: "Settings",
        icon: "⚙",
      },
    ],
  },
  automation: {
    label: "Automation",
    views: [
      {
        id: "alert-center",
        label: "Alert Center",
        icon: "◈",
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
        id: "candle-patterns",
        label: "Pattern Detection",
        icon: "🕯️",
      },
      {
        id: "candle-patterns-guide",
        label: "Candle Patterns",
        icon: "◉",
      },
      {
        id: "mt5-demo-trading",
        label: "MT5 Demo Trading",
        icon: "🎮",
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
    ],
  },
  settings: {
    label: "Settings",
    views: [
      {
        kind: "section-header",
        id: "settings-layers",
        label: "META.Stack Layers",
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
  development: {
    label: "Development",
    views: [
      {
        kind: "section-header",
        id: "dev-decisions",
        label: "Decisions",
        icon: "⚖",
      },
      {
        kind: "section-header",
        id: "dev-engineering",
        label: "Engineering Tools",
        icon: "🛠",
      },
      {
        kind: "section-header",
        id: "dev-theme",
        label: "Theme Engineering",
        icon: "🎨",
      },
      {
        kind: "section-header",
        id: "dev-metastack",
        label: "META.Stack Internals",
        icon: "🔗",
      },
      {
        kind: "section-header",
        id: "dev-prototypes",
        label: "Prototypes",
        icon: "🧪",
      },
      {
        id: "mt5-trading",
        label: "MT5 Trading (Prototype)",
        icon: "🔬",
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
