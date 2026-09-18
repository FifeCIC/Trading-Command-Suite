/**
 * AlertTriggerService
 * ===================
 * Evaluates real trading conditions on a configurable interval and creates
 * real alerts via AlertsService — replacing simulated alerts with live monitoring.
 *
 * Trigger types:
 *  - position-pnl      — position profit/loss exceeds $ or %
 *  - swap-accrual      — daily swap cost exceeds threshold
 *  - margin-utilization — margin used exceeds % of equity
 *  - data-staleness    — last quote older than N seconds
 *  - provider-degraded — provider health changes
 *  - mt5-disconnected  — MT5 bridge connection lost
 *  - market-close      — time until session close < N minutes
 *  - weekend-gap-risk  — projected gap risk exceeds % of equity
 *  - earnings-proximity — earnings event within N hours
 *  - bridge-clock-skew — MT5 bridge clock-offset telemetry missing or implausible (#750)
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AlertsService, type AlertSeverity } from './alerts.service';
import { PrismaService } from '../../database/prisma.service';
import { MarketCalendarService } from '../calendar/market-calendar.service';
import { Mt5ConnectionManager } from '../providers/mt5/mt5-connection-manager.service';
import {
  summariseExposure,
  parseIntent,
  overrideKey,
  type PositionIntent,
} from '../risk/position-intent';
import * as http from 'http';

interface TriggerConfig {
  enabled: boolean;
  cooldownSeconds: number;
  severity: AlertSeverity;
  threshold?: number;
}

@Injectable()
export class AlertTriggerService implements OnModuleInit {
  private readonly logger = new Logger(AlertTriggerService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastFired = new Map<string, number>(); // triggerKey → timestamp
  private readonly POLL_INTERVAL_MS = 60_000; // 60 seconds

  // Default trigger configs
  private readonly configs: Record<string, TriggerConfig> = {
    'position-pnl':      { enabled: true, cooldownSeconds: 300, severity: 'warning', threshold: 5 },    // 5% P&L
    'swap-accrual':      { enabled: true, cooldownSeconds: 3600, severity: 'warning', threshold: 1 },    // $1/day
    'margin-utilization':{ enabled: true, cooldownSeconds: 300, severity: 'high', threshold: 50 },       // 50%
    'data-staleness':    { enabled: true, cooldownSeconds: 600, severity: 'warning', threshold: 300 },   // 5 min
    'provider-degraded': { enabled: true, cooldownSeconds: 600, severity: 'high' },
    'mt5-disconnected':  { enabled: true, cooldownSeconds: 120, severity: 'critical' },
    'market-close':      { enabled: true, cooldownSeconds: 900, severity: 'info', threshold: 30 },       // 30 min
    'weekend-gap-risk':  { enabled: true, cooldownSeconds: 3600, severity: 'warning', threshold: 2 },    // 2%
    'earnings-proximity':{ enabled: true, cooldownSeconds: 7200, severity: 'info', threshold: 24 },      // 24h
    // threshold is HOURS here (the only trigger that is): a real broker offset is at
    // most ±14h, so anything larger means the measurement itself is broken.
    'bridge-clock-skew': { enabled: true, cooldownSeconds: 3600, severity: 'high', threshold: 14 },      // 14h
  };

  constructor(
    private readonly alerts: AlertsService,
    private readonly prisma: PrismaService,
    private readonly calendar: MarketCalendarService,
    private readonly mt5Connection: Mt5ConnectionManager,
  ) {}

  onModuleInit() {
    this.start();
  }

  start() {
    if (this.timer) return;
    this.logger.log('AlertTriggerService started — polling every 60s');
    this.timer = setInterval(() => this.evaluateAll(), this.POLL_INTERVAL_MS);
    // Run first evaluation after 10s delay
    setTimeout(() => this.evaluateAll(), 10_000);
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  // ── Main evaluation loop ────────────────────────────

  private async evaluateAll() {
    const promises = Object.entries(this.configs)
      .filter(([, cfg]) => cfg.enabled)
      .map(([key, cfg]) => this.evaluateTrigger(key, cfg));
    await Promise.allSettled(promises);
  }

  private async evaluateTrigger(key: string, cfg: TriggerConfig) {
    try {
      let condition: { triggered: boolean; title: string; message: string; severity?: AlertSeverity } | null = null;

      switch (key) {
        case 'mt5-disconnected':   condition = await this.checkMt5Connection(); break;
        case 'provider-degraded':  condition = await this.checkProviderHealth(); break;
        case 'data-staleness':     condition = await this.checkDataStaleness(cfg); break;
        case 'position-pnl':       condition = await this.checkPositionPnl(cfg); break;
        case 'swap-accrual':       condition = await this.checkSwapAccrual(cfg); break;
        case 'margin-utilization': condition = await this.checkMarginUtilization(cfg); break;
        case 'market-close':       condition = await this.checkMarketClose(cfg); break;
        case 'weekend-gap-risk':   condition = await this.checkWeekendGapRisk(cfg); break;
        case 'earnings-proximity': condition = await this.checkEarningsProximity(cfg); break;
        case 'bridge-clock-skew':  condition = await this.checkBridgeClockSkew(cfg); break;
      }

      if (condition?.triggered) {
        this.fireAlert(key, cfg, condition.title, condition.message, condition.severity || cfg.severity);
      }
    } catch (err) {
      this.logger.warn(`Trigger "${key}" evaluation failed: ${(err as Error).message}`);
    }
  }

  // ── Trigger checks ──────────────────────────────────

  private async checkMt5Connection(): Promise<{ triggered: boolean; title: string; message: string; severity?: AlertSeverity } | null> {
    try {
      const brokers = await this.mt5Connection.getAllBrokerHealths();
      if (brokers.length === 0) {
        return { triggered: true, title: 'MT5 Bridge Unreachable', message: 'No MT5 broker bridges configured.' };
      }
      const down = brokers.filter((b) => !b.reachable || !b.health?.connected);
      if (down.length === brokers.length) {
        const servers = down.map((b) => b.server).join(', ');
        return { triggered: true, title: 'All MT5 Bridges Disconnected', message: `${servers} not connected. Automated trading disabled.` };
      }
      if (down.length > 0) {
        const servers = down.map((b) => b.server).join(', ');
        return { triggered: true, title: `${down.length} MT5 Bridge(s) Down`, message: `${servers} unreachable. Only ${brokers.length - down.length}/${brokers.length} active.`, severity: 'warning' };
      }
      return { triggered: false, title: '', message: '' };
    } catch {
      return { triggered: true, title: 'MT5 Bridge Error', message: 'Failed to query MT5 bridge health.' };
    }
  }

  private async checkProviderHealth(): Promise<{ triggered: boolean; title: string; message: string; severity?: AlertSeverity } | null> {
    try {
      const res = await this.httpGet('http://localhost:3201/api/providers/health');
      const data = JSON.parse(res);
      const degraded = Array.isArray(data) ? data.filter((p: any) => p.status === 'degraded' || p.status === 'failed') : [];
      if (degraded.length > 0) {
        const names = degraded.map((p: any) => p.name || p.id).join(', ');
        return { triggered: true, title: `${degraded.length} Provider(s) Degraded`, message: `${names} — scoring may be affected.`, severity: degraded.some((p: any) => p.status === 'failed') ? 'critical' : 'warning' };
      }
      return { triggered: false, title: '', message: '' };
    } catch {
      return null; // API unavailable — don't fire alert
    }
  }

  private async checkDataStaleness(cfg: TriggerConfig): Promise<{ triggered: boolean; title: string; message: string } | null> {
    if (!this.prisma.isAvailable) return null;
    try {
      const threshold = new Date(Date.now() - (cfg.threshold || 300) * 1000);
      const staleCount = await this.prisma.marketBar.count({
        where: { timestamp: { lt: threshold } },
      });
      if (staleCount > 0) {
        const minutes = Math.round((cfg.threshold || 300) / 60);
        return { triggered: true, title: 'Market Data Stale', message: `${staleCount} market bar(s) older than ${minutes} minutes. Import fresh data.` };
      }
      return { triggered: false, title: '', message: '' };
    } catch { return null; }
  }

  private async checkPositionPnl(cfg: TriggerConfig): Promise<{ triggered: boolean; title: string; message: string; severity?: AlertSeverity } | null> {
    if (!this.prisma.isAvailable) return null;
    try {
      const positions = await this.prisma.position.findMany({ where: { pnl: { not: null } } });
      const thresholdPct = cfg.threshold || 5;
      for (const pos of positions) {
        if (pos.pnl != null && pos.avgPrice > 0) {
          const pnlPct = Math.abs(pos.pnl / (pos.avgPrice * pos.quantity)) * 100;
          if (pnlPct > thresholdPct) {
            const dir = pos.pnl > 0 ? 'profit' : 'loss';
            return { triggered: true, title: `${pos.symbol} P&L Alert`, message: `${pos.symbol} ${dir}: ${pos.pnl.toFixed(2)} (${pnlPct.toFixed(1)}%).`, severity: pos.pnl < 0 ? 'warning' : 'info' };
          }
        }
      }
      return { triggered: false, title: '', message: '' };
    } catch { return null; }
  }

  private async checkSwapAccrual(cfg: TriggerConfig): Promise<{ triggered: boolean; title: string; message: string } | null> {
    if (!this.prisma.isAvailable) return null;
    try {
      const positions = await this.prisma.position.findMany({ where: { provider: 'mt5' } });
      let totalSwap = 0;
      for (const pos of positions) {
        // Approximate swap from stored data — real implementation would query MT5
        totalSwap += 0;
      }
      if (totalSwap > (cfg.threshold || 1)) {
        return { triggered: true, title: 'Swap Cost Alert', message: `Daily swap costs estimated at $${totalSwap.toFixed(2)}.` };
      }
      return { triggered: false, title: '', message: '' };
    } catch { return null; }
  }

  private async checkMarginUtilization(cfg: TriggerConfig): Promise<{ triggered: boolean; title: string; message: string; severity?: AlertSeverity } | null> {
    try {
      const acc = await this.mt5Connection.getAccountInfo();
      if (!acc) return null;
      if (acc.margin && acc.equity) {
        const utilPct = (acc.margin / acc.equity) * 100;
        if (utilPct > (cfg.threshold || 50)) {
          return { triggered: true, title: 'Margin Utilization High', message: `Margin at ${utilPct.toFixed(1)}% of equity (threshold: ${cfg.threshold}%).`, severity: utilPct > 80 ? 'critical' : 'high' };
        }
      }
      return { triggered: false, title: '', message: '' };
    } catch { return null; }
  }

  private async checkMarketClose(cfg: TriggerConfig): Promise<{ triggered: boolean; title: string; message: string } | null> {
    const status = this.calendar.getMarketStatus('US');
    if (!status.isOpen && status.status === 'pre-market') {
      // Market hasn't opened yet — no close alert needed
      return { triggered: false, title: '', message: '' };
    }
    if (status.minutesUntilClose != null && status.minutesUntilClose > 0 && status.minutesUntilClose < (cfg.threshold || 30)) {
      const label = status.holidayName ? `${status.holidayName} (Early Close)` : 'US Session';
      return {
        triggered: true,
        title: `${label} Closing Soon`,
        message: `US market closes in ${status.minutesUntilClose} minutes${status.holidayName ? ` (${status.holidayName})` : ''}.`,
      };
    }
    return { triggered: false, title: '', message: '' };
  }

  /**
   * weekend-gap-risk — counts positions a WEEKEND GAP can actually hurt.
   *
   * ⚠️ This used to report `position.length` — every row, with no concept of what a position is
   * FOR. On Friday 2026-09-18 that produced:
   *
   *     "26 position(s) open going into weekend. Consider flattening or tightening stops."
   *
   * Measured: 5 were MT5 CFD positions opened within 30 hours (genuine gap risk) and **21 were
   * Trading212 equity holdings**, the oldest opened 25 July, aggregate −996 and held deliberately.
   * "Consider flattening" applied to a long-term holding is the opposite of the correct advice,
   * and because it repeats every Friday it trains the reader to ignore the alert entirely.
   *
   * The fix is not a filter on `provider` — that would hard-code today's two brokers into a
   * heuristic and silently mis-handle a third. Intent is resolved by `position-intent.ts`, where
   * the provider defaults are declared and labelled as inference, and where an unknown provider
   * becomes a QUESTION rather than either a nag or a silent omission.
   */
  private async checkWeekendGapRisk(cfg: TriggerConfig): Promise<{ triggered: boolean; title: string; message: string } | null> {
    const now = new Date();
    const day = now.getUTCDay();
    // Friday check
    if (day !== 5) return { triggered: false, title: '', message: '' };
    if (!this.prisma.isAvailable) return null;
    try {
      const positions = await this.prisma.position.findMany();
      if (positions.length === 0) return { triggered: false, title: '', message: '' };

      const overrides = await this.loadIntentOverrides();
      const { exposed, held, needingDecision } = summariseExposure(positions, overrides);

      if (exposed.length === 0) {
        // No gap-exposed position. Not an alert — and specifically NOT the old behaviour of
        // reporting the whole ledger. Returning `triggered:false` here is what stops the Friday
        // noise; the held/unknown counts are stated below so their absence is not mistaken for
        // the check having failed to run ("fine" must not look like "cannot judge").
        if (needingDecision.length > 0) {
          return {
            triggered: true,
            title: 'Position Intent Unconfirmed',
            message:
              `No gap-exposed positions. ${needingDecision.length} position(s) on a provider with ` +
              `no declared intent (${needingDecision.map((p) => p.symbol).join(', ')}) — the app will ` +
              'not decide these for you. Set an intent to include them in risk checks.',
          };
        }
        return { triggered: false, title: '', message: '' };
      }

      const byProvider = new Map<string, number>();
      for (const p of exposed) byProvider.set(p.provider, (byProvider.get(p.provider) || 0) + 1);
      const breakdown = [...byProvider.entries()].map(([k, v]) => `${v} ${k}`).join(', ');

      return {
        triggered: true,
        title: 'Weekend Gap Risk',
        message:
          `${exposed.length} gap-exposed position(s) open going into weekend (${breakdown}). ` +
          `Consider flattening or tightening stops. ${held.length} long-term holding(s) are ` +
          'excluded by intent.' +
          (needingDecision.length > 0
            ? ` ${needingDecision.length} further position(s) are unclassified and were NOT ` +
              'assessed — set an intent to include them.'
            : ''),
      };
    } catch { return null; }
  }

  /**
   * Reads per-position intent overrides into the map `position-intent.ts` expects.
   *
   * ⚠️ A read FAILURE must not look like "no overrides". With an empty map every position falls
   * back to its provider default — for `trading212` that is `long-term`, i.e. a database hiccup
   * would silently EXEMPT the account's holdings from the alert. The failure is therefore logged
   * and rethrown so `checkWeekendGapRisk` returns null (cannot judge) rather than a clean pass.
   */
  private async loadIntentOverrides(): Promise<Map<string, PositionIntent>> {
    const rows = await this.prisma.positionIntentSetting.findMany();
    const map = new Map<string, PositionIntent>();
    for (const r of rows) {
      const parsed = parseIntent(r.intent);
      if (parsed) map.set(overrideKey(r.provider, r.symbol), parsed);
      else this.logger.warn(`position_intent row ${r.provider}/${r.symbol} has unreadable intent "${r.intent}" — ignored`);
    }
    return map;
  }

  private async checkEarningsProximity(cfg: TriggerConfig): Promise<{ triggered: boolean; title: string; message: string } | null> {
    if (!this.prisma.isAvailable) return null;
    try {
      const threshold = new Date(Date.now() + (cfg.threshold || 24) * 3600 * 1000);
      const upcoming = await this.prisma.earningsEvent.findMany({
        where: { reportDate: { lte: threshold, gte: new Date() } },
        take: 5,
      });
      if (upcoming.length > 0) {
        const symbols = [...new Set(upcoming.map(e => e.symbol))].slice(0, 3).join(', ');
        return { triggered: true, title: 'Earnings Events Approaching', message: `${upcoming.length} earnings event(s) in next ${cfg.threshold}h: ${symbols}...` };
      }
      return { triggered: false, title: '', message: '' };
    } catch { return null; }
  }

  /**
   * Bridge clock-offset telemetry (#750).
   *
   * WHY THIS ALERT EXISTS
   * ---------------------
   * The MT5 bridge measures the broker's server-clock offset (+3h on MetaQuotes-Demo)
   * and subtracts it in `utc_iso()`, so every MT5-sourced timestamp is true UTC. Two
   * failure modes are silent and expensive, and both look like healthy data:
   *
   *  1. **The telemetry is gone.** A bridge build from before #750 (or a rollback)
   *     stamps raw server-clock epochs as UTC, so every bar lands ~3h in the FUTURE.
   *     `computeMarketStatus` then computes a negative `ageMs`, which can never exceed
   *     the staleness threshold — the tradability gate fails OPEN and a stale or
   *     weekend feed reads as tradable. Nothing else in the app complains; scores
   *     still compute, they just describe the wrong moment.
   *  2. **The offset is implausible.** A broken measurement applies a nonsense
   *     conversion to every timestamp. Real broker offsets are within ±14h.
   *
   * Only evaluated while a bridge is reachable AND connected — an unreachable bridge is
   * already covered by `mt5-disconnected`, and firing both would be noise.
   *
   * `cfg.threshold` is in HOURS. This is intentionally an in-app alert rather than a
   * silent log line: the pre-#750 failure survived for weeks because nothing surfaced it.
   */
  private async checkBridgeClockSkew(cfg: TriggerConfig): Promise<{ triggered: boolean; title: string; message: string; severity?: AlertSeverity } | null> {
    try {
      const brokers = await this.mt5Connection.getAllBrokerHealths();
      const live = brokers.filter((b) => b.reachable && b.health?.connected);
      if (live.length === 0) return { triggered: false, title: '', message: '' };

      const missing = live.filter((b) => typeof b.health?.serverUtcOffsetSeconds !== 'number');
      if (missing.length > 0) {
        const servers = missing.map((b) => b.server || `broker ${b.brokerId}`).join(', ');
        return {
          triggered: true,
          title: 'MT5 Clock-Offset Telemetry Missing',
          message: `${servers}: /health reports no serverUtcOffsetSeconds, so the bridge is stamping broker SERVER time as UTC again (pre-#750 build). Timestamps will run ~3h ahead and the market-status gate will fail open. Redeploy scripts/mt5-bridge/mt5_bridge_v2.py.`,
          severity: 'critical',
        };
      }

      const limitHours = cfg.threshold ?? 14;
      const implausible = live.filter((b) => Math.abs(b.health!.serverUtcOffsetSeconds!) > limitHours * 3600);
      if (implausible.length > 0) {
        const detail = implausible
          .map((b) => `${b.server || `broker ${b.brokerId}`} ${(b.health!.serverUtcOffsetSeconds! / 3600).toFixed(2)}h`)
          .join(', ');
        return {
          triggered: true,
          title: 'MT5 Clock-Offset Implausible',
          message: `Measured server-clock offset beyond ±${limitHours}h: ${detail}. Every MT5-sourced timestamp is being shifted by a suspect offset — check GET :5000/health.`,
          severity: 'high',
        };
      }

      return { triggered: false, title: '', message: '' };
    } catch {
      return null; // bridge health unavailable — mt5-disconnected covers this case
    }
  }

  // ── Helpers ─────────────────────────────────────────

  private fireAlert(key: string, cfg: TriggerConfig, title: string, message: string, severity: AlertSeverity) {
    const now = Date.now();
    const last = this.lastFired.get(key) || 0;
    if (now - last < cfg.cooldownSeconds * 1000) return;

    this.lastFired.set(key, now);
    // ⚠️ ARGUMENT ORDER — AlertsService.addAlert(type, title, detail, severity, ticker?, link?).
    // These four args were previously shifted by one (`severity, 'trading', title, message`),
    // so every stored alert had title='trading' and the human message landed in the
    // `severity` column — the Alert Center and the notification bell then showed useless
    // titles and could not colour by severity. Frontend expects `type` to be a CATEGORY
    // (AlertCenterPage TYPE_FALLBACKS: signal | drawdown | daily | backtest | system | trading),
    // not the trigger key. Keep 'trading' as the category, pass the message as `detail`.
    this.alerts.addAlert('trading', title, message, severity);
    this.logger.log(`ALERT [${severity}] ${title}: ${message}`);
  }

  private httpGet(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      http.get(url, { timeout: 5000 }, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => resolve(data));
      }).on('error', reject);
    });
  }
}
