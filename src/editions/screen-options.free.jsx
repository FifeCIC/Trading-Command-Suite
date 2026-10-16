/**
 * Free-edition view options registry — GENERATED FILE, DO NOT EDIT.
 *
 * Filtered copy of `src/components/ScreenOptions.jsx` for the free edition.
 * Regenerate with: node scripts/generate-free-map.cjs
 * Check freshness:  node scripts/generate-free-map.cjs --check
 *
 * 5 of 11 keys — premium-view keys dropped (their titles named premium pages), shared keys kept
 * Plan: Trading-Command-Suite-Documentation/commercial/FREE-EDITION-PLAN.md (§3, §11.1)
 */

const OPTIONS_REGISTRY = {
  "active-symbols": {
    title: "Active Symbols",
    sections: [
      {
        id: "layoutWidth",
        label: "Layout Width",
        description: "Maximum content width for this view",
        type: "radio",
        key: "as-layout-width",
        defaultValue: "full",
        options: [
          {
            value: "full",
            label: "Full Width",
            desc: "Use all available screen width",
          },
          {
            value: "4k",
            label: "4K (2560px)",
            desc: "Wide layout for large monitors",
          },
          {
            value: "desktop",
            label: "Desktop (1440px)",
            desc: "Standard desktop layout",
          },
          {
            value: "laptop",
            label: "Laptop (1024px)",
            desc: "Compact for smaller screens",
          },
        ],
      },
    ],
  },
  "symbols-browser": {
    title: "Symbols Browser",
    sections: [
      {
        id: "tableColumns",
        label: "Table Columns",
        description: "Choose which columns appear in the table. Changes apply immediately.",
        type: "columns",
        options: [
          {
            key: "sb-col-name",
            label: "Name",
            desc: "Company or asset name.",
            defaultValue: true,
          },
          {
            key: "sb-col-exchange",
            label: "Exchange",
            desc: "Trading venue the symbol is listed on.",
            defaultValue: true,
          },
          {
            key: "sb-col-type",
            label: "Type",
            desc: "Asset class — stock, crypto or forex.",
            defaultValue: true,
          },
          {
            key: "sb-col-active",
            label: "Active",
            desc: "Whether the symbol is marked active in the database.",
            defaultValue: false,
          },
          {
            key: "sb-col-tags",
            label: "Tags",
            desc: "Tag list stored on the symbol record.",
            defaultValue: false,
          },
          {
            key: "sb-col-aliases",
            label: "Aliases",
            desc: "Alternative ticker/name mappings stored on the symbol.",
            defaultValue: false,
          },
          {
            key: "sb-col-position",
            label: "Position",
            desc: "Whether you currently hold the symbol (Held / —).",
            defaultValue: true,
          },
          {
            key: "sb-col-provider",
            label: "Provider",
            desc: "Broker or provider the position is held with.",
            defaultValue: false,
          },
          {
            key: "sb-col-quantity",
            label: "Quantity",
            desc: "Number of units currently held.",
            defaultValue: false,
          },
          {
            key: "sb-col-avgPrice",
            label: "Avg Cost",
            desc: "Average entry cost per unit.",
            defaultValue: false,
          },
          {
            key: "sb-col-currentPrice",
            label: "Current Price",
            desc: "Latest price recorded for the position.",
            defaultValue: false,
          },
          {
            key: "sb-col-pnl",
            label: "P&L",
            desc: "Unrealised profit/loss on the position.",
            defaultValue: true,
          },
          {
            key: "sb-col-pnlPct",
            label: "P&L %",
            desc: "Unrealised P&L as a percentage of cost.",
            defaultValue: false,
          },
          {
            key: "sb-col-fresh",
            label: "Freshness",
            desc: "Market data freshness status (fresh / stale).",
            defaultValue: true,
          },
          {
            key: "sb-col-freshAge",
            label: "Data Age",
            desc: "Minutes since the latest stored bar.",
            defaultValue: false,
          },
          {
            key: "sb-col-freshTimeframe",
            label: "Timeframe",
            desc: "Timeframe of the freshest stored bar.",
            defaultValue: false,
          },
          {
            key: "sb-col-freshLatest",
            label: "Latest Bar",
            desc: "Timestamp of the latest stored bar.",
            defaultValue: false,
          },
          {
            key: "sb-col-created",
            label: "Created",
            desc: "When the symbol was first added to the database.",
            defaultValue: false,
          },
          {
            key: "sb-col-updated",
            label: "Updated",
            desc: "When the symbol record last changed.",
            defaultValue: false,
          },
          {
            key: "sb-col-id",
            label: "Symbol ID",
            desc: "Internal database identifier for the symbol.",
            defaultValue: false,
          },
        ],
      },
    ],
  },
  screener: {
    title: "Screener",
    sections: [
      {
        id: "tableColumns",
        label: "Table Columns",
        description: "Choose which columns appear in the table. Changes apply immediately.",
        type: "columns",
        options: [
          {
            key: "scr-col-catalyst",
            label: "Catalyst",
            desc: "Catalyst type(s) that surfaced this symbol.",
            defaultValue: true,
          },
          {
            key: "scr-col-source",
            label: "Source",
            desc: "Where the catalyst came from — news or earnings.",
            defaultValue: true,
          },
          {
            key: "scr-col-lean",
            label: "Lean",
            desc: "Aggregate news lean — LONG / SHORT / NEUTRAL.",
            defaultValue: true,
          },
          {
            key: "scr-col-strength",
            label: "Strength",
            desc: "Catalyst strength from the source feed.",
            defaultValue: true,
          },
          {
            key: "scr-col-reliability",
            label: "Reliab.",
            desc: "Source reliability weight.",
            defaultValue: true,
          },
          {
            key: "scr-col-when",
            label: "When",
            desc: "Next event date or age of the latest catalyst.",
            defaultValue: true,
          },
          {
            key: "scr-col-hits",
            label: "Hits",
            desc: "Number of catalyst hits behind this row.",
            defaultValue: true,
          },
        ],
      },
      {
        id: "topPicks",
        label: "Top Picks Count",
        description: "How many highest-attention rows are highlighted as top picks.",
        type: "radio",
        key: "scr-top-picks",
        defaultValue: "10",
        options: [
          {
            value: "5",
            label: "5",
            desc: "Five top picks — minimal noise",
          },
          {
            value: "10",
            label: "10",
            desc: "Ten top picks — default",
          },
          {
            value: "15",
            label: "15",
            desc: "Fifteen top picks",
          },
          {
            value: "20",
            label: "20",
            desc: "Twenty top picks",
          },
          {
            value: "25",
            label: "25",
            desc: "Twenty-five top picks — maximum surface",
          },
        ],
      },
    ],
  },
  "t212-portfolio": {
    title: "Portfolio",
    sections: [
      {
        id: "accounts",
        label: "Accounts & Totals",
        description: "Choose which accounts (and Live/Demo categories) are included in the total.",
        type: "accounts",
      },
    ],
  },
  "mt5-trading": {
    title: "Manual Trading",
    sections: [
      {
        id: "pageWidth",
        label: "Page Width",
        description: "How wide the Manual Trading page renders. A wider page fits more of the order form and positions table on one screen.",
        type: "radio",
        key: "mt5-page-width",
        defaultValue: "desktop",
        options: [
          {
            value: "full",
            label: "Full Width",
            desc: "Use all available screen width",
          },
          {
            value: "4k",
            label: "4K",
            desc: "Max width 2560px",
          },
          {
            value: "desktop",
            label: "Desktop",
            desc: "Max width 1440px — default",
          },
          {
            value: "laptop",
            label: "Laptop",
            desc: "Max width 1200px",
          },
          {
            value: "tablet",
            label: "Tablet",
            desc: "Max width 960px",
          },
        ],
      },
    ],
  },
};


/**
 * Read every registry value for a view from localStorage, applying defaults.
 * Handles plain sections (key on the section) and column-toggle groups
 * (each option carries its own key).
 */
function readRegistryValues(registry) {
  var initial = {};
  if (!registry) return initial;
  for (var i = 0; i < registry.sections.length; i++) {
    var section = registry.sections[i];
    if (section.type === 'columns' && Array.isArray(section.options)) {
      for (var j = 0; j < section.options.length; j++) {
        var opt = section.options[j];
        try {
          initial[opt.key] = localStorage.getItem(opt.key);
          if (initial[opt.key] == null) initial[opt.key] = String(opt.defaultValue);
        } catch (e) {
          initial[opt.key] = String(opt.defaultValue);
        }
      }
    } else if (section.key) {
      try {
        initial[section.key] = localStorage.getItem(section.key) || section.defaultValue;
      } catch (e) {
        initial[section.key] = section.defaultValue;
      }
    }
  }
  return initial;
}

/**
 * relTime(iso) — "4m ago" / "2h ago" / "3d ago" for the notification popup.
 *
 * The popup answers "is this happening NOW?", so age is the useful form of the timestamp; a raw
 * ISO string would make the reader subtract. The raw value stays available via `title`.
 */
function relTime(iso) {
  if (!iso) return '';
  var ms = Date.now() - new Date(iso).getTime();
  if (!isFinite(ms) || ms < 0) return '';
  var m = Math.floor(ms / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return m + 'm ago';
  var h = Math.floor(m / 60);
  if (h < 24) return h + 'h ago';
  return Math.floor(h / 24) + 'd ago';
}

export default function ScreenOptions({ activeView, area, onSettingsChange, isOpen, onToggle, isBookmarked, onToggleBookmark, statusLevel, isMt5Online, isApiOnline, isDbOnline }) {
  var { prefs, set: setPref } = usePreferences();
  var registry = activeView ? OPTIONS_REGISTRY[activeView] : null;
  var [calcOpen, setCalcOpen] = useState(false);
  var [notifOpen, setNotifOpen] = useState(false);
  var [infoOpen, setInfoOpen] = useState(false);
  var [glossaryOpen, setGlossaryOpen] = useState(false);
  var [dismissed, setDismissed] = useState(new Set());
  var viewExplanation = activeView ? VIEW_EXPLANATIONS[activeView] : null;

  // ── Notification data ──
  var healthQuery = useQuery({
    queryKey: ['so-notif-health'],
    queryFn: () => apiGet('/api/providers/health').catch(() => null),
    refetchInterval: 60_000,
  });
  var autoQuery = useQuery({
    queryKey: ['so-notif-auto'],
    queryFn: () => apiGet('/api/automation/status').catch(() => null),
    refetchInterval: 30_000,
  });
  // DB-backed alerts (was in-memory, now persisted via #440)
  var alertsQuery = useQuery({
    queryKey: ['so-notif-alerts'],
    queryFn: () => apiGet('/api/alerts/count').catch(() => ({ active: 0, critical: 0 })),
    refetchInterval: 30_000,
  });
  // The ACTUAL alerts (2026-09-23). The badge read /count while the popup rendered ONLY the
  // health-derived list — two unconnected sources behind one bell, so it could show 9,818 on the
  // badge and "All clear" in the panel at the same moment. Both now read this list (plus the
  // derived items), and /count uses the same predicate, so the three can no longer disagree.
  // ⚠️ `.catch(() => null)`: `null` means COULD NOT LOAD, which must never render as "no alerts".
  var alertListQuery = useQuery({
    queryKey: ['so-notif-list'],
    queryFn: () => apiGet('/api/alerts/active').catch(() => null),
    refetchInterval: 60_000,
  });

  // ── Portfolio account toggles (view-specific) ──
  var hasAccountsSection = registry && registry.sections.some(function (s) { return s.type === 'accounts'; });
  var accountsQuery = useQuery({
    queryKey: ['so-portfolio-accounts'],
    queryFn: () => apiGet('/api/portfolio/accounts').catch(() => null),
    enabled: !!hasAccountsSection,
    refetchInterval: 60_000,
  });
  var portfolioAccounts = accountsQuery.data || { categories: [], grandTotal: null };
  var togglePortfolioAccount = useCallback(function (id, enabled) {
    apiPost('/api/portfolio/accounts/' + id, { enabled: enabled }).catch(function () {});
    accountsQuery.refetch();
    try { window.dispatchEvent(new CustomEvent('tcs:accounts-changed')); } catch (e) {}
  }, [accountsQuery]);

  // ── Trading layer switch (Trading area pages) ──
  // One switch = both the global trading layer AND the MT5 broker's
  // tradingEnabled, so a single flip fully enables/disables live orders.
  var isTradingArea = area === 'trading';
  var tradingEnabled = autoQuery.data?.layers?.tradingEnabled === true;
  var toggleTrading = useCallback(function (enabled) {
    apiPost('/api/automation/layer', { layer: 'trading', enabled: enabled }).catch(function () {});
    apiPost('/api/automation/config', { brokerId: 'mt5', tradingEnabled: enabled }).catch(function () {});
    autoQuery.refetch();
    try { window.dispatchEvent(new CustomEvent('tcs:trading-layer-changed', { detail: { enabled: enabled } })); } catch (e) {}
  }, [autoQuery]);

  var notifications = useMemo(() => {
    var items = [];
    var now = new Date().toISOString();
    var providers = healthQuery.data?.providers || [];
    providers.forEach(function(p) {
      if (p.status === 'degraded') {
        items.push({ id: 'prov-' + p.provider + '-degraded', severity: 'warning', title: p.displayName + ' degraded', detail: p.message || 'Provider performance degraded', timestamp: p.checkedAt || now });
      }
      if (p.status === 'error' || p.status === 'unreachable') {
        items.push({ id: 'prov-' + p.provider + '-down', severity: 'critical', title: p.displayName + ' unreachable', detail: p.message || 'Provider is not responding', timestamp: p.checkedAt || now });
      }
    });
    var decisions = autoQuery.data?.recentDecisions || [];
    var errs = decisions.filter(function(d) { return d.decision === 'ERROR' || d.decision === 'BLOCKED'; });
    if (errs.length > 0) {
      items.push({ id: 'auto-recent-errors', severity: 'warning', title: errs.length + ' automation error' + (errs.length > 1 ? 's' : ''), detail: errs.slice(0, 3).map(function(d) { return d.symbol + ': ' + d.reason; }).join('; '), timestamp: now });
    }
    return items;
  }, [healthQuery.data, autoQuery.data]);

  var visible = notifications.filter(function(n) { return !dismissed.has(n.id); });
  var criticalCount = visible.filter(function(n) { return n.severity === 'critical'; }).length;
  var alertActive = alertsQuery.data?.active || 0;
  var alertCritical = alertsQuery.data?.critical || 0;
  var totalUnread = visible.length + alertActive;

  // ── The popup's items (2026-09-23) ──
  //
  // ONE list from TWO sources: the live health/automation items computed above, PLUS the stored
  // alerts the badge had always counted but the panel never fetched. Highest severity first, then
  // most recently observed — the order is the answer to "what needs me right now".
  //
  // ⚠️ `listState` distinguishes THREE states that must never collapse into one: loading,
  // failed-to-load, and genuinely empty. "All clear" is a CLAIM; a failed fetch cannot make it.
  var listState = alertListQuery.isLoading
    ? 'loading'
    : (alertListQuery.data === null ? 'failed' : 'ok');
  var popupItems = [];
  visible.forEach(function(n) {
    popupItems.push({
      id: n.id,
      level: n.severity === 'critical' ? 'critical' : 'warning',
      title: n.title, detail: n.detail, at: n.timestamp, ticker: null, repeatCount: 1,
    });
  });
  if (Array.isArray(alertListQuery.data)) {
    alertListQuery.data.forEach(function(a) {
      var n = normaliseAlert(a);
      popupItems.push({
        id: 'db-' + n.id,
        level: n.level,
        title: n.title,
        detail: n.message,
        at: n.lastSeenAt || n.createdAt,
        ticker: n.ticker || null,
        repeatCount: Number(n.repeatCount) || 1,
      });
    });
  }
  popupItems.sort(function(a, b) {
    var d = (ALERT_LEVEL_WEIGHT[b.level] || 0) - (ALERT_LEVEL_WEIGHT[a.level] || 0);
    return d !== 0 ? d : String(b.at || '').localeCompare(String(a.at || ''));
  });
  var POPUP_LIMIT = 8;
  var popupShown = popupItems.slice(0, POPUP_LIMIT);
  var popupHidden = popupItems.length - popupShown.length;

  var handleDismissAll = function() {
    apiPost('/api/alerts/dismiss-all').then(function() {
      alertListQuery.refetch();
      alertsQuery.refetch();
    }).catch(function() {});
  };

  // Read current global preference values
  var displayMode = prefs.displayMode || 'focused';
  var experienceLevel = prefs.experienceLevel || 'beginner';
  var hidePageTitle = prefs.hidePageTitle === true;
  var hidePageSubtitle = prefs.hidePageSubtitle === true;
  var highContrastText = prefs.highContrastText === true;
  var colorBlindMode = prefs.colorBlindMode === true;
  var hidePracticeData = prefs.hidePracticeData === true;
  var showTrainingGuidance = prefs.showTrainingGuidance !== false;
  var fontScale = prefs.fontScale || 'normal';
  var focusIndicatorStyle = prefs.focusIndicatorStyle || 'strong';
  var layoutSize = prefs.layoutSize || 'normal';

  // Read view-specific values from localStorage
  var [values, setValues] = useState(function () {
    return readRegistryValues(registry);
  });

  useEffect(function () {
    setValues(readRegistryValues(registry));
  }, [activeView]);

  var handleViewChange = useCallback(function (key, value) {
    var next = { ...values, [key]: value };
    setValues(next);
    try { localStorage.setItem(key, value); } catch (e) {}
    if (onSettingsChange) onSettingsChange({ key: key, value: value });
  }, [values, onSettingsChange]);

  var handleGlobalChange = useCallback(function (field, value) {
    setPref(field, value);
  }, [setPref]);

  // Close on Escape
  useEffect(function () {
    if (!isOpen) return;
    var onKey = function (e) { if (e.key === 'Escape') onToggle(); };
    window.addEventListener('keydown', onKey);
    return function () { window.removeEventListener('keydown', onKey); };
  }, [isOpen, onToggle]);

  // Build global section state for rendering
  var globalValueMap = { displayMode: displayMode, experienceLevel: experienceLevel, hidePageTitle: hidePageTitle, hidePageSubtitle: hidePageSubtitle, highContrastText: highContrastText, colorBlindMode: colorBlindMode, hidePracticeData: hidePracticeData, showTrainingGuidance: showTrainingGuidance, fontScale: fontScale, focusIndicatorStyle: focusIndicatorStyle };
  var hasGlobalSections = true; // always show global section
  var hasViewSections = registry && registry.sections.length > 0;

  // Apply hide title/subtitle preferences to the document so CSS can respond
  useEffect(function () {
    document.documentElement.dataset.hidePageTitle = hidePageTitle ? 'true' : 'false';
    document.documentElement.dataset.hidePageSubtitle = hidePageSubtitle ? 'true' : 'false';
  }, [hidePageTitle, hidePageSubtitle]);

  // Apply font scale preference to the document so CSS can respond
  useEffect(function () {
    document.documentElement.setAttribute('data-font-scale', fontScale || 'normal');
  }, [fontScale]);

  // Apply focus indicator style preference to the document so CSS can respond
  useEffect(function () {
    document.documentElement.setAttribute('data-focus-indicator-style', focusIndicatorStyle || 'strong');
  }, [focusIndicatorStyle]);

  // Apply layout size preference to the document so CSS can respond
  useEffect(function () {
    document.documentElement.setAttribute('data-layout-size', layoutSize || 'normal');
  }, [layoutSize]);

  // Apply color-blind mode preference to the document so CSS can respond
  useEffect(function () {
    document.documentElement.setAttribute('data-colorblind', colorBlindMode ? 'true' : 'false');
  }, [colorBlindMode]);

  // Apply high contrast text preference to the document so CSS can respond
  //
  // IMPORTANT: this is the ONE preference that needs its own effect here, and the
  // reason is a trap. App.jsx applies `data-high-contrast` in a mount-only effect
  // plus an `onStorage` listener — but the `storage` event does NOT fire in the
  // tab that made the change, so toggling this from the panel updated
  // localStorage and nothing else. Measured 2026-10-16: same click left the
  // attribute 'false'; a reload then produced 'true'. The user-visible symptom is
  // "the toggle does nothing", which reads as a missing control rather than a
  // missing repaint. The six siblings above each apply their own attribute for
  // exactly this reason — this one was simply absent.
  useEffect(function () {
    document.documentElement.setAttribute('data-high-contrast', highContrastText ? 'true' : 'false');
  }, [highContrastText]);

  return (
    <>
      {/* Sticky buttons */}
      <div className="so-sticky-btns">
        {statusLevel && (
          <button
            className="so-gear-btn"
            onClick={() => window.location.href = '/status/setup'}
            title={`Bridge: ${isMt5Online ? 'Connected' : 'Offline'} | API: ${isApiOnline ? 'Online' : 'Offline'} | DB: ${isDbOnline ? 'Connected' : 'Offline'}`}
            aria-label="System status"
            style={{ color: statusLevel === 'online' ? '#22c55e' : statusLevel === 'warn' ? '#f59e0b' : '#ef4444' }}
          >
            !
          </button>
        )}
        <button
          className={`so-gear-btn ${isBookmarked ? 'so-bookmarked' : ''}`}
          onClick={onToggleBookmark}
          title={isBookmarked ? 'Remove bookmark' : 'Bookmark this page'}
          aria-label={isBookmarked ? 'Remove bookmark' : 'Bookmark this page'}
        >
          {isBookmarked ? '⭐' : '☆'}
        </button>
        {viewExplanation && (
          <div className="so-info-wrap">
            <button
              className={`so-gear-btn so-info-btn ${infoOpen ? 'so-gear-active' : ''}`}
              onClick={() => setInfoOpen((v) => !v)}
              title="View explanation"
              aria-label="View explanation"
            >
              ℹ
            </button>
            {infoOpen && (
              <div className="so-info-popover">
                <div className="so-info-pop-title">About this view</div>
                <div className="so-info-pop-text">{viewExplanation}</div>
                <button className="so-info-pop-close" onClick={() => setInfoOpen(false)}>×</button>
              </div>
            )}
          </div>
        )}
        <button
          className="ksh-trigger"
          onClick={() => setGlossaryOpen((v) => !v)}
          title="Trading Glossary"
          aria-label="Open trading glossary"
          style={{ right: 174 }}
        >
          📖
        </button>
        <button
          className={`so-gear-btn ${isOpen ? 'so-gear-active' : ''}`}
          onClick={onToggle}
          title={`Screen Options${registry ? ` — ${registry.title}` : ''}`}
          aria-label="Open screen options"
        >
          ⚙
        </button>
        <div className="notif-disc">
          <button
            type="button"
            className={`notif-bell ${notifOpen ? 'active' : ''} ${criticalCount + alertCritical > 0 ? 'has-critical' : ''}`}
            onClick={function() { setNotifOpen(function(v) { return !v; }); }}
            aria-label={'Notifications - ' + totalUnread + ' unread'}
            title={totalUnread + ' notification' + (totalUnread !== 1 ? 's' : '')}
          >
            <svg className="notif-svg-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            {totalUnread > 0 && (
              <span className="notif-badge">{totalUnread}</span>
            )}
          </button>
          {notifOpen && (
            <>
              <div className="notif-backdrop" onClick={function() { setNotifOpen(false); }} />
              <div className="notif-dropdown">
                <div className="notif-header">
                  <h3>Notifications</h3>
                  {totalUnread > 0 && (
                    <button
                      type="button"
                      className="notif-dismiss-all"
                      title="Dismiss every active alert. Rows move to history — they are not deleted, and a condition that recurs will surface again as a new alert."
                      onClick={handleDismissAll}
                    >
                      Dismiss all
                    </button>
                  )}
                </div>
                {popupShown.length === 0 ? (
                  // ⚠️ THREE states, and only one of them is "All clear". A failed fetch and an
                  // empty list must never render the same — the badge may still show a count
                  // (it comes from a different endpoint), and "All clear" under a non-zero badge
                  // is exactly the contradiction this rewrite exists to remove.
                  listState === 'failed' ? (
                    <p className="notif-empty">
                      Could not load alerts.
                      {alertActive > 0 && <> {alertActive} alert(s) are still recorded as active.</>}
                    </p>
                  ) : listState === 'loading' ? (
                    <p className="notif-empty">Loading alerts…</p>
                  ) : (
                    <p className="notif-empty">All clear — no active alerts.</p>
                  )
                ) : (
                  <>
                    <div className="notif-list">
                      {popupShown.map(function(n) {
                        var urgency = n.level === 'critical' || n.level === 'high'
                          ? '🔴'
                          : n.level === 'warning' || n.level === 'medium' ? '🟠' : '🔵';
                        return (
                          <div className="notif-item" key={n.id}>
                            <div className="notif-item-left">
                              <span className="notif-severity-dot" aria-hidden="true">{urgency}</span>
                              <div className="notif-item-body">
                                <span className="notif-item-title">{n.title}</span>
                                {n.detail && (
                                  <span className="notif-item-detail" title={n.detail}>{n.detail}</span>
                                )}
                                <span className="notif-item-time" title={n.at || ''}>
                                  {relTime(n.at)}
                                  {(n.repeatCount || 1) > 1 ? ' · seen ' + n.repeatCount + '×' : ''}
                                  {n.ticker ? ' · ' + n.ticker : ''}
                                </span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {/* ⚠️ MIXED-STATE GAP (2026-09-23): derived items can render while the STORED
                        alerts failed to load — the badge still counts them (separate query), so
                        silently omitting them here is the same mismatch this rewrite removed.
                        A fetch that fails must SAY so, even when something else rendered fine. */}
                    {listState === 'failed' && (
                      <div className="notif-load-error">
                        ⚠ Stored alerts could not be loaded
                        {alertActive > 0 && <> ({alertActive} active)</>}
                      </div>
                    )}
                    <div className="notif-footer">
                      {popupHidden > 0 && <span className="notif-more">+{popupHidden} more</span>}
                      {/* "Open Alert Center →" REMOVED 2026-10-02 (owner, Page Walkthrough): the
                          notifications disc IS the primary way to get alerts, and the Alert Center
                          page is being deleted with the whole Automation area. Every other link to
                          it was removed in the same pass - one dead link in the popover is still a
                          dead end. */}
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* Sidebar rail — hidable like Dev Tools (no backdrop, no overlay) */}
      {isOpen && (
        <aside className="so-rail" aria-label="Screen options">
              <div className="so-header">
                <h2 className="so-title">
                  Screen Options
                  {registry && <span className="so-view-name"> — {registry.title}</span>}
                </h2>
                <button className="so-close-btn" onClick={onToggle} aria-label="Close screen options">
                  ✕
                </button>
              </div>

              <div className="so-body">
                {/* ── Global preferences (always shown) ── */}
                <div className="so-global-section">
                  <h3 className="so-global-label">Preferences</h3>
                  {GLOBAL_PREFERENCES.map(function (section) {
                    if (section.type === 'radio') {
                      return (
                        <div key={section.id} className="ff-field">
                          <span className="ff-label" title={section.description}>{section.label}</span>
                          <div className="ff-toggle-group">
                            {section.options.map(function (opt) {
                              var currentValue = globalValueMap[section.field];
                              return (
                                <label
                                  key={opt.value}
                                  className={'ff-toggle-option' + (currentValue === opt.value ? ' active' : '')}
                                  title={opt.desc}
                                >
                                  <input
                                    type="radio"
                                    name={'global-' + section.field}
                                    value={opt.value}
                                    checked={currentValue === opt.value}
                                    onChange={function () { handleGlobalChange(section.field, opt.value); }}
                                  />
                                  <span className="ff-toggle-label">{opt.label}</span>
                                  {opt.desc && <span className="ff-toggle-desc">{opt.desc}</span>}
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      );
                    }
                    return (
                      <label key={section.id} className="ff-checkbox-label" title={section.description}>
                        <input
                          type="checkbox"
                          defaultChecked={globalValueMap[section.field] === true}
                          onChange={function (e) { handleGlobalChange(section.field, e.target.checked); }}
                        />
                        <span>{section.label} — {section.description}</span>
                      </label>
                    );
                  })}
                </div>

                {/* ── View-specific options ── */}
                {hasViewSections ? (
                  <div className="so-view-section">
                    <h3 className="so-global-label">View Options — {registry.title}</h3>
                    {registry.sections.map(function (section) {
                      return (
                        <div key={section.id} className="ff-field">
                          <span className="ff-label" title={section.description}>{section.label}</span>
                          {section.type === 'radio' && (
                            <div className="ff-toggle-group">
                              {section.options.map(function (opt) {
                                return (
                                  <label
                                    key={opt.value}
                                    className={'ff-toggle-option' + (values[section.key] === opt.value ? ' active' : '')}
                                    title={opt.desc}
                                  >
                                    <input
                                      type="radio"
                                      name={section.key}
                                      value={opt.value}
                                      checked={values[section.key] === opt.value}
                                      onChange={function () { handleViewChange(section.key, opt.value); }}
                                    />
                                    <span className="ff-toggle-label">{opt.label}</span>
                                    {opt.desc && <span className="ff-toggle-desc">{opt.desc}</span>}
                                  </label>
                                );
                              })}
                            </div>
                          )}
                          {section.type === 'checkbox' && (
                            <label className="ff-checkbox-label">
                              <input
                                type="checkbox"
                                checked={values[section.key] === 'true' || values[section.key] === true}
                                onChange={function (e) { handleViewChange(section.key, String(e.target.checked)); }}
                              />
                              <span>{section.description || section.label}</span>
                            </label>
                          )}
                          {section.type === 'columns' && (
                            <div className="so-columns-grid">
                              {section.options.map(function (opt) {
                                return (
                                  <label key={opt.key} className="ff-checkbox-label" title={opt.desc}>
                                    <input
                                      type="checkbox"
                                      checked={values[opt.key] === 'true' || values[opt.key] === true}
                                      onChange={function (e) { handleViewChange(opt.key, String(e.target.checked)); }}
                                    />
                                    <span>{opt.label}</span>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                          {section.type === 'accounts' && (
                            <div className="so-accounts">
                              {(portfolioAccounts.categories || []).map(function (cat) {
                                return (
                                  <div key={cat.id} className="so-accounts-cat">
                                    <label className="ff-checkbox-label so-accounts-cat-head">
                                      <input
                                        type="checkbox"
                                        checked={cat.enabled === true}
                                        onChange={function (e) { togglePortfolioAccount('cat:' + cat.id, e.target.checked); }}
                                      />
                                      <span>{cat.label} — {cat.enabled ? ('£' + Number(cat.total || 0).toFixed(2)) : 'excluded'}</span>
                                    </label>
                                    {(cat.accounts || []).map(function (acc) {
                                      return (
                                        <label key={acc.id} className="ff-checkbox-label so-accounts-item" title={acc.note || acc.label}>
                                          <input
                                            type="checkbox"
                                            checked={acc.enabled === true}
                                            disabled={!acc.connected}
                                            onChange={function (e) { togglePortfolioAccount(acc.id, e.target.checked); }}
                                          />
                                          <span>
                                            {acc.label}
                                            {acc.value != null ? ' — £' + Number(acc.value).toFixed(2) : ''}
                                            {!acc.connected ? ' (not connected)' : ''}
                                          </span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : isTradingArea ? (
                  <div className="so-view-section">
                    <h3 className="so-global-label">Trading Controls</h3>
                    <div className="ff-field">
                      <span className="ff-label" title="Master switch for the automated trading layer. Off = signals are generated but no live orders are placed.">Automated Trading</span>
                      <label className="ff-checkbox-label">
                        <input
                          type="checkbox"
                          checked={tradingEnabled}
                          onChange={function (e) { toggleTrading(e.target.checked); }}
                        />
                        <span>{tradingEnabled ? 'Trading is ON — the bot may place live orders.' : 'Trading is OFF — signals only, no live orders.'}</span>
                      </label>
                    </div>
                  </div>
                ) : (
                  <EmptyState icon="⚙" title="No view-specific options" description="This view has no additional configurable options." />
                )}
              </div>

              <div className="so-footer">
                <button className="so-done-btn" onClick={onToggle}>
                  Done
                </button>
              </div>
        </aside>
      )}

      {/* ── Calculators Panel ── */}
      <AnimatePresence>
        {calcOpen && (
          <>
            <motion.div
              className="so-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setCalcOpen(false)}
            />
            <motion.div
              className="so-panel"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
            >
              <div className="so-header">
                <h2 className="so-title">Quick Calculators</h2>
                <button className="so-close-btn" onClick={() => setCalcOpen(false)} aria-label="Close calculators">✕</button>
              </div>
              <div className="so-body">
                <CalcPanel />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* ── Glossary Overlay ── */}
      <AnimatePresence>
        {glossaryOpen && (
          <motion.div
            className="ksh-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => { if (e.target === e.currentTarget) setGlossaryOpen(false); }}
          >
            <motion.div
              className="ksh-modal"
              initial={{ opacity: 0, scale: 0.92, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.92, y: 20 }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              style={{ maxWidth: '680px', maxHeight: '85vh' }}
            >
              <div className="ksh-header">
                <h2>📖 Trading Glossary</h2>
                <button className="ksh-close" onClick={() => setGlossaryOpen(false)} aria-label="Close glossary">×</button>
              </div>
              <div className="ksh-body">
                <GlossaryPage compact />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/** ── Embedded calculator panel ── */
function CalcPanel() {
  var [account, setAccount] = useState(10000);
  var [riskPct, setRiskPct] = useState(2);
  var [entry, setEntry] = useState(100);
  var [stopLoss, setStopLoss] = useState(95);
  var [tpEntry, setTpEntry] = useState(100);
  var [tpSl, setTpSl] = useState(95);
  var [tpTp, setTpTp] = useState(115);

  var riskAmount = account * (riskPct / 100);
  var riskPerShare = Math.abs(entry - stopLoss);
  var maxShares = riskPerShare > 0 ? Math.floor(riskAmount / riskPerShare) : 0;
  var totalValue = maxShares * entry;

  var rrRisk = Math.abs(tpEntry - tpSl);
  var rrReward = Math.abs(tpTp - tpEntry);
  var rrRatio = rrRisk > 0 ? rrReward / rrRisk : 0;

  return (
    <div className="so-calc-panel">
      {/* Position Size */}
      <div className="so-calc-section">
        <h3>Position Size</h3>
        <div className="so-calc-fields">
          <CalcInput label="Account ($)" value={account} onChange={setAccount} />
          <CalcInput label="Risk %" value={riskPct} onChange={setRiskPct} step="0.1" />
          <CalcInput label="Entry ($)" value={entry} onChange={setEntry} step="0.01" />
          <CalcInput label="Stop Loss ($)" value={stopLoss} onChange={setStopLoss} step="0.01" />
          <div className="so-calc-results">
            <CalcResult label="Max Shares" value={maxShares} />
            <CalcResult label="Position $" value={`$${totalValue.toFixed(0)}`} />
            <CalcResult label="Risk $" value={`$${riskAmount.toFixed(0)}`} />
          </div>
        </div>
      </div>

      {/* Risk/Reward */}
      <div className="so-calc-section">
        <h3>Risk / Reward</h3>
        <div className="so-calc-fields">
          <CalcInput label="Entry ($)" value={tpEntry} onChange={setTpEntry} step="0.01" />
          <CalcInput label="Stop Loss ($)" value={tpSl} onChange={setTpSl} step="0.01" />
          <CalcInput label="Take Profit ($)" value={tpTp} onChange={setTpTp} step="0.01" />
          <div className="so-calc-results">
            <CalcResult label="Risk" value={`$${rrRisk.toFixed(1)}`} />
            <CalcResult label="Reward" value={`$${rrReward.toFixed(1)}`} />
            <CalcResult label="R:R" value={`1:${rrRatio.toFixed(1)}`} highlight />
          </div>
        </div>
      </div>
    </div>
  );
}

function CalcInput({ label, value, onChange, step }) {
  return (
    <div className="so-calc-input">
      <label>{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        step={step}
      />
    </div>
  );
}

function CalcResult({ label, value, highlight }) {
  return (
    <div className="so-calc-result">
      <span>{label}</span>
      <strong className={highlight ? 'so-calc-highlight' : ''}>{value}</strong>
    </div>
  );
}
