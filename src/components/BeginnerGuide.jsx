/**
 * BeginnerGuide — two dismissable education containers
 * =====================================================
 * Container 1: "What Are Directives?" — global concept explanation
 * Container 2: "About This Directive" — category-specific guidance
 *
 * Both are dismissable (✕) and collapsible (▼/▶).
 * Dismissals are stored in preferences.dismissedGuides.
 * The showTrainingGuidance master toggle hides everything.
 *
 * Usage:
 *   <BeginnerGuide directive={directive} />
 */

import { useState, useCallback } from 'react';
import { usePreferences } from '../core/hooks/usePreferences';
import GlossaryPopover from './GlossaryPopover';
import { getDirectiveMeta } from '../data/directive-meta';
import './beginner-guide.css';

const GLOBAL_ID = 'directives-global';
const SPECIFIC_ID = 'directives-specific';

export default function BeginnerGuide({ directive }) {
  const { prefs, set } = usePreferences();
  const showGuidance = prefs?.showTrainingGuidance !== false;
  const dismissed = prefs?.dismissedGuides || {};

  const globalDismissed = !!dismissed[GLOBAL_ID];
  const specificDismissed = !!dismissed[SPECIFIC_ID];

  // ⚠️ HOOK ORDER: `useCallback` must be declared BEFORE any early return.
  // It previously sat below the two `return null` guards, so on a render where
  // the guide was hidden React saw FEWER hooks than on a render where it was
  // shown. React enforces a fixed hook count per component, so toggling
  // training guidance on (or dismissing both guides) would throw
  // "Rendered fewer hooks than expected" and blank the surrounding view.
  // `react-hooks/rules-of-hooks` flagged this; the fix is ordering, not logic.
  const dismiss = useCallback((guideId) => {
    set('dismissedGuides', {
      ...(prefs?.dismissedGuides || {}),
      [guideId]: new Date().toISOString(),
    });
  }, [prefs, set]);

  if (!showGuidance || !directive) return null;
  if (globalDismissed && specificDismissed) return null;

  const category = directive.category || 'Other';
  const name = directive.name || directive.id;
  const description = typeof directive.description === 'string' ? directive.description : '';
  const directiveId = directive.id;

  return (
    <div className="bg-wrapper">
      {!globalDismissed && (
        <GlobalGuide onDismiss={() => dismiss(GLOBAL_ID)} />
      )}
      {!specificDismissed && (
        <SpecificGuide
          category={category}
          name={name}
          description={description}
          directiveId={directiveId}
          onDismiss={() => dismiss(SPECIFIC_ID)}
        />
      )}
    </div>
  );
}

/* ────────────────────────────────────────────
   Container 1: What Are Directives? (global)
   ──────────────────────────────────────────── */
function GlobalGuide({ onDismiss }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <section className="bg-card">
      <div className="bg-header" onClick={() => setCollapsed(!collapsed)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setCollapsed(!collapsed)}>
        <span className="bg-icon">📖</span>
        <span className="bg-title">What Are Directives?</span>
        <span className="bg-badge">Education</span>
        <button className="bg-toggle" aria-label={collapsed ? 'Expand guide' : 'Collapse guide'} onClick={(e) => { e.stopPropagation(); setCollapsed(!collapsed); }}>
          {collapsed ? '▶' : '▼'}
        </button>
        <button className="bg-dismiss" aria-label="Dismiss this guide" title="Don't show this again" onClick={(e) => { e.stopPropagation(); onDismiss(); }}>
          ✕
        </button>
      </div>
      {!collapsed && (
        <div className="bg-body">
          <div className="bg-content">
            <p className="bg-intro">
              Directives are <strong>scoring rules</strong> that grade one aspect of a trading setup — like a checklist item that gets a score instead of a simple yes/no.
            </p>
            <div className="bg-block">
              <h4>How Directives Work</h4>
              <p>Each directive asks a single question about the market: <em>"Is the trend healthy?"</em>, <em>"Is the pullback deep enough?"</em>, <em>"Is volume confirming the move?"</em> The score (0 to max) tells you how strongly the conditions match.</p>
              <p>Multiple directives combine into a <strong>composite score</strong> — your overall grade for the setup. Higher composite = more conditions are met.</p>
            </div>
            <div className="bg-block">
              <h4>Directive Categories</h4>
              <p className="bg-cat-hint">Hover over each category for an explanation:</p>
              <ul className="bg-cat-list">
                <li><GlossaryPopover term="entry directive"><strong>Entry</strong></GlossaryPopover> — when to open a position</li>
                <li><GlossaryPopover term="exit directive"><strong>Exit</strong></GlossaryPopover> — when to close a position</li>
                <li><GlossaryPopover term="trend directive"><strong>Trend</strong></GlossaryPopover> — which direction the market is moving</li>
                <li><GlossaryPopover term="momentum directive"><strong>Momentum</strong></GlossaryPopover> — how fast and strong the move is</li>
                <li><GlossaryPopover term="volume directive"><strong>Volume</strong></GlossaryPopover> — trading activity confirming the move</li>
                <li><GlossaryPopover term="risk directive"><strong>Risk</strong></GlossaryPopover> — position sizing and drawdown protection</li>
                <li><GlossaryPopover term="macro directive"><strong>Macro</strong></GlossaryPopover> — broad economic factors</li>
              </ul>
            </div>
            <div className="bg-block">
              <h4>Protocols: Combining Directives</h4>
              <p>A <strong>protocol</strong> is a collection of directives that work together. For example, a "Trend Pullback" protocol might combine a trend directive (confirming the trend direction) with an entry directive (spotting a pullback) and a risk directive (checking volatility is acceptable). You can build your own protocols on the <strong>Protocol Editor</strong> page.</p>
            </div>
            <TipsBlock />
          </div>
        </div>
      )}
    </section>
  );
}

/* ────────────────────────────────────────────
   Container 2: About This Directive (specific)
   ──────────────────────────────────────────── */
function SpecificGuide({ category, name, description, directiveId, onDismiss }) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <section className="bg-card bg-card-specific">
      <div className="bg-header" onClick={() => setCollapsed(!collapsed)} role="button" tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setCollapsed(!collapsed)}>
        <span className="bg-icon">💡</span>
        <span className="bg-title">About This Directive</span>
        <span className="bg-badge">Education</span>
        <button className="bg-toggle" aria-label={collapsed ? 'Expand guide' : 'Collapse guide'} onClick={(e) => { e.stopPropagation(); setCollapsed(!collapsed); }}>
          {collapsed ? '▶' : '▼'}
        </button>
        <button className="bg-dismiss" aria-label="Dismiss this guide" title="Don't show this again" onClick={(e) => { e.stopPropagation(); onDismiss(); }}>
          ✕
        </button>
      </div>
      {!collapsed && (
        <div className="bg-body">
          <div className="bg-content">
            <GuideBody category={category} name={name} description={description} directiveId={directiveId} />
            <DirectiveMetaBlock directiveId={directiveId} />
          </div>
        </div>
      )}
    </section>
  );
}

/* ────────────────────────────────────────────
   Category-specific guide bodies
   ──────────────────────────────────────────── */
function GuideBody({ category, name, description, directiveId }) {
  switch (category) {
    case 'Entry':    return <EntryBody name={name} description={description} directiveId={directiveId} />;
    case 'Exit':     return <ExitBody name={name} description={description} directiveId={directiveId} />;
    case 'Risk':     return <RiskBody name={name} description={description} directiveId={directiveId} />;
    case 'Momentum': return <MomentumBody name={name} description={description} directiveId={directiveId} />;
    case 'Trend':    return <TrendBody name={name} description={description} directiveId={directiveId} />;
    case 'Volume':   return <VolumeBody name={name} description={description} directiveId={directiveId} />;
    case 'Macro':    return <MacroBody name={name} description={description} directiveId={directiveId} />;
    default:         return <DefaultBody name={name} description={description} directiveId={directiveId} />;
  }
}

function EntryBody({ name, description }) {
  return (
    <>
      <p className="bg-intro">
        <strong>{name}</strong> is an <strong>entry directive</strong> — it helps decide <em>when</em> to enter a trade.
      </p>
      <div className="bg-block">
        <h4>What Entry Directives Do</h4>
        <p>Entry directives scan the market for favorable conditions to open a position. They look for setups like pullbacks, breakouts, or momentum shifts — moments where the odds favor a successful trade. Think of them as a <strong>quality checklist</strong> before you click "buy" or "sell."</p>
      </div>
      {description && (
        <div className="bg-block">
          <h4>This Directive's Logic</h4>
          <p className="bg-quote">"{description}"</p>
          <p>In plain language: this rule checks whether the current price action matches the pattern it's designed to detect. A high score means the pattern is clearly present; a low score means it's weak or absent.</p>
        </div>
      )}
    </>
  );
}

function ExitBody({ name, description }) {
  return (
    <>
      <p className="bg-intro">
        <strong>{name}</strong> is an <strong>exit directive</strong> — it helps decide <em>when</em> to close a trade.
      </p>
      <div className="bg-block">
        <h4>What Exit Directives Do</h4>
        <p>Exit directives monitor open positions for signs that the trade has run its course. They look for weakening momentum, reversal patterns, or risk thresholds being hit. A good exit is just as important as a good entry — exiting too early leaves profit on the table; exiting too late gives back gains.</p>
      </div>
      {description && (
        <div className="bg-block">
          <h4>This Directive's Logic</h4>
          <p className="bg-quote">"{description}"</p>
          <p>This rule monitors your open positions and scores how strongly the current conditions suggest you should close. A rising exit score means the reasons to exit are getting stronger.</p>
        </div>
      )}
    </>
  );
}

function RiskBody({ name, description }) {
  return (
    <>
      <p className="bg-intro">
        <strong>{name}</strong> is a <strong>risk directive</strong> — it evaluates the danger level of a trade.
      </p>
      <div className="bg-block">
        <h4>What Risk Directives Do</h4>
        <p>Risk directives measure things like volatility, correlation exposure, or position size relative to your account. They help answer: <em>"How much can I lose if this goes wrong?"</em> A high risk score doesn't necessarily mean "don't trade" — it means "size accordingly and be aware."</p>
      </div>
      {description && (
        <div className="bg-block">
          <h4>This Directive's Logic</h4>
          <p className="bg-quote">"{description}"</p>
        </div>
      )}
    </>
  );
}

function MomentumBody({ name, description }) {
  return (
    <>
      <p className="bg-intro">
        <strong>{name}</strong> is a <strong>momentum directive</strong> — it measures how fast and strong price is moving.
      </p>
      <div className="bg-block">
        <h4>What Momentum Directives Do</h4>
        <p>Momentum directives assess the speed of price changes. Strong momentum in your trade's direction is good — it suggests the move has force behind it. Weakening momentum can be an early warning of a reversal. Think of momentum like a car's speedometer: it tells you how fast you're going, not where you're headed.</p>
      </div>
      {description && (
        <div className="bg-block">
          <h4>This Directive's Logic</h4>
          <p className="bg-quote">"{description}"</p>
        </div>
      )}
    </>
  );
}

function TrendBody({ name, description }) {
  return (
    <>
      <p className="bg-intro">
        <strong>{name}</strong> is a <strong>trend directive</strong> — it identifies whether the market is trending and in which direction.
      </p>
      <div className="bg-block">
        <h4>What Trend Directives Do</h4>
        <p>Trend directives determine if the market is moving consistently in one direction (uptrend or downtrend) or if it's choppy and directionless. They typically use moving averages, price structure (higher highs/lower lows), or ADX. The golden rule: <strong>"The trend is your friend."</strong> Trading with the trend has statistically higher success rates.</p>
      </div>
      {description && (
        <div className="bg-block">
          <h4>This Directive's Logic</h4>
          <p className="bg-quote">"{description}"</p>
        </div>
      )}
    </>
  );
}

function VolumeBody({ name, description }) {
  return (
    <>
      <p className="bg-intro">
        <strong>{name}</strong> is a <strong>volume directive</strong> — it analyzes trading activity levels.
      </p>
      <div className="bg-block">
        <h4>What Volume Directives Do</h4>
        <p>Volume directives check whether trading activity confirms or contradicts the price move. High volume on a breakout = strong conviction. Low volume = the move may be weak and likely to fail. Volume is the "fuel" behind price moves — without it, moves tend to fizzle out.</p>
      </div>
      {description && (
        <div className="bg-block">
          <h4>This Directive's Logic</h4>
          <p className="bg-quote">"{description}"</p>
        </div>
      )}
    </>
  );
}

function MacroBody({ name, description }) {
  return (
    <>
      <p className="bg-intro">
        <strong>{name}</strong> is a <strong>macro directive</strong> — it factors in broad economic conditions.
      </p>
      <div className="bg-block">
        <h4>What Macro Directives Do</h4>
        <p>Macro directives look beyond individual symbols to the bigger picture: interest rates, GDP, commodity prices, correlations, and sentiment. These "big picture" factors often drive entire markets. For example: a strong USD tends to pressure gold and emerging market currencies.</p>
      </div>
      {description && (
        <div className="bg-block">
          <h4>This Directive's Logic</h4>
          <p className="bg-quote">"{description}"</p>
          <p>This is the technical formula. Hover over any underlined bold terms for plain-language definitions.</p>
        </div>
      )}
    </>
  );
}

function DefaultBody({ name, description }) {
  return (
    <>
      <p className="bg-intro">
        <strong>{name}</strong> is a scoring directive — a rule that evaluates one aspect of a trading setup.
      </p>
      {description && (
        <div className="bg-block">
          <h4>This Directive's Logic</h4>
          <p className="bg-quote">"{description}"</p>
          <p>This is the technical formula. Hover over any underlined bold terms for plain-language definitions.</p>
        </div>
      )}
    </>
  );
}

function DirectiveMetaBlock({ directiveId }) {
  const meta = directiveId ? getDirectiveMeta(directiveId) : null;
  if (!meta) return null;

  return (
    <div className="bg-meta">
      <h4>📐 Parameters & Logic</h4>
      <table className="bg-meta-params">
        <tbody>
          {Object.entries(meta.parameters).map(([key, val]) => (
            <tr key={key}>
              <td className="bg-meta-param-key">{key}</td>
              <td className="bg-meta-param-val">{val}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h4 style={{ marginTop: '0.75rem' }}>📊 Scoring Zones</h4>
      <div className="bg-meta-zones">
        {meta.scoringZones.map((zone, i) => (
          <div key={i} className="bg-meta-zone">
            <div className="bg-meta-zone-header">
              <span className="bg-meta-zone-range">{zone.range}</span>
              <span className="bg-meta-zone-score">{zone.score}</span>
            </div>
            <p className="bg-meta-zone-meaning">{zone.meaning}</p>
          </div>
        ))}
      </div>

      <div className="bg-meta-interpretation">
        <h4>🔍 How to Interpret Scores</h4>
        <p>{meta.interpretation}</p>
      </div>
    </div>
  );
}

function TipsBlock() {
  return (
    <div className="bg-tips">
      <h4>💬 Pro Tips</h4>
      <ul>
        <li><strong>Test before trusting:</strong> Use the "Test Directive" section below to see how this rule scores on real market data before relying on it.</li>
        <li><strong>No single directive tells the whole story:</strong> Combine multiple directives (entry + trend + risk) for a complete picture. This is what protocols do.</li>
        <li><strong>Scores are relative, not absolute:</strong> A score of 7/10 doesn't mean "70% chance of profit." It means 70% of ideal conditions are met. Real markets are messier than any formula.</li>
        <li><strong>Hover over bold, underlined terms</strong> throughout the app for plain-language definitions of trading jargon.</li>
      </ul>
    </div>
  );
}
