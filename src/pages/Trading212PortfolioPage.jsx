/**
 * Trading212 Portfolio Scoring Page
 * ==================================
 * Dedicated page for viewing your live Trading212 portfolio through the
 * scoring lens. Every holding is scored through the full protocol gating
 * pipeline including multi-timeframe trend alignment and micro S/R.
 *
 * URL: /trading/trading212-portfolio
 */

import { useState, useMemo } from 'react';
import { motion } from 'motion/react';
import { useQuery } from '@tanstack/react-query';
import { apiGet, apiPost } from '../core/api/client';
import LoadingSkeleton from '../components/LoadingSkeleton';
import RarityGauge from '../components/RarityGauge';
import './trading212-portfolio.css';

const REFRESH_MS = 30_000;

export default function Trading212PortfolioPage() {
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

  // ── Fetch portfolio ──────────────────────────────────
  const portfolioQuery = useQuery({
    queryKey: ['t212-portfolio'],
    queryFn: () => apiGet('/api/portfolio/trading212/import'),
    refetchInterval: REFRESH_MS,
    staleTime: 15_000,
  });

  // ── Score batch ──────────────────────────────────────
  const holdings = portfolioQuery.data?.positions ?? [];
  const tickers = useMemo(() => holdings.map(h => h.ticker), [holdings]);

  const scoresQuery = useQuery({
    queryKey: ['t212-scores', tickers.join(',')],
    queryFn: () => apiPost('/api/scoring/gated/batch', { tickers, protocolId: 'default' }),
    enabled: tickers.length > 0,
    refetchInterval: REFRESH_MS,
    staleTime: 15_000,
  });

  // ── Import handler ───────────────────────────────────
  const handleImport = async () => {
    setImporting(true);
    try {
      const res = await apiPost('/api/portfolio/trading212/import');
      setImportResult(res);
      portfolioQuery.refetch();
    } catch (e) {
      setImportResult({ success: false, error: e.message });
    }
    setImporting(false);
  };

  // ── Merge holdings with scores ───────────────────────
  const scoredHoldings = useMemo(() => {
    const scoreMap = new Map();
    if (scoresQuery.data) {
      for (const s of scoresQuery.data) {
        scoreMap.set(s.symbol, s);
      }
    }
    return holdings.map(h => ({
      ...h,
      score: scoreMap.get(h.ticker) ?? null,
    }));
  }, [holdings, scoresQuery.data]);

  // ── Summary stats ────────────────────────────────────
  const summary = useMemo(() => {
    const scored = scoredHoldings.filter(h => h.score);
    const composites = scored.map(h => h.score.composite).filter(c => c != null);
    const avgComposite = composites.length > 0
      ? composites.reduce((a, b) => a + b, 0) / composites.length
      : null;
    const buyCount = scored.filter(h => h.score?.signal === 'BUY').length;
    const sellCount = scored.filter(h => h.score?.signal === 'SELL').length;
    const holdCount = scored.filter(h => h.score?.signal === 'HOLD').length;
    const rareCount = scored.filter(h => h.score?.rarity?.band === 'exceptional' || h.score?.rarity?.band === 'cyclical' || h.score?.rarity?.band === 'black-swan').length;
    const totalValue = holdings.reduce((sum, h) => sum + (h.quantity || 0) * (h.currentPrice || 0), 0);

    return { avgComposite, buyCount, sellCount, holdCount, rareCount, totalValue, scoredCount: scored.length };
  }, [scoredHoldings, holdings]);

  const isLoaded = !portfolioQuery.isLoading && !scoresQuery.isLoading;
  const hasError = portfolioQuery.isError || scoresQuery.isError;
  const isEmpty = isLoaded && holdings.length === 0;

  return (
    <div className="t212-page">
      <header className="t212-header">
        <div>
          <h1>Trading212 Portfolio</h1>
          <p className="t212-subtitle">Live positions scored through the SEES protocol pipeline</p>
        </div>
        <button className="t212-btn t212-btn--import" onClick={handleImport} disabled={importing}>
          {importing ? '⏳ Importing…' : '🔄 Import Positions'}
        </button>
      </header>

      {importResult && (
        <motion.div
          className={`t212-import-result ${importResult.success ? 'success' : 'error'}`}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
        >
          {importResult.success
            ? `✓ Imported ${importResult.positionsImported} positions, ${importResult.symbolsCreated} new symbols`
            : `✗ ${importResult.error}`}
        </motion.div>
      )}

      {/* ── Summary Cards ──────────────────────────────── */}
      {holdings.length > 0 && (
        <motion.div className="t212-summary" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 }}>
          <div className="t212-summary-card">
            <span className="t212-summary-value">{holdings.length}</span>
            <span className="t212-summary-label">Positions</span>
          </div>
          <div className="t212-summary-card">
            <span className="t212-summary-value">
              {summary.totalValue > 0 ? `$${summary.totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : '—'}
            </span>
            <span className="t212-summary-label">Portfolio Value</span>
          </div>
          <div className="t212-summary-card">
            <span className={`t212-summary-value ${summary.avgComposite != null ? (summary.avgComposite >= 55 ? 'bullish' : summary.avgComposite <= 45 ? 'bearish' : '') : ''}`}>
              {summary.avgComposite != null ? summary.avgComposite.toFixed(0) : '—'}
            </span>
            <span className="t212-summary-label">Avg Composite</span>
          </div>
          <div className="t212-summary-card">
            <span className="t212-summary-value">{summary.scoredCount}</span>
            <span className="t212-summary-label">Scored</span>
          </div>
          <div className="t212-summary-card">
            <div className="t212-signal-split">
              <span className="t212-split-buy" style={{ flex: summary.buyCount || 0.1 }} title={`${summary.buyCount} BUY`}>{summary.buyCount || ''}</span>
              <span className="t212-split-hold" style={{ flex: summary.holdCount || 0.1 }} title={`${summary.holdCount} HOLD`}>{summary.holdCount || ''}</span>
              <span className="t212-split-sell" style={{ flex: summary.sellCount || 0.1 }} title={`${summary.sellCount} SELL`}>{summary.sellCount || ''}</span>
            </div>
            <span className="t212-summary-label">Signal Split</span>
          </div>
          <div className="t212-summary-card">
            <span className={`t212-summary-value ${summary.rareCount > 0 ? 'rare' : ''}`}>
              {summary.rareCount > 0 ? `⭐ ${summary.rareCount}` : '0'}
            </span>
            <span className="t212-summary-label">Rare Opportunities</span>
          </div>
        </motion.div>
      )}

      {/* ── Holdings Table ──────────────────────────────── */}
      {!isEmpty && (
        <motion.div className="t212-table-wrap" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <table className="t212-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Symbol</th>
                <th>Qty</th>
                <th>Price</th>
                <th>Value</th>
                <th>P/L</th>
                <th>Composite</th>
                <th>Signal</th>
                <th>Trend</th>
                <th>Rarity</th>
                <th>Risk</th>
              </tr>
            </thead>
            <tbody>
              {scoredHoldings.map((h, i) => (
                <HoldingsRow key={h.ticker} holding={h} rank={i + 1} />
              ))}
            </tbody>
          </table>
        </motion.div>
      )}

      {/* ── Empty state ─────────────────────────────────── */}
      {isEmpty && (
        <div className="t212-empty">
          <div className="t212-empty-icon">📊</div>
          <h2>No positions loaded</h2>
          <p>Click "Import Positions" to pull your live Trading212 portfolio, or connect your Trading212 account in Settings.</p>
        </div>
      )}

      {/* ── Loading state ───────────────────────────────── */}
      {!isLoaded && !hasError && (
        <div className="t212-loading">
          <LoadingSkeleton variant="text" lines={8} />
        </div>
      )}

      {/* ── Error state ─────────────────────────────────── */}
      {hasError && (
        <div className="t212-error">
          <span>⚠ Could not load portfolio data. Check that your Trading212 API key is configured in Settings.</span>
        </div>
      )}
    </div>
  );
}

// ── Holdings Row ────────────────────────────────────────

function HoldingsRow({ holding, rank }) {
  const { ticker, quantity, currentPrice, ppl } = holding;
  const score = holding.score;
  const value = (quantity || 0) * (currentPrice || 0);

  // Extract trend direction from directive-level results
  const trendReason = score?.breakouts?.technical?.find(
    b => b.directiveId === 'multi-timeframe-trend'
  )?.reason ?? '';
  const dayTrend = trendReason.match(/1D:\s*(\w+)/)?.[1] ?? null;
  const hourTrend = trendReason.match(/1H:\s*(\w+)/)?.[1] ?? null;
  const min15Trend = trendReason.match(/15M:\s*(\w+)/)?.[1] ?? null;

  const composite = score?.composite;
  const signal = score?.signal ?? '—';
  const rarity = score?.rarity;
  const riskMult = score?.riskMultiplier;

  return (
    <tr className={`t212-row ${signal === 'BUY' ? 'row-buy' : signal === 'SELL' ? 'row-sell' : ''}`}>
      <td className="t212-cell-rank">{rank}</td>
      <td className="t212-cell-symbol">
        <span className="t212-ticker">{ticker}</span>
      </td>
      <td className="t212-cell-num">{quantity ?? '—'}</td>
      <td className="t212-cell-num">{currentPrice != null ? `$${currentPrice.toFixed(2)}` : '—'}</td>
      <td className="t212-cell-num">{value > 0 ? `$${value.toFixed(0)}` : '—'}</td>
      <td className={`t212-cell-num ${ppl > 0 ? 'positive' : ppl < 0 ? 'negative' : ''}`}>
        {ppl != null ? `${ppl >= 0 ? '+' : ''}$${Math.abs(ppl).toFixed(2)}` : '—'}
      </td>
      <td className="t212-cell-score">
        {composite != null ? (
          <div className="t212-score-bar-wrap">
            <div
              className={`t212-score-bar ${composite >= 65 ? 'strong' : composite <= 35 ? 'weak' : ''}`}
              style={{ width: `${Math.min(100, Math.max(0, composite))}%` }}
            />
            <span className="t212-score-val">{composite.toFixed(0)}</span>
          </div>
        ) : (
          <span className="t212-na">—</span>
        )}
      </td>
      <td className="t212-cell-signal">
        {signal !== '—' ? (
          <span className={`t212-signal-chip ${signal.toLowerCase()}`}>{signal}</span>
        ) : (
          <span className="t212-na">—</span>
        )}
      </td>
      <td className="t212-cell-trend">
        {dayTrend ? (
          <span className="t212-trend-dots">
            <TrendDot direction={dayTrend} label="D" />
            <TrendDot direction={hourTrend} label="H" />
            <TrendDot direction={min15Trend} label="15" />
          </span>
        ) : (
          <span className="t212-na">—</span>
        )}
      </td>
      <td className="t212-cell-rarity">
        {rarity ? (
          <RarityGauge rarity={rarity} compact />
        ) : (
          <span className="t212-na">—</span>
        )}
      </td>
      <td className="t212-cell-risk">
        {riskMult != null ? (
          <span className={`t212-risk-badge ${riskMult >= 1 ? 'boost' : riskMult <= 0.6 ? 'penalty' : ''}`}>
            {riskMult.toFixed(2)}x
          </span>
        ) : (
          <span className="t212-na">—</span>
        )}
      </td>
    </tr>
  );
}

// ── Mini trend dot ──────────────────────────────────────

function TrendDot({ direction, label }) {
  const color = direction === 'bullish' ? '#10b981' : direction === 'bearish' ? '#ef4444' : '#475569';
  return (
    <span className="t212-trend-dot" title={`${label}: ${direction}`}>
      <span className="t212-dot" style={{ background: color }} />
    </span>
  );
}
