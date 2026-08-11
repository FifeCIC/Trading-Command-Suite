/**
 * Daily Summary Report
 * ====================
 * Auto-generates a formatted Markdown/plain-text report of today's trading
 * activity. Copy to clipboard for posting to Reddit, Discord, or other platforms.
 *
 * Data sources: /api/providers/mt5/diagnostics, /api/providers/mt5/positions,
 *   /api/providers/mt5/history, /api/scoring/ranked, /api/automation/status,
 *   /api/providers/health
 */
import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../core/api/client';
import { formatCurrency } from '../core/format-utils';
import LoadingSkeleton from '../components/LoadingSkeleton';
import Notice from '../components/Notice';
import './daily-summary-report.css';
import PageInfoPopover from '../components/PageInfoPopover';

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function DailySummaryReportPage() {
  const [copied, setCopied] = useState('');
  const [copyMode, setCopyMode] = useState('markdown');

  // ── Data queries ──
  const diagQuery = useQuery({
    queryKey: ['report-diag'],
    queryFn: () => apiGet('/api/providers/mt5/diagnostics').catch(() => null),
    staleTime: 30_000,
  });
  const diag = diagQuery.data || {};

  const posQuery = useQuery({
    queryKey: ['report-positions'],
    queryFn: () => apiGet('/api/providers/mt5/positions').catch(() => ({ positions: [] })),
    staleTime: 30_000,
  });
  const positions = posQuery.data?.positions || [];

  const historyQuery = useQuery({
    queryKey: ['report-history'],
    queryFn: () => apiGet('/api/providers/mt5/history?from=' + todayStr()).catch(() => ({ deals: [] })),
    staleTime: 30_000,
  });
  const deals = (() => {
    const raw = historyQuery.data?.deals || historyQuery.data;
    return Array.isArray(raw) ? raw : [];
  })();

  const rankedQuery = useQuery({
    queryKey: ['report-ranked'],
    queryFn: () => apiGet('/api/scoring/ranked?limit=10').catch(() => ({ ranked: [] })),
    staleTime: 30_000,
  });
  const ranked = rankedQuery.data?.ranked || [];

  const autoQuery = useQuery({
    queryKey: ['report-auto'],
    queryFn: () => apiGet('/api/automation/status').catch(() => null),
    staleTime: 30_000,
  });
  const auto = autoQuery.data || {};

  const healthQuery = useQuery({
    queryKey: ['report-health'],
    queryFn: () => apiGet('/api/providers/health').catch(() => null),
    staleTime: 30_000,
  });
  const providers = healthQuery.data?.providers || [];

  // ── Derived stats ──
  const totalPnl = positions.reduce((s, p) => s + (p.profit || 0), 0);
  const longs = positions.filter(p => (p.type || '').toLowerCase() === 'buy').length;
  const shorts = positions.filter(p => (p.type || '').toLowerCase() === 'sell').length;
  const bestPerformer = [...positions].sort((a, b) => (b.profit || 0) - (a.profit || 0))[0];
  const worstPerformer = [...positions].sort((a, b) => (a.profit || 0) - (b.profit || 0))[0];

  const todayDeals = deals.filter(d => {
    const t = d.time || d.closeTime || d.timestamp;
    return t && t.slice(0, 10) === todayStr();
  });
  const closedPnl = todayDeals.reduce((s, d) => s + (d.profit || d.pnl || 0), 0);
  const winCount = todayDeals.filter(d => (d.profit || d.pnl || 0) > 0).length;
  const loseCount = todayDeals.filter(d => (d.profit || d.pnl || 0) < 0).length;

  const activeStrategies = auto.activeStrategies?.length || 0;
  const tickCount = auto.tickCount || 0;
  const healthyProviders = providers.filter(p => p.status === 'healthy').length;

  // ── Generate report ──
  const report = useMemo(() => {
    const lines = [];

    // Header
    lines.push(`# 📊 Daily Trading Summary — ${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`);
    lines.push('');

    // Portfolio
    lines.push('## 💼 Portfolio');
    lines.push('');
    if (diag.connected !== undefined) {
      lines.push(`- **Balance:** ${formatCurrency(diag.balance, { abs: true })}  |  **Equity:** ${formatCurrency(diag.equity, { abs: true })}`);
    }
    lines.push(`- **Open Positions:** ${positions.length} (${longs} long, ${shorts} short)`);
    lines.push(`- **Unrealized P&L:** ${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}`);
    if (bestPerformer) {
      lines.push(`- **Best:** ${bestPerformer.symbol} ${bestPerformer.profit >= 0 ? '+' : ''}${(bestPerformer.profit || 0).toFixed(2)}`);
    }
    if (worstPerformer && worstPerformer.profit < 0) {
      lines.push(`- **Worst:** ${worstPerformer.symbol} ${(worstPerformer.profit || 0).toFixed(2)}`);
    }
    lines.push('');

    // Closed trades today
    if (todayDeals.length > 0) {
      lines.push('## 🔄 Trades Closed Today');
      lines.push('');
      lines.push(`- **Total:** ${todayDeals.length} trades closed`);
      lines.push(`- **P&L:** ${closedPnl >= 0 ? '+' : ''}${closedPnl.toFixed(2)}`);
      lines.push(`- **Win/Loss:** ${winCount}W / ${loseCount}L`);
      lines.push('');
    } else {
      lines.push('## 🔄 Trades Closed Today');
      lines.push('');
      lines.push('No trades closed today.');
      lines.push('');
    }

    // Top signals
    lines.push('## 🎯 Top Signals');
    lines.push('');
    if (ranked.length > 0) {
      lines.push('| # | Symbol | Score | Signal |');
      lines.push('|---|--------|-------|--------|');
      ranked.slice(0, 8).forEach((r, i) => {
        lines.push(`| ${i + 1} | ${r.ticker || r.symbol} | ${r.score || '—'} | ${r.signal || '—'} |`);
      });
    } else {
      lines.push('No signals generated today.');
    }
    lines.push('');

    // Automation
    lines.push('## ⚙️ Automation');
    lines.push('');
    lines.push(`- **Ticks:** ${tickCount}  |  **Strategies:** ${activeStrategies} active`);
    if (auto.loopEnabled !== undefined) {
      lines.push(`- **Loop:** ${auto.loopEnabled ? '🟢 Running' : '🔴 Paused'}`);
    }
    lines.push('');

    // Provider health
    lines.push('## 📡 Provider Health');
    lines.push('');
    if (providers.length > 0) {
      providers.filter(p => p.status === 'healthy').forEach(p => {
        lines.push(`- 🟢 **${p.displayName}** — connected`);
      });
      providers.filter(p => p.status !== 'healthy').forEach(p => {
        const icon = p.status === 'degraded' ? '🟡' : p.status === 'unknown' ? '⚪' : '🔴';
        lines.push(`- ${icon} **${p.displayName}** — ${p.status}`);
      });
    } else {
      lines.push('No provider data available.');
    }
    lines.push('');

    // Footer
    lines.push('---');
    lines.push(`*Generated by Trading Command Suite — ${new Date().toLocaleString()}*`);

    return lines.join('\n');
  }, [diag, positions, todayDeals, ranked, auto, providers, totalPnl, longs, shorts, bestPerformer, worstPerformer, closedPnl, winCount, loseCount, tickCount, activeStrategies, healthyProviders]);

  const plainText = report
    .replace(/^#+\s+/gm, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/^[-*]\s+/gm, '• ')
    .replace(/\|/g, ' ')
    .replace(/^-{3,}$/gm, '—'.repeat(30))
    .replace(/\*_/g, '')
    .replace(/_/g, '');

  const handleCopy = (mode) => {
    const text = mode === 'markdown' ? report : plainText;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(mode);
      setTimeout(() => setCopied(''), 2000);
    }).catch(() => {});
  };

  const isLoading = diagQuery.isLoading || posQuery.isLoading || rankedQuery.isLoading;

  if (isLoading) {
    return (
      <div className="dr-page">
        <header className="dr-header"><h1>Daily Summary Report</h1></header>
        <LoadingSkeleton variant="card" count={3} />
      </div>
    );
  }

  return (
    <div className="dr-page">
      <header className="dr-header">
        <div>
          <h1>Daily Summary Report
          <PageInfoPopover>
            Auto-generated trading summary — copy to clipboard for Reddit, Discord, or other platforms
          </PageInfoPopover>
        </h1>
        </div>
      </header>

      {/* Copy buttons */}
      <div className="dr-actions">
        <button
          className={`dr-copy-btn ${copied === 'markdown' ? 'copied' : ''}`}
          onClick={() => handleCopy('markdown')}
        >
          {copied === 'markdown' ? '✓ Copied Markdown!' : '📋 Copy Markdown'}
        </button>
        <button
          className={`dr-copy-btn dr-copy-plain ${copied === 'plain' ? 'copied' : ''}`}
          onClick={() => handleCopy('plain')}
        >
          {copied === 'plain' ? '✓ Copied Text!' : '📄 Copy Plain Text'}
        </button>
        <button className="dr-refresh-btn" onClick={() => { diagQuery.refetch(); posQuery.refetch(); rankedQuery.refetch(); historyQuery.refetch(); }}>
          ⟳ Refresh
        </button>
      </div>

      {/* Report preview */}
      <section className="dr-preview">
        <div className="dr-preview-header">
          <span>📊 Rendered Preview</span>
          <span className="dr-preview-hint">Markdown formatting — copy and paste into Reddit, Discord, or any Markdown editor</span>
        </div>
        <div className="dr-report-content">
          {report.split('\n').map((line, i) => {
            // Headers
            if (line.startsWith('# ')) return <h1 key={i} className="dr-md-h1">{line.slice(2)}</h1>;
            if (line.startsWith('## ')) return <h2 key={i} className="dr-md-h2">{line.slice(3)}</h2>;
            // Table separator rows
            if (line.startsWith('|---')) return <hr key={i} className="dr-md-sep" />;
            // Table rows
            if (line.startsWith('| ')) {
              const cells = line.split('|').filter(c => c.trim());
              return (
                <div key={i} className="dr-md-table-row">
                  {cells.map((c, j) => (
                    <span key={j} className="dr-md-table-cell">{c.trim()}</span>
                  ))}
                </div>
              );
            }
            // List items
            if (line.startsWith('- ')) return <div key={i} className="dr-md-li">{line.slice(2)}</div>;
            // Horizontal rule
            if (line.startsWith('---')) return <hr key={i} className="dr-md-hr" />;
            // Italic
            if (line.startsWith('*') && line.endsWith('*')) return <p key={i} className="dr-md-italic">{line.slice(1, -1)}</p>;
            // Empty
            if (line === '') return <br key={i} />;
            return <p key={i} className="dr-md-p">{line}</p>;
          })}
        </div>
      </section>

      <p className="dr-footer">
        Data refreshes on page load · Last updated {new Date().toLocaleTimeString()}
      </p>
    </div>
  );
}
